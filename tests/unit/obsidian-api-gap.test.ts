// SPEC-OBSIDIAN-API-GAP-001: Obsidian Vault API 공식 메서드 전환 테스트
// TDD 테스트: 각 마일스톤별 RED-GREEN-REFACTOR 사이클

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
	VaultAdapter: {} as any, // 인터페이스는 런타임에 존재하지 않음
}));

vi.mock('../../src/settings', () => ({
	VSyncSettingTab: vi.fn().mockImplementation(() => ({
		display: vi.fn(),
		hide: vi.fn(),
		isConfigured: vi.fn().mockReturnValue(true),
		validateSettings: vi.fn(),
		testConnection: vi.fn(),
		normalizeServerUrl: vi.fn(),
		setDeviceApi: vi.fn(),
			setConnectHandler: vi.fn(),
			setDisconnectHandler: vi.fn(),
	})),
	DEFAULT_SETTINGS: {
		server_url: '',
		api_key: '',
		vault_id: '',
		sync_interval: 30,
		device_id: '',
	},
}));

vi.mock('../../src/utils/hash', () => ({
	computeHash: vi.fn().mockResolvedValue('mock-hash'),
}));

vi.mock('../../src/ui/SearchModal', () => ({
	SearchInputModal: vi.fn().mockImplementation(() => ({
		open: vi.fn(),
		close: vi.fn(),
	})),
	SearchModal: vi.fn().mockImplementation(() => ({
		open: vi.fn(),
		close: vi.fn(),
	})),
}));

import VSyncPlugin from '../../src/main';

// ============================================================
// 마일스톤 1: VaultAdapter 인터페이스 확장
// ============================================================

describe('SPEC-OBSIDIAN-API-GAP-001: VaultAdapter 인터페이스 확장', () => {
	let plugin: VSyncPlugin;

	beforeEach(() => {
		vi.clearAllMocks();
		capturedVaultAdapter = null;
		plugin = new (VSyncPlugin as any)();
	});

	describe('VaultAdapter에 새 메서드가 존재해야 한다', () => {
		it('renameFile 메서드가 VaultAdapter에 정의되어야 한다 (REQ-API-002)', async () => {
			plugin.loadData = vi.fn().mockResolvedValue({
				server_url: 'https://example.com',
				username: 'testuser', password: '', session_token: 'test-token', sync_enabled: true,
				vault_id: 'vault-1',
			});
			await plugin.onload();

			expect(capturedVaultAdapter).not.toBeNull();
			expect(typeof capturedVaultAdapter.renameFile).toBe('function');
		});

		it('process 메서드가 VaultAdapter에 정의되어야 한다 (REQ-API-003)', async () => {
			plugin.loadData = vi.fn().mockResolvedValue({
				server_url: 'https://example.com',
				username: 'testuser', password: '', session_token: 'test-token', sync_enabled: true,
				vault_id: 'vault-1',
			});
			await plugin.onload();

			expect(capturedVaultAdapter).not.toBeNull();
			expect(typeof capturedVaultAdapter.process).toBe('function');
		});

		it('cachedRead 메서드가 VaultAdapter에 정의되어야 한다 (REQ-API-005)', async () => {
			plugin.loadData = vi.fn().mockResolvedValue({
				server_url: 'https://example.com',
				username: 'testuser', password: '', session_token: 'test-token', sync_enabled: true,
				vault_id: 'vault-1',
			});
			await plugin.onload();

			expect(capturedVaultAdapter).not.toBeNull();
			expect(typeof capturedVaultAdapter.cachedRead).toBe('function');
		});
	});
});

// ============================================================
// 마일스톤 2: REQ-API-001 onLayoutReady 래핑
// ============================================================

