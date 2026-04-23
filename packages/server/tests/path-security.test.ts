import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildApp } from "../src/app.js";
import type { FastifyInstance } from "fastify";
import { createDbClient } from "../src/config/database.js";
import { createTestVault } from "./setup.js";
import { setupTestAuth, authHeaders, cleanupTestAuth } from "./helpers/jwt-auth.js";

describe("Path validation middleware", () => {
  let app: FastifyInstance;
  let vault_id: string;
  let jwt_token: string;
  const { client } = createDbClient();

  beforeAll(async () => {
    app = await buildApp();

    // JWT 토큰 획득
    jwt_token = await setupTestAuth(app);

    // 테스트용 볼트 생성
    const vault = await createTestVault(app, "path-security-test");
    vault_id = vault.vault_id;
    
  });

  afterAll(async () => {
    await app.close();
    await client.end();
  });

  function auth_headers(extra?: Record<string, string>) {
    return { ...authHeaders(jwt_token), ...extra };
  }

  describe("Body 기반 path 검증 (PUT /file)", () => {
    it(".. 가 포함된 path 는 400 을 반환한다", async () => {
      const res = await app.inject({
        method: "PUT",
        url: `/v1/vault/${vault_id}/file`,
        headers: auth_headers({ "content-type": "application/json" }),
        payload: {
          path: "../etc/passwd",
          content: "test",
          hash: "abc123",
        },
      });

      expect(res.statusCode).toBe(400);
      const body = res.json();
      expect(body).toHaveProperty("error");
    });

    it("null byte 가 포함된 path 는 400 을 반환한다", async () => {
      const res = await app.inject({
        method: "PUT",
        url: `/v1/vault/${vault_id}/file`,
        headers: auth_headers({ "content-type": "application/json" }),
        payload: {
          path: "file\0.md",
          content: "test",
          hash: "abc123",
        },
      });

      expect(res.statusCode).toBe(400);
    });

    it("정상 path 는 통과한다", async () => {
      const res = await app.inject({
        method: "PUT",
        url: `/v1/vault/${vault_id}/file`,
        headers: auth_headers({ "content-type": "application/json" }),
        payload: {
          path: "notes/test.md",
          content: "test content",
          hash: "abc123def456",
        },
      });

      expect(res.statusCode).not.toBe(400);
    });
  });

  describe("Body 기반 path 검증 (POST /edit)", () => {
    it(".. 가 포함된 path 는 400 을 반환한다", async () => {
      // 먼저 정상 파일 생성
      await app.inject({
        method: "PUT",
        url: `/v1/vault/${vault_id}/raw/edit-target.md`,
        headers: auth_headers({ "content-type": "text/markdown" }),
        body: "initial content here",
      });

      const res = await app.inject({
        method: "POST",
        url: `/v1/vault/${vault_id}/edit`,
        headers: auth_headers({ "content-type": "application/json" }),
        payload: {
          path: "../../etc/passwd",
          old_text: "initial",
          new_text: "modified",
        },
      });

      expect(res.statusCode).toBe(400);
    });
  });

  describe("첨부파일 경로 검증 (PUT /attachment/*)", () => {
    it("null byte 가 포함된 경로는 에러를 반환한다", async () => {
      // Fastify URL 정규화로 .. 가 제거되므로 null byte 로 테스트
      const res = await app.inject({
        method: "PUT",
        url: `/v1/vault/${vault_id}/attachment/test%00.png`,
        headers: auth_headers({ "content-type": "image/png" }),
        body: Buffer.from("fake image"),
      });

      // null byte 가 URL 디코딩되어 경로 검증에서 차단되어야 함
      expect(res.statusCode).toBeGreaterThanOrEqual(400);
    });
  });

  describe("버전 경로 검증 (GET /versions/*)", () => {
    it("null byte 가 포함된 버전 경로는 400 을 반환한다", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/v1/vault/${vault_id}/versions/test%00.md`,
        headers: auth_headers(),
      });

      expect(res.statusCode).toBe(400);
      const body = res.json();
      expect(body).toHaveProperty("error");
    });

    it("정상 버전 경로는 통과한다", async () => {
      // 먼저 파일 업로드
      await app.inject({
        method: "PUT",
        url: `/v1/vault/${vault_id}/raw/versions-test.md`,
        headers: auth_headers({ "content-type": "text/markdown" }),
        body: "version content",
      });

      const res = await app.inject({
        method: "GET",
        url: `/v1/vault/${vault_id}/versions/versions-test.md`,
        headers: auth_headers(),
      });

      // 200 또는 404 - 400 은 아니어야 함
      expect(res.statusCode).not.toBe(400);
    });
  });

  describe("정상 경로는 모두 통과한다", () => {
    it("raw PUT 이 정상 처리된다", async () => {
      const res = await app.inject({
        method: "PUT",
        url: `/v1/vault/${vault_id}/raw/notes/test.md`,
        headers: auth_headers({ "content-type": "text/markdown" }),
        body: "# Test",
      });

      expect(res.statusCode).not.toBe(400);
    });

    it("raw GET 이 정상 처리된다", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/v1/vault/${vault_id}/raw/notes/test.md`,
        headers: auth_headers(),
      });

      // 200 또는 404 (파일 없음) - 400 은 아니어야 함
      expect(res.statusCode).not.toBe(400);
    });

    it("한글 경로가 정상 처리된다", async () => {
      const res = await app.inject({
        method: "PUT",
        url: `/v1/vault/${vault_id}/raw/%EB%85%B8%ED%8A%B8/%ED%94%84%EB%A1%9C%EC%A0%9D%ED%8A%B8.md`,
        headers: auth_headers({ "content-type": "text/markdown" }),
        body: "# 한국어 경로 테스트",
      });

      expect(res.statusCode).not.toBe(400);
    });
  });
});
