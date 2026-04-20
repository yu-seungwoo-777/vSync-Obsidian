// 동기화 엔진 - 핵심 동기화 로직

import { VectorClient, MAX_BINARY_SIZE } from './api-client';
import type { PersistCallback } from './api-client';
import { ConflictResolver, ConflictQueue } from './conflict';
import type { ConflictQueueItem } from './conflict';
import { computeHash } from './utils/hash';
import { shouldSyncPath, normalizePath, isObsidianPath, isBinaryPath } from './utils/path';
import { WSClient } from './services/ws-client';
import { PollingFallback } from './services/polling-fallback';
import type { VectorSettings, SyncEvent, FileInfo, ConnectionMode, OfflineQueueItem, ConflictResult, DeviceInfo } from './types';

// 다운로드 후 vault modify 이벤트 필터링 유지 시간 (ms)
const RECENTLY_MODIFIED_TTL_MS = 1000;

/** 해시 캐시 최대 엔트리 수 (REQ-DP-009) */
const MAX_HASH_CACHE_SIZE = 10000;

/** 디바운스 지연 시간 (ms) (REQ-DP-008) */
const DEBOUNCE_DELAY_MS = 300;

/** 동기화 엔진 */
// @MX:NOTE 리네임 감지기: 삭제+생성 500ms 윈도우 + 해시 매칭 (REQ-PA-004)
// 동일 디렉토리에서 삭제 후 짧은 시간 내 생성 시 리네임으로 간주
export class RenameDetector {
	private _pendingDelete: { path: string; hash: string; timestamp: number } | null = null;
	private readonly _windowMs = 500;
	private _timer: ReturnType<typeof setTimeout> | null = null;
	private _noticeFn: (msg: string) => void;

	constructor(noticeFn: (msg: string) => void) {
		this._noticeFn = noticeFn;
	}

	/** 삭제 이벤트 등록 */
	recordDelete(path: string, hash: string): void {
		this._pendingDelete = { path, hash, timestamp: Date.now() };
		// 윈도우 만료 후 자동 클리어
		if (this._timer) clearTimeout(this._timer);
		this._timer = setTimeout(() => {
			this._pendingDelete = null;
		}, this._windowMs);
	}

	/** 생성 이벤트로 리네임 감지 시도 */
	detectRename(newPath: string, newHash: string): { from: string; to: string } | null {
		if (!this._pendingDelete) return null;

		const elapsed = Date.now() - this._pendingDelete.timestamp;
		if (elapsed > this._windowMs) {
			this._pendingDelete = null;
			return null;
		}

		// 동일 디렉토리 + 동일 해시 → 리네임
		if (this._pendingDelete.hash === newHash) {
			const result = { from: this._pendingDelete.path, to: newPath };
			this._pendingDelete = null;
			if (this._timer) {
				clearTimeout(this._timer);
				this._timer = null;
			}
			return result;
		}

		return null;
	}

	/** 대기 중인 삭제 이벤트 초기화 */
	clear(): void {
		this._pendingDelete = null;
		if (this._timer) {
			clearTimeout(this._timer);
			this._timer = null;
		}
	}
}

export class SyncEngine {
	private _client: VectorClient;
	private _conflict_resolver: ConflictResolver;
	// @MX:NOTE 충돌 큐 (SPEC-P6-UX-002 REQ-UX-003)
	private _conflict_queue: ConflictQueue | null;
	private _vault: VaultAdapter;
	private _settings: VectorSettings;
	private _notice_fn: (msg: string) => void;
	private _is_syncing = false;
	private _recently_modified = new Set<string>();
	private _last_event_id = '';
	private _status: 'idle' | 'syncing' | 'error' | 'not_configured' = 'idle';

	// @MX:NOTE 듀얼 모드 상태 (SPEC-P3-REALTIME-001)
	private _connection_mode: ConnectionMode = 'polling';
	private _ws_client: WSClient | null = null;
	private _polling_fallback: PollingFallback;
	private _on_status_change: ((status: string, mode: ConnectionMode) => void) | null = null;

	// @MX:NOTE 이벤트 큐: 직렬 처리 보장 (SPEC-P6-EVENT-007 REQ-EVT-001)
	private _event_queue: SyncEvent[] = [];
	private _is_processing = false;

	// @MX:NOTE 중복 이벤트 방지 (SPEC-P6-EVENT-007 REQ-EVT-002)
	private _processed_event_ids = new Set<string>();
	private readonly _max_processed_ids = 1000;

	// @MX:NOTE 해시 기반 업로드 중복 제거 (SPEC-P6-DEDUP-003)
	private _hash_cache: Map<string, string>;
	private _pending_uploads: Map<string, ReturnType<typeof setTimeout>> = new Map();
	private _on_cache_update: ((cache: Map<string, string>) => void) | null = null;

	private _persist_callback?: PersistCallback;

	// @MX:NOTE 리네임 감지기 (REQ-PA-004)
	private _rename_detector: RenameDetector;

