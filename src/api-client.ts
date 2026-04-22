// vSync API 클라이언트

import { requestUrl } from 'obsidian';
import type {
	FileInfo,
	SyncEvent,
	UploadResult,
	OfflineQueueItem,
	ConflictResult,
	StandardErrorResult,
	BatchOperation,
	BatchResult,
	MoveResult,
	DeviceInfo,
	SearchResponse,
	ConflictInfo,
	PaginationOptions,
} from './types';

/** API 클라이언트 설정 */
interface ClientSettings {
	server_url: string;
	vault_id: string;
	device_id: string;
	/** JWT 세션 토큰 (로그인 플로우에서 사용) */
	session_token: string;
}

/** 연결 테스트 결과 */
export interface ConnectionTestResult {
	success: boolean;
	fileCount?: number;
	error?: string;
}

// @MX:NOTE 로그인 응답 타입
/** 로그인 성공 응답 */
export interface LoginResult {
	token: string;
	user: {
		id: string;
		username: string;
		role: string;
	};
	vaults: Array<{
		id: string;
		name: string;
	}>;
}

/** 볼트 정보 (인증 후 조회) */
export interface VaultInfo {
	id: string;
	name: string;
	created_at: string;
}

// @MX:NOTE 오프라인 큐 영속화 콜백 (SPEC-P6-PERSIST-004)
/** 큐 영속화 콜백 — plugin.saveData()를 래핑 */
export type PersistCallback = (items: OfflineQueueItem[]) => void;

// @MX:NOTE 영구 실패 항목 알림 콜백 (SPEC-P6-PERSIST-004)
/** 큐 flush 실패 콜백 */
export type FlushFailedCallback = (failedItems: OfflineQueueItem[]) => void;

// 오프라인 큐 최대 크기
const MAX_QUEUE_SIZE = 100;

// 최대 재시도 횟수 (SPEC-P6-PERSIST-004 REQ-P6-005)
const MAX_RETRIES = 3;

// 50MB 파일 크기 상한 (REQ-P6-003)
export const MAX_BINARY_SIZE = 52_428_800;

// MIME 타입 매핑 (REQ-P6-009)
const MIME_MAP: Record<string, string> = {
	'.png': 'image/png',
	'.jpg': 'image/jpeg',
	'.jpeg': 'image/jpeg',
	'.gif': 'image/gif',
	'.svg': 'image/svg+xml',
	'.webp': 'image/webp',
	'.pdf': 'application/pdf',
	'.mp3': 'audio/mpeg',
	'.mp4': 'video/mp4',
	'.wav': 'audio/wav',
	'.ogg': 'audio/ogg',
};

/** 확장자에 따른 MIME 타입 반환 */
export function getMimeType(path: string): string {
	const ext = path.slice(path.lastIndexOf('.')).toLowerCase();
	return MIME_MAP[ext] || 'application/octet-stream';
}

/** API 엔드포인트 URL 생성 헬퍼 */
function buildApiUrl(baseUrl: string, vaultId: string, ...segments: string[]): string {
	return `${baseUrl}/v1/vault/${vaultId}/${segments.join('/')}`;
}

// @MX:NOTE 듀얼 에러 형식 파싱 (SPEC-P8-PLUGIN-API-001 REQ-PA-016)
// 구형 { error: "string" }과 신형 { error: { code, message, statusCode } } 모두 지원

/** 서버 에러 응답을 StandardErrorResult로 정규화 (REQ-PA-016) */
export function parseServerError(data: Record<string, unknown>): StandardErrorResult {
	const errorField = data.error;

	if (typeof errorField === 'string') {
		// 구형 에러 형식: { error: "message" }
		return {
			code: 'UNKNOWN',
			message: errorField,
		};
	}

	if (errorField !== null && errorField !== undefined && typeof errorField === 'object') {
		// 신형 에러 형식: { error: { code, message, statusCode } }
		const err = errorField as Record<string, unknown>;
		return {
			code: (err.code as string) ?? 'UNKNOWN',
			message: (err.message as string) ?? '',
			statusCode: err.statusCode as number | undefined,
		};
	}

	// error 필드가 없는 경우
	return {
		code: 'UNKNOWN',
		message: '',
	};
}

