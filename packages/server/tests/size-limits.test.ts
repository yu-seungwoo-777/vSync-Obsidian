import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildApp } from "../src/app.js";
import type { FastifyInstance } from "fastify";
import { createDbClient } from "../src/config/database.js";
import { createTestVault } from "./setup.js";
import { setupTestAuth, authHeaders, cleanupTestAuth } from "./helpers/jwt-auth.js";
import { MAX_RAW_SIZE, MAX_EDIT_SIZE, MAX_SEARCH_QUERY_LENGTH } from "../src/utils/validation.js";

describe("Size limit enforcement", () => {
  let app: FastifyInstance;
  let vault_id: string;
  let jwt_token: string;
  const { client } = createDbClient();

  beforeAll(async () => {
    app = await buildApp();

    // JWT 토큰 획득
    jwt_token = await setupTestAuth(app);

    const vault = await createTestVault(app, "size-limit-test");
    vault_id = vault.vault_id;
    
  });

  afterAll(async () => {
    await app.close();
    await client.end();
  });

  function auth_headers() {
    return { ...authHeaders(jwt_token) };
  }

  describe("Raw markdown upload - 10MB 제한", () => {
    it("10MB 초과 시 413 을 반환한다", async () => {
      // 큰 body 생성 (10MB + 1)
      const big_content = "x".repeat(MAX_RAW_SIZE + 1);
      const res = await app.inject({
        method: "PUT",
        url: `/v1/vault/${vault_id}/raw/big-note.md`,
        headers: {
          ...auth_headers(),
          "content-type": "text/markdown",
        },
        body: big_content,
      });

      expect(res.statusCode).toBe(413);
      const body = res.json();
      expect(body).toHaveProperty("error");
    });

    it("10MB 이하면 정상 처리된다", async () => {
      const res = await app.inject({
        method: "PUT",
        url: `/v1/vault/${vault_id}/raw/small-note.md`,
        headers: {
          ...auth_headers(),
          "content-type": "text/markdown",
        },
        body: "small content",
      });

      // 200 또는 충돌 관련 응답 (400/413 이 아님)
      expect(res.statusCode).not.toBe(413);
    });
  });

  describe("Edit - 1MB 제한", () => {
    it("old_text 가 1MB 초과 시 413 을 반환한다", async () => {
      // 먼저 파일 하나 업로드
      await app.inject({
        method: "PUT",
        url: `/v1/vault/${vault_id}/raw/edit-test.md`,
        headers: {
          ...auth_headers(),
          "content-type": "text/markdown",
        },
        body: "initial content for edit test",
      });

      const big_old_text = "x".repeat(MAX_EDIT_SIZE + 1);
      const res = await app.inject({
        method: "POST",
        url: `/v1/vault/${vault_id}/edit`,
        headers: {
          ...auth_headers(),
          "content-type": "application/json",
        },
        payload: {
          path: "edit-test.md",
          old_text: big_old_text,
          new_text: "replaced",
        },
      });

      expect(res.statusCode).toBe(413);
    });
  });

  describe("Search - 500자 제한", () => {
    it("검색어가 500자 초과 시 400 을 반환한다", async () => {
      const long_query = "a".repeat(MAX_SEARCH_QUERY_LENGTH + 1);
      const res = await app.inject({
        method: "GET",
        url: `/v1/vault/${vault_id}/search`,
        headers: auth_headers(),
        query: { q: long_query },
      });

      // Zod 검증 또는 커스텀 검증에서 400 반환
      expect(res.statusCode).toBe(400);
    });

    it("검색어가 500자 이하면 정상 처리된다", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/v1/vault/${vault_id}/search`,
        headers: auth_headers(),
        query: { q: "test query" },
      });

      expect(res.statusCode).toBe(200);
    });
  });
});