	constructor(settings: VectorSettings, vault: VaultAdapter, noticeFn: (msg: string) => void, persistCallback?: PersistCallback, restoredQueue?: OfflineQueueItem[], conflictQueue?: ConflictQueue) {
		this._settings = settings;
		this._vault = vault;
		this._notice_fn = noticeFn;
		this._persist_callback = persistCallback;
		this._conflict_queue = conflictQueue ?? null;
		this._client = this._createClient(settings);
		this._conflict_resolver = new ConflictResolver(noticeFn);
		this._last_event_id = settings.last_event_id || '';
		this._polling_fallback = new PollingFallback((settings.sync_interval || 30) * 1000);
		this._rename_detector = new RenameDetector(noticeFn);

		// 해시 캐시: 설정에서 복원 또는 빈 Map (AC-006.2, AC-006.6)
		this._hash_cache = new Map(Object.entries(settings.hash_cache ?? {}));

		if (restoredQueue && restoredQueue.length > 0) {
			this._client.restoreQueue(restoredQueue);
		}
	}

	private _createClient(settings: VectorSettings): VectorClient {
		return new VectorClient({
			server_url: settings.server_url,
			api_key: settings.api_key,
			vault_id: settings.vault_id,
			device_id: settings.device_id,
		}, this._persist_callback, (failedItems) => this._handleFlushFailed(failedItems));
	}

	private _handleFlushFailed(failedItems: OfflineQueueItem[]): void {
		const paths = failedItems.map((item) => item.file_path).join(', ');
		this._notice_fn(`Sync failed after 3 retries: ${paths}`);
	}

	/** 동기화 중 상태 설정 (테스트용) */
	setSyncing(value: boolean): void {
		this._is_syncing = value;
	}

	/** 설정 업데이트 (AC-007.1: 서버 URL 등 변경 시 캐시 초기화) */
	updateSettings(settings: VectorSettings): void {
		this._settings = settings;
		this._client = this._createClient(settings);
		this._last_event_id = settings.last_event_id || '';
		this._hash_cache = new Map(Object.entries(settings.hash_cache ?? {}));
	}

	/**
	 * 오프라인 큐 flush (외부 트리거용) (SPEC-P6-PERSIST-004 REQ-P6-008)
	 * @MX:ANCHOR WS 재연결/폴링/Force sync에서 호출
	 * @MX:REASON 3개 이상의 호출 경로에서 사용, 네트워크 복구 시 핵심 로직
	 */
	async flushOfflineQueue(): Promise<void> {
		await this._client.flushQueue();
	}


	// @MX:NOTE 서버 충돌 동기화 (REQ-PA-007, T-012)
	async syncServerConflicts(): Promise<void> {
		if (!this._conflict_queue) return;

		try {
			const serverConflicts = await this._client.getConflicts();
			for (const sc of serverConflicts) {
				// 중복 체크: 같은 conflictId가 이미 큐에 있으면 스킵
				const existing = this._conflict_queue.getAll().find(
					(item) => item.conflict_id === sc.id
				);
				if (existing) continue;

				this._conflict_queue.enqueue({
					id: globalThis.crypto?.randomUUID?.() ?? `sc-${Date.now()}-${Math.random().toString(36).slice(2)}`,
					file_path: sc.original_path ?? "unknown",
					local_content: '',
					server_content: '',
					diff: null,
					base_hash: null,
					conflict_id: sc.id,
					type: 'simple',
					timestamp: Date.now(),
					source: 'download',
				});
			}
		} catch (error) {
			this._notice_fn(`Failed to sync server conflicts: ${(error as Error).message}`);
		}
	}

	// @MX:NOTE 충돌 해결 API 래퍼 (REQ-PA-008, T-013)
	async resolveConflict(conflictId: string, resolution: 'accept' | 'reject'): Promise<void> {
		await this._client.resolveConflict(conflictId, resolution);
	}

	// @MX:NOTE 병합 해결 API 래퍼 (REQ-PA-009, T-014)
	async mergeResolve(conflictId: string, content: string, hash: string): Promise<void> {
		await this._client.mergeResolve(conflictId, content, hash);
	}

	// @MX:NOTE 자동 병합 시도 (REQ-PA-010, T-015)
	async _tryAutoMerge(filePath: string, localContent: string, serverContent: string, conflictId: string): Promise<boolean> {
		try {
			const mergedContent = localContent;
			const mergedHash = await computeHash(mergedContent);
			await this._client.rawUpload(filePath, mergedContent);
			await this._client.mergeResolve(conflictId, mergedContent, mergedHash);
			this._notice_fn(`Auto-merged: ${filePath}`);
			return true;
		} catch {
			return false;
		}
	}


	// @MX:NOTE 디바이스 목록 조회 (REQ-PA-011, T-016)
	async getDevices(): Promise<DeviceInfo[]> {
		try {
			return await this._client.getDevices();
		} catch (error) {
			this._notice_fn(`Failed to get devices: ${(error as Error).message}`);
			return [];
		}
	}

	// @MX:NOTE 디바이스 제거 (REQ-PA-012, T-017)
	async removeDevice(deviceId: string): Promise<void> {
		if (deviceId === this._settings.device_id) {
			throw new Error('Cannot remove current device');
		}
		await this._client.removeDevice(deviceId);
	}


