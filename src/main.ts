// vSync 플러그인 진입점

import { Plugin, Notice } from 'obsidian';
import { SyncEngine } from './sync-engine';
import { VSyncSettingTab } from './settings';
import { DEFAULT_SETTINGS } from './types';
import type { VSyncSettings, OfflineQueueItem } from './types';
import type { ConnectionMode } from './types';
import type { VaultAdapter } from './adapters/vault-adapter';
import type { WorkspaceAdapter } from './adapters/workspace-adapter';
import { ConflictQueue, ConflictResolver } from './conflict';
import type { ConflictQueueItem } from './conflict';
import { ConflictQueueView } from './ui/conflict-queue-view';
import { SyncLogView } from './ui/sync-log-view';
import { SearchInputModal, SearchModal } from './ui/search-modal';
import { FileNotFoundError, VaultReadError, VaultWriteError } from './errors';
import { validateVaultPath } from './utils/path';
import { showDownloadModal } from './ui/initial-sync-download-modal';
import { showUploadModal } from './ui/initial-sync-upload-modal';
import { showConflictModal } from './ui/initial-sync-conflict-modal';
import { syncLogger } from './sync-logger';
import { checkPluginUpdate } from './api-client';
import { UpdateModal } from './ui/update-modal';

export default class VSyncPlugin extends Plugin {
	settings: VSyncSettings = { ...DEFAULT_SETTINGS };
	private _syncEngine: SyncEngine | null = null;
	private _workspaceAdapter: WorkspaceAdapter | null = null;
	private _statusBarItem: { setText: (text: string) => void; setAttr: (attr: string, value: string) => void; _lastText?: string; hide?: () => void; show?: () => void } | null = null;

	// @MX:NOTE 충돌 큐 (SPEC-P6-UX-002 REQ-UX-003)
	conflictQueue: ConflictQueue;

	async onload() {
		// 설정 로드
		const savedData = await this.loadData();
		if (savedData) {
			this.settings = { ...DEFAULT_SETTINGS, ...savedData as Partial<VSyncSettings> };
		}

		// deviceId가 없으면 자동 생성
		if (!this.settings.device_id) {
			this.settings.device_id = globalThis.crypto.randomUUID();
			await this.saveSettings();
		}

		// 상태 표시줄 생성
		this._statusBarItem = this.addStatusBarItem() as unknown as typeof this._statusBarItem;
		this._statusBarItem?.setText('vSync: loading...');

		// 상태 표시줄 클릭 시 동기화 토글
		this.registerDomEvent(this._statusBarItem as unknown as HTMLElement, 'click', () => {
			if (!this._isConfigured()) {
				return;
			}
			this._toggleSync();
		});
		// Vault 어댑터 생성
		const vaultAdapter = this._createVaultAdapter();

		// @MX:NOTE SPEC-WORKSPACE-ADAPTER-001: Workspace 어댑터 생성 (REQ-WA-001)
		this._workspaceAdapter = this._createWorkspaceAdapter();

		// @MX:NOTE 오프라인 큐 복원 (SPEC-P6-PERSIST-004 REQ-P6-002)
		const rawQueue = this._parseQueueData(savedData);
		const restoredQueue = this._cleanStaleEntries(rawQueue);

		// @MX:NOTE 충돌 큐 생성 (SPEC-P6-UX-002 REQ-UX-003)
		this.conflictQueue = new ConflictQueue();

		// 동기화 엔진 생성 (persistCallback + conflictQueue 전달)
		this._syncEngine = new SyncEngine(
			this.settings,
			vaultAdapter,
			(msg: string) => {
				syncLogger.info(msg);
				this._copyableNotice(msg);
			},
			(items: OfflineQueueItem[]) => this._persistQueue(items),
			restoredQueue,
			this.conflictQueue,
		);

		// @MX:NOTE 연결 모드 상태 변경 콜백 설정 (SPEC-P3-REALTIME-001)
		this._syncEngine.setOnStatusChange((status: string, mode: ConnectionMode) => {
			if (status === 'idle' && mode === 'realtime') {
				this.updateStatus('idle');
			} else if (status === 'idle' && mode === 'polling') {
				this.updateStatus('polling');
			}
		});

		// @MX:NOTE 해시 캐시 업데이트 콜백 (SPEC-P6-DEDUP-003, AC-006.4)
		this._syncEngine.setOnCacheUpdate((cache: Map<string, string>) => {
			const entries: Record<string, string> = {};
			let count = 0;
			for (const [key, value] of cache) {
				if (count >= 10000) break;
				entries[key] = value;
				count++;
			}
			this.settings.hash_cache = entries;
			this.saveData(this.settings);
		});

		// @MX:NOTE 충돌 큐 업데이트 콜백 (SPEC-P6-UX-002 REQ-UX-005)
		this.conflictQueue.onUpdate(() => this.updateConflictBadge());

		// @MX:NOTE 충돌 해결 뷰 등록 (SPEC-P6-UX-002 REQ-UX-006)
		this.registerView(ConflictQueueView.VIEW_TYPE, (leaf) => {
			const view = new ConflictQueueView(leaf, this.conflictQueue);
			view.setOnResolveItem((item) => this._openResolveModal(item));
			view.setOnBulkResolve((items) => this._bulkResolveRemote(items));
			// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Obsidian registerView 콜백 반환 타입 제약
				return view as any;
		});

		// 동기화 로그 뷰 등록
		this.registerView(SyncLogView.VIEW_TYPE, (leaf) => {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Obsidian registerView 콜백 반환 타입 제약
				return new SyncLogView(leaf) as any;
		});

		// 리본 아이콘으로 로그 뷰 열기
		this.addRibbonIcon('scroll', 'Open sync log', () => {
			this._activateLogView();
		});

		// @MX:NOTE SPEC-OBSIDIAN-API-GAP-001 REQ-API-001: onLayoutReady 래핑
		// vault 로드 중 기존 파일의 create 이벤트가 트리거되는 것을 방지
		if (this._isConfigured()) {
			this._workspaceAdapter!.onLayoutReady(() => {
				// 동기화 활성화 여부 확인 (sync_enabled이면 동기화 시작, 아니면 paused 상태)
				if (this.settings.sync_enabled) {
					this._startSync();

					// @MX:NOTE 큐에 복원된 항목이 있으면 flush 시도 (SPEC-P6-PERSIST-004 REQ-P6-002)
					if (restoredQueue.length > 0) {
						this._syncEngine?.flushOfflineQueue();
					}
				} else {
					this.updateStatus('paused');
				}
			});
		} else {
			this.updateStatus('not_configured');
		}

		// 명령 등록
		this._registerCommands();

			// @MX:NOTE 서버 연결 시 자동 업데이트 체크
			if (this._isConfigured()) {
				this._workspaceAdapter!.onLayoutReady(() => {
					this._checkForUpdates();
				});
			}


		// 설정 탭 등록 + 디바이스 API 주입 (REQ-PA-011, REQ-PA-012)
		const settingTab = new VSyncSettingTab(this.app, this);
		settingTab.setConnectHandler((s) => this.connectAndSync(s));
		settingTab.setDisconnectHandler(() => this.disconnect());
		this.addSettingTab(settingTab);
	}

