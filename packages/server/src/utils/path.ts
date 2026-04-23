// @MX:NOTE 서버 전용 경로 정규화 유틸리티 (REQ-SRV-004)
// Plugin의 Obsidian normalizePath와는 독립적인 서버 측 구현

/**
 * 파일 경로 정규화: 선행/후행 슬래시 제거, 중복 슬래시 축소
 * 서버는 Linux 환경에서 실행되므로 역슬래시 처리는 제외
 * @param path 정규화할 파일 경로
 * @returns 정규화된 경로
 */
export function normalizePath(path: string): string {
  if (!path) return "";
  return path
    .replace(/\/+/g, "/")
    .replace(/^\/+/, "")
    .replace(/\/+$/, "");
}
