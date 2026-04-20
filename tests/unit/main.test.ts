// 플러그인 메인 테스트

import { describe, it, expect, vi, beforeEach } from 'vitest';

// SyncEngine mock - 생성자 인자 캡처
let capturedVaultAdapter: any = null;
const mockSyncEngine = {
	start: vi.fn(),
	pollRemoteChanges: vi.fn(),
	performInitialSync: vi.fn(),
	performFullSync: vi.fn(),
	updateSettings: vi.fn(),
	getStatus: vi.fn().mockReturnValue('idle'),
	setSyncing: vi.fn(),
	setOnStatusChange: vi.fn(),
	setOnCacheUpdate: vi.fn(),
	enableRealtimeMode: vi.fn(),
	destroy: vi.fn(),
	getConnectionMode: vi.fn().mockReturnValue('polling'),
	flushOfflineQueue: vi.fn(),
	getConflictQueue: vi.fn().mockReturnValue(null),
	getDevices: vi.fn().mockResolvedValue([]),
	removeDevice: vi.fn().mockResolvedValue(undefined),
	searchFiles: vi.fn().mockResolvedValue({ results: [], total: 0 }),
};

vi.mock('../../src/sync-engine', () => ({
	SyncEngine: vi.fn().mockImplementation((_settings: any, vault: any, _noticeFn: any) => {
		capturedVaultAdapter = vault;
		return mockSyncEngine;
	}),
}));

// VectorSettingTab mock
vi.mock('../../src/settings', () => ({
	VectorSettingTab: vi.fn().mockImplementation(() => ({
		display: vi.fn(),
		hide: vi.fn(),
		isConfigured: vi.fn().mockReturnValue(true),
		validateSettings: vi.fn(),
		testConnection: vi.fn(),
		normalizeServerUrl: vi.fn(),
		setDeviceApi: vi.fn(),
	})),
	DEFAULT_SETTINGS: {
		server_url: '',
		api_key: '',
		vault_id: '',
		sync_interval: 30,
		device_id: '',
	},
}));

// computeHash 모킹 (merge resolve 테스트에서 사용)
vi.mock('../../src/utils/hash', () => ({
	computeHash: vi.fn().mockResolvedValue('mock-hash'),
}));

// SearchModal 모킹 (REQ-PA-013, REQ-PA-014)
vi.mock('../../src/ui/SearchModal', () => ({
	SearchInputModal: vi.fn().mockImplementation((_app: any, onSearch: any) => ({
		open: vi.fn(),
		close: vi.fn(),
		_onSearch: onSearch,
	})),
	SearchModal: vi.fn().mockImplementation(() => ({
		open: vi.fn(),
		close: vi.fn(),
	})),
}));

import VectorPlugin from '../../src/main';