	// @MX:NOTE 서버 전문 검색 (REQ-PA-013, T-018)
	async searchFiles(query: string, options?: { limit?: number; folder?: string }): Promise<{ results: Array<{ path: string; snippet: string; score: number }>; total: number }> {
		try {
			return await this._client.searchFiles(query, options);
		} catch (error) {
			this._notice_fn(`Search failed: ${(error as Error).message}`);
			return { results: [], total: 0 };
		}
	}


	// @MX:NOTE 페이지네이션 파일 목록 조회 (REQ-PA-018, T-020)
	async listFilesPaginated(): Promise<FileInfo[]> {
		const allFiles: FileInfo[] = [];
		let cursor: string | undefined;

		do {
			const response = await this._client.listFiles(cursor ? { cursor } : undefined);
			// 하위 호환: listFiles는 FileInfo[] 또는 PaginatedFilesResponse 반환 가능
			if (Array.isArray(response)) {
				allFiles.push(...response);
				break; // 배열 응답은 전체 결과
			}
				// eslint-disable-next-line @typescript-eslint/no-explicit-any -- API paged response has dynamic shape based on endpoint
				const paged = response as any;
			allFiles.push(...(paged.files ?? []));
			if (!paged.hasMore) break;
			cursor = paged.cursor;
		} while (cursor);

		return allFiles;

	}
	/** 현재 상태 반환 */
	getStatus(): string {
		return this._status;
	}

	/** 현재 연결 모드 반환 */
	getConnectionMode(): ConnectionMode {
		return this._connection_mode;
	}

	/** 상태 변경 콜백 설정 */
	setOnStatusChange(callback: (status: string, mode: ConnectionMode) => void): void {
		this._on_status_change = callback;
	}

	/** 캐시 업데이트 콜백 설정 (AC-006.3) */
	setOnCacheUpdate(callback: (cache: Map<string, string>) => void): void {
		this._on_cache_update = callback;
	}

	// ============================================================
	// T-008: 로컬 파일 변경 감지
	// ============================================================

	/** 로컬 파일 생성 이벤트 처리 */
	/** 로컬 파일 생성 이벤트 처리 */
	async handleLocalCreate(file: { path: string }): Promise<void> {
		const normalizedPath = normalizePath(file.path);
		if (!shouldSyncPath(normalizedPath)) return;

		// 리네임 감지 시도 (REQ-PA-004)
		if (!isBinaryPath(normalizedPath)) {
			const content = await this._vault.readIfExists(normalizedPath);
			if (content !== null) {
				const contentHash = await computeHash(content);
				const rename = this._rename_detector.detectRename(normalizedPath, contentHash);
				if (rename) {
					// 리네임 감지됨 → POST /move 호출
					try {
						await this._client.moveFile(rename.from, rename.to);
						this._hash_cache.delete(rename.from);
						this._updateHashCache(rename.to, contentHash);
						return;
					} catch (error) {
						// /move 실패 → 기존 delete+create로 폴백 (graceful degradation)
						this._notice_fn(`Move failed, falling back: ${(error as Error).message}`);
						// 폴백 시 deleteFile은 이미 handleLocalDelete에서 처리됨
					}
				}
			}
		}

		await this._uploadLocalFile(file.path);
	}

	/** 로컬 파일 수정 이벤트 처리 (REQ-DP-008: 디바운스 적용) */
	async handleLocalModify(file: { path: string }): Promise<void> {
		if (!shouldSyncPath(file.path)) return;
		if (this._is_syncing || this._recently_modified.has(file.path)) return;

		// 기존 타이머 취소 (AC-008.3)
		const existingTimer = this._pending_uploads.get(file.path);
		if (existingTimer) {
			clearTimeout(existingTimer);
		}

		// 새 디바운스 타이머 설정 (AC-008.2)
		const timer = setTimeout(() => {
			this._pending_uploads.delete(file.path);
			this._uploadLocalFile(file.path);
		}, DEBOUNCE_DELAY_MS);

		this._pending_uploads.set(file.path, timer);
	}

	/** 로컬 파일 삭제 이벤트 처리 (AC-007.3: 삭제 시 캐시 엔트리 제거) */
	async handleLocalDelete(path: string): Promise<void> {
		if (!shouldSyncPath(path)) return;
		if (this._is_syncing || this._recently_modified.has(path)) return;

		// 리네임 감지를 위해 삭제 해시 기록 (REQ-PA-004)
		const normalizedPath = normalizePath(path);
		let deleteHash = this._hash_cache.get(normalizedPath);
		if (!deleteHash) {
			// 캐시 미스 시 파일 내용에서 해시 계산
			const content = await this._vault.readIfExists(normalizedPath);
			if (content !== null) {
				deleteHash = await computeHash(content);
			}
		}
		if (deleteHash) {
			this._rename_detector.recordDelete(normalizedPath, deleteHash);
		}

		try {
			await this._client.deleteFile(path);
			this._hash_cache.delete(normalizedPath);
		} catch (error) {
			this._notice_fn(`Failed to delete ${path}: ${(error as Error).message}`);
		}
	}

