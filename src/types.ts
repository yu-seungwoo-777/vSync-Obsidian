// Vector 타입 정의
//
// API 응답 타입은 OpenAPI 명세에서 자동 생성됨 (docs/api/openapi.yaml)
// 비-API 타입만 이 파일에 정의

import type { components } from './types/api-types';

// ============================================================
// Module 1: 설정 타입
// ============================================================

/** 플러그인 설정 인터페이스 */
export interface VectorSettings {
	/** 서버 URL (trailing slash 제거) */
	server_url: string;
	/** API 인증 키 */
	api_key: string;
	/** 볼트 고유 ID */
	vault_id: string;
	/** 동기화 주기 (초 단위, 기본 30) */
	sync_interval: number;
	/** 디바이스 식별자 */
	device_id: string;
	/** 마지막 동기화 이벤트 ID (커서) */
	last_event_id?: string;
	/** 업로드된 파일 해시 캐시 (경로 → SHA-256) */
	hash_cache?: Record<string, string>;
}

/** 기본 설정값 */
export const DEFAULT_SETTINGS: VectorSettings = {
	server_url: '',
	api_key: '',
	vault_id: '',
	sync_interval: 30,
	device_id: '',
};

// ============================================================
// Module 2: API 응답 타입 (OpenAPI 명세에서 자동 생성)
// ============================================================

// Wire format 타입 재-export (snake_case)
export type UploadResult = components['schemas']['UploadResult'];
export type FileInfo = components['schemas']['FileInfo'];
export type SyncEvent = components['schemas']['SyncEvent'];
export type EventsResponse = components['schemas']['EventsResponse'];
export type SyncStatusResponse = components['schemas']['SyncStatusResponse'];
export type ConflictResult = components['schemas']['ConflictResult'];
export type ConflictInfo = components['schemas']['ConflictInfo'];
export type SearchResultItem = components['schemas']['SearchResultItem'];
export type SearchResponse = components['schemas']['SearchResponse'];
export type DeviceInfo = components['schemas']['DeviceInfo'];
export type DiffOperation = components['schemas']['DiffOperation'];

// 요청 타입
export type BatchOperation = {
	type: 'create' | 'delete';
	data: { path: string; content?: string; hash?: string };
};

export type BatchResultItem = {
	status: number;
	data?: unknown;
	error?: string;
};

export type BatchResult = {
	results: BatchResultItem[];
};

export type MoveResult = {
	path: string;
	id: string;
};

export type DeleteResponse = {
	message: string;
	deleted: boolean;
	path: string;
};

export type PaginationOptions = {
	limit?: number;
	cursor?: string;
};

export type PaginatedFilesResponse = {
	files: FileInfo[];
	hasMore?: boolean;
	cursor?: string;
};

// ============================================================
// Module 2.1: 표준화된 에러 결과 (SPEC-P8-PLUGIN-API-001 REQ-PA-016)
// ============================================================

// @MX:NOTE 듀얼 에러 형식 파싱 결과 (구형 string / 신형 object 통합)
export interface StandardErrorResult {
	/** 에러 코드 (구형: "UNKNOWN", 신형: 서버 정의 코드) */
	code: string;
	/** 사용자 친화적 메시지 */
	message: string;
	/** HTTP 상태 코드 (신형에서만 제공) */
	statusCode?: number;
}

// ============================================================
// Module 3: 동기화 엔진 타입
// ============================================================

/** 동기화 상태 */
export type SyncStatus = 'idle' | 'syncing' | 'error' | 'not_configured';

/** 오프라인 큐 항목 */
export interface OfflineQueueItem {
	filePath: string;
	content: string | ArrayBuffer;
	operation: 'upload' | 'delete';
	timestamp: number;
	retryCount: number;
	/** content의 SHA-256 해시 (upload 시), 선택적 필드 (REQ-P6-003) */
	hash?: string;
}

/** 동기화 엔진 상태 */
export interface SyncState {
	status: SyncStatus;
	last_sync_at?: string;
	last_error?: string;
	processed_count: number;
	error_count: number;
}

// ============================================================
// Module 4: 실시간 동기화 타입 (SPEC-P3-REALTIME-001)
// ============================================================

// @MX:NOTE 연결 모드: 실시간(WS) 또는 폴링
export type ConnectionMode = 'realtime' | 'polling';

/** WS 서버 → 클라이언트 메시지 */
export interface WSMessage {
	type: 'connected' | 'sync_event' | 'pong';
	vault_id?: string;
	timestamp?: string;
	data?: WSSyncEventData;
}

/** WS sync_event 데이터 */
export interface WSSyncEventData {
	id: string;
	event_type: string;
	file_path: string;
	file_type: string;
	device_id: string;
	created_at: string;
	/** 서버 시퀀스 번호 (SPEC-P6-EVENT-007) */
	sequence?: number;
}

/** WS 클라이언트 → 서버 메시지 */
export interface WSClientMessage {
	type: 'ping';
}

// ============================================================
// 충돌 큐 타입
// ============================================================

export interface ConflictQueueItem {
	id: string;
	file_path: string;
	local_content: string;
	server_content: string;
	diff: DiffOperation[] | null;
	base_hash: string | null;
	conflict_id: string | null;
	type: 'diff' | 'simple';
	timestamp: number;
	source: 'download' | 'upload';
}

// ============================================================
// 타입 가드
// ============================================================

/** VectorSettings 타입 가드 */
export function isVectorSettings(value: unknown): value is VectorSettings {
	if (typeof value !== 'object' || value === null) return false;
	const obj = value as Record<string, unknown>;
	return (
		typeof obj.server_url === 'string' &&
		typeof obj.api_key === 'string' &&
		typeof obj.vault_id === 'string' &&
		typeof obj.sync_interval === 'number' &&
		typeof obj.device_id === 'string'
	);
}

/** FileInfo 타입 가드 */
export function isFileInfo(value: unknown): value is FileInfo {
	if (typeof value !== 'object' || value === null) return false;
	const obj = value as Record<string, unknown>;
	return (
		typeof obj.id === 'string' &&
		typeof obj.path === 'string' &&
		typeof obj.hash === 'string'
	);
}

/** SyncEvent 타입 가드 */
const VALID_EVENT_TYPES = ['created', 'updated', 'deleted', 'moved'];

export function isSyncEvent(value: unknown): value is SyncEvent {
	if (typeof value !== 'object' || value === null) return false;
	const obj = value as Record<string, unknown>;
	return (
		typeof obj.id === 'string' &&
		typeof obj.event_type === 'string' &&
		VALID_EVENT_TYPES.includes(obj.event_type) &&
		typeof obj.file_path === 'string' &&
		typeof obj.device_id === 'string' &&
		typeof obj.created_at === 'string'
	);
}
