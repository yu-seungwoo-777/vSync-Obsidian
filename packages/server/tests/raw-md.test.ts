import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildApp } from "../src/app.js";
import type { FastifyInstance } from "fastify";
import { createDbClient } from "../src/config/database.js";
import { eq, and } from "drizzle-orm";
import { files } from "../src/db/schemas/index.js";
import { createTestVault } from "./setup.js";
import { setupTestAuth, authHeaders, cleanupTestAuth } from "./helpers/jwt-auth.js";
import crypto from "node:crypto";

describe("Raw MD Routes", () => {
  let app: FastifyInstance;
  let vault_id: string;
  let jwt_token: string;
  const { client } = createDbClient();

  beforeAll(async () => {
    app = await buildApp();

    // JWT 토큰 획득
    jwt_token = await setupTestAuth(app);

    const vault = await createTestVault(app, "raw-md-test-vault");
    vault_id = vault.vault_id;
    
  });

  afterAll(async () => {
    await app.close();
    await client.end();
  });

  const auth_headers = () => authHeaders(jwt_token);

  describe("PUT /v1/vault/:id/raw/* - Raw 마크다운 업로드", () => {
    it("text/markdown 본문으로 파일을 저장한다", async () => {
      const res = await app.inject({
        method: "PUT",
        url: `/v1/vault/${vault_id}/raw/notes/hello.md`,
        headers: {
          ...auth_headers(),
          "content-type": "text/markdown",
        },
        body: "# Hello World",
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.path).toBe("notes/hello.md");
      expect(body.hash).toBeDefined();
      // SHA-256 해시 검증
      const expected_hash = crypto
        .createHash("sha256")
        .update("# Hello World")
        .digest("hex");
      expect(body.hash).toBe(expected_hash);
    });

    it("빈 본문도 허용한다", async () => {
      const res = await app.inject({
        method: "PUT",
        url: `/v1/vault/${vault_id}/raw/notes/empty.md`,
        headers: {
          ...auth_headers(),
          "content-type": "text/markdown",
        },
        body: "",
      });

      expect(res.statusCode).toBe(200);
    });

    it("인증 없으면 401을 반환한다", async () => {
      const res = await app.inject({
        method: "PUT",
        url: `/v1/vault/${vault_id}/raw/notes/test.md`,
        headers: {
          "content-type": "text/markdown",
        },
        body: "test",
      });

      expect(res.statusCode).toBe(401);
    });
  });

  describe("GET /v1/vault/:id/raw/* - Raw 마크다운 조회", () => {
    it("업로드한 파일의 원본 마크다운을 반환한다", async () => {
      // 먼저 업로드
      await app.inject({
        method: "PUT",
        url: `/v1/vault/${vault_id}/raw/notes/fetch-test.md`,
        headers: {
          ...auth_headers(),
          "content-type": "text/markdown",
        },
        body: "# Fetch Test Content",
      });

      // 조회
      const res = await app.inject({
        method: "GET",
        url: `/v1/vault/${vault_id}/raw/notes/fetch-test.md`,
        headers: auth_headers(),
      });

      expect(res.statusCode).toBe(200);
      expect(res.headers["content-type"]).toContain("text/markdown");
      expect(res.body).toBe("# Fetch Test Content");
    });

    it("존재하지 않는 파일이면 404를 반환한다", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/v1/vault/${vault_id}/raw/notes/nonexistent.md`,
        headers: auth_headers(),
      });

      expect(res.statusCode).toBe(404);
    });

    it("인증 없으면 401을 반환한다", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/v1/vault/${vault_id}/raw/notes/hello.md`,
      });

      expect(res.statusCode).toBe(401);
    });
  });

  describe("Raw MD round-trip", () => {
    it("PUT 후 GET으로 동일 내용이 반환된다", async () => {
      const content = "# Round Trip Test\n\nThis is a **test**.";

      // PUT
      await app.inject({
        method: "PUT",
        url: `/v1/vault/${vault_id}/raw/notes/roundtrip.md`,
        headers: {
          ...auth_headers(),
          "content-type": "text/markdown",
        },
        body: content,
      });

      // GET
      const res = await app.inject({
        method: "GET",
        url: `/v1/vault/${vault_id}/raw/notes/roundtrip.md`,
        headers: auth_headers(),
      });

      expect(res.statusCode).toBe(200);
      expect(res.body).toBe(content);
    });
  });

  describe("SPEC-P1-STORAGE-002 - PG content 조회", () => {
    it("파일 내용이 files.content에서 반환된다", async () => {
      // Upload a file
      await app.inject({
        method: "PUT",
        url: `/v1/vault/${vault_id}/raw/notes/pg-read-test.md`,
        headers: { ...auth_headers(), "content-type": "text/markdown" },
        body: "# PG Read Test",
      });

      // Verify content in DB
      const { db } = createDbClient();
      const file_rows = await db
        .select({ content: files.content })
        .from(files)
        .where(and(eq(files.vaultId, vault_id), eq(files.path, "notes/pg-read-test.md")));
      expect(file_rows[0].content).toBe("# PG Read Test");

      // Verify API returns same content
      const res = await app.inject({
        method: "GET",
        url: `/v1/vault/${vault_id}/raw/notes/pg-read-test.md`,
        headers: auth_headers(),
      });
      expect(res.body).toBe("# PG Read Test");
    });
  });
});