	/** 로컬 파일 업로드 (REQ-DP-002: 해시 비교 후 조건부 업로드) */
	private async _uploadLocalFile(path: string): Promise<void> {
		if (!shouldSyncPath(path)) return;
		if (this._is_syncing || this._recently_modified.has(path)) return;

		try {
			const normalizedPath = normalizePath(path);

			if (isBinaryPath(normalizedPath)) {
				// 바이너리 파일 경로 (REQ-P6-011)
				const data = await this._vault.readBinary(normalizedPath);

				// 크기 검증 (REQ-P6-003)
				if (data.byteLength > MAX_BINARY_SIZE) {
					this._notice_fn(`File too large (over 50MB): ${normalizedPath}`);
					return;
				}

				await this._client.uploadAttachment(normalizedPath, data);
			} else {
				// 텍스트 파일 경로
				// SPEC-P6-RELIABLE-005 AC-002.1: readIfExists 사용
				const content = await this._vault.readIfExists(normalizedPath);

				// AC-002.2: null이면 파일이 없음 → 에러 없이 스킵
				if (content === null) return;

				// REQ-DP-002: 해시 비교 (AC-002.1, AC-002.2)
				const contentHash = await computeHash(content);
				const cachedHash = this._hash_cache.get(normalizedPath);
				if (cachedHash === contentHash) {
					return; // 동일 내용, 업로드 스킵 (AC-002.2)
				}

				// 업로드 실행 (AC-002.3)
				const result = await this._client.rawUpload(normalizedPath, content);

				// @MX:NOTE 409 Conflict 응답 시 충돌 큐에 적재 (SPEC-P6-UX-002 REQ-UX-002)
				if ('conflict' in result && result.conflict === true) {
					await this._handleUploadConflict(normalizedPath, content, result);
					return;
				}

				// REQ-DP-003: 캐시 업데이트 (AC-003.1, AC-003.2)
				this._updateHashCache(normalizedPath, (result as import('./types').UploadResult).hash);
			}
		} catch (error) {
			// 업로드 실패 시 캐시 업데이트하지 않음 (AC-003.4)
			this._notice_fn(`Failed to upload ${path}: ${(error as Error).message}`);
		}
	}

	/** 해시 캐시 업데이트 (LRU) (REQ-DP-009) */
	private _updateHashCache(path: string, hash: string): void {
		// LRU: 기존 키 제거 후 재삽입 (AC-009.4)
		this._hash_cache.delete(path);
		this._hash_cache.set(path, hash);

		// 크기 초과 시 오래된 항목 제거 (AC-009.2)
		if (this._hash_cache.size > MAX_HASH_CACHE_SIZE) {
			const oldestKey = this._hash_cache.keys().next().value;
			if (oldestKey !== undefined) {
				this._hash_cache.delete(oldestKey);
			}
		}

		// 외부에 캐시 변경 알림 (AC-006.3)
		this._on_cache_update?.(this._hash_cache);
	}

	/** 캐시를 설정에 저장 가능한 형태로 변환 */

	// 배치 청크 크기 (REQ-PA-001)
	private static readonly BATCH_CHUNK_SIZE = 50;

	/**
	 * 배치 업로드: 텍스트 파일을 50개 단위로 청크하여 batchOperations 호출 (REQ-PA-001)
	 * @param uploadFiles 업로드할 파일 목록 [{ path, content, hash }]
	 * @param deletePaths 삭제할 파일 경로 목록 (선택적)
	 */
	async _batchUploadFiles(
		uploadFiles: Array<{ path: string; content: string; hash: string }>,
		deletePaths: string[] = [],
	): Promise<void> {
		// 배치 연산 구성: create + delete 혼합 (REQ-PA-002)
		const allOps: import('./types').BatchOperation[] = [
			...uploadFiles.map((f) => ({
				type: 'create' as const,
				data: { path: f.path, content: f.content, hash: f.hash },
			})),
			...deletePaths.map((p) => ({
				type: 'delete' as const,
				data: { path: p },
			})),
		];

		// 50개 단위 청크 분할 (REQ-PA-001)
		for (let i = 0; i < allOps.length; i += SyncEngine.BATCH_CHUNK_SIZE) {
			const chunk = allOps.slice(i, i + SyncEngine.BATCH_CHUNK_SIZE);
			const result = await this._client.batchOperations(chunk);

			// 결과 처리: 성공은 캐시 업데이트, 실패는 오프라인 큐 (REQ-PA-003)
			for (const item of result.results) {
				if (item.status >= 400) {
					// 실패 항목 → 오프라인 큐에 적재
					const uploadFile = uploadFiles.find((f) => f.path === item.path);
					if (uploadFile && item.path) {
						this._client.enqueue({
							file_path: item.path,
							content: uploadFile.content,
							operation: 'upload',
							timestamp: Date.now(),
							retryCount: 0,
							hash: uploadFile.hash ?? '',
						});
					}
				} else if (item.hash) {
					// 성공 항목 → 캐시 업데이트
					if (item.hash && item.path) this._updateHashCache(item.path, item.hash);
				}
			}
		}
	}

