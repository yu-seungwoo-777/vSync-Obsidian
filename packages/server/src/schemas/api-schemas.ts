import { z } from "zod";

// 파일 업로드 스키마 (PUT /file)
export const fileUploadSchema = z.object({
  path: z.string({ required_error: "path is required" }),
  content: z.string().optional(),
  hash: z.string({ required_error: "hash is required" }),
});

// 파일 편집 스키마 (POST /edit)
export const editSchema = z.object({
  path: z.string({ required_error: "path is required" }),
  old_text: z.string().min(1, "old_text must not be empty"),
  new_text: z.string({ required_error: "new_text is required" }),
});

// 검색 스키마 (GET /search)
// limit max: 기존 테스트 호환성을 위해 200으로 설정 (서비스에서 100 cap 적용)
// coerce: query params 가 문자열로 전달되므로 자동 변환
export const searchSchema = z.object({
  q: z.string().min(1, "q must not be empty").max(500, "q must be at most 500 characters"),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  folder: z.string().optional(),
});

// 이벤트 조회 스키마 (GET /events)
export const eventsQuerySchema = z.object({
  since: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

// 동기화 상태 스키마 (PUT /sync-status)
export const syncStatusSchema = z.object({
  device_id: z.string().regex(
    /^[a-zA-Z0-9-_]+$/,
    "device_id must contain only alphanumeric characters, hyphens, and underscores",
  ),
  last_event_id: z.string().uuid("last_event_id must be a valid UUID"),
});

// 단일 배치 연산 스키마
const batchOperationSchema = z.object({
  type: z.string({ required_error: "operation type is required" }),
  data: z.record(z.unknown(), { required_error: "operation data is required" }),
});

// 배치 연산 스키마 (POST /batch)
export const batchSchema = z.object({
  operations: z.array(batchOperationSchema).min(1, "at least one operation required").max(50, "maximum 50 operations"),
});

// 파일 이동 스키마 (POST /move)
export const moveSchema = z.object({
  from: z.string({ required_error: "from is required" }),
  to: z.string({ required_error: "to is required" }),
});

// 페이지네이션 스키마 (GET /files, GET /events 등)
export const paginationSchema = z.object({
  limit: z.number().int().min(1).max(100).default(100),
  cursor: z.string().optional(),
});
