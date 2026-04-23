// @MX:NOTE 확장자 기반 Content-Type 추측 및 이미지 파일 판별 유틸리티

// @MX:ANCHOR 확장자 → MIME 타입 매핑 테이블
// @MX:REASON v1.ts에서 추출, attachment 라우트 등 여러 곳에서 재사용 (fan_in >= 3)
const MIME_MAP: ReadonlyMap<string, string> = new Map([
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".gif", "image/gif"],
  [".svg", "image/svg+xml"],
  [".webp", "image/webp"],
  [".pdf", "application/pdf"],
  [".zip", "application/zip"],
  [".mp3", "audio/mpeg"],
  [".mp4", "video/mp4"],
  [".wav", "audio/wav"],
  [".ogg", "audio/ogg"],
]);

const IMAGE_EXTENSIONS: ReadonlySet<string> = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".svg",
  ".webp",
]);

/** 파일 경로의 확장자로부터 Content-Type(MIME 타입)을 추측한다. */
export function guessContentType(filePath: string): string {
  const lower = filePath.toLowerCase();
  for (const [ext, mime] of MIME_MAP) {
    if (lower.endsWith(ext)) return mime;
  }
  return "application/octet-stream";
}

/** 파일 경로가 이미지 확장자인지 여부를 반환한다. */
export function isImageFile(filePath: string): boolean {
  const dotIndex = filePath.lastIndexOf(".");
  if (dotIndex === -1) return false;
  const ext = filePath.slice(dotIndex).toLowerCase();
  return IMAGE_EXTENSIONS.has(ext);
}