// @MX:WARN RateLimitBackoff는 지연 상태 전파 위험이 있음
// @MX:REASON syncEngine이 isBackoffActive를 확인하여 동기화 스킵, 상태 불일치 가능
/** 레이트 리밋 지수 백오프 관리 (REQ-PA-017) */
export class RateLimitBackoff {
	private _retryCount = 0;
	private _baseDelay = 1000; // 초기 1초
	private _currentDelay = 1000;
	private _active = false;
	private readonly _maxDelay = 60000; // 최대 60초
	private readonly _maxRetries = 5;

	/** 현재 대기 시간 (ms) */
	getCurrentDelay(): number {
		return this._currentDelay;
	}

	/** 백오프 활성 상태 여부 */
	isActive(): boolean {
		return this._active;
	}

	/** 영구 실패 여부 (최대 재시도 초과) */
	isPermanentlyFailed(): boolean {
		return this._retryCount >= this._maxRetries;
	}

	/** 현재 재시도 횟수 */
	getRetryCount(): number {
		return this._retryCount;
	}

	/**
	 * 429 수신 시 백오프 트리거
	 * @param retryAfterMs Retry-After 헤더 값 (ms), 없으면 undefined
	 */
	trigger(retryAfterMs?: number): void {
		this._active = true;
		this._retryCount++;

		// Retry-After 헤더가 있으면 baseDelay 업데이트
		if (retryAfterMs !== undefined && retryAfterMs > 0) {
			this._baseDelay = retryAfterMs;
		}

		// 지수 백오프: base * 2^retryCount (최대 maxDelay)
		this._currentDelay = Math.min(this._baseDelay * Math.pow(2, this._retryCount), this._maxDelay);
	}

	/** 성공 시 백오프 초기화 */
	reset(): void {
		this._retryCount = 0;
		this._baseDelay = 1000;
		this._currentDelay = 1000;
		this._active = false;
	}
}

// ============================================================
// 정적 인증 API (인스턴스 불필요)
// ============================================================

/** 로그인 - POST /v1/auth/login */
export async function login(
	serverUrl: string,
	username: string,
	password: string,
): Promise<LoginResult> {
	const url = `${serverUrl.replace(/\/+$/, '')}/v1/auth/login`;
	const response = await requestUrl({
		url,
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ username, password }),
	});
	return response.json as LoginResult;
}

/** 볼트 목록 조회 - GET /v1/auth/vaults */
export async function fetchVaults(
	serverUrl: string,
	token: string,
): Promise<VaultInfo[]> {
	const url = `${serverUrl.replace(/\/+$/, '')}/v1/auth/vaults`;
	const response = await requestUrl({
		url,
		method: 'GET',
		headers: { 'Authorization': `Bearer ${token}` },
	});
	const data = response.json as { vaults: VaultInfo[] };
	return data.vaults ?? [];
}

export class VSyncClient {
	private _base_url: string;
	private _vault_id: string;
	private _device_id: string;
	private _session_token: string;
	private _offline_queue: OfflineQueueItem[] = [];
	private _on_auth_failure?: () => void;
	private _persist_callback: PersistCallback;
	private _on_flush_failed?: FlushFailedCallback;
	private _is_flushing = false;

	constructor(settings: ClientSettings, persistCallback?: PersistCallback, onFlushFailed?: FlushFailedCallback) {
		// trailing slash 제거
		this._base_url = settings.server_url.replace(/\/+$/, '');
		this._vault_id = settings.vault_id;
		this._device_id = settings.device_id;
		this._session_token = settings.session_token;
		this._persist_callback = persistCallback ?? (() => {});
		this._on_flush_failed = onFlushFailed;
	}

	/** 설정 업데이트 */
	updateSettings(settings: ClientSettings): void {
		this._base_url = settings.server_url.replace(/\/+$/, '');
		this._vault_id = settings.vault_id;
		this._device_id = settings.device_id;
		this._session_token = settings.session_token;
	}

	/** 인증 실패 콜백 설정 */
	setOnAuthFailure(callback: () => void): void {
		this._on_auth_failure = callback;
	}

	// ============================================================
	// Raw MD API
	// ============================================================

