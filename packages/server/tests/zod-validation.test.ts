import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildApp } from "../src/app.js";
import type { FastifyInstance } from "fastify";
import { createDbClient } from "../src/config/database.js";
import { createTestVault } from "./setup.js";
import { setupTestAuth, authHeaders, cleanupTestAuth } from "./helpers/jwt-auth.js";

describe("Zod preHandler validation", () => {
  let app: FastifyInstance;
  let vault_id: string;
  let jwt_token: string;
  const { client } = createDbClient();

  beforeAll(async () => {
    app = await buildApp();

    // JWT 토큰 획득
    jwt_token = await setupTestAuth(app);

    const vault = await createTestVault(app, "zod-test-vault");
    vault_id = vault.vault_id;
    
  });

  afterAll(async () => {
    await app.close();
    await client.end();
  });

  function auth_headers() {
    return { ...authHeaders(jwt_token), "content-type": "application/json" };
  }

  describe("PUT /file - fileUploadSchema", () => {
    it("path 가 없으면 400 을 반환한다", async () => {
      const res = await app.inject({
        method: "PUT",
        url: `/v1/vault/${vault_id}/file`,
        headers: auth_headers(),
        payload: { content: "hello", hash: "abc123" },
      });

      expect(res.statusCode).toBe(400);
    });

    it("hash 가 없으면 400 을 반환한다", async () => {
      const res = await app.inject({
        method: "PUT",
        url: `/v1/vault/${vault_id}/file`,
        headers: auth_headers(),
        payload: { path: "test.md", content: "hello" },
      });

      expect(res.statusCode).toBe(400);
    });

    it("유효한 입력은 통과한다", async () => {
      const res = await app.inject({
        method: "PUT",
        url: `/v1/vault/${vault_id}/file`,
        headers: auth_headers(),
        payload: { path: "test.md", content: "hello", hash: "abc123" },
      });

      // 200 또는 409 (충돌) 등 비즈니스 로직 결과
      expect([200, 409]).toContain(res.statusCode);
    });
  });

  describe("POST /edit - editSchema", () => {
    it("old_text 가 빈 문자열이면 400 을 반환한다", async () => {
      const res = await app.inject({
        method: "POST",
        url: `/v1/vault/${vault_id}/edit`,
        headers: auth_headers(),
        payload: { path: "test.md", old_text: "", new_text: "world" },
      });

      expect(res.statusCode).toBe(400);
    });

    it("new_text 가 없으면 400 을 반환한다", async () => {
      const res = await app.inject({
        method: "POST",
        url: `/v1/vault/${vault_id}/edit`,
        headers: auth_headers(),
        payload: { path: "test.md", old_text: "hello" },
      });

      expect(res.statusCode).toBe(400);
    });
  });

  describe("GET /search - searchSchema", () => {
    it("q 가 없으면 400 을 반환한다", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/v1/vault/${vault_id}/search`,
        headers: authHeaders(jwt_token),
      });

      expect(res.statusCode).toBe(400);
    });

    it("q 가 빈 문자열이면 400 을 반환한다", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/v1/vault/${vault_id}/search`,
        headers: authHeaders(jwt_token),
        query: { q: "" },
      });

      expect(res.statusCode).toBe(400);
    });
  });

  describe("PUT /sync-status - syncStatusSchema", () => {
    it("device_id 에 특수문자가 있으면 400 을 반환한다", async () => {
      const res = await app.inject({
        method: "PUT",
        url: `/v1/vault/${vault_id}/sync-status`,
        headers: auth_headers(),
        payload: {
          device_id: "device@invalid!",
          last_event_id: "550e8400-e29b-41d4-a716-446655440000",
        },
      });

      expect(res.statusCode).toBe(400);
    });

    it("last_event_id 가 UUID 가 아니면 400 을 반환한다", async () => {
      const res = await app.inject({
        method: "PUT",
        url: `/v1/vault/${vault_id}/sync-status`,
        headers: auth_headers(),
        payload: {
          device_id: "device-123",
          last_event_id: "not-a-uuid",
        },
      });

      expect(res.statusCode).toBe(400);
    });
  });

  describe("GET /events - eventsQuerySchema", () => {
    it("since 가 잘못된 UUID 형식이면 400 을 반환한다", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/v1/vault/${vault_id}/events`,
        headers: authHeaders(jwt_token),
        query: { since: "invalid-uuid" },
      });

      expect(res.statusCode).toBe(400);
    });
  });
});