describe('SPEC-OBSIDIAN-API-GAP-001: REQ-API-001 onLayoutReady 래핑', () => {
	let plugin: VSyncPlugin;

	beforeEach(() => {
		vi.clearAllMocks();
		capturedVaultAdapter = null;
		plugin = new (VSyncPlugin as any)();
	});

	it('설정이 구성된 경우 onLayoutReady 콜백 내에서 동기화를 시작해야 한다', async () => {
		// onLayoutReady mock 설정: 모든 콜백을 배열로 캡처
		// (main.ts에서 onLayoutReady가 2번 호출됨: sync + update check)
		const capturedCallbacks: Function[] = [];
		(plugin.app as any).workspace = {
			getLeavesOfType: vi.fn().mockReturnValue([]),
			onLayoutReady: vi.fn((cb: Function) => {
				capturedCallbacks.push(cb);
			}),
		};

		plugin.loadData = vi.fn().mockResolvedValue({
			server_url: 'https://example.com',
			username: 'testuser', password: '', session_token: 'test-token', sync_enabled: true,
			vault_id: 'vault-1',
			hash_cache: { 'existing.md': 'baseHash' },
		});

		await plugin.onload();

		// onLayoutReady가 호출되었어야 함
		expect((plugin.app as any).workspace.onLayoutReady).toHaveBeenCalled();

		// 아직 콜백이 실행되지 않았으므로 sync는 시작되지 않음
		expect(mockSyncEngine.start).not.toHaveBeenCalled();

		// 첫 번째 콜백 실행 (sync 시작 콜백)
		await capturedCallbacks[0]();

		// 이제 sync가 시작되어야 함
		expect(mockSyncEngine.start).toHaveBeenCalled();
		expect(mockSyncEngine.performInitialSync).toHaveBeenCalled();
	});

	it('onLayoutReady 전에는 vault 이벤트 리스너가 등록되지 않아야 한다', async () => {
		// onLayoutReady mock: 콜백을 보류 (실행하지 않음)
		(plugin.app as any).workspace = {
			getLeavesOfType: vi.fn().mockReturnValue([]),
			onLayoutReady: vi.fn(() => {
				// 콜백을 저장하지 않음 - 즉시 실행하지 않음
			}),
		};

		plugin.loadData = vi.fn().mockResolvedValue({
			server_url: 'https://example.com',
			username: 'testuser', password: '', session_token: 'test-token', sync_enabled: true,
			vault_id: 'vault-1',
		});

		await plugin.onload();

		// 아직 vault 이벤트 리스너가 등록되지 않았어야 함
		// (SyncEngine.start가 아직 호출되지 않았으므로)
		expect(mockSyncEngine.start).not.toHaveBeenCalled();
	});

	it('설정이 구성되지 않은 경우 onLayoutReady를 호출하지 않아야 한다', async () => {
		(plugin.app as any).workspace = {
			getLeavesOfType: vi.fn().mockReturnValue([]),
			onLayoutReady: vi.fn(),
		};

		plugin.loadData = vi.fn().mockResolvedValue(null);
		await plugin.onload();

		expect((plugin.app as any).workspace.onLayoutReady).not.toHaveBeenCalled();
	});

	it('복원된 오프라인 큐도 onLayoutReady 이후에 flush해야 한다', async () => {
		const capturedCallbacks: Function[] = [];
		(plugin.app as any).workspace = {
			getLeavesOfType: vi.fn().mockReturnValue([]),
			onLayoutReady: vi.fn((cb: Function) => {
				capturedCallbacks.push(cb);
			}),
		};

		plugin.loadData = vi.fn().mockResolvedValue({
			server_url: 'https://example.com',
			username: 'testuser', password: '', session_token: 'test-token', sync_enabled: true,
			vault_id: 'vault-1',
			__offlineQueue: [
				{
					file_path: 'queued.md',
					content: 'queued content',
					operation: 'upload',
					timestamp: Date.now(),
					retryCount: 0,
				},
			],
		});

		await plugin.onload();

		// onLayoutReady 전에는 flush가 호출되지 않아야 함
		expect(mockSyncEngine.flushOfflineQueue).not.toHaveBeenCalled();

		// 첫 번째 콜백 실행 (sync 시작 콜백에 flush 로직 포함)
		await capturedCallbacks[0]();

		// 이제 flush가 호출되어야 함
		expect(mockSyncEngine.flushOfflineQueue).toHaveBeenCalled();
	});
});

// ============================================================
// 마일스톤 3: REQ-API-002 fileManager.renameFile
// ============================================================

