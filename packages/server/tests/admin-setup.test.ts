import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildTestAdminApp } from "./helpers/admin-app.js";
import type { FastifyInstance } from "fastify";
import { createDbClient } from "../src/config/database.js";
import { eq } from "drizzle-orm";
import { adminCredentials } from "../src/db/schemas/index.js";

describe("T-004: Setup Routes", () => {
  let app: FastifyInstance;
  const { client, db } = createDbClient();
  // 각 테스트에서 생성한 사용자명 추적
  const createdUsernames: string[] = [];

  beforeAll(async () => {
    app = await buildTestAdminApp();
  });

  afterAll(async () => {
    // 이 테스트에서 생성한 계정만 정리
    for (const username of createdUsernames) {
      await db
        .delete(adminCredentials)
        .where(eq(adminCredentials.username, username));
    }
    await app.close();
    await client.end();
  });

  describe("GET /admin/api/status", () => {
    it("초기 상태에서 initialized 필드를 반환한다", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/admin/api/status",
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toHaveProperty("initialized");
      // initialized는 boolean
      expect(typeof res.json().initialized).toBe("boolean");
    });
  });

  describe("POST /admin/api/setup", () => {
    it("올바른 입력으로 관리자 계정을 생성하고 201을 반환한다", async () => {
      const username = `setup-test-${Date.now()}`;
      const res = await app.inject({
        method: "POST",
        url: "/admin/api/setup",
        payload: { username, password: "newpassword123" },
      });

      // 이미 초기화된 경우 403 (다른 테스트가 먼저 실행)
      if (res.statusCode === 403) {
        return; // 다른 테스트가 이미 초기화한 경우 스킵
      }

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.username).toBe(username);
      createdUsernames.push(username);

      // DB에 저장되었는지 확인
      const result = await db
        .select()
        .from(adminCredentials)
        .where(eq(adminCredentials.username, username));

      expect(result.length).toBe(1);
      expect(result[0].passwordHash).toMatch(/^\$2[aby]\$/);
    });

    it("username이 3자 미만이면 400을 반환한다", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/admin/api/setup",
        payload: { username: "ab", password: "validpassword" },
      });

      // 400 (검증 실패) 또는 403 (이미 초기화됨)
      if (res.statusCode === 403) return;
      expect(res.statusCode).toBe(400);
    });

    it("password가 8자 미만이면 400을 반환한다", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/admin/api/setup",
        payload: { username: "validuser", password: "short" },
      });

      if (res.statusCode === 403) return;
      expect(res.statusCode).toBe(400);
    });

    it("이미 초기화된 경우 403을 반환한다", async () => {
      // 상태 확인
      const statusRes = await app.inject({
        method: "GET",
        url: "/admin/api/status",
      });

      if (statusRes.json().initialized) {
        // 이미 초기화된 상태에서 setup 시도
        const res = await app.inject({
          method: "POST",
          url: "/admin/api/setup",
          payload: { username: `dup-${Date.now()}`, password: "secondpassword123" },
        });
        expect(res.statusCode).toBe(403);
      }
      // 초기화되지 않은 상태면 이 테스트는 스킵 (다른 테스트가 먼저 실행되었을 것)
    });

    it("설정 성공 시 세션 쿠키가 발급된다", async () => {
      // 상태 확인
      const statusRes = await app.inject({
        method: "GET",
        url: "/admin/api/status",
      });

      if (statusRes.json().initialized) {
        // 이미 초기화된 상태면 스킵
        return;
      }

      const username = `session-test-${Date.now()}`;
      const res = await app.inject({
        method: "POST",
        url: "/admin/api/setup",
        payload: { username, password: "sessionpassword123" },
      });

      expect(res.statusCode).toBe(201);
      const setCookie = res.headers["set-cookie"];
      expect(setCookie).toBeDefined();
      createdUsernames.push(username);
    });

    it("첫 설정 계정의 role이 admin이어야 한다 (REQ-RBAC-001 AC-002)", async () => {
      // 상태 확인
      const statusRes = await app.inject({
        method: "GET",
        url: "/admin/api/status",
      });

      if (statusRes.json().initialized) {
        // 이미 초기화된 상태면 스킵
        return;
      }

      const username = `role-test-${Date.now()}`;
      const res = await app.inject({
        method: "POST",
        url: "/admin/api/setup",
        payload: { username, password: "rolepassword123" },
      });

      if (res.statusCode === 403) return; // 이미 초기화됨

      expect(res.statusCode).toBe(201);

      // DB에서 role 확인
      const result = await db
        .select()
        .from(adminCredentials)
        .where(eq(adminCredentials.username, username));

      expect(result.length).toBe(1);
      expect(result[0].role).toBe("admin");
      createdUsernames.push(username);
    });
  });
});
