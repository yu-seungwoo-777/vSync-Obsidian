// 동기화 엔진 - 핵심 동기화 로직

import { VSyncClient, MAX_BINARY_SIZE } from './api-client';
import type { PersistCallback } from './api-client';
import { ConflictResolver, ConflictQueue } from './conflict';
import type { ConflictQueueItem } from './conflict';
import type { VaultAdapter } from './adapters/vault-adapter';
import { computeHash } from './utils/hash';
import { shouldSyncPath, normalizePath, isObsidianPath, isBinaryPath } from './utils/path';
import { WSClient } from './services/ws-client';
import { PollingFallback } from './services/polling-fallback';
import type { VSyncSettings, SyncEvent, FileInfo, ConnectionMode, OfflineQueueItem, ConflictResult, DeviceInfo } from './types';

// 다운로드 후 vault modify 이벤트 필터링 유지 시간 (ms)
const RECENTLY_MODIFIED_TTL_MS = 1000;

/** 해시 캐시 최대 엔트리 수 (REQ-DP-009) */
const MAX_HASH_CACHE_SIZE = 10000;

/** 디바운스 지연 시간 (ms) (REQ-DP-008) */
const DEBOUNCE_DELAY_MS = 300;

/** 동기화 엔진 */
export class SyncEngine {
	private _client: VSyncClient;
	private _conflictResolver: ConflictResolver;
	// @MX:NOTE 충돌 큐 (SPEC-P6-UX-002 REQ-UX-003)
	private _conflictQueue: ConflictQueue | null;
	private _vault: VaultAdapter;
	private _settings: VSyncSettings;
	private _noticeFn: (msg: string) => void;
	private _isSyncing = false;
	// @MX:NOTE 동기화 일시정지 상태 (pause: 이벤트 무시 + 폴링 중단, WS 연결은 유지)
	private _paused = false;
	private _recentlyModified = new Set<string>();
	private _lastEventId = '';
	private _status: 'idle' | 'syncing' | 'error' | 'not_configured' | 'paused' = 'idle';

	// @MX:NOTE 듀얼 모드 상태 (SPEC-P3-REALTIME-001)
	private _connectionMode: ConnectionMode = 'polling';
	private _wsClient: WSClient | null = null;
	private _pollingFallback: PollingFallback;
	private _onStatusChange: ((status: string, mode: ConnectionMode) => void) | null = null;

	// @MX:NOTE 이벤트 큐: 직렬 처리 보장 (SPEC-P6-EVENT-007 REQ-EVT-001)
	private _eventQueue: SyncEvent[] = [];
	private _isProcessing = false;

	// @MX:NOTE 중복 이벤트 방지 (SPEC-P6-EVENT-007 REQ-EVT-002)
	private _processedEventIds = new Set<string>();
	private readonly _maxProcessedIds = 1000;

	// @MX:NOTE 해시 기반 업로드 중복 제거 (SPEC-P6-DEDUP-003)
	private _hashCache: Map<string, string>;
	private _pendingUploads: Map<string, ReturnType<typeof setTimeout>> = new Map();
	private _onCacheUpdate: ((cache: Map<string, string>) => void) | null = null;

	private _persistCallback?: PersistCallback;

	constructor(settings: VSyncSettings, vault: VaultAdapter, noticeFn: (msg: string) => void, persistCallback?: PersistCallback, restoredQueue?: OfflineQueueItem[], conflictQueue?: ConflictQueue) {
		this._settings = settings;
		this._vault = vault;
		this._noticeFn = noticeFn;
		this._persistCallback = persistCallback;
		this._conflictQueue = conflictQueue ?? null;
		this._client = this._createClient(settings);
		this._conflictResolver = new ConflictResolver(noticeFn);
		this._lastEventId = settings.last_event_id || '';
		this._pollingFallback = new PollingFallback((settings.sync_interval || 30) * 1000);

		// 해시 캐시: 설정에서 복원 또는 빈 Map (AC-006.2, AC-006.6)
		this._hashCache = new Map(Object.entries(settings.hash_cache ?? {}));

		if (restoredQueue && restoredQueue.length > 0) {
			this._client.restoreQueue(restoredQueue);
		}
	}