describe('SPEC-OBSIDIAN-API-GAP-001: REQ-API-002 fileManager.renameFile', () => {
	let plugin: VSyncPlugin;

	beforeEach(() => {
		vi.clearAllMocks();
		capturedVaultAdapter = null;
		plugin = new (VSyncPlugin as any)();
	});

	it('renameFile이 app.fileManager.renameFile을 호출해야 한다', async () => {
		const mockFile = { path: 'notes/old.md' };
		(plugin.app.vault.getAbstractFileByPath as any).mockImplementation((path: string) => {
			if (path === 'notes/old.md') return mockFile;
			return null;
		});

		// fileManager mock 설정
		(plugin.app as any).fileManager = {
			renameFile: vi.fn().mockResolvedValue(undefined),
		};

		plugin.loadData = vi.fn().mockResolvedValue({
			server_url: 'https://example.com',
			username: 'testuser', password: '', session_token: 'test-token', sync_enabled: true,
			vault_id: 'vault-1',
		});

		await plugin.onload();

		await capturedVaultAdapter.renameFile('notes/old.md', 'notes/new.md');

		expect((plugin.app as any).fileManager.renameFile).toHaveBeenCalledWith(
			mockFile,
			'notes/new.md'
		);
	});

	it('renameFile: 파일이 없으면 에러 없이 무시해야 한다', async () => {
		(plugin.app.vault.getAbstractFileByPath as any).mockReturnValue(null);
		(plugin.app as any).fileManager = {
			renameFile: vi.fn().mockResolvedValue(undefined),
		};

		plugin.loadData = vi.fn().mockResolvedValue({
			server_url: 'https://example.com',
			username: 'testuser', password: '', session_token: 'test-token', sync_enabled: true,
			vault_id: 'vault-1',
		});

		await plugin.onload();

		// 파일이 없어도 에러가 발생하지 않아야 함
		await capturedVaultAdapter.renameFile('notes/missing.md', 'notes/new.md');

		expect((plugin.app as any).fileManager.renameFile).not.toHaveBeenCalled();
	});

	it('renameFile: fileManager가 없으면 vault.rename으로 폴백해야 한다', async () => {
		const mockFile = { path: 'notes/old.md' };
		(plugin.app.vault.getAbstractFileByPath as any).mockImplementation((path: string) => {
			if (path === 'notes/old.md') return mockFile;
			return null;
		});
		plugin.app.vault.rename = vi.fn().mockResolvedValue(undefined);
		// fileManager 없음
		(plugin.app as any).fileManager = undefined;

		plugin.loadData = vi.fn().mockResolvedValue({
			server_url: 'https://example.com',
			username: 'testuser', password: '', session_token: 'test-token', sync_enabled: true,
			vault_id: 'vault-1',
		});

		await plugin.onload();

		await capturedVaultAdapter.renameFile('notes/old.md', 'notes/new.md');

		expect(plugin.app.vault.rename).toHaveBeenCalledWith(mockFile, 'notes/new.md');
	});
});

// ============================================================
// 마일스톤 4: REQ-API-003 vault.process 원자적 연산
// ============================================================

