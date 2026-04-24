// vSync 타입 정의
//
// API 응답 타입은 OpenAPI 명세에서 자동 생성됨 (docs/api/openapi.yaml)
// 비-API 타입만 이 파일에 정의

import type { components } from './types/api-types';

// ============================================================
// Module 1: 설정 타입
// ============================================================

/** 플러그인 설정 인터페이스 */
export interface VSyncSettings {
	/** 서버 URL (trailing slash 제거) */
	server_url: string;
	/** 볼트 고유 ID */
	vault_id: string;
	/** 동기화 주기 (초 단위, 기본 30) */
	sync_interval: number;
	/** 연결 모드 (realtime=WS, polling=폴링) */
	connection_mode: 'realtime' | 'polling';
	/** 디바이스 식별자 */
	device_id: string;
	/** 마지막 동기화 이벤트 ID (커서) */
	last_event_id?: string;
	/** 업로드된 파일 해시 캐시 (경로 → SHA-256) */
	hash_cache?: Record<string, string>;
	/** 동기화 활성화 여부 (기본값: true) */
	sync_enabled: boolean;
	/** 로그인 사용자명 */
	username: string;
	/** 로그인 비밀번호 */
	password: string;
	/** JWT 세션 토큰 (로그인 성공 시 발급) */
	session_token: string;
	/** 건너뛴 파일 경로 목록 (REQ-IS-007, REQ-IS-008) */
	skipped_paths?: string[];
}

/** 기본 설정값 */
export const DEFAULT_SETTINGS: VSyncSettings = {
	server_url: '',
	vault_id: '',
	sync_interval: 30,
	connection_mode: 'realtime',
	device_id: '',
	sync_enabled: false,
	username: '',
	password: '',
	session_token: '',
	skipped_paths: [],
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
	path?: string;
	hash?: string;
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
export type SyncStatus = 'idle' | 'syncing' | 'error' | 'not_configured' | 'paused';

/** 오프라인 큐 항목 */
export interface OfflineQueueItem {
	filePath: string;
	content: string | ArrayBuffer;
	operation: 'upload' | 'delete';
	timestamp: number;
	retryCount: number;
	/** content의 SHA-256 해시 (upload 시), 선택적 필드 (REQ-P6-003) */
	hash?: string;
	/** 3-way merge를 위한 서버 base 해시 (SPEC-SYNC-3WAY-FIX-001 T-005) */
	baseHash?: string;
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
// Module 4: 초기 동기화 모달 타입 (SPEC-INITIAL-SYNC-MODAL-001)
// ============================================================

/**
 * 로컬 파일 항목 (REQ-IS-001)
 */
export interface LocalFileEntry {
	path: string;
	content: string | null;
}

/**
 * 충돌 파일 정보 (REQ-IS-001)
 */
export interface ConflictFile {
	path: string;
	serverHash: string;
	localContent: string | null;
}

/**
 * 동기화 분류 결과 (REQ-IS-001)
 */
export interface SyncClassification {
	auto: {
		/** baseHash 있음, 서버 변경 + 로컬 미변경 */
		downloads: string[];
		/** baseHash 있음, 로컬 변경 + 서버 미변경 */
		uploads: string[];
		/** baseHash 있음, 한쪽 삭제 */
		deletions: string[];
		/** 양쪽 동일 내용 */
		skips: string[];
	};
	user: {
		/** 서버에만 존재 (base 없음) */
		downloads: FileInfo[];
		/** 로컬에만 존재 (base 없음) */
		uploads: LocalFileEntry[];
		/** 양쪽 존재 + 내용 다름 (base 없음) */
		conflicts: ConflictFile[];
	};
}

/** 모달 사용자 선택 결과 (REQ-IS-003~005) */
export interface SyncPlan {
	downloadsToSync: string[];
	uploadsToSync: string[];
	conflictResolutions: Map<string, 'server' | 'local' | 'skip'>;
	allSkippedPaths: string[];
}

export interface DownloadPlan {
	selectedPaths: string[];
	skippedPaths: string[];
}

export interface UploadPlan {
	selectedPaths: string[];
	skippedPaths: string[];
}

export interface ConflictPlan {
	resolutions: Map<string, 'server' | 'local' | 'skip'>;
	skippedPaths: string[];
}

// ============================================================
// Module 5: 실시간 동기화 타입 (SPEC-P3-REALTIME-001)
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

/** VSyncSettings 타입 가드 */
export function isVSyncSettings(value: unknown): value is VSyncSettings {
	if (typeof value !== 'object' || value === null) return false;
	const obj = value as Record<string, unknown>;
	return (
		typeof obj.server_url === 'string' &&
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
