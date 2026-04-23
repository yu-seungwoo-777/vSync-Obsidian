import { describe, it, expect } from "vitest";

// REQ-SRV-004: 서버 경로 정규화 유틸리티 테스트
describe("server normalizePath 유틸리티", () => {
  // 테스트 대상을 동적으로 import하여 모듈 생성 전 실패 확인
  async function getNormalizePath() {
    const { normalizePath } = await import("../src/utils/path");
    return normalizePath;
  }

  it("빈 문자열을 입력하면 빈 문자열을 반환한다", async () => {
    const normalizePath = await getNormalizePath();
    expect(normalizePath("")).toBe("");
  });

  it("선행 슬래시를 제거한다", async () => {
    const normalizePath = await getNormalizePath();
    expect(normalizePath("/notes/test.md")).toBe("notes/test.md");
  });

  it("후행 슬래시를 제거한다", async () => {
    const normalizePath = await getNormalizePath();
    expect(normalizePath("notes/test.md/")).toBe("notes/test.md");
  });

  it("선행 및 후행 슬래시를 모두 제거한다", async () => {
    const normalizePath = await getNormalizePath();
    expect(normalizePath("/notes/test.md/")).toBe("notes/test.md");
  });

  it("중복 슬래시를 단일 슬래시로 축소한다", async () => {
    const normalizePath = await getNormalizePath();
    expect(normalizePath("notes//daily///2024.md")).toBe("notes/daily/2024.md");
  });

  it("루트 경로 '/'를 빈 문자열로 변환한다", async () => {
    const normalizePath = await getNormalizePath();
    expect(normalizePath("/")).toBe("");
  });

  it("다중 루트 슬래시 '///'를 빈 문자열로 변환한다", async () => {
    const normalizePath = await getNormalizePath();
    expect(normalizePath("///")).toBe("");
  });

  it("이미 정규화된 경로는 변경하지 않는다", async () => {
    const normalizePath = await getNormalizePath();
    expect(normalizePath("notes/daily/2024.md")).toBe("notes/daily/2024.md");
  });

  it("선행/후행/중복 슬래시가 모두 있는 경로를 정규화한다", async () => {
    const normalizePath = await getNormalizePath();
    expect(normalizePath("///notes//deep///file.md///")).toBe("notes/deep/file.md");
  });
});