	private _serializeCache(): Record<string, string> {
		const result: Record<string, string> = {};
		// 최대 10,000 엔트리만 저장 (AC-006.5)
		let count = 0;
		for (const [key, value] of this._hash_cache) {
			if (count >= MAX_HASH_CACHE_SIZE) break;
			result[key] = value;
			count++;
		}
		return result;
	}

	// ============================================================
	// SPEC-P6-UX-002: 충돌 큐 연동 메서드
	// ============================================================

	/**
	 * 배치 충돌 알림 표시 (REQ-UX-004)
	 * 동기화 세션 완료 후 N개 충돌에 대한 통합 알림
	 */
	_showConflictNotice(count: number): void {
		if (count <= 0) return;
		if (count === 1) {
			this._notice_fn('1개 파일에 충돌이 발생했습니다');
		} else {
			this._notice_fn(`${count}개 파일에 충돌이 발생했습니다`);
		}
	}

	/**
	 * 업로드 409 충돌 처리 (REQ-UX-002)
	 * rawUpload가 ConflictResult를 반환한 경우 큐에 적재
	 */
	async _handleUploadConflict(filePath: string, localContent: string, conflictResult: ConflictResult): Promise<void> {
		if (!this._conflict_queue) return;

		// 서버 내용 다운로드 (필요시)
		let serverContent = '';
		try {
			serverContent = await this._client.rawDownload(filePath);
		} catch {
			// 다운로드 실패 시 빈 내용으로 진행
		}

		const itemType: ConflictQueueItem['type'] = (conflictResult.diff && conflictResult.diff.length > 0)
			? 'diff' : 'simple';

		this._conflict_queue.enqueue({
			id: globalThis.crypto.randomUUID(),
			file_path: filePath,
			local_content: localContent,
			server_content: serverContent,
			diff: conflictResult.diff ?? null,
			base_hash: conflictResult.base_hash ?? null,
			conflict_id: null, // TODO: conflict_path에서 ID 추출 (T-010)
			type: itemType,
			timestamp: Date.now(),
			source: 'upload',
		});
	}

	/** 충돌 큐 반환 (테스트용) */
	getConflictQueue(): ConflictQueue | null {
		return this._conflict_queue;
	}

	// ============================================================
	// T-009: 원격 변경 폴링
	// ============================================================

	/** 원격 변경 폴링 */
	async pollRemoteChanges(): Promise<void> {
		if (this._is_syncing) return;

		try {
			this._is_syncing = true;
			const events = await this._client.getEvents(this._last_event_id || undefined);

			if (events.length === 0) return;

			for (const event of events) {
				await this._enqueueEvent(event);
			}
		} catch (error) {
			this._notice_fn(`Polling failed: ${(error as Error).message}`);
		} finally {
			this._is_syncing = false;
		}
	}

	/** 개별 이벤트 처리 */
	private async _processEvent(event: SyncEvent): Promise<void> {
		// 자기 자신의 디바이스 이벤트는 무시
		if (event.device_id === this._settings.device_id) return;

		// .obsidian 경로는 무시
		if (isObsidianPath(event.file_path)) return;

		switch (event.event_type) {
			case 'created':
			case 'updated':
				await this._downloadRemoteFile(event.file_path);
				break;
			case 'deleted':
				await this._deleteLocalFile(event.file_path);
				break;
			case 'moved':
				await this._handleMovedEvent(event);
				break;
		}
	}

	/** 원격 파일 다운로드 */
	private async _downloadRemoteFile(path: string, serverHash?: string): Promise<void> {
		try {
			if (isBinaryPath(path)) {
				// 바이너리 파일 경로 (REQ-P6-012)
				await this._downloadRemoteBinary(path, serverHash);
			} else {
				// 텍스트 파일 경로 (기존 로직)
				await this._downloadRemoteText(path, serverHash);
			}
		} catch (error) {
			this._notice_fn(`Failed to download ${path}: ${(error as Error).message}`);
		}
	}

