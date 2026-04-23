import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildApp } from "../src/app.js";
import type { FastifyInstance } from "fastify";
import { createDbClient } from "../src/config/database.js";
import { createTestVault } from "./setup.js";
import { setupTestAuth, authHeaders, cleanupTestAuth } from "./helpers/jwt-auth.js";

// @MX:NOTE SPEC-P2-API-CORE-001 Folder List API 인수 테스트
describe("Folder List API", () => {
  let app: FastifyInstance;
  let vault_id: string;
  let jwt_token: string;
  const { client } = createDbClient();

  beforeAll(async () => {
    app = await buildApp();

    // JWT 토큰 획득
    jwt_token = await setupTestAuth(app);

    // 테스트용 볼트 생성
    const vault = await createTestVault(app, "folder-list-test-vault");
    vault_id = vault.vault_id;
    

    // 폴더 구조를 갖는 파일들 업로드
    const test_files = [
      { path: "notes/daily/2024-01.md", content: "# 일일 노트 1", hash: "fl-1" },
      { path: "notes/daily/2024-02.md", content: "# 일일 노트 2", hash: "fl-2" },
      { path: "notes/project.md", content: "# 프로젝트 노트", hash: "fl-3" },
      { path: "notes/deep/nested/doc.md", content: "# 중첩 문서", hash: "fl-4" },
      { path: "readme.md", content: "# 리드미", hash: "fl-5" },
      { path: "config.json", content: "{}", hash: "fl-6" },
    ];

    for (const file of test_files) {
      await app.inject({
        method: "PUT",
        url: `/v1/vault/${vault_id}/file`,
        headers: authHeaders(jwt_token),
        payload: file,
      });
    }
  });

  afterAll(async () => {
    await app.close();
    await client.end();
  });

  // AC-018: folder 기본값은 루트 "/"
  it("AC-018: folder 파라미터 기본값은 루트(/)이다", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/vault/${vault_id}/list`,
      headers: authHeaders(jwt_token),
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.folder).toBe("/");
    expect(body.entries).toBeInstanceOf(Array);
  });

  // AC-019: recursive 기본값 false
  it("AC-019: recursive 기본값은 false이다", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/vault/${vault_id}/list?folder=notes`,
      headers: authHeaders(jwt_token),
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    // recursive=false면 직접 하위 항목만
    for (const entry of body.entries) {
      // notes/ 다음에 /가 더 없어야 함 (직접 하위)
      const relative_path = entry.path.slice("notes/".length);
      if (entry.type === "file") {
        // 파일은 하위 경로가 없어야 함
        expect(relative_path).not.toContain("/");
      }
    }
  });

  // AC-020: 파일 항목 형식
  it("AC-020: 파일 항목에 name, path, hash, sizeBytes, updatedAt, type이 포함된다", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/vault/${vault_id}/list`,
      headers: authHeaders(jwt_token),
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    const file_entries = body.entries.filter((e: any) => e.type === "file");

    expect(file_entries.length).toBeGreaterThan(0);
    const file = file_entries[0];
    expect(file.name).toBeDefined();
    expect(file.path).toBeDefined();
    expect(file.hash).toBeDefined();
    expect(file.size_bytes).toBeDefined();
    expect(file.updated_at).toBeDefined();
    expect(file.type).toBe("file");
  });

  // AC-021: 폴더 항목 형식
  it("AC-021: 폴더 항목에 name, path, type이 포함된다", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/vault/${vault_id}/list`,
      headers: authHeaders(jwt_token),
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    const folder_entries = body.entries.filter((e: any) => e.type === "folder");

    if (folder_entries.length > 0) {
      const folder = folder_entries[0];
      expect(folder.name).toBeDefined();
      expect(folder.path).toBeDefined();
      expect(folder.type).toBe("folder");
      // 폴더 항목에는 hash, sizeBytes, updatedAt이 없어야 함
      expect(folder.hash).toBeUndefined();
      expect(folder.sizeBytes).toBeUndefined();
      expect(folder.updated_at).toBeUndefined();
    }
  });

  // AC-022: 삭제된 파일 제외
  it("AC-022: 삭제된 파일은 목록에 포함되지 않는다", async () => {
    // 파일 업로드 후 삭제
    await app.inject({
      method: "PUT",
      url: `/v1/vault/${vault_id}/file`,
      headers: authHeaders(jwt_token),
      payload: { path: "to-delete.md", content: "삭제될 파일", hash: "fl-del-1" },
    });

    await app.inject({
      method: "DELETE",
      url: `/v1/vault/${vault_id}/file/to-delete.md`,
      headers: authHeaders(jwt_token),
    });

    const res = await app.inject({
      method: "GET",
      url: `/v1/vault/${vault_id}/list`,
      headers: authHeaders(jwt_token),
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    const paths = body.entries.map((e: any) => e.path);
    expect(paths).not.toContain("to-delete.md");
  });

  // AC-023: 존재하지 않는 폴더는 빈 배열 반환 (404 아님)
  it("AC-023: 존재하지 않는 폴더는 빈 배열을 반환한다", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/vault/${vault_id}/list?folder=nonexistent/folder`,
      headers: authHeaders(jwt_token),
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.entries).toEqual([]);
  });

  // AC-024: recursive=true 모든 하위 경로 포함
  it("AC-024: recursive=true면 모든 하위 경로가 포함된다", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/vault/${vault_id}/list?folder=notes&recursive=true`,
      headers: authHeaders(jwt_token),
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    const paths = body.entries.map((e: any) => e.path);

    // notes/daily/... 와 notes/project.md, notes/deep/nested/doc.md 모두 포함
    expect(paths).toContain("notes/project.md");
    expect(paths).toContain("notes/daily/2024-01.md");
    expect(paths).toContain("notes/daily/2024-02.md");
    expect(paths).toContain("notes/deep/nested/doc.md");
  });

  // AC-025: 인증 필요
  it("AC-025: 인증 없이 조회하면 401을 반환한다", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/vault/${vault_id}/list`,
    });

    expect(res.statusCode).toBe(401);
  });

  // 추가: 특정 폴더 조회
  it("특정 폴더의 파일과 하위 폴더를 반환한다", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/vault/${vault_id}/list?folder=notes/daily`,
      headers: authHeaders(jwt_token),
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    // notes/daily 폴더의 직접 하위 파일만
    const paths = body.entries.map((e: any) => e.path);
    expect(paths).toContain("notes/daily/2024-01.md");
    expect(paths).toContain("notes/daily/2024-02.md");
    // deeper files should not be included
    expect(paths).not.toContain("notes/deep/nested/doc.md");
    expect(paths).not.toContain("notes/project.md");
  });
});
