import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Fastify from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import cookie from "@fastify/cookie";
import session from "@fastify/session";
import { createDbClient } from "../src/config/database.js";
import { adminCredentials } from "../src/db/schemas/index.js";
import bcrypt from "bcrypt";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";

// Rate limiting이 활성화된 테스트용 앱 빌더
// /admin/api/login 경로에만 rate limiting 적용
async function buildRateLimitedApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });

  await app.register(cors, { origin: true });

  // 세션 플러그인
  await app.register(cookie);
  await app.register(session, {
    secret: "test-session-secret-for-rate-limit-testing",
    cookie: {
      httpOnly: true,
      sameSite: "strict" as const,
      secure: false,
      maxAge: 24 * 60 * 60 * 1000,
    },
    saveUninitialized: false,
  });

  // 로그인 전용 rate limit (캡슐화)
  await app.register(rateLimit, {
    max: 3,
    timeWindow: 5000,
    keyGenerator: (request) => `login:${request.ip}`,
    // /admin/api/login POST만 제한, 나머지는 통과
    allowList: (request) => {
      if (request.method !== "POST") return true;
      const url = request.url.split("?")[0];
      return url !== "/admin/api/login";
    },
    errorHttpResponseBuilder: () => ({
      error: "Too many login attempts. Try again in 15 minutes.",
    }),
  });

  // 관리자 라우트 (rate limit 아래에 등록)
  const { db } = createDbClient();

  // /admin/api/status — 공개
  app.get("/admin/api/status", async () => {
    const result = await db
      .select({ id: adminCredentials.id })
      .from(adminCredentials)
      .limit(1);
    return { initialized: result.length > 0 };
  });

  // /admin/api/login — rate limiting 적용됨
  app.post("/admin/api/login", async (request, reply) => {
    const { username, password } = request.body as {
      username?: string;
      password?: string;
    };

    if (!username || !password) {
      reply.code(401).send({ error: "Invalid credentials" });
      return;
    }

    const result = await db
      .select()
      .from(adminCredentials)
      .where(eq(adminCredentials.username, username))
      .limit(1);

    if (result.length === 0) {
      reply.code(401).send({ error: "Invalid credentials" });
      return;
    }

    const admin = result[0];
    const valid = await bcrypt.compare(password, admin.passwordHash);
    if (!valid) {
      reply.code(401).send({ error: "Invalid credentials" });
      return;
    }

    request.session.set("adminId", admin.id);
    request.session.set("username", admin.username);

    return { username: admin.username };
  });

  return app;
}

describe("AC-AUTH-005: 로그인 Rate Limiting", () => {
  let app: FastifyInstance;
  const { client, db } = createDbClient();
  const testUsername = `ratelimit-admin-${Date.now()}`;
  const testPassword = "ratelimitpw12345678";

  beforeAll(async () => {
    app = await buildRateLimitedApp();
    const hash = await bcrypt.hash(testPassword, 12);
    await db.insert(adminCredentials).values({
      username: testUsername,
      passwordHash: hash,
    });
  });

  afterAll(async () => {
    await db
      .delete(adminCredentials)
      .where(eq(adminCredentials.username, testUsername));
    await app.close();
    await client.end();
  });

  it("3회 연속 로그인 실패 후 429 Too Many Requests를 반환한다", async () => {
    // 3회 실패 (max=3)
    for (let i = 0; i < 3; i++) {
      const res = await app.inject({
        method: "POST",
        url: "/admin/api/login",
        payload: { username: testUsername, password: "wrongpassword" },
      });
      expect(res.statusCode).toBe(401);
    }

    // 4번째 요청은 rate limit에 걸려야 함
    const res = await app.inject({
      method: "POST",
      url: "/admin/api/login",
      payload: { username: testUsername, password: "wrongpassword" },
    });
    expect(res.statusCode).toBe(429);
    const body = res.json();
    expect(body.error).toContain("Too Many Requests");
  });

  it("rate limit은 다른 엔드포인트에 영향을 주지 않는다", async () => {
    // /admin/api/status는 rate limit에서 제외
    for (let i = 0; i < 5; i++) {
      const res = await app.inject({
        method: "GET",
        url: "/admin/api/status",
      });
      expect(res.statusCode).toBe(200);
    }
  });
});
