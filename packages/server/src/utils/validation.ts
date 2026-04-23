// 크기 제한 상수
export const MAX_RAW_SIZE = 10 * 1024 * 1024; // 10MB
export const MAX_ATTACHMENT_SIZE = 50 * 1024 * 1024; // 50MB
export const MAX_EDIT_SIZE = 1 * 1024 * 1024; // 1MB
export const MAX_SEARCH_QUERY_LENGTH = 500;
export const MAX_PATH_LENGTH = 500; // 파일 경로 최대 길이
export const MAX_PATH_DEPTH = 20; // 경로 최대 깊이

type ValidationSuccess = { valid: true };
type ValidationFailure = { valid: false; reason: string };
type ValidationResult = ValidationSuccess | ValidationFailure;

/**
 * 볼트 내 파일 경로 검증
 * - 경로 순회 공격(..) 차단
 * - 절대 경로 차단
 * - null byte 차단
 */
export function validateVaultPath(filePath: string): ValidationResult {
  // null byte 검사
  if (filePath.includes("\0")) {
    return { valid: false, reason: "경로에 null byte가 포함되어 있습니다" };
  }

  // 절대 경로 검사
  if (filePath.startsWith("/")) {
    return { valid: false, reason: "절대 경로는 허용되지 않습니다" };
  }

  // 경로 순회 검사 (.. 및 URL 인코딩된 ..)
  if (filePath.includes("..") || filePath.includes("%2e%2e") || filePath.includes("%2E%2E")) {
    return { valid: false, reason: "경로 순회(..)는 허용되지 않습니다" };
  }

  // 경로 길이 제한 (500자)
  if (filePath.length > MAX_PATH_LENGTH) {
    return { valid: false, reason: `경로 길이가 제한을 초과했습니다 (최대: ${MAX_PATH_LENGTH}자)` };
  }

  // 경로 깊이 제한 (20단계)
  const depth = filePath.split("/").filter(Boolean).length;
  if (depth > MAX_PATH_DEPTH) {
    return { valid: false, reason: `경로 깊이가 제한을 초과했습니다 (최대: ${MAX_PATH_DEPTH}단계)` };
  }

  return { valid: true };
}

// 크기 검증 타입별 제한값 매핑
const SIZE_LIMITS: Record<string, number> = {
  raw: MAX_RAW_SIZE,
  attachment: MAX_ATTACHMENT_SIZE,
  edit: MAX_EDIT_SIZE,
  search: MAX_SEARCH_QUERY_LENGTH,
};

// 크기 검증 타입별 라벨
const SIZE_LABELS: Record<string, string> = {
  raw: "마크다운",
  attachment: "첨부파일",
  edit: "편집 내용",
  search: "검색어",
};

/**
 * 입력 크기 검증
 * @param type - 검증할 입력 타입 (raw, attachment, edit, search)
 * @param value - 검증할 크기 값 (바이트 또는 문자열 길이)
 */
export function validateSize(type: string, value: number): ValidationResult {
  const limit = SIZE_LIMITS[type];
  if (limit === undefined) {
    return { valid: false, reason: `알 수 없는 타입: ${type}` };
  }

  if (value > limit) {
    const label = SIZE_LABELS[type] || type;
    return {
      valid: false,
      reason: `${label} 크기가 제한을 초과했습니다 (최대: ${limit} bytes)`,
    };
  }

  return { valid: true };
}