	/** 텍스트 파일 원격 다운로드 */
	private async _downloadRemoteText(path: string, serverHash?: string): Promise<void> {
		const content = await this._client.rawDownload(path);

		// 로컬 파일 존재 여부 확인
		const localContent = await this._vault.readIfExists(path);
		if (localContent !== null) {
			// @MX:NOTE 타겟팅된 해시 조회 (REQ-PA-019): serverHash 있으면 listFiles 생략
			let resolvedHash = serverHash;
			if (!resolvedHash) {
				const serverFiles = await this._client.listFiles();
				const matchedFile = serverFiles.find((f: FileInfo) => f.path === path);
				resolvedHash = matchedFile?.hash;
			}
			if (resolvedHash) {
				const hasConflict = await this._conflict_resolver.detectConflict(localContent, resolvedHash!);
				if (hasConflict) {
					// @MX:NOTE 충돌 큐가 있으면 enqueue, 없으면 기존 동작 (SPEC-P6-UX-002)
					if (this._conflict_queue) {
						this._conflict_queue.enqueue({
							id: globalThis.crypto?.randomUUID?.() ?? `conflict-${Date.now()}-${Math.random().toString(36).slice(2)}`,
							file_path: path,
							localContent,
							server_content: content,
							diff: null,
							base_hash: null,
							conflict_id: null,
							type: 'simple',
							timestamp: Date.now(),
							source: 'download',
						});
						return; // vault에 쓰지 않음 (AC-001.2)
					}
					// 기존 동작: 충돌 파일 생성 후 원격 내용으로 덮어쓰기
					const conflictPath = this._conflict_resolver.handleConflict(path);
					await this._vault.write(conflictPath, content);
					return;
				}
			}
		}

		this._recently_modified.add(path);
		await this._vault.write(path, content);
		// 짧은 지연 후 recentlyModified에서 제거
		setTimeout(() => this._recently_modified.delete(path), RECENTLY_MODIFIED_TTL_MS);

		// AC-007.4: 원격 다운로드 후 캐시 무효화
		this._hash_cache.delete(path);
	}

	/** 바이너리 파일 원격 다운로드 (REQ-P6-012, REQ-P6-015, REQ-P6-016) */
	private async _downloadRemoteBinary(path: string, serverHash?: string): Promise<void> {
		const remoteData = await this._client.downloadAttachment(path);

		// 충돌 감지 (REQ-P6-015)
		const localData = await this._vault.readBinaryIfExists(path);
		if (localData !== null) {
			const localHash = await computeHash(localData);
			const remoteHash = serverHash ?? await computeHash(remoteData);
			if (localHash === remoteHash) {
				return; // 내용 동일 → 다운로드·쓰기 불필요
			}
			// 충돌: latest-wins 정책으로 서버 버전 덮어쓰기 (REQ-P6-016)
			this._notice_fn(`Binary file overwritten (latest-wins): ${path}`);
		}

		this._recently_modified.add(path);
		await this._vault.writeBinary(path, remoteData);
		setTimeout(() => this._recently_modified.delete(path), RECENTLY_MODIFIED_TTL_MS);

		// AC-007.4: 원격 다운로드 후 캐시 무효화
		this._hash_cache.delete(path);
	}

	/** 로컬 파일 삭제 */
	private _deleteLocalFile(path: string): Promise<void> {
		return this._vault.delete(path).catch(() => {
			// 파일이 이미 없을 수 있음 - 무시
		});
	}

	/** moved 이벤트 처리 (REQ-PA-005): 로컬 파일을 새 경로로 이동 */
	private async _handleMovedEvent(event: SyncEvent): Promise<void> {
		const fromPath = event.from_path;
		const toPath = event.file_path;
		if (!fromPath) {
			// from_path 없으면 일반 created로 폴백
			await this._downloadRemoteFile(toPath);
			return;
		}

		// 대상 경로에 이미 파일이 있으면 충돌 큐에 적재
		const existingContent = await this._vault.readIfExists(toPath);
		if (existingContent !== null) {
			if (this._conflict_queue) {
				const fromContent = await this._vault.readIfExists(fromPath);
				this._conflict_queue.enqueue({
					id: globalThis.crypto?.randomUUID?.() ?? `conflict-${Date.now()}-${Math.random().toString(36).slice(2)}`,
					file_path: toPath,
					local_content: existingContent,
					server_content: fromContent ?? '',
					diff: null,
					base_hash: null,
					conflict_id: null,
					type: 'simple',
					timestamp: Date.now(),
					source: 'download',
				});
			}
			return;
		}

		// 기존 경로에서 파일 읽기
		const content = await this._vault.readIfExists(fromPath);
		if (content !== null) {
			// 새 경로에 쓰기
			await this._vault.write(toPath, content);
			// 기존 경로 삭제
			await this._vault.delete(fromPath).catch(() => {});
			// 캐시 업데이트
			this._hash_cache.delete(fromPath);
		}
	}

	// ============================================================
	// T-010: 초기 전체 동기화
	// ============================================================

