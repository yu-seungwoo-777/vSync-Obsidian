import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildApp } from "../src/app.js";
import type { FastifyInstance } from "fastify";
import { createDbClient } from "../src/config/database.js";
import { createTestVault } from "./setup.js";
import { setupTestAuth, authHeaders, cleanupTestAuth } from "./helpers/jwt-auth.js";

describe("Pagination", () => {
  let app: FastifyInstance;
  let vault_id: string;
  let jwt_token: string;
  const { client } = createDbClient();

  beforeAll(async () => {
    app = await buildApp();

    // JWT 토큰 획득
    jwt_token = await setupTestAuth(app);

    const vault = await createTestVault(app, "pagination-test");
    vault_id = vault.vault_id;
    

    // 테스트용 파일 여러 개 업로드
    for (let i = 1; i <= 5; i++) {
      await app.inject({
        method: "PUT",
        url: `/v1/vault/${vault_id}/raw/notes/file${i}.md`,
        headers: { ...authHeaders(jwt_token),
          "content-type": "text/markdown",
        },
        body: `# File ${i}\nContent for file ${i}`,
      });
    }
  });

  afterAll(async () => {
    await app.close();
    await client.end();
  });

  function auth_headers() {
    return { ...authHeaders(jwt_token) };
  }

  describe("GET /files - 페이지네이션", () => {
    it("limit 파라미터로 결과 수를 제한한다", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/v1/vault/${vault_id}/files?limit=2`,
        headers: auth_headers(),
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(Array.isArray(body)).toBe(true);
      expect(body.length).toBeLessThanOrEqual(2);
    });

    it("기본 응답에 파일 목록이 포함된다", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/v1/vault/${vault_id}/files`,
        headers: auth_headers(),
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(Array.isArray(body)).toBe(true);
      expect(body.length).toBeGreaterThan(0);
    });
  });

  describe("GET /events - 페이지네이션", () => {
    it("limit 파라미터로 이벤트 수를 제한한다", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/v1/vault/${vault_id}/events?limit=2`,
        headers: auth_headers(),
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.events).toBeDefined();
      expect(body.events.length).toBeLessThanOrEqual(2);
    });

    it("이벤트 목록이 반환된다", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/v1/vault/${vault_id}/events`,
        headers: auth_headers(),
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.events).toBeDefined();
      expect(Array.isArray(body.events)).toBe(true);
    });
  });

  describe("GET /conflicts - 페이지네이션", () => {
    it("충돌 목록이 반환된다", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/v1/vault/${vault_id}/conflicts`,
        headers: auth_headers(),
      });

      expect(res.statusCode).toBe(200);
    });

    it("limit 파라미터가 적용된다", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/v1/vault/${vault_id}/conflicts?limit=10`,
        headers: auth_headers(),
      });

      expect(res.statusCode).toBe(200);
    });
  });

  describe("GET /versions/* - 페이지네이션", () => {
    it("파일 버전 목록이 반환된다", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/v1/vault/${vault_id}/versions/notes/file1.md`,
        headers: auth_headers(),
      });

      expect(res.statusCode).toBe(200);
    });

    it("존재하지 않는 파일은 404", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/v1/vault/${vault_id}/versions/nonexistent.md`,
        headers: auth_headers(),
      });

      expect(res.statusCode).toBe(404);
    });
  });
});