	/** 클릭하면 메시지가 복사되는 커스텀 토스트 */
	private _copyableNotice(message: string): void {
		new Notice(message, 5000);
	}

	/** 동기화 로그 뷰 열기 */
	private async _activateLogView(): Promise<void> {
		// @MX:NOTE SPEC-WORKSPACE-ADAPTER-001 REQ-WA-003, REQ-WA-004: 어댑터로 호출
		const leaves = this._workspaceAdapter!.getLeavesOfType(SyncLogView.VIEW_TYPE);
		if (leaves.length > 0) {
			(leaves[0] as any).setEphemeralState?.({ focus: true }); // eslint-disable-line @typescript-eslint/no-explicit-any -- Obsidian WorkspaceLeaf.setEphemeralState 미노출
		} else {
			await this._workspaceAdapter!.openViewInRightLeaf(SyncLogView.VIEW_TYPE);
		}
	}

	onunload() {
		// @MX:NOTE 플러그인 언로드 시 WS 연결 종료, 타이머 정리
		if (this._syncEngine) {
			this._syncEngine.destroy();
			this._syncEngine = null;
		}
	}

	/** 설정 저장 */
	async saveSettings() {
		await this.saveData(this.settings);
		if (this._syncEngine) {
			this._syncEngine.updateSettings(this.settings);
		}
	}

	/** 상태 표시줄 아이템 반환 (테스트용) */
	getStatusBarItem(): { _lastText: string } {
		// _statusBarItem이 없으면 생성
		if (!this._statusBarItem) {
			this._statusBarItem = {
				setText: () => {},
				setAttr: () => {},
				_lastText: '',
			};
		}
		return this._statusBarItem as unknown as { _lastText: string };
	}

	/** 상태 업데이트 (REQ-P4-017 + REQ-P3-014) */
	updateStatus(status: string, message?: string) {
		const statusTexts: Record<string, string> = {
			idle: 'vSync: Synced',
			syncing: 'vSync: Syncing...',
			polling: 'vSync: Synced (polling)',
			connecting: 'vSync: Connecting...',
			paused: 'vSync: Paused',
			error: `vSync: Error: ${message || 'Unknown'}`,
			not_configured: 'vSync: Not configured',
		};

		const text = statusTexts[status] || status;

		// _statusBarItem이 없으면 지연 초기화
		if (!this._statusBarItem) {
			this.getStatusBarItem();
		}

		if (this._statusBarItem) {
			this._statusBarItem.setText(text);
			(this._statusBarItem as { _lastText?: string })._lastText = text;
		}
	}