	/** 파일 업로드 - PUT /v1/vault/{id}/raw/{path} */
	// @MX:NOTE 409 시 ConflictResult 반환, 나머지 에러는 throw (REQ-UX-002)
	async rawUpload(path: string, content: string): Promise<UploadResult | ConflictResult> {
		const url = buildApiUrl(this._base_url, this._vault_id, 'raw', encodeURIComponent(path));

		try {
			const response = await requestUrl({
				url,
				method: 'PUT',
				headers: this._getAuthAndDeviceHeaders(),
				contentType: 'text/markdown',
				body: content,
			});
			return response.json as UploadResult;
		} catch (error) {
			// @MX:NOTE 409 Conflict는 에러가 아닌 충돌 응답으로 처리 (REQ-UX-002)
			if (this._isConflictError(error)) {
				return this._parseConflictResponse(error);
			}

			this._handleError(error);
			// 네트워크 오류 시 큐에 추가
			if (this._isNetworkError(error)) {
				this.enqueue({
					filePath: path,
					content,
					operation: 'upload',
					timestamp: Date.now(),
					retryCount: 0,
				});
			}
			throw error;
		}
	}

	/** 파일 다운로드 - GET /v1/vault/{id}/raw/{path} */
	async rawDownload(path: string): Promise<string> {
		const url = buildApiUrl(this._base_url, this._vault_id, 'raw', encodeURIComponent(path));

		try {
			const response = await requestUrl({
				url,
				method: 'GET',
				headers: this._getAuthHeaders(),
			});
			return response.text;
		} catch (error) {
			this._handleError(error);
			throw error;
		}
	}

	/** 파일 삭제 - DELETE /v1/vault/{id}/file/{path} */
	async deleteFile(path: string): Promise<void> {
		const url = buildApiUrl(this._base_url, this._vault_id, 'file', path);

		try {
			await requestUrl({
				url,
				method: 'DELETE',
				headers: this._getAuthAndDeviceHeaders(),
			});
		} catch (error) {
			this._handleError(error);
			if (this._isNetworkError(error)) {
				this.enqueue({
					filePath: path,
					content: '',
					operation: 'delete',
					timestamp: Date.now(),
					retryCount: 0,
				});
			}
			throw error;
		}
	}

	// ============================================================
	// Attachment API (REQ-P6-007, REQ-P6-008)
	// ============================================================

	/** 바이너리 파일 업로드 - PUT /v1/vault/{id}/attachment/{path} */
	async uploadAttachment(path: string, data: ArrayBuffer): Promise<UploadResult> {
		const url = buildApiUrl(this._base_url, this._vault_id, 'attachment', encodeURIComponent(path));
		const mimeType = getMimeType(path);

		try {
			const response = await requestUrl({
				url,
				method: 'PUT',
				headers: this._getAuthAndDeviceHeaders(),
				contentType: mimeType,
				body: data,
			});
			return response.json as UploadResult;
		} catch (error) {
			this._handleError(error);
			// 네트워크 오류 시 큐에 추가 (ArrayBuffer content)
			if (this._isNetworkError(error)) {
				this.enqueue({
					filePath: path,
					content: data,
					operation: 'upload',
					timestamp: Date.now(),
					retryCount: 0,
				});
			}
			throw error;
		}
	}

	/** 바이너리 파일 다운로드 - GET /v1/vault/{id}/attachment/{path} */
	async downloadAttachment(path: string): Promise<ArrayBuffer> {
		const url = buildApiUrl(this._base_url, this._vault_id, 'attachment', encodeURIComponent(path));

		try {
			const response = await requestUrl({
				url,
				method: 'GET',
				headers: this._getAuthHeaders(),
			});
			return response.arrayBuffer;
		} catch (error) {
			this._handleError(error);
			throw error;
		}
	}

	// ============================================================
	// JSON API
	// ============================================================