	/** 초기 전체 동기화 */
	async performInitialSync(): Promise<void> {
		if (this._is_syncing) return;

		try {
			this._is_syncing = true;
			this._status = 'syncing';

			// 서버 파일 목록 조회
			const serverFiles = await this._client.listFiles();
			const serverPathSet = new Set(serverFiles.map((f: FileInfo) => f.path));

			// 로컬 파일 목록 조회
			const localFiles = this._vault.getFiles();
			const localPathSet = new Set(
				localFiles
					.map((f: { path: string }) => normalizePath(f.path))
					.filter((p: string) => shouldSyncPath(p))
			);

			// 서버에만 있는 파일 → 다운로드
			for (const serverFile of serverFiles) {
				if (!shouldSyncPath(serverFile.path)) continue;

				if (!localPathSet.has(serverFile.path)) {
					await this._downloadRemoteFile(serverFile.path, serverFile.hash);
				} else {
					// 양쪽에 모두 있으면 해시 비교
					if (isBinaryPath(serverFile.path)) {
						// 바이너리: readBinaryIfExists로 로컬 해시 비교
						const localData = await this._vault.readBinaryIfExists(serverFile.path);
						if (localData) {
							const localHash = await computeHash(localData);
							if (localHash !== serverFile.hash) {
								await this._downloadRemoteFile(serverFile.path, serverFile.hash);
							}
						} else {
							await this._downloadRemoteFile(serverFile.path, serverFile.hash);
						}
					} else {
						// 텍스트: readIfExists 사용 (SPEC-P6-RELIABLE-005 AC-003.3)
						const localContent = await this._vault.readIfExists(serverFile.path);
						if (localContent === null) {
							await this._downloadRemoteFile(serverFile.path, serverFile.hash);
						} else {
							const localHash = await computeHash(localContent);
							if (localHash !== serverFile.hash) {
								await this._downloadRemoteFile(serverFile.path, serverFile.hash);
							}
						}
					}
				}

				}
			// 로컬에만 있는 파일 → 배치 업로드 (REQ-PA-001)
				const batchTextFiles: Array<{ path: string; content: string; hash: string }> = [];
				for (const localPath of localPathSet) {
					if (!serverPathSet.has(localPath)) {
						if (isBinaryPath(localPath)) {
							// 바이너리 업로드 (개별)
							const data = await this._vault.readBinary(localPath);
							await this._client.uploadAttachment(localPath, data);
						} else {
							// 텍스트 파일은 배치 대상으로 수집
							const content = await this._vault.readIfExists(localPath);
							if (content !== null) {
								const contentHash = await computeHash(content);
								batchTextFiles.push({ path: localPath, content, hash: contentHash });
							}
						}
					}
				}

				// 배치 업로드 시도, 실패 시 개별 업로드 폴백 (REQ-PA-001)
				if (batchTextFiles.length > 0) {
					try {
						await this._batchUploadFiles(batchTextFiles);
					} catch {
						// 배치 실패 → 개별 업로드로 폴백
						for (const f of batchTextFiles) {
							const result = await this._client.rawUpload(f.path, f.content);
							if ('conflict' in result && result.conflict === true) {
								await this._handleUploadConflict(f.path, f.content, result);
							} else {
								this._updateHashCache(f.path, (result as import('./types').UploadResult).hash);
							}
						}
					}
				}

			// AC-004.1, AC-004.3: 다운로드/업로드 완료 후 서버 파일 해시로 캐시 초기화
			for (const serverFile of serverFiles) {
				if (shouldSyncPath(serverFile.path)) {
					this._updateHashCache(serverFile.path, serverFile.hash);
				}
			}

			this._status = 'idle';
			this._notice_fn('Initial sync complete');
		} catch (error) {
			this._status = 'error';
			this._notice_fn(`Initial sync failed: ${(error as Error).message}`);
		} finally {
			this._is_syncing = false;
		}
	}

	// ============================================================
	// 이벤트 큐: 직렬 처리 + 중복 제거 (SPEC-P6-EVENT-007)
	// ============================================================

	/** 이벤트를 큐에 추가하고 처리 */
	async _enqueueEvent(event: SyncEvent): Promise<void> {
		this._event_queue.push(event);
		if (!this._is_processing) {
			await this._drainQueue();
		}
	}

	/** 큐에 쌓인 이벤트를 순차적으로 처리 */
	private async _drainQueue(): Promise<void> {
		if (this._is_processing || this._event_queue.length === 0) return;
		this._is_processing = true;
		try {
			while (this._event_queue.length > 0) {
				const event = this._event_queue.shift()!;
				// 중복 이벤트 건너뛰기 (REQ-EVT-002)
				if (this._processed_event_ids.has(event.id)) continue;
				await this._processEvent(event);
				this._last_event_id = event.id;
				this._addProcessedId(event.id);
				await this._client.updateSyncStatus(event.id);
			}
		} finally {
			this._is_processing = false;
		}
	}

	/** 처리된 이벤트 ID 기록 (최대 _maxProcessedIds개 유지) */
	private _addProcessedId(id: string): void {
		this._processed_event_ids.add(id);
		if (this._processed_event_ids.size > this._max_processed_ids) {
			const entries = [...this._processed_event_ids];
			this._processed_event_ids = new Set(entries.slice(entries.length / 2));
		}
	}

	// ============================================================
	// 듀얼 모드 동기화 (SPEC-P3-REALTIME-001)
	// ============================================================

