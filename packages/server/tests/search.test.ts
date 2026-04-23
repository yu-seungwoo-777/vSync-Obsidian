import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildApp } from "../src/app.js";
import type { FastifyInstance } from "fastify";
import { createDbClient } from "../src/config/database.js";
import { createTestVault } from "./setup.js";
import { setupTestAuth, authHeaders, cleanupTestAuth } from "./helpers/jwt-auth.js";

// @MX:NOTE SPEC-P2-API-CORE-001 Search API 인수 테스트
describe("Search API", () => {
  let app: FastifyInstance;
  let vault_id: string;
  let jwt_token: string;
  const { client } = createDbClient();

  beforeAll(async () => {
    app = await buildApp();

    // JWT 토큰 획득
    jwt_token = await setupTestAuth(app);

    // 테스트용 볼트 생성
    const vault = await createTestVault(app, "search-test-vault");
    vault_id = vault.vault_id;
    

    // 검색 대상 파일들 업로드
    const files = [
      { path: "notes/korean.md", content: "# 한국어 문서\n이것은 테스트 문서입니다.", hash: "search-kr-1" },
      { path: "notes/english.md", content: "# English Document\nThis is a test document.", hash: "search-en-1" },
      { path: "notes/deep/nested.md", content: "# 깊은 폴더\n중첩된 폴더의 문서입니다.", hash: "search-nested-1" },
      { path: "notes/daily/2024-01.md", content: "# 일일 노트\n오늘의 기록입니다.", hash: "search-daily-1" },
    ];

    for (const file of files) {
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

  // AC-001: q 파라미터 필수, 누락 시 400
  it("AC-001: q 파라미터가 없으면 400을 반환한다", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/vault/${vault_id}/search`,
      headers: authHeaders(jwt_token),
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBeDefined();
  });

  // AC-002: limit 기본값 20, 최대 100
  it("AC-002: limit 기본값은 20이다", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/vault/${vault_id}/search?q=테스트`,
      headers: authHeaders(jwt_token),
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.results).toBeInstanceOf(Array);
    // 결과가 limit 기본값(20) 이하인지 확인
    expect(body.results.length).toBeLessThanOrEqual(20);
  });

  it("AC-002: limit 최대값은 100이다", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/vault/${vault_id}/search?q=테스트&limit=150`,
      headers: authHeaders(jwt_token),
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.results.length).toBeLessThanOrEqual(100);
  });

  // AC-003: folder 파라미터로 폴더 범위 검색 (선택적)
  it("AC-003: folder 파라미터로 특정 폴더 내 검색이 가능하다", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/vault/${vault_id}/search?q=문서&folder=notes/deep`,
      headers: authHeaders(jwt_token),
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    // notes/deep 폴더의 파일만 반환되어야 함
    for (const result of body.results) {
      expect(result.path).toMatch(/^notes\/deep\//);
    }
  });

  // AC-004: 결과에 path, snippet, score 포함
  it("AC-004: 검색 결과에 path, snippet, score가 포함된다", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/vault/${vault_id}/search?q=테스트`,
      headers: authHeaders(jwt_token),
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.results.length).toBeGreaterThan(0);

    const first_result = body.results[0];
    expect(first_result.path).toBeDefined();
    expect(typeof first_result.path).toBe("string");
    expect(first_result.snippet).toBeDefined();
    expect(typeof first_result.snippet).toBe("string");
    expect(first_result.score).toBeDefined();
    expect(typeof first_result.score).toBe("number");
  });

  // AC-004: snippet은 매치된 텍스트 주변 컨텍스트 (~100자)
  it("AC-004: snippet은 매치된 텍스트 주변 컨텍스트를 포함한다", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/vault/${vault_id}/search?q=테스트`,
      headers: authHeaders(jwt_token),
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    if (body.results.length > 0) {
      // snippet은 검색어와 관련된 내용을 포함해야 함
      const snippet = body.results[0].snippet;
      expect(snippet.length).toBeGreaterThan(0);
    }
  });

  // AC-005: 삭제된 파일은 검색 결과에서 제외
  it("AC-005: 삭제된 파일은 검색 결과에 포함되지 않는다", async () => {
    // 새 파일 업로드 후 삭제
    await app.inject({
      method: "PUT",
      url: `/v1/vault/${vault_id}/file`,
      headers: authHeaders(jwt_token),
      payload: {
        path: "notes/to-delete.md",
        content: "삭제될 검색 테스트 문서 uniquekeyword123",
        hash: "search-del-1",
      },
    });

    // 삭제 전 검색 - 결과에 포함됨
    const before_delete = await app.inject({
      method: "GET",
      url: `/v1/vault/${vault_id}/search?q=uniquekeyword123`,
      headers: authHeaders(jwt_token),
    });
    expect(before_delete.json().results.length).toBeGreaterThan(0);

    // 파일 삭제
    await app.inject({
      method: "DELETE",
      url: `/v1/vault/${vault_id}/file/notes/to-delete.md`,
      headers: authHeaders(jwt_token),
    });

    // 삭제 후 검색 - 결과에서 제외됨
    const after_delete = await app.inject({
      method: "GET",
      url: `/v1/vault/${vault_id}/search?q=uniquekeyword123`,
      headers: authHeaders(jwt_token),
    });
    expect(after_delete.json().results.length).toBe(0);
  });

  // AC-006: 마크다운 파일만 검색 대상
  it("AC-006: 마크다운 파일만 검색된다", async () => {
    // 이 테스트는 file_type이 markdown인 파일만 검색되는지 확인
    const res = await app.inject({
      method: "GET",
      url: `/v1/vault/${vault_id}/search?q=테스트`,
      headers: authHeaders(jwt_token),
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    // 모든 결과가 .md 확장자를 가져야 함 (간접 검증)
    for (const result of body.results) {
      expect(result.path).toMatch(/\.(md|markdown|mdx|txt)$/);
    }
  });

  // AC-007: 인증 필요
  it("AC-007: 인증 없이 검색하면 401을 반환한다", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/vault/${vault_id}/search?q=test`,
    });

    expect(res.statusCode).toBe(401);
  });

  // 통합: 검색 결과에 total 포함
  it("검색 응답에 total 필드가 포함된다", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/vault/${vault_id}/search?q=문서`,
      headers: authHeaders(jwt_token),
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.total).toBeDefined();
    expect(typeof body.total).toBe("number");
  });
});
