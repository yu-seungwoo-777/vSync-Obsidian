import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildApp } from "../src/app.js";
import type { FastifyInstance } from "fastify";
import { createDbClient } from "../src/config/database.js";
import { createTestVault } from "./setup.js";
import { setupTestAuth, authHeaders, cleanupTestAuth } from "./helpers/jwt-auth.js";

describe("HTTP status codes", () => {
  let app: FastifyInstance;
  let vault_id: string;
  let jwt_token: string;
  const { client } = createDbClient();

  beforeAll(async () => {
    app = await buildApp();

    jwt_token = await setupTestAuth(app);

    const vault = await createTestVault(app, "status-code-test");
    vault_id = vault.vault_id;
  });

  afterAll(async () => {
    await cleanupTestAuth();
    await app.close();
    await client.end();
  });

  describe("400 - Bad Request (검증 에러)", () => {
    it("POST /vault: 이름 없으면 400", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/v1/vault",
        payload: {},
      });

      expect(res.statusCode).toBe(400);
    });

    it("POST /vault: 이름이 100자 초과면 400", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/v1/vault",
        payload: { name: "a".repeat(101) },
      });

      expect(res.statusCode).toBe(400);
    });

    it("POST /vault: 이름이 정확히 100자면 성공한다", async () => {
      const vault = await createTestVault(app, "a".repeat(100));
      expect(vault.vault_id).toBeDefined();
    });

    it("PUT /file: path 없으면 400", async () => {
      const res = await app.inject({
        method: "PUT",
        url: `/v1/vault/${vault_id}/file`,
        headers: { ...authHeaders(jwt_token), "content-type": "application/json" },
        payload: { content: "test", hash: "abc" },
      });

      expect(res.statusCode).toBe(400);
    });

    it("GET /search: q 없으면 400", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/v1/vault/${vault_id}/search`,
        headers: authHeaders(jwt_token),
      });

      expect(res.statusCode).toBe(400);
    });
  });

  describe("401 - Unauthorized (인증 실패)", () => {
    it("JWT 토큰 없이 보호된 라우트 접근 시 401", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/v1/vault/${vault_id}/files`,
      });

      expect(res.statusCode).toBe(401);
    });

    it("잘못된 JWT 토큰으로 접근 시 401", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/v1/vault/${vault_id}/files`,
        headers: { authorization: "Bearer invalid-token" },
      });

      expect(res.statusCode).toBe(401);
    });

    it("존재하지 않는 vault ID 로 접근 시 401", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/v1/vault/00000000-0000-0000-0000-000000000000/files",
        headers: authHeaders(jwt_token),
      });

      expect(res.statusCode).toBe(404);
    });
  });

  describe("404 - Not Found", () => {
    it("존재하지 않는 파일 조회 시 404", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/v1/vault/${vault_id}/raw/nonexistent.md`,
        headers: authHeaders(jwt_token),
      });

      expect(res.statusCode).toBe(404);
    });
  });
});