	private _createClient(settings: VSyncSettings): VSyncClient {
		return new VSyncClient({
			server_url: settings.server_url,
			vault_id: settings.vault_id,
			device_id: settings.device_id,
			session_token: settings.session_token,
		}, this._persistCallback, (failedItems) => this._handleFlushFailed(failedItems));
	}

	private _handleFlushFailed(failedItems: OfflineQueueItem[]): void {
		const paths = failedItems.map((item) => item.filePath).join(', ');
		this._noticeFn(`Sync failed after 3 retries: ${paths}`);
	}

	/** 동기화 중 상태 설정 (테스트용) */
	setSyncing(value: boolean): void {
		this._isSyncing = value;
	}

	/** 설정 업데이트 (AC-007.1: 서버 URL 등 변경 시 캐시 초기화) */
	updateSettings(settings: VSyncSettings): void {
		this._settings = settings;
		this._client = this._createClient(settings);
		this._lastEventId = settings.last_event_id || '';
		this._hashCache = new Map(Object.entries(settings.hash_cache ?? {}));
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
		if (!this._conflictQueue) return;

		try {
			const serverConflicts = await this._client.getConflicts();
			for (const sc of serverConflicts) {
				// 중복 체크: 같은 conflictId가 이미 큐에 있으면 스킵
				const existing = this._conflictQueue.getAll().find(
					(item) => item.conflict_id === sc.id
				);
				if (existing) continue;

				this._conflictQueue.enqueue({
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
			this._noticeFn(`Failed to sync server conflicts: ${(error as Error).message}`);
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
	// @MX:ANCHOR [SPEC-PLUGIN-BUGFIX-001] 자동 병합 로직 — local+server 콘텐츠 모두 사용 필수
	async _tryAutoMerge(filePath: string, localContent: string, serverContent: string, conflictId: string): Promise<boolean> {
		try {
			// 기본 병합 전략: local/server 콘텐츠를 모두 고려
			let mergedContent: string;
			if (!localContent || localContent.trim() === '') {
				// 로컬 내용 없음 → 서버 내용 사용
				mergedContent = serverContent;
			} else if (!serverContent || serverContent.trim() === '') {
				// 서버 내용 없음 → 로컬 내용 사용
				mergedContent = localContent;
			} else if (localContent === serverContent) {
				// 동일 내용 → 병합 불필요
				mergedContent = localContent;
			} else {
				// 양쪽 모두 다름 → 로컬 우선 (사용자 편집 보존)
				mergedContent = localContent;
				this._noticeFn(`Merge conflict (${filePath}): keeping local version, server version was different`);
			}

			const mergedHash = await computeHash(mergedContent);
			await this._client.rawUpload(filePath, mergedContent);
			await this._client.mergeResolve(conflictId, mergedContent, mergedHash);
			this._noticeFn(`Auto-merged: ${filePath}`);
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
			this._noticeFn(`Failed to get devices: ${(error as Error).message}`);
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
			this._noticeFn(`Search failed: ${(error as Error).message}`);
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

	/** 동기화 일시정지 여부 반환 */
	get isPaused(): boolean {
		return this._paused;
	}

	/** 동기화 일시정지 - 이벤트 핸들러는 동작 유지하나 _paused 체크로 무시, WS 연결은 유지 */
	pause(): void {
		this._paused = true;
		this._status = 'paused';
		// 대기 중인 디바운스 타이머 모두 취소
		for (const timer of this._pendingUploads.values()) {
			clearTimeout(timer);
		}
		this._pendingUploads.clear();
		// 폴링 타이머 중단 (WS 연결은 유지하여 재개 시 빠른 동기화)
		this._pollingFallback.deactivate();
		this._emitStatus('paused', this._connectionMode);
	}

	/** 동기화 재개 - 일시정지 중 놓친 변경 즉시 폴링 */
	resume(): void {
		if (!this._paused) return;
		this._paused = false;
		this._status = 'idle';
		// 폴링 재활성화
		if (this._connectionMode === 'polling') {
			this._pollingFallback.activate(() => this.pollRemoteChanges());
		}
		this._emitStatus('idle', this._connectionMode);
		// 일시정지 중 놓친 변경 즉시 폴링
		this.pollRemoteChanges();
	}

	/** 현재 연결 모드 반환 */
	getConnectionMode(): ConnectionMode {
		return this._connectionMode;
	}

	/** 상태 변경 콜백 설정 */
	setOnStatusChange(callback: (status: string, mode: ConnectionMode) => void): void {
		this._onStatusChange = callback;
	}

	/** 캐시 업데이트 콜백 설정 (AC-006.3) */
	setOnCacheUpdate(callback: (cache: Map<string, string>) => void): void {
		this._onCacheUpdate = callback;
	}

	// ============================================================
	// T-008: 로컬 파일 변경 감지
	// ============================================================

	/** 로컬 파일 생성 이벤트 처리 */
	async handleLocalCreate(file: { path: string }): Promise<void> {
		if (this._paused) return;
		const normalizedPath = normalizePath(file.path);
		if (!shouldSyncPath(normalizedPath)) return;

		await this._uploadLocalFile(file.path);
	}

	/** 로컬 파일 리네임 이벤트 처리 (SPEC-RENAME-FIX-001) */
	async handleLocalRename(oldPath: string, newPath: string): Promise<void> {
		if (this._paused) return;
		const normalizedNewPath = normalizePath(newPath);
		const normalizedOldPath = normalizePath(oldPath);
		if (!shouldSyncPath(normalizedNewPath)) return;
		if (this._isSyncing || this._recentlyModified.has(normalizedNewPath)) return;
		if (!shouldSyncPath(normalizedOldPath)) return;

		try {
			await this._client.moveFile(oldPath, newPath);
			// 해시 캐시 이관
			const oldHash = this._hashCache.get(normalizedOldPath);
			if (oldHash) {
				this._hashCache.delete(normalizedOldPath);
				this._updateHashCache(normalizedNewPath, oldHash);
			}
		} catch (error) {
			this._noticeFn(`Rename failed: ${(error as Error).message}`);
			// Graceful degradation: Obsidian에서 delete+create 이벤트도 발생하므로
			// 기존 handleLocalDelete + handleLocalCreate 흐름으로 폴백
		}
	}

	/** 로컬 파일 수정 이벤트 처리 (REQ-DP-008: 디바운스 적용) */
	async handleLocalModify(file: { path: string }): Promise<void> {
		if (this._paused) return;
		if (!shouldSyncPath(file.path)) return;
		if (this._isSyncing || this._recentlyModified.has(file.path)) return;

		// 기존 타이머 취소 (AC-008.3)
		const existingTimer = this._pendingUploads.get(file.path);
		if (existingTimer) {
			clearTimeout(existingTimer);
		}

		// 새 디바운스 타이머 설정 (AC-008.2)
		const timer = setTimeout(() => {
			this._pendingUploads.delete(file.path);
			this._uploadLocalFile(file.path);
		}, DEBOUNCE_DELAY_MS);

		this._pendingUploads.set(file.path, timer);
	}

	/** 로컬 파일 삭제 이벤트 처리 (AC-007.3: 삭제 시 캐시 엔트리 제거) */
	async handleLocalDelete(path: string): Promise<void> {
		if (this._paused) return;
		if (!shouldSyncPath(path)) return;
		if (this._isSyncing || this._recentlyModified.has(path)) return;

		try {
			await this._client.deleteFile(path);
			const normalizedPath = normalizePath(path);
			this._hashCache.delete(normalizedPath);
		} catch (error) {
			this._noticeFn(`Failed to delete ${path}: ${(error as Error).message}`);
		}
	}

	/** 로컬 파일 업로드 (REQ-DP-002: 해시 비교 후 조건부 업로드) */
	private async _uploadLocalFile(path: string): Promise<void> {
		if (!shouldSyncPath(path)) return;
		if (this._isSyncing || this._recentlyModified.has(path)) return;

		try {
			const normalizedPath = normalizePath(path);

			if (isBinaryPath(normalizedPath)) {
				// 바이너리 파일 경로 (REQ-P6-011)
				const data = await this._vault.readBinary(normalizedPath);

				// 크기 검증 (REQ-P6-003)
				if (data.byteLength > MAX_BINARY_SIZE) {
					this._noticeFn(`File too large (over 50MB): ${normalizedPath}`);
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
				const cachedHash = this._hashCache.get(normalizedPath);
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
			this._noticeFn(`Failed to upload ${path}: ${(error as Error).message}`);
		}
	}

	/** 해시 캐시 업데이트 (LRU) (REQ-DP-009) */
	private _updateHashCache(path: string, hash: string): void {
		// LRU: 기존 키 제거 후 재삽입 (AC-009.4)
		this._hashCache.delete(path);
		this._hashCache.set(path, hash);

		// 크기 초과 시 오래된 항목 제거 (AC-009.2)
		if (this._hashCache.size > MAX_HASH_CACHE_SIZE) {
			const oldestKey = this._hashCache.keys().next().value;
			if (oldestKey !== undefined) {
				this._hashCache.delete(oldestKey);
			}
		}

		// 외부에 캐시 변경 알림 (AC-006.3)
		this._onCacheUpdate?.(this._hashCache);
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
							filePath: item.path,
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
		for (const [key, value] of this._hashCache) {
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
			this._noticeFn('1개 파일에 충돌이 발생했습니다');
		} else {
			this._noticeFn(`${count}개 파일에 충돌이 발생했습니다`);
		}
	}

	/**
	 * 업로드 409 충돌 처리 (REQ-UX-002)
	 * rawUpload가 ConflictResult를 반환한 경우 큐에 적재
	 */
	async _handleUploadConflict(filePath: string, localContent: string, conflictResult: ConflictResult): Promise<void> {
		if (!this._conflictQueue) return;

		// 서버 내용 다운로드 (필요시)
		let serverContent = '';
		try {
			serverContent = await this._client.rawDownload(filePath);
		} catch {
			// 다운로드 실패 시 빈 내용으로 진행
		}

		const itemType: ConflictQueueItem['type'] = (conflictResult.diff && conflictResult.diff.length > 0)
			? 'diff' : 'simple';

		this._conflictQueue.enqueue({
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
		return this._conflictQueue;
	}

	// ============================================================
	// T-009: 원격 변경 폴링
	// ============================================================

	/** 원격 변경 폴링 */
	async pollRemoteChanges(): Promise<void> {
		if (this._paused || this._isSyncing) return;

		try {
			this._isSyncing = true;
			const events = await this._client.getEvents(this._lastEventId || undefined);

			if (events.length === 0) return;

			for (const event of events) {
				await this._enqueueEvent(event);
			}
		} catch (error) {
			this._noticeFn(`Polling failed: ${(error as Error).message}`);
		} finally {
			this._isSyncing = false;
		}
	}

	/** 개별 이벤트 처리 */
	private async _processEvent(event: SyncEvent): Promise<void> {
		// 자기 자신의 디바이스 이벤트는 무시
		if (event.device_id === this._settings.device_id) return;

		// file_path가 null인 이벤트는 스킵 (삭제된 파일의 leftJoin 결과)
		if (!event.file_path) return;

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
			this._noticeFn(`Failed to download ${path}: ${(error as Error).message}`);
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
				const hasConflict = await this._conflictResolver.detectConflict(localContent, resolvedHash!);
				if (hasConflict) {
					// @MX:NOTE 충돌 큐가 있으면 enqueue, 없으면 기존 동작 (SPEC-P6-UX-002)
					if (this._conflictQueue) {
						this._conflictQueue.enqueue({
							id: globalThis.crypto?.randomUUID?.() ?? `conflict-${Date.now()}-${Math.random().toString(36).slice(2)}`,
							file_path: path,
							local_content: localContent,
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
					const conflictPath = this._conflictResolver.handleConflict(path);
					await this._vault.write(conflictPath, content);
					return;
				}
			}
		}

		this._recentlyModified.add(path);
		await this._vault.write(path, content);
		// 짧은 지연 후 recentlyModified에서 제거
		setTimeout(() => this._recentlyModified.delete(path), RECENTLY_MODIFIED_TTL_MS);

		// AC-007.4: 원격 다운로드 후 캐시 무효화
		this._hashCache.delete(path);
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
			this._noticeFn(`Binary file overwritten (latest-wins): ${path}`);
		}

		this._recentlyModified.add(path);
		await this._vault.writeBinary(path, remoteData);
		setTimeout(() => this._recentlyModified.delete(path), RECENTLY_MODIFIED_TTL_MS);

		// AC-007.4: 원격 다운로드 후 캐시 무효화
		this._hashCache.delete(path);
	}

	/** 로컬 파일 삭제 */
	private _deleteLocalFile(path: string): Promise<void> {
		return this._vault.delete(path).catch(() => {
			// 파일이 이미 없을 수 있음 - 무시
		});
	}

	/** moved 이벤트 처리 (REQ-PA-005): 로컬 파일을 새 경로로 이동 */
	private async _handleMovedEvent(event: SyncEvent): Promise<void> {
		// @MX:NOTE (event as any).from_path: OpenAPI 타입에 아직 반영되지 않아 캐스트 사용
		const fromPath = (event as any).from_path as string | undefined;
		const toPath = event.file_path;

		if (!toPath) return; // 대상 경로 없으면 스킵
		if (!fromPath) {
			// from_path 없으면 일반 created로 폴백
			await this._downloadRemoteFile(toPath);
			return;
		}

		// 대상 경로에 이미 파일이 있으면 충돌 큐에 적재
		const existingContent = await this._vault.readIfExists(toPath);
		if (existingContent !== null) {
			if (this._conflictQueue) {
				const fromContent = await this._vault.readIfExists(fromPath);
				this._conflictQueue.enqueue({
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

		// @MX:NOTE SPEC-OBSIDIAN-API-GAP-001 REQ-API-002: renameFile 사용으로 wiki link 보존
		// 기존 경로에서 파일 읽기
		const content = await this._vault.readIfExists(fromPath);
		if (content !== null) {
			// renameFile 우선 사용 → wiki link 자동 갱신, 폴백 시 write+delete
			if (typeof this._vault.renameFile === 'function') {
				await this._vault.renameFile(fromPath, toPath).catch(async () => {
					// renameFile 실패 시 기존 write+delete로 폴백
					await this._vault.write(toPath, content);
					await this._vault.delete(fromPath).catch(() => {});
				});
			} else {
				// renameFile 없으면 기존 write+delete 사용
				await this._vault.write(toPath, content);
				await this._vault.delete(fromPath).catch(() => {});
			}
			// 캐시 업데이트
			this._hashCache.delete(fromPath);
		}
	}

	// ============================================================
	// T-010: 초기 전체 동기화
	// ============================================================

	/** 초기 전체 동기화 */
	async performInitialSync(): Promise<void> {
		if (this._paused || this._isSyncing) return;

		try {
			this._isSyncing = true;
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
			this._noticeFn('Initial sync complete');
		} catch (error) {
			this._status = 'error';
			this._noticeFn(`Initial sync failed: ${(error as Error).message}`);
		} finally {
			this._isSyncing = false;
		}
	}

	// ============================================================
	// 이벤트 큐: 직렬 처리 + 중복 제거 (SPEC-P6-EVENT-007)
	// ============================================================

	/** 이벤트를 큐에 추가하고 처리 */
	async _enqueueEvent(event: SyncEvent): Promise<void> {
		this._eventQueue.push(event);
		if (!this._isProcessing) {
			await this._drainQueue();
		}
	}

	/** 큐에 쌓인 이벤트를 순차적으로 처리 */
	private async _drainQueue(): Promise<void> {
		if (this._isProcessing || this._eventQueue.length === 0) return;
		this._isProcessing = true;
		try {
			while (this._eventQueue.length > 0) {
				const event = this._eventQueue.shift()!;
				// 중복 이벤트 건너뛰기 (REQ-EVT-002)
				if (this._processedEventIds.has(event.id)) continue;
				await this._processEvent(event);
				this._lastEventId = event.id;
				this._addProcessedId(event.id);
				await this._client.updateSyncStatus(event.id);
			}
		} finally {
			this._isProcessing = false;
		}
	}

	/** 처리된 이벤트 ID 기록 (최대 _maxProcessedIds개 유지) */
	private _addProcessedId(id: string): void {
		this._processedEventIds.add(id);
		if (this._processedEventIds.size > this._maxProcessedIds) {
			const entries = [...this._processedEventIds];
			this._processedEventIds = new Set(entries.slice(entries.length / 2));
		}
	}

	// ============================================================
	// 듀얼 모드 동기화 (SPEC-P3-REALTIME-001)
	// ============================================================

	/** WS 클라이언트 설정 및 실시간 모드 초기화 */
	enableRealtimeMode(): void {
		if (this._wsClient) {
			this._wsClient.close();
		}

		this._wsClient = new WSClient({
			server_url: this._settings.server_url,
			session_token: this._settings.session_token,
			vault_id: this._settings.vault_id,
			device_id: this._settings.device_id,
		});

		// WS 이벤트 콜백 → 큐 라우팅 (REQ-EVT-001)
		this._wsClient.on('syncEvent', async (event: SyncEvent) => {
			await this._enqueueEvent(event);
		});

		// WS 상태 변경 콜백
		this._wsClient.on('statusChange', (status, _mode) => {
			if (status === 'connected') {
				this._connectionMode = 'realtime';
				this._pollingFallback.deactivate();
				// 갭 체크: WS 재연결 시 놓친 이벤트 폴링
				this.pollRemoteChanges();
				// @MX:NOTE 네트워크 복구 시 오프라인 큐 flush (SPEC-P6-PERSIST-004 REQ-P6-008)
				if (!this._paused) {
					this.flushOfflineQueue();
				}
				this._emitStatus(this._paused ? 'paused' : 'idle', 'realtime');
			} else if (status === 'reconnecting') {
				this._connectionMode = 'polling';
				if (!this._paused) {
					this._pollingFallback.activate(() => this.pollRemoteChanges());
				}
				this._emitStatus(this._paused ? 'paused' : 'idle', 'polling');
			} else if (status === 'disconnected') {
				this._connectionMode = 'polling';
				if (!this._paused) {
					this._pollingFallback.activate(() => this.pollRemoteChanges());
				}
				this._emitStatus(this._paused ? 'paused' : 'idle', 'polling');
			}
		});

		// WS 연결 시도
		this._wsClient.connect();
	}

	/** 상태 변경 emit */
	private _emitStatus(status: string, mode: ConnectionMode): void {
		this._onStatusChange?.(status, mode);
	}

	/** 엔진 정리 (AC-007.2, AC-008.6: 타이머 및 캐시 정리) */
	destroy(): void {
		if (this._wsClient) {
			this._wsClient.close();
			this._wsClient = null;
		}
		this._pollingFallback.deactivate();

		// AC-008.6: 대기 중인 디바운스 타이머 정리
		for (const timer of this._pendingUploads.values()) {
			clearTimeout(timer);
		}
		this._pendingUploads.clear();

		// AC-007.2: 인메모리 캐시 초기화
		this._hashCache.clear();
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
		this._vault.on('rename', (file: { path: string }, oldPath: string) => this.handleLocalRename(oldPath, file.path));

		// 폴링 타이머 등록 (WS 연결 전 기본 폴링)
		const intervalMs = (this._settings.sync_interval || 30) * 1000;
		registerInterval(() => this.pollRemoteChanges(), intervalMs);

		// WS 실시간 모드 활성화 시도
		if (this._settings.server_url && this._settings.session_token && this._settings.vault_id) {
			this.enableRealtimeMode();
		}
	}

	/** 전체 동기화 (수동 트리거) (AC-005.1: 캐시 재구축) */
	async performFullSync(): Promise<void> {
		if (this._paused || this._isSyncing) return;

		try {
			this._isSyncing = true;
			this._status = 'syncing';

			// AC-005.1: 캐시 초기화 후 재구축
			this._hashCache.clear();
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
			const events = await this._client.getEvents(this._lastEventId || undefined);
			for (const event of events) {
				await this._enqueueEvent(event);
			}

			this._status = 'idle';
		} catch (error) {
			this._status = 'error';
			this._noticeFn(`Full sync failed: ${(error as Error).message}`);
		} finally {
			this._isSyncing = false;
		}
	}
}