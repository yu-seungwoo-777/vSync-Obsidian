import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildApp } from "../src/app.js";
import type { FastifyInstance } from "fastify";
import { createDbClient } from "../src/config/database.js";
import { eq, and } from "drizzle-orm";
import { files } from "../src/db/schemas/index.js";
import { setupTestAuth, authHeaders } from "./helpers/jwt-auth.js";
import { createTestVault } from "./setup.js";

describe("Attachment API - SPEC-P1-STORAGE-002 REQ-008", () => {
  let app: FastifyInstance;
  let vault_id: string;
  let jwt_token: string;
  const { client, db } = createDbClient();

  beforeAll(async () => {
    app = await buildApp();

    // JWT 토큰 획득
    jwt_token = await setupTestAuth(app);

    const vault = await createTestVault(app, "attachment-test-vault");
    vault_id = vault.vault_id;
  });

  afterAll(async () => {
    await app.close();
    await client.end();
  });

  const auth_headers = () => authHeaders(jwt_token);

  describe("PUT /v1/vault/:id/attachment/* - 바이너리 업로드", () => {
    it("바이너리 파일을 MinIO에 저장하고 메타데이터를 반환한다", async () => {
      const res = await app.inject({
        method: "PUT",
        url: `/v1/vault/${vault_id}/attachment/images/photo.png`,
        headers: { ...auth_headers(), "content-type": "image/png" },
        body: Buffer.from("fake-png-data"),
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.path).toBe("images/photo.png");
      expect(body.version).toBe(1);
    });

    it("files 테이블에 fileType=attachment, content=NULL로 저장된다", async () => {
      // Upload
      await app.inject({
        method: "PUT",
        url: `/v1/vault/${vault_id}/attachment/images/check.png`,
        headers: { ...auth_headers(), "content-type": "image/png" },
        body: Buffer.from("check-png-data"),
      });

      // DB 확인
      const file_rows = await db
        .select({ file_type: files.fileType, content: files.content })
        .from(files)
        .where(and(eq(files.vaultId, vault_id), eq(files.path, "images/check.png")));

      expect(file_rows.length).toBe(1);
      expect(file_rows[0].file_type).toBe("attachment");
      expect(file_rows[0].content).toBeNull();
    });

    it("인증 없으면 401을 반환한다", async () => {
      const res = await app.inject({
        method: "PUT",
        url: `/v1/vault/${vault_id}/attachment/images/test.png`,
        headers: { "content-type": "image/png" },
        body: Buffer.from("test"),
      });

      expect(res.statusCode).toBe(401);
    });
  });

  describe("GET /v1/vault/:id/attachment/* - 바이너리 조회", () => {
    it("업로드한 바이너리 파일을 반환한다", async () => {
      // 먼저 업로드
      await app.inject({
        method: "PUT",
        url: `/v1/vault/${vault_id}/attachment/images/get-test.png`,
        headers: { ...auth_headers(), "content-type": "image/png" },
        body: Buffer.from("get-test-png-data"),
      });

      // 조회
      const res = await app.inject({
        method: "GET",
        url: `/v1/vault/${vault_id}/attachment/images/get-test.png`,
        headers: auth_headers(),
      });

      expect(res.statusCode).toBe(200);
      expect(res.headers["content-type"]).toBe("image/png");
      expect(res.body.toString()).toBe("get-test-png-data");
    });

    it("존재하지 않는 파일이면 404를 반환한다", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/v1/vault/${vault_id}/attachment/images/nonexistent.png`,
        headers: auth_headers(),
      });

      expect(res.statusCode).toBe(404);
    });

    it("인증 없으면 401을 반환한다", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/v1/vault/${vault_id}/attachment/images/test.png`,
      });

      expect(res.statusCode).toBe(401);
    });
  });
});