describe('SPEC-OBSIDIAN-API-GAP-001: REQ-API-003 vault.process 원자적 연산', () => {
	let plugin: VSyncPlugin;

	beforeEach(() => {
		vi.clearAllMocks();
		capturedVaultAdapter = null;
		plugin = new (VSyncPlugin as any)();
	});

	it('process가 vault.process를 호출하여 원자적 read-modify-write를 수행해야 한다', async () => {
		const mockFile = { path: 'notes/test.md' };
		(plugin.app.vault.getAbstractFileByPath as any).mockReturnValue(mockFile);

		// vault.process mock: 콜백에 현재 내용을 전달하고 반환값으로 갱신
		(plugin.app.vault as any).process = vi.fn().mockImplementation(async (
			_file: any,
			fn: (data: string) => string | null
		) => {
			const result = fn('original content');
			return result;
		});

		plugin.loadData = vi.fn().mockResolvedValue({
			server_url: 'https://example.com',
			username: 'testuser', password: '', session_token: 'test-token', sync_enabled: true,
			vault_id: 'vault-1',
		});

		await plugin.onload();

		const result = await capturedVaultAdapter.process('notes/test.md', (content: string) => {
			return content.toUpperCase();
		});

		expect((plugin.app.vault as any).process).toHaveBeenCalledWith(
			mockFile,
			expect.any(Function)
		);
		expect(result).toBe('ORIGINAL CONTENT');
	});

	it('process: 파일이 없으면 null을 반환해야 한다', async () => {
		(plugin.app.vault.getAbstractFileByPath as any).mockReturnValue(null);

		plugin.loadData = vi.fn().mockResolvedValue({
			server_url: 'https://example.com',
			username: 'testuser', password: '', session_token: 'test-token', sync_enabled: true,
			vault_id: 'vault-1',
		});

		await plugin.onload();

		const result = await capturedVaultAdapter.process('notes/missing.md', (content: string) => {
			return content.toUpperCase();
		});

		expect(result).toBeNull();
	});

	it('process: vault.process가 없으면 read+write로 폴백해야 한다', async () => {
		const mockFile = { path: 'notes/test.md' };
		(plugin.app.vault.getAbstractFileByPath as any).mockReturnValue(mockFile);
		plugin.app.vault.read = vi.fn().mockResolvedValue('fallback content');
		plugin.app.vault.modify = vi.fn().mockResolvedValue(undefined);
		// vault.process 없음
		(plugin.app.vault as any).process = undefined;

		plugin.loadData = vi.fn().mockResolvedValue({
			server_url: 'https://example.com',
			username: 'testuser', password: '', session_token: 'test-token', sync_enabled: true,
			vault_id: 'vault-1',
		});

		await plugin.onload();

		const result = await capturedVaultAdapter.process('notes/test.md', (content: string) => {
			return content.toUpperCase();
		});

		expect(plugin.app.vault.read).toHaveBeenCalledWith(mockFile);
		expect(plugin.app.vault.modify).toHaveBeenCalledWith(mockFile, 'FALLBACK CONTENT');
		expect(result).toBe('FALLBACK CONTENT');
	});
});

// ============================================================
// 마일스톤 5: REQ-API-004 vault.trash
// ============================================================

describe('SPEC-OBSIDIAN-API-GAP-001: REQ-API-004 vault.trash 복구 가능한 삭제', () => {
	let plugin: VSyncPlugin;

	beforeEach(() => {
		vi.clearAllMocks();
		capturedVaultAdapter = null;
		plugin = new (VSyncPlugin as any)();
	});

	it('delete가 vault.trash(file, true)를 호출해야 한다', async () => {
		const mockFile = { path: 'delete.md' };
		(plugin.app.vault.getAbstractFileByPath as any).mockReturnValue(mockFile);
		(plugin.app.vault as any).trash = vi.fn().mockResolvedValue(undefined);

		plugin.loadData = vi.fn().mockResolvedValue({
			server_url: 'https://example.com',
			username: 'testuser', password: '', session_token: 'test-token', sync_enabled: true,
			vault_id: 'vault-1',
		});

		await plugin.onload();

		await capturedVaultAdapter.delete('delete.md');

		expect((plugin.app.vault as any).trash).toHaveBeenCalledWith(mockFile, true);
		// 기존 vault.delete는 호출되지 않아야 함
		expect(plugin.app.vault.delete).not.toHaveBeenCalled();
	});

	it('delete: vault.trash가 없으면 vault.delete로 폴백해야 한다', async () => {
		const mockFile = { path: 'delete.md' };
		(plugin.app.vault.getAbstractFileByPath as any).mockReturnValue(mockFile);
		(plugin.app.vault as any).trash = undefined;
		plugin.app.vault.delete = vi.fn().mockResolvedValue(undefined);

		plugin.loadData = vi.fn().mockResolvedValue({
			server_url: 'https://example.com',
			username: 'testuser', password: '', session_token: 'test-token', sync_enabled: true,
			vault_id: 'vault-1',
		});

		await plugin.onload();

		await capturedVaultAdapter.delete('delete.md');

		expect(plugin.app.vault.delete).toHaveBeenCalledWith(mockFile);
	});

	it('delete: 파일이 없으면 아무것도 하지 않아야 한다', async () => {
		(plugin.app.vault.getAbstractFileByPath as any).mockReturnValue(null);
		(plugin.app.vault as any).trash = vi.fn().mockResolvedValue(undefined);

		plugin.loadData = vi.fn().mockResolvedValue({
			server_url: 'https://example.com',
			username: 'testuser', password: '', session_token: 'test-token', sync_enabled: true,
			vault_id: 'vault-1',
		});

		await plugin.onload();

		await capturedVaultAdapter.delete('missing.md');

		expect((plugin.app.vault as any).trash).not.toHaveBeenCalled();
		expect(plugin.app.vault.delete).not.toHaveBeenCalled();
	});
});