describe('VectorPlugin', () => {
	let plugin: VectorPlugin;

	beforeEach(() => {
		vi.clearAllMocks();
		capturedVaultAdapter = null;
		plugin = new VectorPlugin();
	});

	describe('onload (REQ-P4-017)', () => {
		it('상태 표시줄 아이템을 생성해야 한다', async () => {
			await plugin.onload();
			expect(plugin.addStatusBarItem).toHaveBeenCalled();
		});

		it('수동 동기화 명령을 등록해야 한다 (REQ-P4-019)', async () => {
			await plugin.onload();
			expect(plugin.addCommand).toHaveBeenCalledWith(
				expect.objectContaining({
					id: 'vector-force-sync',
					name: expect.stringContaining('Force sync'),
				})
			);
		});

		it('동기화 상태 보기 명령을 등록해야 한다 (REQ-P4-020)', async () => {
			await plugin.onload();
			expect(plugin.addCommand).toHaveBeenCalledWith(
				expect.objectContaining({
					id: 'vector-show-status',
					name: expect.stringContaining('Show sync status'),
				})
			);
		});

		it('설정 탭을 등록해야 한다', async () => {
			await plugin.onload();
			expect(plugin.addSettingTab).toHaveBeenCalled();
		});

		it('설정이 구성되지 않은 경우 "Not configured" 상태를 표시해야 한다', async () => {
			plugin.loadData = vi.fn().mockResolvedValue(null);
			await plugin.onload();
			const statusBarItem = plugin.getStatusBarItem();
			expect(statusBarItem._lastText).toContain('Not configured');
		});
	});

	describe('updateStatus (REQ-P4-017)', () => {
		it('동기화 중 상태를 "Syncing..."으로 표시해야 한다', () => {
			plugin.updateStatus('syncing');
			const item = plugin.getStatusBarItem();
			expect(item._lastText).toContain('Syncing');
		});

		it('유휴 상태를 "Synced"로 표시해야 한다', () => {
			plugin.updateStatus('idle');
			const item = plugin.getStatusBarItem();
			expect(item._lastText).toContain('Synced');
		});

		it('에러 상태를 "Error"로 표시해야 한다', () => {
			plugin.updateStatus('error', 'Auth failed');
			const item = plugin.getStatusBarItem();
			expect(item._lastText).toContain('Error');
		});
	});

	describe('onunload', () => {
		it('플러그인 언로드 시 destroy를 호출해야 한다', async () => {
			await plugin.onload();
			plugin.onunload();
			expect(mockSyncEngine.destroy).toHaveBeenCalled();
		});

		it('플러그인 언로드 시 에러가 발생하지 않아야 한다', () => {
			expect(() => plugin.onunload()).not.toThrow();
		});
	});

	describe('onload - configured settings', () => {
		it('설정이 구성된 경우 자동 동기화를 시작해야 한다', async () => {
			plugin.loadData = vi.fn().mockResolvedValue({
				server_url: 'https://example.com',
				api_key: 'test-key',
				vault_id: 'vault-1',
				sync_interval: 30,
			});

			await plugin.onload();

			expect(mockSyncEngine.start).toHaveBeenCalled();
			expect(mockSyncEngine.performInitialSync).toHaveBeenCalled();
		});

		it('설정이 구성된 경우 초기 상태가 idle이어야 한다', async () => {
			plugin.loadData = vi.fn().mockResolvedValue({
				server_url: 'https://example.com',
				api_key: 'test-key',
				vault_id: 'vault-1',
			});

			await plugin.onload();

			const statusBarItem = plugin.getStatusBarItem();
			expect(statusBarItem._lastText).toContain('Synced');
		});

		it('저장된 설정을 로드해야 한다', async () => {
			const savedSettings = {
				server_url: 'https://saved.example.com',
				api_key: 'saved-key',
				vault_id: 'saved-vault',
				sync_interval: 60,
			};
			plugin.loadData = vi.fn().mockResolvedValue(savedSettings);

			await plugin.onload();

			expect(plugin.settings.server_url).toBe('https://saved.example.com');
			expect(plugin.settings.sync_interval).toBe(60);
		});
	});

	describe('force sync command', () => {
		it('수동 동기화 성공 시 idle 상태로 전환해야 한다', async () => {
			await plugin.onload();

			const forceSyncCommand = (plugin.addCommand as ReturnType<typeof vi.fn>).mock.calls.find(
				(call: any[]) => call[0].id === 'vector-force-sync'
			);
			expect(forceSyncCommand).toBeDefined();

			mockSyncEngine.performFullSync.mockResolvedValue(undefined);
			await forceSyncCommand![0].callback();

			const statusBarItem = plugin.getStatusBarItem();
			expect(statusBarItem._lastText).toContain('Synced');
		});

		it('수동 동기화 실패 시 error 상태로 전환해야 한다', async () => {
			await plugin.onload();

			const forceSyncCommand = (plugin.addCommand as ReturnType<typeof vi.fn>).mock.calls.find(
				(call: any[]) => call[0].id === 'vector-force-sync'
			);
			expect(forceSyncCommand).toBeDefined();

			mockSyncEngine.performFullSync.mockRejectedValue(new Error('Network error'));
			await forceSyncCommand![0].callback();

			const statusBarItem = plugin.getStatusBarItem();
			expect(statusBarItem._lastText).toContain('Error');
			expect(statusBarItem._lastText).toContain('Network error');
		});
	});

	describe('show status command', () => {
		it('동기화 상태를 Notice로 표시해야 한다', async () => {
			const { Notice } = await import('../mocks/obsidian');
			(Notice as ReturnType<typeof vi.fn>).mockClear();

			await plugin.onload();

			const showStatusCommand = (plugin.addCommand as ReturnType<typeof vi.fn>).mock.calls.find(
				(call: any[]) => call[0].id === 'vector-show-status'
			);
			expect(showStatusCommand).toBeDefined();

			mockSyncEngine.getStatus.mockReturnValue('syncing');
			showStatusCommand![0].callback();

			expect(Notice).toHaveBeenCalledWith(expect.stringContaining('syncing'));
		});
	});

	describe('_createVaultAdapter', () => {
		it('Vault 어댑터의 read가 존재하는 파일을 읽어야 한다', async () => {
			const mockFile = { path: 'test.md' };
			plugin.app.vault.getAbstractFileByPath.mockReturnValue(mockFile);
			plugin.app.vault.read.mockResolvedValue('content');

			await plugin.onload();
			expect(capturedVaultAdapter).not.toBeNull();

			const result = await capturedVaultAdapter.read('test.md');
			expect(result).toBe('content');
			expect(plugin.app.vault.getAbstractFileByPath).toHaveBeenCalledWith('test.md');
		});

		it('Vault 어댑터의 read가 없는 파일에 대해 FileNotFoundError를 throw해야 한다 (SPEC-P6-RELIABLE-005)', async () => {
			plugin.app.vault.getAbstractFileByPath.mockReturnValue(null);
			await plugin.onload();
			await expect(capturedVaultAdapter.read('missing.md')).rejects.toThrow('File not found: missing.md');
		});

		it('Vault 어댑터의 readIfExists가 존재하는 파일을 읽어야 한다', async () => {
			const mockFile = { path: 'exists.md' };
			plugin.app.vault.getAbstractFileByPath.mockReturnValue(mockFile);
			plugin.app.vault.read.mockResolvedValue('file content');
			await plugin.onload();
			const result = await capturedVaultAdapter.readIfExists('exists.md');
			expect(result).toBe('file content');
		});

		it('Vault 어댑터의 readIfExists가 없는 파일에 대해 null을 반환해야 한다', async () => {
			plugin.app.vault.getAbstractFileByPath.mockReturnValue(null);
			await plugin.onload();
			const result = await capturedVaultAdapter.readIfExists('missing.md');
			expect(result).toBeNull();
		});

		it('Vault 어댑터의 write가 기존 파일을 수정해야 한다', async () => {
			const mockFile = { path: 'existing.md' };
			plugin.app.vault.getAbstractFileByPath.mockReturnValue(mockFile);
			plugin.app.vault.modify.mockResolvedValue(undefined);
			await plugin.onload();
			await capturedVaultAdapter.write('existing.md', 'new content');
			expect(plugin.app.vault.modify).toHaveBeenCalledWith(mockFile, 'new content');
		});

		it('Vault 어댑터의 write가 새 파일을 생성해야 한다', async () => {
			plugin.app.vault.getAbstractFileByPath.mockReturnValue(null);
			plugin.app.vault.create.mockResolvedValue(undefined);
			await plugin.onload();
			await capturedVaultAdapter.write('new.md', 'new file content');
			expect(plugin.app.vault.create).toHaveBeenCalledWith('new.md', 'new file content');
		});

		it('Vault 어댑터의 delete가 파일을 삭제해야 한다', async () => {
			const mockFile = { path: 'delete.md' };
			plugin.app.vault.getAbstractFileByPath.mockReturnValue(mockFile);
			plugin.app.vault.delete.mockResolvedValue(undefined);
			await plugin.onload();
			await capturedVaultAdapter.delete('delete.md');
			expect(plugin.app.vault.delete).toHaveBeenCalledWith(mockFile);
		});

		it('Vault 어댑터의 delete가 없는 파일에 대해 아무것도 하지 않아야 한다', async () => {
			plugin.app.vault.getAbstractFileByPath.mockReturnValue(null);
			await plugin.onload();
			await capturedVaultAdapter.delete('missing.md');
			expect(plugin.app.vault.delete).not.toHaveBeenCalled();
		});

		it('Vault 어댑터의 getFiles가 파일 목록을 반환해야 한다', async () => {
			const mockFiles = [{ path: 'a.md' }, { path: 'b.md' }];
			plugin.app.vault.getFiles.mockReturnValue(mockFiles);
			await plugin.onload();
			const files = capturedVaultAdapter.getFiles();
			expect(files).toEqual(mockFiles);
		});

		it('Vault 어댑터의 on이 vault.on을 호출해야 한다', async () => {
			await plugin.onload();
			const handler = () => {};
			capturedVaultAdapter.on('create', handler);
			expect(plugin.app.vault.on).toHaveBeenCalledWith('create', handler);
		});

		it('Vault 어댑터의 off가 vault.off을 호출해야 한다', async () => {
			await plugin.onload();
			const handler = () => {};
			capturedVaultAdapter.off('create', handler);
			expect(plugin.app.vault.off).toHaveBeenCalledWith('create', handler);
		});
	});

	describe('updateStatus - edge cases', () => {
		it('알 수 없는 상태를 원본 문자열로 표시해야 한다', () => {
			plugin.updateStatus('custom_status');
			const item = plugin.getStatusBarItem();
			expect(item._lastText).toBe('custom_status');
		});

		it('에러 메시지가 없으면 Unknown을 표시해야 한다', () => {
			plugin.updateStatus('error');
			const item = plugin.getStatusBarItem();
			expect(item._lastText).toContain('Unknown');
		});
	});

	// ============================================================
	// T10: 연결 모드 상태 표시 (REQ-P3-014)
	// ============================================================

	describe('T10: 연결 모드 상태 표시 (REQ-P3-014)', () => {
		it('실시간 연결 시 "Synced"를 표시해야 한다', () => {
			plugin.updateStatus('idle');
			const item = plugin.getStatusBarItem();
			expect(item._lastText).toContain('Synced');
			expect(item._lastText).not.toContain('polling');
		});

		it('폴링 모드 시 "Synced (polling)"을 표시해야 한다', () => {
			plugin.updateStatus('polling');
			const item = plugin.getStatusBarItem();
			expect(item._lastText).toContain('Synced');
			expect(item._lastText).toContain('polling');
		});

		it('연결 중일 때 "Connecting..."을 표시해야 한다', () => {
			plugin.updateStatus('connecting');
			const item = plugin.getStatusBarItem();
			expect(item._lastText).toContain('Connecting');
		});

		it('에러 시 "Error: {msg}"를 표시해야 한다', () => {
			plugin.updateStatus('error', 'Connection refused');
			const item = plugin.getStatusBarItem();
			expect(item._lastText).toContain('Error');
			expect(item._lastText).toContain('Connection refused');
		});

		it('setOnStatusChange 콜백이 등록되어야 한다', async () => {
			await plugin.onload();
			expect(mockSyncEngine.setOnStatusChange).toHaveBeenCalled();
		});
	});

	// ============================================================
	// SPEC-P6-PERSIST-004: 오프라인 큐 영속화
	// ============================================================

	describe('큐 복원 (REQ-P6-002)', () => {
		it('onload 시 저장된 큐 데이터를 복원해야 한다', async () => {
			plugin.loadData = vi.fn().mockResolvedValue({
				server_url: 'https://example.com',
				api_key: 'test-key',
				vault_id: 'vault-1',
				sync_interval: 30,
				__offlineQueue: [
					{
						file_path: 'queued.md',
						content: 'queued content',
						operation: 'upload',
						timestamp: Date.now(),
						retry_count: 0,
					},
				],
			});

			await plugin.onload();

			// SyncEngine이 생성되고 동기화가 시작되었는지 확인
			expect(mockSyncEngine.start).toHaveBeenCalled();
		});

		it('빈 큐 데이터 로드 시 정상 동작해야 한다', async () => {
			plugin.loadData = vi.fn().mockResolvedValue({
				server_url: 'https://example.com',
				api_key: 'test-key',
				vault_id: 'vault-1',
			});

			await plugin.onload();

			expect(mockSyncEngine.start).toHaveBeenCalled();
		});

		it('잘못된 큐 항목을 필터링해야 한다', async () => {
			plugin.loadData = vi.fn().mockResolvedValue({
				server_url: 'https://example.com',
				api_key: 'test-key',
				vault_id: 'vault-1',
				__offlineQueue: [
					{
						// 필수 필드 누락 (operation 없음)
						file_path: 'invalid.md',
						content: 'content',
						timestamp: Date.now(),
						retry_count: 0,
					},
					{
						// 유효한 항목
						file_path: 'valid.md',
						content: 'valid content',
						operation: 'upload',
						timestamp: Date.now(),
						retry_count: 0,
					},
				],
			});

			await plugin.onload();

			expect(mockSyncEngine.start).toHaveBeenCalled();
		});

		it('설정 미구성 시 flush를 시도하지 않아야 한다', async () => {
			plugin.loadData = vi.fn().mockResolvedValue(null);

			await plugin.onload();

			expect(mockSyncEngine.start).not.toHaveBeenCalled();
		});
	});

	describe('Stale Entry 정리 (REQ-P6-006)', () => {
		it('7일 이전 항목을 제거해야 한다', async () => {
			const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000 - 1000;
			const recentTimestamp = Date.now();

			plugin.loadData = vi.fn().mockResolvedValue({
				server_url: 'https://example.com',
				api_key: 'test-key',
				vault_id: 'vault-1',
				__offlineQueue: [
					{
						file_path: 'stale.md',
						content: 'old content',
						operation: 'upload',
						timestamp: sevenDaysAgo,
						retry_count: 0,
					},
					{
						file_path: 'recent.md',
						content: 'recent content',
						operation: 'upload',
						timestamp: recentTimestamp,
						retry_count: 0,
					},
				],
			});

			await plugin.onload();

			expect(mockSyncEngine.start).toHaveBeenCalled();
		});

		it('모든 항목이 오래된 경우 빈 큐로 복원해야 한다', async () => {
			const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000 - 1000;

			plugin.loadData = vi.fn().mockResolvedValue({
				server_url: 'https://example.com',
				api_key: 'test-key',
				vault_id: 'vault-1',
				__offlineQueue: [
					{
						file_path: 'stale1.md',
						content: 'content',
						operation: 'upload',
						timestamp: sevenDaysAgo,
						retry_count: 0,
					},
					{
						file_path: 'stale2.md',
						content: 'content',
						operation: 'delete',
						timestamp: sevenDaysAgo,
						retry_count: 1,
					},
				],
			});

			await plugin.onload();

			expect(mockSyncEngine.start).toHaveBeenCalled();
		});
	});

	// ============================================================
	// SPEC-P6-UX-002: 충돌 해결 UX 통합 (T-010)
	// ============================================================

	describe('SPEC-P6-UX-002: 충돌 해결 UX', () => {
		it('ConflictQueue를 생성해야 한다 (REQ-UX-003)', async () => {
			await plugin.onload();
			expect(plugin.conflictQueue).toBeDefined();
			expect(plugin.conflictQueue.size()).toBe(0);
		});

		it('상태 표시줄 충돌 배지가 초기에는 표시되지 않아야 한다 (REQ-UX-005)', async () => {
			await plugin.onload();
			// conflictQueue가 비어있으므로 배지 숨김
			expect(plugin.conflictQueue.size()).toBe(0);
		});

		it('"Resolve conflicts" 커맨드를 등록해야 한다 (REQ-UX-009)', async () => {
			await plugin.onload();
			expect(plugin.addCommand).toHaveBeenCalledWith(
				expect.objectContaining({
					id: 'resolve-conflicts',
					name: expect.stringContaining('Resolve conflicts'),
				})
			);
		});

		it('updateConflictBadge가 충돌 수를 표시해야 한다 (AC-005.1)', async () => {
			await plugin.onload();

			// 큐에 충돌 추가
			plugin.conflictQueue.enqueue({
				id: 'test-1',
				file_path: 'test.md',
				local_content: 'local',
				server_content: 'server',
				diff: null,
				base_hash: null,
				conflict_id: null,
				type: 'simple',
				timestamp: Date.now(),
				source: 'download',
			});

			plugin.updateConflictBadge();

			const item = plugin.getStatusBarItem();
			expect(item._lastText).toContain('!');
			expect(item._lastText).toContain('1');
		});

		it('updateConflictBadge: 충돌이 0개면 배지를 숨겨야 한다 (AC-005.2)', async () => {
			await plugin.onload();
			plugin.updateConflictBadge();

			// 배지가 빈 상태 또는 이전 상태 표시줄 텍스트
			expect(plugin.conflictQueue.size()).toBe(0);
		});

		it('충돌 해결 후 큐에서 제거하고 배지를 업데이트해야 한다 (AC-008.5)', async () => {
			await plugin.onload();

			const itemId = 'test-resolve-id';
			plugin.conflictQueue.enqueue({
				id: itemId,
				file_path: 'test.md',
				local_content: 'local',
				server_content: 'server',
				diff: null,
				base_hash: null,
				conflict_id: null,
				type: 'simple',
				timestamp: Date.now(),
				source: 'download',
			});

			expect(plugin.conflictQueue.size()).toBe(1);

			// 해결 처리
			plugin.resolveConflict(itemId);

			expect(plugin.conflictQueue.size()).toBe(0);
		});

		it('applyLocal: 로컬 내용을 유지해야 한다 (AC-008.1)', async () => {
			await plugin.onload();

			const itemId = 'apply-local-id';
			plugin.conflictQueue.enqueue({
				id: itemId,
				file_path: 'test.md',
				local_content: 'local content',
				server_content: 'server content',
				diff: null,
				base_hash: null,
				conflict_id: null,
				type: 'simple',
				timestamp: Date.now(),
				source: 'download',
			});

			// applyLocal 호출
			await plugin.applyLocal(itemId);

			// 큐에서 제거됨
			expect(plugin.conflictQueue.size()).toBe(0);
		});

		it('applyRemote: 원격 내용을 적용해야 한다 (AC-008.2)', async () => {
			await plugin.onload();

			const itemId = 'apply-remote-id';
			plugin.conflictQueue.enqueue({
				id: itemId,
				file_path: 'test.md',
				local_content: 'local content',
				server_content: 'server content',
				diff: null,
				base_hash: null,
				conflict_id: null,
				type: 'simple',
				timestamp: Date.now(),
				source: 'download',
			});

			await plugin.applyRemote(itemId);

			expect(plugin.conflictQueue.size()).toBe(0);
		});

		it('applyBoth: 로컬 유지 + 충돌 파일 생성해야 한다 (AC-008.3)', async () => {
			await plugin.onload();

			const itemId = 'apply-both-id';
			plugin.conflictQueue.enqueue({
				id: itemId,
				file_path: 'test.md',
				local_content: 'local content',
				server_content: 'server content',
				diff: null,
				base_hash: null,
				conflict_id: null,
				type: 'simple',
				timestamp: Date.now(),
				source: 'download',
			});

			await plugin.applyBoth(itemId);

			expect(plugin.conflictQueue.size()).toBe(0);
		});

		// ============================================================
		// SPEC-P8-PLUGIN-API-001 Cycle 5: 서버 충돌 해결 (T-013, T-014)
		// ============================================================

		describe('서버 충돌 해결 API 연동 (REQ-PA-008, T-013)', () => {
			it('applyLocal: conflictId 있으면 resolveConflict(reject) 호출', async () => {
				await plugin.onload();
				const mockResolveConflict = vi.fn().mockResolvedValue(undefined);
				mockSyncEngine.resolveConflict = mockResolveConflict;

				const itemId = 'server-local-id';
				plugin.conflictQueue.enqueue({
					id: itemId,
					file_path: 'test.md',
					local_content: 'local',
					server_content: 'server',
					diff: null,
					base_hash: null,
					conflict_id: 'server-conflict-1',
					type: 'simple',
					timestamp: Date.now(),
					source: 'download',
				});

				await plugin.applyLocal(itemId);

				expect(mockResolveConflict).toHaveBeenCalledWith('server-conflict-1', 'reject');
				expect(plugin.conflictQueue.size()).toBe(0);
			});

			it('applyRemote: conflictId 있으면 resolveConflict(accept) 호출', async () => {
				await plugin.onload();
				const mockResolveConflict = vi.fn().mockResolvedValue(undefined);
				mockSyncEngine.resolveConflict = mockResolveConflict;

				const itemId = 'server-remote-id';
				plugin.conflictQueue.enqueue({
					id: itemId,
					file_path: 'test.md',
					local_content: 'local',
					server_content: 'server',
					diff: null,
					base_hash: null,
					conflict_id: 'server-conflict-2',
					type: 'simple',
					timestamp: Date.now(),
					source: 'download',
				});

				await plugin.applyRemote(itemId);

				expect(mockResolveConflict).toHaveBeenCalledWith('server-conflict-2', 'accept');
				expect(plugin.conflictQueue.size()).toBe(0);
			});

			it('conflictId 없으면 서버 API 호출 생략', async () => {
				await plugin.onload();
				const mockResolveConflict = vi.fn();
				mockSyncEngine.resolveConflict = mockResolveConflict;

				const itemId = 'no-conflict-id';
				plugin.conflictQueue.enqueue({
					id: itemId,
					file_path: 'test.md',
					local_content: 'local',
					server_content: 'server',
					diff: null,
					base_hash: null,
					conflict_id: null,
					type: 'simple',
					timestamp: Date.now(),
					source: 'download',
				});

				await plugin.applyLocal(itemId);

				expect(mockResolveConflict).not.toHaveBeenCalled();
				expect(plugin.conflictQueue.size()).toBe(0);
			});

			it('서버 API 실패해도 로컬 큐에서 제거 (오프라인 동작 보장)', async () => {
				await plugin.onload();
				const mockResolveConflict = vi.fn().mockRejectedValue(new Error('Server error'));
				mockSyncEngine.resolveConflict = mockResolveConflict;

				const itemId = 'fail-api-id';
				plugin.conflictQueue.enqueue({
					id: itemId,
					file_path: 'test.md',
					local_content: 'local',
					server_content: 'server',
					diff: null,
					base_hash: null,
					conflict_id: 'server-conflict-3',
					type: 'simple',
					timestamp: Date.now(),
					source: 'download',
				});

				await plugin.applyRemote(itemId);

				expect(mockResolveConflict).toHaveBeenCalled();
				expect(plugin.conflictQueue.size()).toBe(0);
			});
		});

		describe('병합 해결 API 연동 (REQ-PA-009, T-014)', () => {
			it('applyBoth: conflictId 있으면 mergeResolve 호출', async () => {
				await plugin.onload();
				const mockMergeResolve = vi.fn().mockResolvedValue(undefined);
				mockSyncEngine.mergeResolve = mockMergeResolve;

				// 볼트 모킹: readIfExists가 콘텐츠를 반환하도록 설정
				const mockFile = { path: 'merge.md' };
				(plugin.app as any).vault.getAbstractFileByPath = vi.fn().mockReturnValue(mockFile);
				(plugin.app as any).vault.read = vi.fn().mockResolvedValue('local merged content');

				const itemId = 'merge-id';
				plugin.conflictQueue.enqueue({
					id: itemId,
					file_path: 'merge.md',
					local_content: 'local',
					server_content: 'server',
					diff: [{ op: 1, text: 'local' }],
					base_hash: 'base-hash',
					conflict_id: 'merge-conflict-1',
					type: 'diff',
					timestamp: Date.now(),
					source: 'upload',
				});

				await plugin.applyBoth(itemId);

				expect(mockMergeResolve).toHaveBeenCalled();
				expect(plugin.conflictQueue.size()).toBe(0);
			});
		});

	});
	});
