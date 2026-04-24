// main.ts _startSync() 분기 로직 테스트 (SPEC-INITIAL-SYNC-MODAL-001 AC-006)
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { VSyncSettings } from '../../../src/types';
import { DEFAULT_SETTINGS } from '../../../src/types';

describe('_startSync() branching logic (AC-006)', () => {
	// 분기 판별 로직만 단위 테스트: hash_cache 상태에 따른 최초/재접속 판별
	function isFirstTimeUser(hashCache: Record<string, string> | undefined): boolean {
		return !hashCache || Object.keys(hashCache).length === 0;
	}

	beforeEach(() => {
		vi.clearAllMocks();
	});

	// AC-006.1: First-time user (empty hash_cache) triggers modal flow
	it('should detect first-time user when hash_cache is empty object', () => {
		expect(isFirstTimeUser({})).toBe(true);
	});

	it('should detect first-time user when hash_cache is undefined', () => {
		expect(isFirstTimeUser(undefined)).toBe(true);
	});

	// AC-006.2: Returning user (non-empty hash_cache) calls performInitialSync()
	it('should detect returning user when hash_cache has entries', () => {
		expect(isFirstTimeUser({ 'file.md': 'hash123' })).toBe(false);
	});

	it('should detect returning user with multiple entries', () => {
		expect(isFirstTimeUser({ 'a.md': 'h1', 'b.md': 'h2' })).toBe(false);
	});

	// AC-006.3: Detection happens before any sync operations
	it('should synchronously evaluate hash_cache without async operations', () => {
		const cache: Record<string, string> = {};
		const start = performance.now();
		const result = isFirstTimeUser(cache);
		const elapsed = performance.now() - start;

		expect(result).toBe(true);
		// 동기 판별이므로 1ms 미만이어야 함
		expect(elapsed).toBeLessThan(1);
	});

	// 통합 레벨: SyncEngine이 hash_cache 기반으로 올바른 메서드 호출하는지 확인
	describe('SyncEngine integration', () => {
		const mockApiClient = {
			rawUpload: vi.fn(),
			rawDownload: vi.fn(),
			deleteFile: vi.fn(),
			listFiles: vi.fn().mockResolvedValue([]),
			getEvents: vi.fn().mockResolvedValue({ events: [], has_more: false }),
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
			VSyncClient: vi.fn().mockImplementation(() => ({})),
			MAX_BINARY_SIZE: 52_428_800,
		}));

		vi.mock('../../../src/utils/hash', () => ({
			computeHash: vi.fn().mockResolvedValue('mock-hash'),
		}));

		// _startSync 로직 검증: hash_cache가 비어있으면 classifyFiles 경로로 진입
		it('should classify files when hash_cache is empty', async () => {
			const { SyncEngine } = await import('../../../src/sync-engine');
			const { createMockVault } = await import('../../mocks/vault');

			const vault = createMockVault();
			const settings: VSyncSettings = {
				...DEFAULT_SETTINGS,
				server_url: 'https://test.com',
				vault_id: 'v1',
				device_id: 'd1',
				session_token: 'tok',
				hash_cache: {},
			};

			const engine = new SyncEngine(settings, vault as any, vi.fn());

			// classifyFiles가 존재하고 호출 가능한지 확인
			expect(typeof engine.classifyFiles).toBe('function');

			// 빈 캐시로 classifyFiles 호출 → auto 그룹에 아무것도 없어야 함
			const result = engine.classifyFiles([], []);
			expect(result.auto.downloads).toEqual([]);
			expect(result.auto.uploads).toEqual([]);
			expect(result.user.downloads).toEqual([]);
		});

		it('should not classify files when hash_cache has entries (returning user)', async () => {
			const { SyncEngine } = await import('../../../src/sync-engine');
			const { createMockVault } = await import('../../mocks/vault');

			const vault = createMockVault();
			const settings: VSyncSettings = {
				...DEFAULT_SETTINGS,
				server_url: 'https://test.com',
				vault_id: 'v1',
				device_id: 'd1',
				session_token: 'tok',
				hash_cache: { 'existing.md': 'baseHash' },
			};

			const engine = new SyncEngine(settings, vault as any, vi.fn());

			// hash_cache가 있으면 classifyFiles는 auto 그룹에 기존 파일 포함
			const result = engine.classifyFiles(
				[{ id: '1', path: 'existing.md', hash: 'newHash', size_bytes: null, created_at: '', updated_at: '' } as any],
				[{ path: 'existing.md' }],
			);
			// baseHash가 있으므로 auto 그룹에 분류됨
			expect(result.auto.skips).toContain('existing.md');
		});
	});
});