// ============================================================
// 마일스톤 6: REQ-API-005 vault.cachedRead
// ============================================================

describe('SPEC-OBSIDIAN-API-GAP-001: REQ-API-005 vault.cachedRead 캐시 활용', () => {
	let plugin: VSyncPlugin;

	beforeEach(() => {
		vi.clearAllMocks();
		capturedVaultAdapter = null;
		plugin = new (VSyncPlugin as any)();
	});

	it('cachedRead가 vault.cachedRead를 호출해야 한다', async () => {
		const mockFile = { path: 'notes/test.md' };
		(plugin.app.vault.getAbstractFileByPath as any).mockReturnValue(mockFile);
		(plugin.app.vault as any).cachedRead = vi.fn().mockResolvedValue('cached content');

		plugin.loadData = vi.fn().mockResolvedValue({
			server_url: 'https://example.com',
			username: 'testuser', password: '', session_token: 'test-token', sync_enabled: true,
			vault_id: 'vault-1',
		});

		await plugin.onload();

		const result = await capturedVaultAdapter.cachedRead('notes/test.md');

		expect((plugin.app.vault as any).cachedRead).toHaveBeenCalledWith(mockFile);
		expect(result).toBe('cached content');
	});

	it('cachedRead: 파일이 없으면 null을 반환해야 한다', async () => {
		(plugin.app.vault.getAbstractFileByPath as any).mockReturnValue(null);
		(plugin.app.vault as any).cachedRead = vi.fn();

		plugin.loadData = vi.fn().mockResolvedValue({
			server_url: 'https://example.com',
			username: 'testuser', password: '', session_token: 'test-token', sync_enabled: true,
			vault_id: 'vault-1',
		});

		await plugin.onload();

		const result = await capturedVaultAdapter.cachedRead('notes/missing.md');

		expect(result).toBeNull();
		expect((plugin.app.vault as any).cachedRead).not.toHaveBeenCalled();
	});

	it('cachedRead: vault.cachedRead가 없으면 vault.read로 폴백해야 한다', async () => {
		const mockFile = { path: 'notes/test.md' };
		(plugin.app.vault.getAbstractFileByPath as any).mockReturnValue(mockFile);
		plugin.app.vault.read = vi.fn().mockResolvedValue('fallback read content');
		// cachedRead 없음
		(plugin.app.vault as any).cachedRead = undefined;

		plugin.loadData = vi.fn().mockResolvedValue({
			server_url: 'https://example.com',
			username: 'testuser', password: '', session_token: 'test-token', sync_enabled: true,
			vault_id: 'vault-1',
		});

		await plugin.onload();

		const result = await capturedVaultAdapter.cachedRead('notes/test.md');

		expect(plugin.app.vault.read).toHaveBeenCalledWith(mockFile);
		expect(result).toBe('fallback read content');
	});

	it('cachedRead: 읽기 실패 시 null을 반환해야 한다', async () => {
		const mockFile = { path: 'notes/error.md' };
		(plugin.app.vault.getAbstractFileByPath as any).mockReturnValue(mockFile);
		(plugin.app.vault as any).cachedRead = vi.fn().mockRejectedValue(new Error('Read error'));

		plugin.loadData = vi.fn().mockResolvedValue({
			server_url: 'https://example.com',
			username: 'testuser', password: '', session_token: 'test-token', sync_enabled: true,
			vault_id: 'vault-1',
		});

		await plugin.onload();

		const result = await capturedVaultAdapter.cachedRead('notes/error.md');

		expect(result).toBeNull();
	});
});