	// ============================================================
	// SPEC-P6-UX-002: 충돌 해결 UX 메서드
	// ============================================================

	/** 충돌 배지 업데이트 (REQ-UX-005) */
	updateConflictBadge(): void {
		if (!this._statusBarItem) return;
		const count = this.conflictQueue.size();

		if (count > 0) {
			const badgeText = `(!) ${count}`;
			this._statusBarItem.setText(badgeText);
			(this._statusBarItem as { _lastText?: string })._lastText = badgeText;
		}
		// count가 0이면 기본 상태 표시 유지 (배지 숨김은 상태 표시줄 텍스트로 처리)
	}

	/** 큐에서 항목 찾기 (공통 헬퍼) */
	private _findQueueItem(itemId: string): ConflictQueueItem | undefined {
		return this.conflictQueue.getAll().find((i) => i.id === itemId);
	}

	/** 충돌 해결: 로컬 유지 (AC-008.1) */
	async applyLocal(itemId: string): Promise<void> {
		const item = this._findQueueItem(itemId);
		if (!item) return;

		// @MX:NOTE 로컬 버전 유지 + 서버에 업로드 (AC-008.1)
		if (this._syncEngine) {
			try {
				const vault = this._createVaultAdapter();
				const content = await vault.readIfExists(item.file_path);
				if (content !== null) {
					(this._syncEngine as any)._uploadLocalFile(item.file_path); // eslint-disable-line @typescript-eslint/no-explicit-any -- SyncEngine private 메서드 접근
				}
			} catch (e) {
				console.warn('vSync: Failed to apply local', e);
			}

			// @MX:NOTE 서버 충돌 해결 API (REQ-PA-008)
			if (item.conflict_id) {
				try {
					await this._syncEngine.resolveConflict(item.conflict_id, 'reject');
				} catch (e) {
					console.warn('vSync: Failed to resolve conflict on server', e);
				}
			}
		}

		// 큐에서 제거 (AC-008.5) - onUpdate 콜백이 배지 업데이트
		this.conflictQueue.resolve(itemId);
	}

	/** 충돌 해결: 원격 적용 (AC-008.2) */
	async applyRemote(itemId: string): Promise<void> {
		const item = this._findQueueItem(itemId);
		if (!item) return;

		// 원격 내용으로 로컬 덮어쓰기
		try {
			const vault = this._createVaultAdapter();
			await vault.write(item.file_path, item.server_content);
		} catch (e) {
			console.warn('vSync: Failed to apply remote', e);
		}

		// @MX:NOTE 서버 충돌 해결 API (REQ-PA-008)
		if (item.conflict_id && this._syncEngine) {
			try {
				await this._syncEngine.resolveConflict(item.conflict_id, 'accept');
			} catch (e) {
				console.warn('vSync: Failed to resolve conflict on server', e);
			}
		}

		this.conflictQueue.resolve(itemId);
	}

	/** 충돌 해결: 둘 다 보존 (AC-008.3) */
	async applyBoth(itemId: string): Promise<void> {
		const item = this._findQueueItem(itemId);
		if (!item) return;

		// 로컬 원본 유지 + 원격 내용을 .sync-conflict-* 파일로 저장
		try {
			const vault = this._createVaultAdapter();
			const timestamp = new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 14);
			const conflictPath = ConflictResolver.createConflictPathStatic(item.file_path, timestamp);
			await vault.write(conflictPath, item.server_content);
		} catch (e) {
			console.warn('vSync: Failed to apply both', e);
		}

		// @MX:NOTE 병합 해결 API (REQ-PA-009)
		if (item.conflict_id && this._syncEngine) {
			try {
				const vault = this._createVaultAdapter();
				const localContent = await vault.readIfExists(item.file_path);
				if (localContent !== null) {
					const { computeHash } = await import('./utils/hash');
					const hash = await computeHash(localContent);
					await this._syncEngine.mergeResolve(item.conflict_id, localContent, hash);
				}
			} catch (e) {
				console.warn('vSync: Failed to merge-resolve on server', e);
			}
		}