	/** 파일 목록 조회 - GET /v1/vault/{id}/files (REQ-PA-018: 페이지네이션 지원) */
	async listFiles(options?: PaginationOptions): Promise<FileInfo[]> {
		let url = buildApiUrl(this._base_url, this._vault_id, 'files');
		const params: string[] = [];
		if (options?.limit) params.push(`limit=${options.limit}`);
		if (options?.cursor) params.push(`cursor=${options.cursor}`);
		if (params.length > 0) url += '?' + params.join('&');

		const response = await requestUrl({
			url,
			method: 'GET',
			headers: this._getAuthHeaders(),
		});
		// 하위 호환: 배열 응답(구형) 또는 { files, hasMore } (신형)
		const data = response.json;
		if (Array.isArray(data)) return data as FileInfo[];
		return (data as any).files ?? []; // eslint-disable-line @typescript-eslint/no-explicit-any -- 서버 응답이 배열(구형) 또는 객체(신형)로 올 수 있음
	}

	/** 이벤트 폴링 - GET /v1/vault/{id}/events?since={id} (REQ-PA-018: 페이지네이션 지원) */
	async getEvents(sinceId?: string, options?: PaginationOptions): Promise<SyncEvent[]> {
		let url = buildApiUrl(this._base_url, this._vault_id, 'events');
		const params: string[] = [];
		if (sinceId) params.push(`since=${sinceId}`);
		if (options?.limit) params.push(`limit=${options.limit}`);
		if (options?.cursor) params.push(`cursor=${options.cursor}`);
		if (params.length > 0) url += '?' + params.join('&');

		const response = await requestUrl({
			url,
			method: 'GET',
			headers: this._getAuthHeaders(),
		});
		const data = response.json as { events: SyncEvent[] };
		return data.events || [];
	}

