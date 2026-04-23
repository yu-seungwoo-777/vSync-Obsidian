import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildApp } from "../src/app.js";
import type { FastifyInstance } from "fastify";
import { createDbClient } from "../src/config/database.js";
import { eq, and } from "drizzle-orm";
import { files, fileVersions } from "../src/db/schemas/index.js";
import { createTestVault } from "./setup.js";
import { setupTestAuth, authHeaders, cleanupTestAuth } from "./helpers/jwt-auth.js";

// @MX:NOTE SPEC-P2-API-CORE-001 Edit API 인수 테스트
describe("Edit API", () => {
  let app: FastifyInstance;
  let vault_id: string;
  let jwt_token: string;
  const { client, db } = createDbClient();

  beforeAll(async () => {
    app = await buildApp();

    // JWT 토큰 획득
    jwt_token = await setupTestAuth(app);

    // 테스트용 볼트 생성
    const vault = await createTestVault(app, "edit-test-vault");
    vault_id = vault.vault_id;
    
  });

  afterAll(async () => {
    await app.close();
    await client.end();
  });

  // 헬퍼: 인증 헤더
  const auth_headers = () => authHeaders(jwt_token);

  // 편집 대상 파일 업로드 헬퍼
  async function upload_test_file(path: string, content: string, hash: string) {
    return app.inject({
      method: "PUT",
      url: `/v1/vault/${vault_id}/file`,
      headers: auth_headers(),
      payload: { path, content, hash },
    });
  }

  // AC-011: 요청 body 필수 필드 검증
  describe("AC-011: 요청 body 필수 필드", () => {
    it("path가 없으면 400을 반환한다", async () => {
      const res = await app.inject({
        method: "POST",
        url: `/v1/vault/${vault_id}/edit`,
        headers: auth_headers(),
        payload: { old_text: "old", new_text: "new" },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBeDefined();
    });

    it("old_text가 없으면 400을 반환한다", async () => {
      const res = await app.inject({
        method: "POST",
        url: `/v1/vault/${vault_id}/edit`,
        headers: auth_headers(),
        payload: { path: "test.md", new_text: "new" },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBeDefined();
    });

    it("new_text가 없으면 400을 반환한다", async () => {
      const res = await app.inject({
        method: "POST",
        url: `/v1/vault/${vault_id}/edit`,
        headers: auth_headers(),
        payload: { path: "test.md", old_text: "old" },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBeDefined();
    });
  });

  // AC-012: 파일 없음
  it("AC-012: 존재하지 않는 파일이면 404를 반환한다", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/vault/${vault_id}/edit`,
      headers: auth_headers(),
      payload: { path: "nonexistent.md", old_text: "old", new_text: "new" },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe("File not found");
  });

  // AC-013: old_text 매치 없음
  it("AC-013: old_text가 매치되지 않으면 400을 반환한다", async () => {
    await upload_test_file("edit/test.md", "# Hello World\n테스트 내용", "edit-hash-1");

    const res = await app.inject({
      method: "POST",
      url: `/v1/vault/${vault_id}/edit`,
      headers: auth_headers(),
      payload: { path: "edit/test.md", old_text: "존재하지않는텍스트", new_text: "new" },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain("No matches found");
  });

  // AC-014: 자동 해시, 버전 생성, 동기화 이벤트
  it("AC-014: 편집 후 자동으로 해시, 버전, 동기화 이벤트가 생성된다", async () => {
    await upload_test_file("edit/version-test.md", "# Version Test\n원본 내용", "edit-v1-hash");

    const res = await app.inject({
      method: "POST",
      url: `/v1/vault/${vault_id}/edit`,
      headers: auth_headers(),
      payload: {
        path: "edit/version-test.md",
        old_text: "원본 내용",
        new_text: "수정된 내용",
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();

    // 해시가 자동 계산됨 (원본과 다름)
    expect(body.hash).toBeDefined();
    expect(body.hash).not.toBe("edit-v1-hash");

    // 버전이 2로 증가
    expect(body.version).toBe(2);

    // DB에서 파일 버전 확인
    const file_rows = await db
      .select({ id: files.id })
      .from(files)
      .where(and(eq(files.vaultId, vault_id), eq(files.path, "edit/version-test.md")));
    const versions = await db
      .select()
      .from(fileVersions)
      .where(eq(fileVersions.fileId, file_rows[0].id));
    expect(versions.length).toBe(2);
  });

  // AC-015: 응답 형식 검증
  it("AC-015: 응답에 id, path, version, hash, changes가 포함된다", async () => {
    await upload_test_file("edit/response-test.md", "# Response\n원본 텍스트입니다", "edit-resp-hash");

    const res = await app.inject({
      method: "POST",
      url: `/v1/vault/${vault_id}/edit`,
      headers: auth_headers(),
      payload: {
        path: "edit/response-test.md",
        old_text: "원본 텍스트입니다",
        new_text: "수정된 텍스트입니다",
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.id).toBeDefined();
    expect(body.path).toBe("edit/response-test.md");
    expect(body.version).toBeDefined();
    expect(body.hash).toBeDefined();
    expect(body.changes).toBeDefined();
  });

  // AC-016: 첨부파일 편집 불가
  it("AC-016: 첨부파일은 편집할 수 없다 (400 반환)", async () => {
    // 바이넌리 파일을 첨부파일로 업로드 (text/markdown이 아닌 Content-Type)
    // file_type이 attachment인 파일 생성
    await app.inject({
      method: "PUT",
      url: `/v1/vault/${vault_id}/attachment/edit/image.png`,
      headers: { ...auth_headers(), "content-type": "image/png" },
      payload: Buffer.from("fake-png-data"),
    });

    const res = await app.inject({
      method: "POST",
      url: `/v1/vault/${vault_id}/edit`,
      headers: auth_headers(),
      payload: {
        path: "edit/image.png",
        old_text: "fake",
        new_text: "new",
      },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain("markdown");
  });

  // AC-017: 인증 필요
  it("AC-017: 인증 없이 편집하면 401을 반환한다", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/vault/${vault_id}/edit`,
      payload: { path: "test.md", old_text: "old", new_text: "new" },
    });

    expect(res.statusCode).toBe(401);
  });

  // 추가: 다중 매치 변경 수 확인
  it("동일한 old_text가 여러 번 나타나면 모두 교체된다", async () => {
    await upload_test_file(
      "edit/multi.md",
      "# Multi\n안녕하세요. 안녕하세요. 안녕하세요.",
      "edit-multi-hash",
    );

    const res = await app.inject({
      method: "POST",
      url: `/v1/vault/${vault_id}/edit`,
      headers: auth_headers(),
      payload: {
        path: "edit/multi.md",
        old_text: "안녕하세요",
        new_text: "반갑습니다",
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().changes).toBe(3);

    // 파일 내용 확인
    const file_res = await app.inject({
      method: "GET",
      url: `/v1/vault/${vault_id}/file/edit/multi.md`,
      headers: auth_headers(),
    });
    expect(file_res.json().content).toContain("반갑습니다");
    expect(file_res.json().content).not.toContain("안녕하세요");
  });
});
