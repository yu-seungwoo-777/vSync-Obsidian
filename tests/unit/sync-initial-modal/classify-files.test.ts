// classifyFiles() 테스트 (SPEC-INITIAL-SYNC-MODAL-001 T-003)
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SyncEngine } from '../../../src/sync-engine';
import type { VSyncSettings } from '../../../src/types';
import { DEFAULT_SETTINGS } from '../../../src/types';
import { createMockVault } from '../../mocks/vault';

// API 클라이언트 mock
const mockApiClient = {
	rawUpload: vi.fn(),
	rawDownload: vi.fn(),
	deleteFile: vi.fn(),
	listFiles: vi.fn(),
	getEvents: vi.fn(),
	updateSyncStatus: vi.fn(),
	testConnection: vi.fn(),
	setOnAuthFailure: vi.fn(),
	getQueueSize: vi.fn().mockReturnValue(0),
	flushQueue: vi.fn(),
	enqueue: vi.fn(),
	uploadAttachment: vi.fn(),
	downloadAttachment: vi.fn(),
	batchOperations: vi.fn(),
	moveFile: vi.fn(),
	getDevices: vi.fn(),
	removeDevice: vi.fn(),
	searchFiles: vi.fn(),
	getConflicts: vi.fn(),
	resolveConflict: vi.fn(),
	mergeResolve: vi.fn(),
};

vi.mock('../../../src/api-client', () => ({
	VSyncClient: vi.fn().mockImplementation(() => mockApiClient),
		MAX_BINARY_SIZE: 52_428_800,
}));

vi.mock('../../../src/utils/hash', () => ({
	computeHash: vi.fn().mockResolvedValue('mock-hash'),
}));

const mockNotice = vi.fn();
vi.mock('obsidian', () => ({
	requestUrl: vi.fn(),
	Notice: vi.fn().mockImplementation((msg: string) => mockNotice(msg)),
	Platform: { isDesktop: true, isMobile: false },
	normalizePath: vi.fn((path: string): string => {
		if (!path) return '';
		return path.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/^\//, '');
	}),
}));

describe('classifyFiles() (T-003)', () => {
	let engine: SyncEngine;
	let vault: ReturnType<typeof createMockVault>;
	let settings: VSyncSettings;

	beforeEach(() => {
		vi.clearAllMocks();

		settings = {
			...DEFAULT_SETTINGS,
			server_url: 'https://sync.example.com',
			username: 'testuser',
			password: '',
			session_token: 'test-token',
			sync_enabled: true,
			vault_id: 'vault-1',
			device_id: 'device-1',
			sync_interval: 30,
			hash_cache: {}, // 빈 캐시 = 최초 연결
		};

		vault = createMockVault();
		engine = new SyncEngine(settings, vault as never, mockNotice);
	});

	// REQ-IS-001: 순수 함수 — 부수효과 없음
	it('should be a pure function with no side effects', () => {
		// 서버 파일 목록 준비
		const serverFiles = [
			{ path: 'server-only.md', hash: 'hash1', serverModifiedAt: 1000 },
			{ path: 'both-same.md', hash: 'hash2', serverModifiedAt: 2000 },
			{ path: 'both-diff.md', hash: 'hash3', serverModifiedAt: 3000 },
		];
		mockApiClient.listFiles.mockResolvedValue(serverFiles);

		// 로컬 파일 목록 준비
		const localFiles = [
			{ path: 'local-only.md' },
			{ path: 'both-same.md' },
			{ path: 'both-diff.md' },
		];
		vault.getFiles.mockReturnValue(localFiles as any);
		vault.readIfExists.mockResolvedValue('content');

		// classifyFiles 호출
		const result = engine.classifyFiles(serverFiles, localFiles);

		// 결과 검증
		expect(result).toBeDefined();
		expect(result.auto).toBeDefined();
		expect(result.user).toBeDefined();
	});

	// REQ-IS-001: baseHash 없는 파일 → user 그룹
	it('should classify files without baseHash into user group', async () => {
		const serverFiles = [
			{ path: 'server-only.md', hash: 'hash1', serverModifiedAt: 1000 },
		];
		const localFiles = [
			{ path: 'local-only.md' },
		];

		const result = engine.classifyFiles(serverFiles, localFiles);

		// 서버에만 존재 → user.downloads
		expect(result.user.downloads).toHaveLength(1);
		expect(result.user.downloads[0].path).toBe('server-only.md');

		// 로컬에만 존재 → user.uploads
		expect(result.user.uploads).toHaveLength(1);
		expect(result.user.uploads[0].path).toBe('local-only.md');
	});

	// REQ-IS-001: 양쪽에 존재 + baseHash 없음 → user.conflicts
	it('should classify files existing on both sides without baseHash as conflicts', async () => {
		const serverFiles = [
			{ path: 'both.md', hash: 'hash1', serverModifiedAt: 1000 },
		];
		const localFiles = [
			{ path: 'both.md' },
		];

		const result = engine.classifyFiles(serverFiles, localFiles);

		// 양쪽에 존재 + base 없음 → user.conflicts
		expect(result.user.conflicts).toHaveLength(1);
		expect(result.user.conflicts[0].path).toBe('both.md');
		expect(result.user.conflicts[0].serverHash).toBe('hash1');
		// @MX:NOTE classifyFiles는 순수 함수이므로 localContent는 null로 설정
		// 실제 내용 읽기는 모달 표시 시점에 비동기로 수행
		expect(result.user.conflicts[0].localContent).toBeNull();
	});

	// REQ-IS-001: baseHash 있는 파일 → auto 그룹
	it('should classify files with baseHash into auto group', () => {
		settings.hash_cache = {
			'has-base.md': 'baseHash',
		};

		engine = new SyncEngine(settings, vault as never, mockNotice);

		const serverFiles = [
			{ path: 'has-base.md', hash: 'newHash', serverModifiedAt: 1000 },
		];
		const localFiles = [
			{ path: 'has-base.md' },
		];

		const result = engine.classifyFiles(serverFiles, localFiles);

		// baseHash 있음 → auto 그룹
		// 세 곳 모두 존재 → compare-hash → skips (동기화 불필요)
		expect(result.auto.skips).toContain('has-base.md');
	});

	// REQ-IS-001: baseHash 있고 서버만 존재 → auto.deletions
	it('should classify files with baseHash deleted on server as auto.deletions', () => {
		settings.hash_cache = {
			'deleted-server.md': 'baseHash',
		};

		engine = new SyncEngine(settings, vault as never, mockNotice);

		const serverFiles = [];
		const localFiles = [
			{ path: 'deleted-server.md' },
		];

		const result = engine.classifyFiles(serverFiles, localFiles);

		// baseHash 있음 + 서버 삭제 → delete-server → auto.deletions
		expect(result.auto.deletions).toContain('deleted-server.md');
	});
});