	/** 동기화 상태 업데이트 - PUT /v1/vault/{id}/sync-status */
	async updateSyncStatus(lastEventId: string): Promise<void> {
		const url = buildApiUrl(this._base_url, this._vault_id, 'sync-status');

		await requestUrl({
			url,
			method: 'PUT',
			headers: {
				...this._getAuthHeaders(),
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				device_id: this._device_id,
				last_event_id: lastEventId,
			}),
		});
	}

	/** 연결 테스트 */
	async testConnection(): Promise<ConnectionTestResult> {
		try {
			const files = await this.listFiles();
			return {
				success: true,
				fileCount: files.length,
			};
		} catch (error: unknown) {
			let errorMessage = 'Unknown error';
			if (this._isAuthError(error)) {
				errorMessage = 'Authentication failed. Please check your credentials.';
			} else if (error instanceof Error) {
				errorMessage = error.message;
			}
			return {
				success: false,
				error: errorMessage,
			};
		}
	}

	// ============================================================
	// SPEC-P8-PLUGIN-API-001: 신규 API 메서드
	// ============================================================

	/** 배치 연산 - POST /v1/vault/{id}/batch (REQ-PA-001) */
	async batchOperations(operations: BatchOperation[]): Promise<BatchResult> {
		const url = buildApiUrl(this._base_url, this._vault_id, 'batch');
		const response = await requestUrl({
			url,
			method: 'POST',
			headers: { ...this._getAuthAndDeviceHeaders(), 'Content-Type': 'application/json' },
			body: JSON.stringify({ operations }),
		});
		// 서버 응답: { results: [{ status, data?: {...}, error? }] } → 평탄화
		const raw = response.json as { results: Array<{ status: number; data?: Record<string, unknown>; error?: string }> };
		return {
			results: raw.results.map((item) => ({
				status: item.status,
				path: (item.data?.path as string) ?? undefined,
				hash: (item.data?.hash as string) ?? undefined,
				error: item.error,
			})),
		};
	}

	/** 파일 이동 - POST /v1/vault/{id}/move (REQ-PA-004) */
	async moveFile(from: string, to: string): Promise<MoveResult> {
		const url = buildApiUrl(this._base_url, this._vault_id, 'move');
		const response = await requestUrl({
			url,
			method: 'POST',
			headers: { ...this._getAuthAndDeviceHeaders(), 'Content-Type': 'application/json' },
			body: JSON.stringify({ from, to }),
		});
		return response.json as MoveResult;
	}

	/** 디바이스 목록 - GET /v1/vault/{id}/devices (REQ-PA-011) */
	async getDevices(): Promise<DeviceInfo[]> {
		const url = buildApiUrl(this._base_url, this._vault_id, 'devices');
		const response = await requestUrl({
			url,
			method: 'GET',
			headers: this._getAuthHeaders(),
		});
		const data = response.json as { devices: DeviceInfo[] };
		return data.devices ?? [];
	}

	/** 디바이스 제거 - DELETE /v1/vault/{id}/devices/{deviceId} (REQ-PA-012) */
	async removeDevice(deviceId: string): Promise<void> {
		const url = buildApiUrl(this._base_url, this._vault_id, 'devices', deviceId);
		await requestUrl({
			url,
			method: 'DELETE',
			headers: this._getAuthAndDeviceHeaders(),
		});
	}

	/** 전문 검색 - GET /v1/vault/{id}/search (REQ-PA-013) */
	async searchFiles(query: string, options?: { limit?: number; folder?: string }): Promise<SearchResponse> {
		const params: string[] = [`q=${encodeURIComponent(query)}`];
		if (options?.limit) params.push(`limit=${options.limit}`);
		if (options?.folder) params.push(`folder=${encodeURIComponent(options.folder)}`);
		const url = buildApiUrl(this._base_url, this._vault_id, 'search') + '?' + params.join('&');
		const response = await requestUrl({
			url,
			method: 'GET',
			headers: this._getAuthHeaders(),
		});
		return response.json as SearchResponse;
	}

	/** 활성 충돌 목록 - GET /v1/vault/{id}/conflicts (REQ-PA-007) */
	async getConflicts(): Promise<ConflictInfo[]> {
		const url = buildApiUrl(this._base_url, this._vault_id, 'conflicts');
		const response = await requestUrl({
			url,
			method: 'GET',
			headers: this._getAuthHeaders(),
		});
		const data = response.json as { conflicts: ConflictInfo[] };
		return data.conflicts ?? [];
	}

	/** 충돌 해결 - POST /v1/vault/{id}/conflicts/{id}/resolve (REQ-PA-008) */
	async resolveConflict(conflictId: string, resolution: 'accept' | 'reject'): Promise<void> {
		const url = buildApiUrl(this._base_url, this._vault_id, 'conflicts', conflictId, 'resolve');
		await requestUrl({
			url,
			method: 'POST',
			headers: { ...this._getAuthAndDeviceHeaders(), 'Content-Type': 'application/json' },
			body: JSON.stringify({ resolution }),
		});
	}

	/** 병합 해결 - POST /v1/vault/{id}/conflicts/{id}/merge-resolve (REQ-PA-009) */
	async mergeResolve(conflictId: string, content: string, hash: string): Promise<void> {
		const url = buildApiUrl(this._base_url, this._vault_id, 'conflicts', conflictId, 'merge-resolve');
		await requestUrl({
			url,
			method: 'POST',
			headers: { ...this._getAuthAndDeviceHeaders(), 'Content-Type': 'application/json' },
			body: JSON.stringify({ content, hash }),
		});
	}

	// ============================================================
	// 오프라인 큐 (REQ-P4-007, REQ-P6-017, SPEC-P6-PERSIST-004)
	// ============================================================

	/**
	 * 큐에 작업 추가 (SPEC-P6-PERSIST-004)
	 * @MX:ANCHOR dedup + FIFO + persist 통합 진입점
	 * @MX:REASON 모든 오프라인 큐 적재 경로에서 호출, fan_in >= 3
	 */
	enqueue(item: OfflineQueueItem): void {
		// @MX:NOTE 동일 filePath 기존 항목 제거 (dedup) (REQ-P6-004)
		this._offline_queue = this._offline_queue.filter(
			(existing) => existing.filePath !== item.filePath
		);

		this._offline_queue.push(item);
		// FIFO 초과 시 가장 오래된 항목 제거
		if (this._offline_queue.length > MAX_QUEUE_SIZE) {
			this._offline_queue.shift();
		}

		this._persist();
	}

	/** 큐 크기 반환 */
	getQueueSize(): number {
		return this._offline_queue.length;
	}

	/**
	 * 외부에서 복원한 항목 주입 (SPEC-P6-PERSIST-004 REQ-P6-002)
	 * @MX:ANCHOR 플러그인 로드 시 큐 복원 진입점
	 * @MX:REASON main.ts에서만 호출, 복원 로직의 유일한 경로
	 */
	restoreQueue(items: OfflineQueueItem[]): void {
		this._offline_queue = [...items];
		this._persist();
	}

	/**
	 * 큐의 작업을 순차 재시도 (SPEC-P6-PERSIST-004)
	 * @MX:ANCHOR mutex + exponential backoff + 영구 실패 처리
	 * @MX:REASON 네트워크 복구/폴링 시 핵심 flush 로직, 3개 이상 호출 경로
	 */
	async flushQueue(): Promise<void> {
		// @MX:NOTE mutex: 이미 flush 중이면 즉시 반환 (REQ-P6-007)
		if (this._is_flushing || this._offline_queue.length === 0) return;
		this._is_flushing = true;

		const failedItems: OfflineQueueItem[] = [];

		try {
			while (this._offline_queue.length > 0) {
				const item = this._offline_queue[0]; // peek

				try {
					if (item.operation === 'upload') {
						if (item.content instanceof ArrayBuffer) {
							await this.uploadAttachment(item.filePath, item.content);
						} else {
							await this.rawUpload(item.filePath, item.content);
						}
					} else if (item.operation === 'delete') {
						await this.deleteFile(item.filePath);
					}
					this._offline_queue.shift();
				} catch (error) {
					if (!this._isNetworkError(error)) {
						this._offline_queue.shift();
						failedItems.push(item);
						continue;
					}

					item.retryCount++;

					if (item.retryCount >= MAX_RETRIES) {
						this._offline_queue.shift();
						failedItems.push(item);
						continue;
					}

					this._offline_queue.shift();
					this._offline_queue.push(item);
					break;
				}
			}

			if (failedItems.length > 0) {
				this._on_flush_failed?.(failedItems);
			}
		} finally {
			this._persist();
			this._is_flushing = false;
		}
	}

	// ============================================================
	// 내부 헬퍼
	// ============================================================

	/** 큐 영속화 호출 */
	private _persist(): void {
		try {
			this._persist_callback(this._offline_queue);
		} catch {
			console.warn('vSync: Failed to persist offline queue');
		}
	}

	/** HTTP 상태 코드 확인 공통 헬퍼 */
	private _hasStatus(error: unknown, status: number): boolean {
		return error !== null && typeof error === 'object' && 'status' in error
			&& (error as { status: number }).status === status;
	}

	/** 인증 에러 감지 */
	private _isAuthError(error: unknown): boolean {
		return this._hasStatus(error, 401);
	}

	/** 네트워크 에러 감지 */
	private _isNetworkError(error: unknown): boolean {
		if (error instanceof Error) {
			const msg = error.message.toLowerCase();
			return msg.includes('network') || msg.includes('fetch') || msg.includes('timeout');
		}
		return false;
	}

	/** 에러 처리 - 401 감지 시 콜백 호출 */
	private _handleError(error: unknown): void {
		if (this._isAuthError(error) && this._on_auth_failure) {
			this._on_auth_failure();
		}
	}

	// @MX:NOTE JWT Bearer 토큰만 사용 (ID/PW 로그인 전용)
	/** 인증 헤더 반환 (JWT Bearer) */
	private _getAuthHeaders(): Record<string, string> {
		return { 'Authorization': `Bearer ${this._session_token}` };
	}

	/** 인증 + 디바이스 ID 헤더 반환 */
	private _getAuthAndDeviceHeaders(): Record<string, string> {
		return {
			...this._getAuthHeaders(),
			'X-Device-ID': this._device_id,
		};
	}

	/** 409 Conflict 에러 감지 (REQ-UX-002) */
	private _isConflictError(error: unknown): boolean {
		return this._hasStatus(error, 409);
	}

	/** 409 응답에서 ConflictResult 파싱 (REQ-UX-002) */
	private _parseConflictResponse(error: unknown): ConflictResult {
		const err = error as { json?: Record<string, unknown> };
		const data = err.json ?? {};
		return {
			conflict: true,
			current_hash: (data.current_hash as string) ?? '',
			incoming_hash: (data.incoming_hash as string) ?? '',
			conflict_path: (data.conflict_path as string) ?? '',
			base_hash: data.base_hash as string | undefined,
			diff: data.diff as ConflictResult['diff'],
			can_auto_merge: data.can_auto_merge as boolean | undefined,
		};
	}
}