		this.conflictQueue.resolve(itemId);
	}

	/** 충돌 해결 (큐에서만 제거) */
	resolveConflict(itemId: string): void {
		this.conflictQueue.resolve(itemId);
	}

	/** 충돌 해결 모달 열기 */
	private _openResolveModal(item: ConflictQueueItem): void {
		new Notice(`충돌 해결: ${item.file_path}`);
	}

	/** 벌크 원격 적용 */
	private async _bulkResolveRemote(items: ConflictQueueItem[]): Promise<void> {
		await Promise.all(items.map((item) => this.applyRemote(item.id)));
		new Notice(`${items.length}개 충돌을 원격 적용으로 해결했습니다`);
	}

	/** 설정이 구성되었는지 확인 (ID/PW 로그인 전용) */
	private _isConfigured(): boolean {
		const s = this.settings;
		return !!(s.server_url && s.username && s.session_token && s.vault_id);
	}

	/** 동기화 시작 */
	private _startSync() {
		if (!this._syncEngine) return;

		this._syncEngine.start((cb: () => void, ms: number) => {
			this.registerInterval(window.setInterval(cb, ms));
		});

		// 최초 연결 감지: hash_cache가 비어 있으면 모달 플로우 (REQ-IS-006)
		const hashCache = this.settings.hash_cache;
		const isFirstTime = !hashCache || Object.keys(hashCache).length === 0;

		if (isFirstTime) {
			this._runInitialSyncWithModals();
		} else {
			// 재접속 사용자: 기존 자동 동기화 (REQ-IS-009)
			this._syncEngine.performInitialSync();
		}
		this.updateStatus('idle');
	}

	/** 최초 연결 시 모달 플로우 실행 */
	private async _runInitialSyncWithModals(): Promise<void> {
		if (!this._syncEngine) return;

		try {
			// 1. 파일 분류 (REQ-IS-001)
			const serverFiles = await this._syncEngine.listServerFiles();
			const localFiles = this.app.vault.getFiles();
			const classification = this._syncEngine.classifyFiles(serverFiles, localFiles);

			// 2. auto 그룹 자동 동기화 (REQ-IS-002)
			await this._syncEngine.executeAutoActions(classification.auto);

			// 3. user 그룹 모달 순차 실행
			// Step 1: 다운로드 (REQ-IS-003)
			if (classification.user.downloads.length > 0) {
				const dlPlan = await showDownloadModal(this.app, classification.user.downloads);
				await this._syncEngine.executeSyncPlan({
					downloadsToSync: dlPlan.selectedPaths,
					uploadsToSync: [],
					conflictResolutions: new Map(),
					allSkippedPaths: dlPlan.skippedPaths,
				});
			}

			// Step 2: 업로드 (REQ-IS-004)
			if (classification.user.uploads.length > 0) {
				const ulPlan = await showUploadModal(this.app, classification.user.uploads);
				await this._syncEngine.executeSyncPlan({
					downloadsToSync: [],
					uploadsToSync: ulPlan.selectedPaths,
					conflictResolutions: new Map(),
					allSkippedPaths: ulPlan.skippedPaths,
				});
			}

			// Step 3: 충돌 (REQ-IS-005)
			if (classification.user.conflicts.length > 0) {
				const cfPlan = await showConflictModal(this.app, classification.user.conflicts);
				// @MX:NOTE 충돌 파일의 서버 해시를 baseHash로 전달 (REQ-SYNC-001)
				const conflictServerHashes = new Map<string, string>();
				for (const cf of classification.user.conflicts) {
					conflictServerHashes.set(cf.path, cf.serverHash);
				}
				await this._syncEngine.executeSyncPlan({
					downloadsToSync: [],
					uploadsToSync: [],
					conflictResolutions: cfPlan.resolutions,
					allSkippedPaths: cfPlan.skippedPaths,
					conflictServerHashes,
				});
			}

			// 설정 영속화 (skipped_paths)
			await this.saveSettings();
			new Notice('초기 동기화가 완료되었습니다');
		} catch (error) {
			new Notice(`초기 동기화 실패: ${(error as Error).message}`);
		}
	}


	/** 동기화 토글 (켜기/끄기) */
	private async _toggleSync(): Promise<void> {
		if (!this._syncEngine) return;

		if (this._syncEngine.isPaused) {
			this.resumeSync();
		} else {
			this.pauseSync();
		}
	}

	/** 동기화 일시정지 (설정 탭 및 토글에서 사용) */
	pauseSync(): void {
		if (this._syncEngine) {
			this._syncEngine.pause();
			this.settings.sync_enabled = false;
			this.updateStatus('paused');
			this.saveSettings();
		}
	}

	/** 동기화 재개 (설정 탭 및 토글에서 사용) */
	resumeSync(): void {
		if (this._syncEngine) {
			this._syncEngine.resume();
			this.settings.sync_enabled = true;
			this.updateStatus('idle');
			this.saveSettings();
		}
	}


	/** 연결 설정 적용 후 동기화 시작 (모달에서 호출) */
	async connectAndSync(newSettings: Partial<VSyncSettings>): Promise<boolean> {
		Object.assign(this.settings, newSettings);
		await this.saveSettings();

		// 엔진이 없으면 (disconnect 후) 재생성
		if (!this._syncEngine) {
			const vaultAdapter = this._createVaultAdapter();
			this._syncEngine = new SyncEngine(
				this.settings,
				vaultAdapter,
				(msg: string) => {
					syncLogger.info(msg);
					this._copyableNotice(msg);
				},
				(items: OfflineQueueItem[]) => this._persistQueue(items),
				[],
				this.conflictQueue,
			);
		}

		this._syncEngine.updateSettings(this.settings);

		if (this._isConfigured()) {
			this.settings.sync_enabled = true;
			await this.saveSettings();
			this._startSync();
			this.updateStatus('idle');
			return true;
		}

		return false;
	}

		/** 서버에서 업데이트 확인 (백그라운드) */
		private async _checkForUpdates(): Promise<void> {
			try {
				const info = await checkPluginUpdate(
					this.settings.server_url,
					this.manifest.version,
				);
				if (info.hasUpdate) {
					new Notice(`vSync 업데이트 available: v${info.latestVersion} (현재: v${info.currentVersion})`);
				}
			} catch {
				// 업데이트 체크 실패는 조용히 무시
			}
		}


	/** 연결 해제 — 세션 초기화 및 동기화 중지 */
	async disconnect(): Promise<void> {
		if (this._syncEngine) {
			this._syncEngine.destroy();
			this._syncEngine = null;
		}

		this.settings.session_token = '';
		this.settings.vault_id = '';
		this.settings.sync_enabled = false;
		this.settings.last_event_id = undefined;
		this.settings.hash_cache = undefined;
			this.settings.skipped_paths = [];
		await this.saveSettings();
		this.updateStatus('not_configured');
	}

		/** 명령 등록 */
	private _registerCommands() {

		// REQ-P4-020: 동기화 상태 보기
		this.addCommand({
			id: 'vsync-show-status',
			name: 'Show sync status',
			callback: () => {
				const status = this._syncEngine?.getStatus() || 'unknown';
				const mode = this._syncEngine?.getConnectionMode() || 'unknown';
				new Notice(`vSync status: ${status} (${mode})`);
			},
		});

		// @MX:NOTE 충돌 해결 커맨드 (SPEC-P6-UX-002 REQ-UX-009)
		this.addCommand({
			id: 'resolve-conflicts',
			name: 'Resolve conflicts',
			callback: () => {
				this.activateConflictView();
			},
		});

		// @MX:NOTE 서버 파일 검색 커맨드 (REQ-PA-013, REQ-PA-014)
		this.addCommand({
			id: 'vsync-search',
			name: 'Search server files',
			callback: () => {
				this._openSearchModal();
			},
		});

		// 동기화 로그 열기
		this.addCommand({
			id: 'vsync-open-log',
			name: 'Open sync log',
			callback: () => {
				this._activateLogView();
			},
		});

		// 동기화 켜기/끄기 토글
		this.addCommand({
			id: 'vsync-toggle-sync',
			name: 'Toggle Sync On/Off',
			callback: () => this._toggleSync(),
		});

			// 플러그인 업데이트 확인
			this.addCommand({
				id: 'vsync-check-update',
				name: 'Check for plugin update',
				callback: () => {
					if (!this._isConfigured()) {
						new Notice('서버에 연결 후 사용 가능합니다');
						return;
					}
					const pluginDir = '.obsidian/plugins/vsync';
					const modal = new UpdateModal(
						this.app,
						this.settings.server_url,
						this.manifest.version,
						pluginDir,
					);
					modal.open();
				},
			});
	}

	/** 충돌 해결 뷰 활성화 (REQ-UX-009) */
	async activateConflictView(): Promise<void> {
		const count = this.conflictQueue.size();

		if (count === 0) {
			new Notice('해결할 충돌이 없습니다');
			return;
		}

		// @MX:NOTE SPEC-WORKSPACE-ADAPTER-001 REQ-WA-003, REQ-WA-004: 어댑터로 호출
		const leaves = this._workspaceAdapter!.getLeavesOfType(ConflictQueueView.VIEW_TYPE);
		if (leaves.length > 0) {
			// 이미 열려있으면 포커스
			(leaves[0] as any).setEphemeralState?.({ focus: true }); // eslint-disable-line @typescript-eslint/no-explicit-any -- Obsidian WorkspaceLeaf.setEphemeralState 미노출
		} else {
			await this._workspaceAdapter!.openViewInRightLeaf(ConflictQueueView.VIEW_TYPE);
		}
	}

	/**
	 * 서버 파일 검색 모달 열기 (REQ-PA-013, REQ-PA-014)
	 * 검색어 입력 → 서버 검색 → 결과 표시 → 클릭으로 파일 열기
	 */
	private _openSearchModal(): void {
		if (!this._syncEngine) {
			new Notice('동기화 엔진이 초기화되지 않았습니다');
			return;
		}

		const searchModal = new SearchInputModal(this.app, async (query: string) => {
			try {
				const response = await this._syncEngine!.searchFiles(query);
				if (response.results.length === 0) {
					new Notice(`"${query}"에 대한 검색 결과가 없습니다`);
					return;
				}
				// 검색 결과 모달 표시
				const resultModal = new SearchModal(
					this.app,
					query,
					response.results,
					response.total,
					(filePath: string) => this._openFileFromSearch(filePath),
				);
				resultModal.open();
			} catch (error) {
				const msg = (error as Error).message || '알 수 없는 오류';
				new Notice(`검색 실패: ${msg}`);
			}
		});
		searchModal.open();
	}

	/**
	 * 검색 결과에서 파일 열기 (REQ-PA-014)
	 */
	private async _openFileFromSearch(filePath: string): Promise<void> {
		try {
			// @MX:NOTE SPEC-WORKSPACE-ADAPTER-001 REQ-WA-005: 어댑터로 파일 열기
			await this._workspaceAdapter!.openFile(filePath);
		} catch (error) {
			// FileNotFoundError는 Notice로 처리 (어댑터 내부에서 처리)
			if (!(error instanceof FileNotFoundError)) {
				new Notice(`파일 열기 실패: ${(error as Error).message}`);
			}
		}
	}

	// ============================================================
	// SPEC-P6-PERSIST-004: 큐 영속화 헬퍼
	// ============================================================

	private static readonly OFFLINE_QUEUE_KEY = '__offlineQueue';

	// @MX:NOTE [SPEC-PLUGIN-BUGFIX-001] 바이너리 파일 큐 제외 시 사용자 알림
	/** 큐를 data.json에 영속화 (SPEC-P6-PERSIST-004) */
	private async _persistQueue(items: OfflineQueueItem[]): Promise<void> {
		try {
			const binaryItems = items.filter(
				(item) => item.content instanceof ArrayBuffer
			);
			const serializable = items.filter(
				(item) => !(item.content instanceof ArrayBuffer)
			);

			// 바이너리 항목이 제외되면 사용자에게 알림 (REQ-009)
			if (binaryItems.length > 0) {
				const fileNames = binaryItems.map((item) => item.filePath).join(', ');
				new Notice(`오프라인 큐에서 ${binaryItems.length}개 바이너리 파일이 제외되었습니다: ${fileNames}`);
			}

			const data = (await this.loadData()) as Record<string, unknown> ?? {};
			data[VSyncPlugin.OFFLINE_QUEUE_KEY] = serializable;
			await this.saveData(data);
		} catch (e) {
			console.warn('vSync: Failed to persist offline queue', e);
		}
	}

	/** 저장된 데이터에서 큐 파싱 (SPEC-P6-PERSIST-004) */
	private _parseQueueData(data: unknown): OfflineQueueItem[] {
		if (!data || typeof data !== 'object') return [];
		const obj = data as Record<string, unknown>;
		const queue = obj[VSyncPlugin.OFFLINE_QUEUE_KEY];
		if (!Array.isArray(queue)) return [];
		return queue.filter((item) => this._isValidQueueItem(item));
	}

	/** 큐 항목 스키마 검증 (SPEC-P6-PERSIST-004) */
	// @MX:WARN [SPEC-PLUGIN-BUGFIX-001] 오프라인 큐 복원 핵심 검증 — retryCount 프로퍼티명 변경 금지
	private _isValidQueueItem(item: unknown): boolean {
		if (typeof item !== 'object' || item === null) return false;
		const obj = item as Record<string, unknown>;
		return (
			typeof obj.file_path === 'string' &&
			typeof obj.operation === 'string' &&
			(obj.operation === 'upload' || obj.operation === 'delete') &&
			typeof obj.timestamp === 'number' &&
			typeof obj.retryCount === 'number'
		);
	}

	/** 7일 이전 항목 정리 (SPEC-P6-PERSIST-004 REQ-P6-006) */
	private _cleanStaleEntries(items: OfflineQueueItem[]): OfflineQueueItem[] {
		const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
		const cutoff = Date.now() - SEVEN_DAYS_MS;
		const valid = items.filter((item) => item.timestamp >= cutoff);
		const removedCount = items.length - valid.length;
		if (removedCount > 0) {
			console.log(`vSync: Removed ${removedCount} stale queue entries`);
		}
		return valid;
	}

	// @MX:NOTE SPEC-WORKSPACE-ADAPTER-001 REQ-WA-001: Workspace 어댑터 팩토리
	/* eslint-disable @typescript-eslint/no-explicit-any -- Obsidian Workspace API 타입 제약 */
	private _createWorkspaceAdapter(): WorkspaceAdapter {
		const workspace = this.app.workspace;
		const vault = this.app.vault;
		return {
			/// @MX:ANCHOR WorkspaceAdapter.onLayoutReady - 레이아웃 준비 시 콜백 실행 (REQ-WA-002)
			/// @MX:REASON: [AUTO] Obsidian workspace 초기화 타이밍 제어
			onLayoutReady(callback: () => void): void {
				workspace.onLayoutReady(callback);
			},
			/// @MX:ANCHOR WorkspaceAdapter.getLeavesOfType - 뷰 타입별 리프 조회 (REQ-WA-003)
			/// @MX:REASON: [AUTO] UI 리프 탐색 추상화
			getLeavesOfType(viewType: string): Array<{ detach: () => void }> {
				return workspace.getLeavesOfType(viewType);
			},
			/// @MX:ANCHOR WorkspaceAdapter.openViewInRightLeaf - 오른쪽 사이드바에 뷰 열기 (REQ-WA-004)
			/// @MX:REASON: [AUTO] getRightLeaf + setViewState 캡슐화
			async openViewInRightLeaf(viewType: string): Promise<void> {
				const rightLeaf = (workspace as any).getRightLeaf?.(false);
				if (rightLeaf) {
					await rightLeaf.setViewState({
						type: viewType,
						active: true,
					});
				}
			},
			/// @MX:ANCHOR WorkspaceAdapter.openFile - 파일 경로로 파일 열기 (REQ-WA-005)
			/// @MX:REASON: [AUTO] getAbstractFileByPath + getLeaf + openFile 통합 추상화
			async openFile(filePath: string): Promise<void> {
				const file = vault.getAbstractFileByPath(filePath);
				if (file) {
					await (workspace as any).getLeaf(false)?.openFile(file);
				} else {
					new Notice(`파일을 찾을 수 없습니다: ${filePath}`);
				}
			},
		};
	}
	/* eslint-enable @typescript-eslint/no-explicit-any */

	/** Vault 어댑터 생성 (SPEC-P6-RELIABLE-005) */
	/* eslint-disable @typescript-eslint/no-explicit-any -- Obsidian Vault API가 TAbstractFile을 반환하나 read/modify/delete는 TFile 요구 */
	private _createVaultAdapter(): VaultAdapter {
		const vault = this.app.vault;
		const app = this.app;
		return {
			/// @MX:ANCHOR VaultAdapter.read - 누락 파일 시 FileNotFoundError throw (SPEC-P6-RELIABLE-005 AC-001.1)
			async read(path: string): Promise<string> {
				// AC-006.6: 경로 검증
				const validatedPath = validateVaultPath(path);

				const file = vault.getAbstractFileByPath(validatedPath);
				if (!file) {
					// AC-001.1: 빈 문자열 대신 FileNotFoundError throw
					throw new FileNotFoundError(validatedPath);
				}
				try {
					return await vault.read(file as any);
				} catch (error) {
					// AC-007.1: 구조화된 에러 로깅
					console.error(`[vault-adapter] read error: ${validatedPath}`, error);
					throw new VaultReadError(validatedPath, error instanceof Error ? error : undefined);
				}
			},
			async readIfExists(path: string): Promise<string | null> {
				// AC-006.6: 경로 검증
				const validatedPath = validateVaultPath(path);

				const file = vault.getAbstractFileByPath(validatedPath);
				if (!file) return null; // AC-001.4: 동작 불변
				try {
					return await vault.read(file as any);
				} catch (error) {
					console.error(`[vault-adapter] readIfExists error: ${validatedPath}`, error);
					return null;
				}
			},
			/// @MX:ANCHOR VaultAdapter.write - 에러 래핑 및 로깅 (SPEC-P6-RELIABLE-005 AC-007.3)
			async write(path: string, content: string): Promise<void> {
				// AC-006.6: 경로 검증
				const validatedPath = validateVaultPath(path);

				try {
					const file = vault.getAbstractFileByPath(validatedPath);
					if (file) {
						await vault.modify(file as any, content);
					} else {
						// 부모 디렉토리가 없으면 생성
						const dir = validatedPath.split('/').slice(0, -1).join('/');
						if (dir) {
							const dirExists = vault.getAbstractFileByPath(dir);
							if (!dirExists) {
								try { await vault.createFolder(dir); } catch { /* 이미 존재 */ }
							}
						}
						await vault.create(validatedPath, content);
					}
				} catch (error) {
					// AC-007.3: 쓰기 에러 로깅
					console.error(`[vault-adapter] write error: ${validatedPath}`, error);
					throw new VaultWriteError(validatedPath, error instanceof Error ? error : undefined);
				}
			},
			// @MX:NOTE SPEC-OBSIDIAN-API-GAP-001 REQ-API-004: vault.trash 우선, 폴백 vault.delete
			async delete(path: string): Promise<void> {
				// AC-006.6: 경로 검증
				const validatedPath = validateVaultPath(path);

				const file = vault.getAbstractFileByPath(validatedPath);
				if (file) {
					// vault.trash(file, true) 우선 사용 → 시스템 휴지통으로 복구 가능 삭제
					if (typeof (vault as any).trash === 'function') {
						await (vault as any).trash(file, true);
					} else {
						await vault.delete(file as any);
					}
				}
			},
			getFiles(): Array<{ path: string }> {
				return vault.getFiles();
			},
			on: (event: string, handler: (...args: unknown[]) => void): void => {
				// registerEvent로 등록해야 플러그인 언로드 시 자동 해제됨
				const ref = vault.on(event as any, handler as any);
				this.registerEvent(ref);
			},
			off(event: string, handler: (...args: unknown[]) => void): void {
				vault.off(event as any, handler as any);
			},
			// 바이너리 지원 (REQ-P6-004 ~ REQ-P6-006)
			async readBinary(path: string): Promise<ArrayBuffer> {
				const validatedPath = validateVaultPath(path);
				const file = vault.getAbstractFileByPath(validatedPath);
				if (!file) throw new FileNotFoundError(validatedPath);
				return await vault.readBinary(file as any);
			},
			async readBinaryIfExists(path: string): Promise<ArrayBuffer | null> {
				try {
					const validatedPath = validateVaultPath(path);
					const file = vault.getAbstractFileByPath(validatedPath);
					if (!file) return null;
					return await vault.readBinary(file as any);
				} catch {
					return null;
				}
			},
			async writeBinary(path: string, data: ArrayBuffer): Promise<void> {
				const validatedPath = validateVaultPath(path);
				const file = vault.getAbstractFileByPath(validatedPath);
				if (file) {
					await vault.modifyBinary(file as any, data);
				} else {
					// 부모 디렉토리가 없으면 생성
					const dir = validatedPath.split('/').slice(0, -1).join('/');
					if (dir) {
						const dirExists = vault.getAbstractFileByPath(dir);
						if (!dirExists) {
							try { await vault.createFolder(dir); } catch { /* 이미 존재 */ }
						}
					}
					await vault.createBinary(validatedPath, data);
				}
			},
			// @MX:NOTE SPEC-OBSIDIAN-API-GAP-001 REQ-API-002: fileManager.renameFile - wiki link 보존
			async renameFile(oldPath: string, newPath: string): Promise<void> {
				const validatedPath = validateVaultPath(oldPath);
				const file = vault.getAbstractFileByPath(validatedPath);
				if (!file) return; // 파일 없으면 무시
				// fileManager.renameFile 우선 사용 → wiki link 자동 갱신
				if (app?.fileManager && typeof app.fileManager.renameFile === 'function') {
					await app.fileManager.renameFile(file, newPath);
				} else if (typeof vault.rename === 'function') {
					// 폴백: vault.rename 사용
					await vault.rename(file as any, newPath);
				}
			},
			// @MX:NOTE SPEC-OBSIDIAN-API-GAP-001 REQ-API-003: vault.process - 원자적 read-modify-write
			async process(path: string, fn: (content: string) => string | null): Promise<string | null> {
				const validatedPath = validateVaultPath(path);
				const file = vault.getAbstractFileByPath(validatedPath);
				if (!file) return null; // 파일 없으면 null 반환
				// vault.process 우선 사용 → 원자적 연산
				if (typeof (vault as any).process === 'function') {
					return await (vault as any).process(file, fn);
				} else {
					// 폴백: read + modify 수동 처리
					const content = await vault.read(file as any);
					const newContent = fn(content);
					if (newContent !== null) {
						await vault.modify(file as any, newContent);
					}
					return newContent;
				}
			},
			// @MX:NOTE SPEC-OBSIDIAN-API-GAP-001 REQ-API-005: vault.cachedRead - 캐시 우선 읽기
			async cachedRead(path: string): Promise<string | null> {
				const validatedPath = validateVaultPath(path);
				const file = vault.getAbstractFileByPath(validatedPath);
				if (!file) return null;
				try {
					// vault.cachedRead 우선 사용 → 메타데이터 캐시 활용
					if (typeof (vault as any).cachedRead === 'function') {
						return await (vault as any).cachedRead(file);
					} else {
						// 폴백: vault.read 사용
						return await vault.read(file as any);
					}
				} catch {
					return null;
				}
			},
		};
	}
	/* eslint-enable @typescript-eslint/no-explicit-any */
}
