import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildApp } from "../src/app.js";
import type { FastifyInstance } from "fastify";
import { createDbClient } from "../src/config/database.js";
import { eq, and } from "drizzle-orm";
import { files, fileVersions } from "../src/db/schemas/index.js";
import { createTestVault } from "./setup.js";
import { setupTestAuth, authHeaders, cleanupTestAuth } from "./helpers/jwt-auth.js";

describe("File Upload + Get API", () => {
  let app: FastifyInstance;
  let vault_id: string;
  let jwt_token: string;
  const { client, db } = createDbClient();

  beforeAll(async () => {
    app = await buildApp();

    // JWT 토큰 획득
    jwt_token = await setupTestAuth(app);
    const vault = await createTestVault(app, "file-test-vault");
    vault_id = vault.vault_id;
    
  });

  afterAll(async () => {
    await app.close();
    await client.end();
  });

  // 헬퍼: 인증 헤더
  const auth_headers = () => authHeaders(jwt_token);

  describe("PUT /v1/vault/:id/file - 파일 업로드", () => {
    it("파일을 업로드하면 200과 파일 메타데이터를 반환한다", async () => {
      const res = await app.inject({
        method: "PUT",
        url: `/v1/vault/${vault_id}/file`,
        headers: auth_headers(),
        payload: {
          path: "notes/test.md",
          content: "# Hello World",
          hash: "abc123hash",
        },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.path).toBe("notes/test.md");
      expect(body.hash).toBe("abc123hash");
      expect(body.version).toBe(1);
    });

    it("동일한 해시로 재업로드하면 새 버전이 생성되지 않는다", async () => {
      // 동일한 내용 재업로드
      const res = await app.inject({
        method: "PUT",
        url: `/v1/vault/${vault_id}/file`,
        headers: auth_headers(),
        payload: {
          path: "notes/test.md",
          content: "# Hello World",
          hash: "abc123hash",
        },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.version).toBe(1); // 버전이 그대로

      // DB에 버전이 1개만 있는지 확인 (vault_id 필터링)
      const file_rows = await db
        .select()
        .from(files)
        .where(and(eq(files.vaultId, vault_id), eq(files.path, "notes/test.md")));
      expect(file_rows.length).toBe(1);

      const versions = await db
        .select()
        .from(fileVersions)
        .where(eq(fileVersions.fileId, file_rows[0].id));
      expect(versions.length).toBe(1);
    });
  });

  describe("GET /v1/vault/:id/file/* - 파일 내용 조회", () => {
    it("업로드한 파일의 내용을 반환한다", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/v1/vault/${vault_id}/file/notes/test.md`,
        headers: auth_headers(),
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.content).toBe("# Hello World");
      expect(body.path).toBe("notes/test.md");
      expect(body.hash).toBe("abc123hash");
    });

    it("존재하지 않는 파일이면 404를 반환한다", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/v1/vault/${vault_id}/file/nonexistent.md`,
        headers: auth_headers(),
      });

      expect(res.statusCode).toBe(404);
    });
  });

  describe("버전 관리", () => {
    it("다른 해시로 업로드하면 버전 2가 생성된다", async () => {
      const res = await app.inject({
        method: "PUT",
        url: `/v1/vault/${vault_id}/file`,
        headers: auth_headers(),
        payload: {
          path: "notes/test.md",
          content: "# Updated Content",
          hash: "def456hash",
        },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.version).toBe(2);
      expect(body.hash).toBe("def456hash");
    });

    it("GET /v1/vault/:id/versions/* 로 모든 버전을 조회한다", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/v1/vault/${vault_id}/versions/notes/test.md`,
        headers: auth_headers(),
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.versions.length).toBe(2);
      expect(body.versions[0].versionNum).toBe(1);
      expect(body.versions[1].versionNum).toBe(2);
    });
  });

  describe("DELETE /v1/vault/:id/file/* - 파일 소프트 삭제", () => {
    it("파일을 삭제하면 deleted_at이 설정된다", async () => {
      const res = await app.inject({
        method: "DELETE",
        url: `/v1/vault/${vault_id}/file/notes/test.md`,
        headers: auth_headers(),
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().message).toBeDefined();

      // DB에서 deleted_at 확인 (vaultId 필터 필수)
      const file_rows = await db
        .select()
        .from(files)
        .where(and(eq(files.vaultId, vault_id), eq(files.path, "notes/test.md")));
      expect(file_rows[0].deletedAt).not.toBeNull();
    });

    it("삭제된 파일을 GET하면 404를 반환한다", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/v1/vault/${vault_id}/file/notes/test.md`,
        headers: auth_headers(),
      });

      expect(res.statusCode).toBe(404);
    });

    it("이미 삭제된 파일을 다시 DELETE하면 404를 반환한다", async () => {
      const res = await app.inject({
        method: "DELETE",
        url: `/v1/vault/${vault_id}/file/notes/test.md`,
        headers: auth_headers(),
      });

      expect(res.statusCode).toBe(404);
    });

    it("파일 목록에 삭제된 파일은 포함되지 않는다", async () => {
      // 새 파일 업로드
      await app.inject({
        method: "PUT",
        url: `/v1/vault/${vault_id}/file`,
        headers: auth_headers(),
        payload: {
          path: "notes/active.md",
          content: "Active file",
          hash: "active123",
        },
      });

      const res = await app.inject({
        method: "GET",
        url: `/v1/vault/${vault_id}/files`,
        headers: auth_headers(),
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      const paths = body.map((f: any) => f.path);
      expect(paths).toContain("notes/active.md");
      expect(paths).not.toContain("notes/test.md"); // 삭제된 파일 미포함
    });

    it("삭제된 파일의 버전은 보존된다", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/v1/vault/${vault_id}/versions/notes/test.md`,
        headers: auth_headers(),
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.versions.length).toBe(2); // 여전히 2개 버전 존재
    });
  });

  describe("엣지 케이스", () => {
    it("빈 콘텐츠로 업로드해도 성공한다", async () => {
      const res = await app.inject({
        method: "PUT",
        url: `/v1/vault/${vault_id}/file`,
        headers: auth_headers(),
        payload: {
          path: "notes/empty.md",
          content: "",
          hash: "emptyhash",
        },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().version).toBe(1);
    });

    it("존재하지 않는 vault_id로 요청하면 404를 반환한다", async () => {
      const res = await app.inject({
        method: "PUT",
        url: "/v1/vault/00000000-0000-0000-0000-000000000000/file",
        headers: auth_headers(),
        payload: {
          path: "notes/test.md",
          content: "test",
          hash: "testhash",
        },
      });

      expect(res.statusCode).toBe(404);
    });

    it("path 필드가 없으면 400을 반환한다", async () => {
      const res = await app.inject({
        method: "PUT",
        url: `/v1/vault/${vault_id}/file`,
        headers: auth_headers(),
        payload: {
          content: "test",
          hash: "testhash",
        },
      });

      expect(res.statusCode).toBe(400);
    });
  });

  describe("SPEC-P1-STORAGE-002 - PG content 저장", () => {
    it("마크다운 파일 업로드 시 files.content에 내용이 저장된다", async () => {
      const res = await app.inject({
        method: "PUT",
        url: `/v1/vault/${vault_id}/file`,
        headers: auth_headers(),
        payload: { path: "notes/pg-test.md", content: "# PG Stored", hash: "pg-hash-1" },
      });
      expect(res.statusCode).toBe(200);

      // DB에서 content 컬럼 직접 확인
      const file_rows = await db
        .select({ content: files.content, file_type: files.fileType })
        .from(files)
        .where(and(eq(files.vaultId, vault_id), eq(files.path, "notes/pg-test.md")));
      expect(file_rows[0].content).toBe("# PG Stored");
      expect(file_rows[0].file_type).toBe("markdown");
    });

    it("파일 수정 시 files.content와 fileVersions.content가 업데이트된다", async () => {
      // 첫 업로드
      await app.inject({
        method: "PUT",
        url: `/v1/vault/${vault_id}/file`,
        headers: auth_headers(),
        payload: { path: "notes/pg-versions.md", content: "# V1", hash: "pg-v1-hash" },
      });

      // 수정 업로드
      await app.inject({
        method: "PUT",
        url: `/v1/vault/${vault_id}/file`,
        headers: auth_headers(),
        payload: { path: "notes/pg-versions.md", content: "# V2 Updated", hash: "pg-v2-hash" },
      });

      // files.content는 최신 버전
      const file_rows = await db
        .select({ content: files.content })
        .from(files)
        .where(and(eq(files.vaultId, vault_id), eq(files.path, "notes/pg-versions.md")));
      expect(file_rows[0].content).toBe("# V2 Updated");

      // file_versions에 두 버전 모두 content가 저장됨
      const versions = await db
        .select({ content: fileVersions.content, versionNum: fileVersions.versionNum })
        .from(fileVersions)
        .innerJoin(files, eq(fileVersions.fileId, files.id))
        .where(and(eq(files.vaultId, vault_id), eq(files.path, "notes/pg-versions.md")))
        .orderBy(fileVersions.versionNum);
      expect(versions.length).toBe(2);
      expect(versions[0].content).toBe("# V1");
      expect(versions[1].content).toBe("# V2 Updated");
    });

    it("동일한 해시로 재업로드 시 content도 변경되지 않는다", async () => {
      // 첫 업로드
      await app.inject({
        method: "PUT",
        url: `/v1/vault/${vault_id}/file`,
        headers: auth_headers(),
        payload: { path: "notes/pg-skip.md", content: "# Skip Test", hash: "pg-skip-hash" },
      });

      // 동일 해시 재업로드
      await app.inject({
        method: "PUT",
        url: `/v1/vault/${vault_id}/file`,
        headers: auth_headers(),
        payload: { path: "notes/pg-skip.md", content: "# Skip Test", hash: "pg-skip-hash" },
      });

      // 버전이 1개만 존재
      const file_rows = await db
        .select({ id: files.id, content: files.content })
        .from(files)
        .where(and(eq(files.vaultId, vault_id), eq(files.path, "notes/pg-skip.md")));
      expect(file_rows.length).toBe(1);

      const versions = await db
        .select()
        .from(fileVersions)
        .where(eq(fileVersions.fileId, file_rows[0].id));
      expect(versions.length).toBe(1);
      expect(versions[0].content).toBe("# Skip Test");
    });
  });
});
