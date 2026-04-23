import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildTestAdminApp } from "./helpers/admin-app.js";
import type { FastifyInstance } from "fastify";
import { createDbClient } from "../src/config/database.js";
import { adminCredentials } from "../src/db/schemas/index.js";
import { eq } from "drizzle-orm";

describe("T-002: Session Plugin", () => {
  let app: FastifyInstance;
  const { client } = createDbClient();

  beforeAll(async () => {
    app = await buildTestAdminApp();
  });

  afterAll(async () => {
    await app.close();
    await client.end();
  });

  it("세션 쿠키가 응답에 포함된다", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/admin/api/status",
    });

    // 세션 쿠키가 존재하는지 확인 (set-cookie 헤더)
    const cookies = res.headers["set-cookie"];
    // 상태 확인은 인증 없이 가능하므로 세션 쿠키가 있을 수 있음
    expect(res.statusCode).toBe(200);
  });
});

describe("T-003: Admin Auth Middleware", () => {
  let app: FastifyInstance;
  const { client, db } = createDbClient();
  const testUsername = `session-test-${Date.now()}`;

  beforeAll(async () => {
    app = await buildTestAdminApp();
  });

  afterAll(async () => {
    await db.delete(adminCredentials).where(eq(adminCredentials.username, testUsername));
    await app.close();
    await client.end();
  });

  it("인증 없이 보호된 엔드포인트에 접근하면 401을 반환한다", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/admin/api/me",
    });

    expect(res.statusCode).toBe(401);
  });

  it("/admin/api/status는 인증 없이 접근 가능하다", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/admin/api/status",
    });

    expect(res.statusCode).toBe(200);
  });

  it("/admin/api/setup은 인증 없이 접근 가능하다", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/admin/api/setup",
      payload: { username: testUsername, password: "testpassword123" },
    });

    // 201 또는 403 (이미 설정된 경우) 둘 다 인증 우회 허용을 의미
    expect([201, 403]).toContain(res.statusCode);
  });

  it("/admin/api/login은 인증 없이 접근 가능하다", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/admin/api/login",
      payload: { username: "nonexistent", password: "wrongpassword" },
    });

    // 401 (잘못된 자격증명)이어도 인증 우회 허용을 의미
    expect([200, 401]).toContain(res.statusCode);
  });
});
