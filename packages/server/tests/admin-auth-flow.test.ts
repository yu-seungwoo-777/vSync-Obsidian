import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildTestAdminApp } from "./helpers/admin-app.js";
import type { FastifyInstance } from "fastify";
import { createDbClient } from "../src/config/database.js";
import { adminCredentials } from "../src/db/schemas/index.js";
import bcrypt from "bcrypt";
import { eq } from "drizzle-orm";

// set-cookie 헤더에서 쿠키 문자열만 추출 (세션 쿠키)
function extractCookies(setCookie: string | string[] | undefined): string {
  if (!setCookie) return "";
  const cookies = Array.isArray(setCookie) ? setCookie : [setCookie];
  return cookies
    .map((c: string) => c.split(";")[0])
    .join("; ");
}

describe("T-005: Auth Routes", () => {
  let app: FastifyInstance;
  const { client, db } = createDbClient();
  const testUsername = `auth-admin-${Date.now()}`;
  const testPassword = "authtest12345678";

  beforeAll(async () => {
    app = await buildTestAdminApp();
    // 테스트용 관리자 계정 생성 (기존 데이터 삭제하지 않음)
    const hash = await bcrypt.hash(testPassword, 12);
    await db.insert(adminCredentials).values({
      username: testUsername,
      passwordHash: hash,
      role: "admin",
    });
  });

  afterAll(async () => {
    // 이 테스트에서 생성한 계정만 정리
    await db
      .delete(adminCredentials)
      .where(eq(adminCredentials.username, testUsername));
    await app.close();
    await client.end();
  });

  describe("POST /admin/api/login", () => {
    it("올바른 자격증명으로 로그인하면 200을 반환한다", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/admin/api/login",
        payload: { username: testUsername, password: testPassword },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.username).toBe(testUsername);
    });

    it("잘못된 비밀번호로 로그인하면 401을 반환한다", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/admin/api/login",
        payload: { username: testUsername, password: "wrongpassword" },
      });

      expect(res.statusCode).toBe(401);
    });

    it("존재하지 않는 사용자로 로그인하면 401을 반환한다", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/admin/api/login",
        payload: { username: "nonexistent", password: "somepassword" },
      });

      expect(res.statusCode).toBe(401);
    });

    it("로그인 성공 시 세션 쿠키가 발급된다", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/admin/api/login",
        payload: { username: testUsername, password: testPassword },
      });

      expect(res.statusCode).toBe(200);
      const setCookie = res.headers["set-cookie"];
      expect(setCookie).toBeDefined();
    });
  });

  describe("POST /admin/api/logout", () => {
    it("로그인 상태에서 로그아웃하면 200을 반환한다", async () => {
      // 먼저 로그인하여 세션 쿠키 획득
      const loginRes = await app.inject({
        method: "POST",
        url: "/admin/api/login",
        payload: { username: testUsername, password: testPassword },
      });

      const cookies = extractCookies(loginRes.headers["set-cookie"]);

      const res = await app.inject({
        method: "POST",
        url: "/admin/api/logout",
        headers: {
          cookie: cookies,
        },
      });

      expect(res.statusCode).toBe(200);
    });

    it("미인증 상태에서 로그아웃 시도 시 401을 반환한다", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/admin/api/logout",
      });

      expect(res.statusCode).toBe(401);
    });
  });

  describe("GET /admin/api/me", () => {
    it("인증된 상태에서 사용자 정보를 반환한다", async () => {
      // 로그인하여 세션 획득
      const loginRes = await app.inject({
        method: "POST",
        url: "/admin/api/login",
        payload: { username: testUsername, password: testPassword },
      });

      const cookies = extractCookies(loginRes.headers["set-cookie"]);

      const res = await app.inject({
        method: "GET",
        url: "/admin/api/me",
        headers: {
          cookie: cookies,
        },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.username).toBe(testUsername);
    });

    it("/me 응답에 role 필드가 포함된다 (REQ-RBAC-006 AC-017)", async () => {
      const loginRes = await app.inject({
        method: "POST",
        url: "/admin/api/login",
        payload: { username: testUsername, password: testPassword },
      });

      const cookies = extractCookies(loginRes.headers["set-cookie"]);

      const res = await app.inject({
        method: "GET",
        url: "/admin/api/me",
        headers: { cookie: cookies },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.role).toBe("admin");
    });

    it("미인증 상태에서 401을 반환한다", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/admin/api/me",
      });

      expect(res.statusCode).toBe(401);
    });
  });
});