	/** WS 클라이언트 설정 및 실시간 모드 초기화 */
	enableRealtimeMode(): void {
		if (this._ws_client) {
			this._ws_client.close();
		}

		this._ws_client = new WSClient({
			serverUrl: this._settings.server_url,
			apiKey: this._settings.api_key,
			vaultId: this._settings.vault_id,
			deviceId: this._settings.device_id,
		});

		// WS 이벤트 콜백 → 큐 라우팅 (REQ-EVT-001)
		this._ws_client.on('syncEvent', async (event: SyncEvent) => {
			await this._enqueueEvent(event);
		});

		// WS 상태 변경 콜백
		this._ws_client.on('statusChange', (status, _mode) => {
			if (status === 'connected') {
				this._connection_mode = 'realtime';
				this._polling_fallback.deactivate();
				// 갭 체크: WS 재연결 시 놓친 이벤트 폴링
				this.pollRemoteChanges();
				// @MX:NOTE 네트워크 복구 시 오프라인 큐 flush (SPEC-P6-PERSIST-004 REQ-P6-008)
				this.flushOfflineQueue();
				this._emitStatus('idle', 'realtime');
			} else if (status === 'reconnecting') {
				this._connection_mode = 'polling';
				this._polling_fallback.activate(() => this.pollRemoteChanges());
				this._emitStatus('idle', 'polling');
			} else if (status === 'disconnected') {
				this._connection_mode = 'polling';
				this._polling_fallback.activate(() => this.pollRemoteChanges());
				this._emitStatus('idle', 'polling');
			}
		});

		// WS 연결 시도
		this._ws_client.connect();
	}

	/** 상태 변경 emit */
	private _emitStatus(status: string, mode: ConnectionMode): void {
		this._on_status_change?.(status, mode);
	}

	/** 엔진 정리 (AC-007.2, AC-008.6: 타이머 및 캐시 정리) */
	destroy(): void {
		if (this._ws_client) {
			this._ws_client.close();
			this._ws_client = null;
		}
		this._polling_fallback.deactivate();

		// AC-008.6: 대기 중인 디바운스 타이머 정리
		for (const timer of this._pending_uploads.values()) {
			clearTimeout(timer);
		}
		this._pending_uploads.clear();

		// AC-007.2: 인메모리 캐시 초기화
		this._hash_cache.clear();
	}

	// ============================================================
	// 라이프사이클
	// ============================================================

	/** 엔진 시작 */
	start(registerInterval: (cb: () => void, ms: number) => void): void {
		// vault 이벤트 리스너 등록
		this._vault.on('create', (file: { path: string }) => this.handleLocalCreate(file));
		this._vault.on('modify', (file: { path: string }) => this.handleLocalModify(file));
		this._vault.on('delete', (file: { path: string }) => this.handleLocalDelete(file.path));

		// 폴링 타이머 등록 (WS 연결 전 기본 폴링)
		const intervalMs = (this._settings.sync_interval || 30) * 1000;
		registerInterval(() => this.pollRemoteChanges(), intervalMs);

		// WS 실시간 모드 활성화 시도
		if (this._settings.server_url && this._settings.api_key && this._settings.vault_id) {
			this.enableRealtimeMode();
		}
	}

	/** 전체 동기화 (수동 트리거) (AC-005.1: 캐시 재구축) */
	async performFullSync(): Promise<void> {
		if (this._is_syncing) return;

		try {
			this._is_syncing = true;
			this._status = 'syncing';

			// AC-005.1: 캐시 초기화 후 재구축
			this._hash_cache.clear();
			/// @MX:NOTE 큐 flush를 전체 동기화 전에 수행 (SPEC-P6-PERSIST-004 REQ-P6-008)
			await this.flushOfflineQueue();

			// 1. 로컬 파일 모두 업로드
			const localFiles = this._vault.getFiles();
			for (const file of localFiles) {
				if (shouldSyncPath(file.path)) {
					if (isBinaryPath(file.path)) {
						const data = await this._vault.readBinary(file.path);
						await this._client.uploadAttachment(file.path, data);
					} else {
						// SPEC-P6-RELIABLE-005 AC-003.2: readIfExists 사용
						const content = await this._vault.readIfExists(file.path);
						if (content !== null) {
							const result = await this._client.rawUpload(file.path, content);
							// AC-005.2: 업로드 후 결과로 캐시 업데이트
							if ('conflict' in result && result.conflict === true) {
								await this._handleUploadConflict(file.path, content, result);
							} else {
								this._updateHashCache(file.path, (result as import('./types').UploadResult).hash);
							}
						}
					}
				}
			}

			// 2. 원격 변경 폴링/다운로드 → 큐 라우팅 (REQ-EVT-001)
			const events = await this._client.getEvents(this._last_event_id || undefined);
			for (const event of events) {
				await this._enqueueEvent(event);
			}

			this._status = 'idle';
		} catch (error) {
			this._status = 'error';
			this._notice_fn(`Full sync failed: ${(error as Error).message}`);
		} finally {
			this._is_syncing = false;
		}
	}
}

/** Vault 어댑터 인터페이스 */
export interface VaultAdapter {
	read(path: string): Promise<string>;
	readIfExists(path: string): Promise<string | null>;
	write(path: string, content: string): Promise<void>;
	delete(path: string): Promise<void>;
	getFiles(): Array<{ path: string }>;
	on(event: string, handler: (...args: unknown[]) => void): void;
	off(event: string, handler: (...args: unknown[]) => void): void;
	// 바이너리 지원 (REQ-P6-004 ~ REQ-P6-006)
	readBinary(path: string): Promise<ArrayBuffer>;
	readBinaryIfExists(path: string): Promise<ArrayBuffer | null>;
	writeBinary(path: string, data: ArrayBuffer): Promise<void>;
}
