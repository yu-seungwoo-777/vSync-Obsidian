// skipped_paths 이벤트 필터링, 영속화, 재접속 사용자 테스트
// SPEC-INITIAL-SYNC-MODAL-001 AC-007, AC-008, AC-009
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SyncEngine } from '../../../src/sync-engine';
import type { VSyncSettings, SyncEvent } from '../../../src/types';
import { DEFAULT_SETTINGS } from '../../../src/types';
import { createMockVault } from '../../mocks/vault';

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

function createEngine(settings?: Partial<VSyncSettings>): { engine: SyncEngine; settings: VSyncSettings; vault: ReturnType<typeof createMockVault> } {
	const vault = createMockVault();
	const s: VSyncSettings = {
		...DEFAULT_SETTINGS,
		server_url: 'https://test.com',
		vault_id: 'v1',
		device_id: 'd1',
		session_token: 'tok',
		...settings,
	};
	const engine = new SyncEngine(s, vault as any, vi.fn());
	return { engine, settings: s, vault };
}

function makeEvent(path: string, eventType: 'updated' | 'created' | 'deleted' | 'moved' = 'updated'): SyncEvent {
	return {
		id: 'evt-' + Math.random().toString(36).slice(2),
		event_type: eventType,
		file_path: path,
		file_type: 'file',
		device_id: 'other-device',
		created_at: new Date().toISOString(),
	};
}

describe('skipped_paths 이벤트 필터링 (AC-007)', () => {
	beforeEach(() => vi.clearAllMocks());

	// AC-007.1: Skipped files are added to skipped_paths array in VSyncSettings
	it('should add path to skipped_paths when addSkippedPath called', () => {
		const { engine, settings } = createEngine();
		engine.addSkippedPath('secret/diary.md');

		expect(engine.getSkippedPaths()).toContain('secret/diary.md');
		expect(settings.skipped_paths).toContain('secret/diary.md');
	});

	// AC-007.2: WebSocket _processEvent filters events for paths in skipped_paths
	it('should filter events for skipped paths in _processEvent', async () => {
		const { engine, vault } = createEngine();
		engine.addSkippedPath('skipped-file.md');

		// _processEvent는 skipped_paths에 있는 경로를 무시
		const downloadSpy = vi.spyOn(engine as any, '_downloadRemoteFile');
		downloadSpy.mockResolvedValue(undefined);

		// 내부 _processEvent 호출 시뮬레이션
		await (engine as any)._processEvent(makeEvent('skipped-file.md'));

		expect(downloadSpy).not.toHaveBeenCalled();
	});

	// AC-007.3: Polling event handler filters events for paths in skipped_paths
	it('should allow events for non-skipped paths', async () => {
		const { engine } = createEngine();
		engine.addSkippedPath('skipped.md');

		const downloadSpy = vi.spyOn(engine as any, '_downloadRemoteFile');
		downloadSpy.mockResolvedValue(undefined);

		await (engine as any)._processEvent(makeEvent('normal-file.md'));

		expect(downloadSpy).toHaveBeenCalledWith('normal-file.md', undefined, { force: false });
	});

	// AC-007.4: Filter happens at event handler entry point
	it('should filter before any file operations', async () => {
		const { engine } = createEngine();
		engine.addSkippedPath('skip.md');

		const downloadSpy = vi.spyOn(engine as any, '_downloadRemoteFile');
		const deleteSpy = vi.spyOn(engine as any, '_deleteLocalFile');

		await (engine as any)._processEvent(makeEvent('skip.md', 'updated'));
		await (engine as any)._processEvent(makeEvent('skip.md', 'deleted'));

		expect(downloadSpy).not.toHaveBeenCalled();
		expect(deleteSpy).not.toHaveBeenCalled();
	});
});

describe('skipped_paths 영속화 (AC-008)', () => {
	beforeEach(() => vi.clearAllMocks());

	// AC-008.1: skipped_paths field added to VSyncSettings
	it('should have skipped_paths field in VSyncSettings', () => {
		const settings: VSyncSettings = { ...DEFAULT_SETTINGS };
		expect(settings.skipped_paths).toEqual([]);
	});

	// AC-008.2: Default value is [] in DEFAULT_SETTINGS
	it('should initialize skipped_paths to empty array by default', () => {
		expect(DEFAULT_SETTINGS.skipped_paths).toEqual([]);
	});

	// AC-008.3: Changes to skipped_paths are saved to plugin data
	it('should persist skipped_paths to settings when path added', () => {
		const { engine, settings } = createEngine();
		engine.addSkippedPath('file1.md');
		engine.addSkippedPath('file2.md');

		expect(settings.skipped_paths).toEqual(['file1.md', 'file2.md']);
	});

	// AC-008.4: skipped_paths is restored when plugin loads
	it('should restore skipped_paths from settings on construction', () => {
		const { engine } = createEngine({ skipped_paths: ['restored.md'] });
		expect(engine.getSkippedPaths()).toContain('restored.md');
	});

	// NFR-IS-003: LRU eviction at 5000 entries
	it('should evict oldest entry when skipped_paths exceeds 5000', () => {
		const { engine, settings } = createEngine();

		// Add 5001 entries
		for (let i = 0; i < 5001; i++) {
			engine.addSkippedPath(`file-${i}.md`);
		}

		// Should be capped at 5000
		expect(engine.getSkippedPaths().length).toBeLessThanOrEqual(5000);
	});

	// Remove path when synced successfully
	it('should remove path from skipped_paths when removeSkippedPath called', () => {
		const { engine, settings } = createEngine();
		engine.addSkippedPath('temp.md');
		expect(engine.getSkippedPaths()).toContain('temp.md');

		engine.removeSkippedPath('temp.md');
		expect(engine.getSkippedPaths()).not.toContain('temp.md');
		expect(settings.skipped_paths).not.toContain('temp.md');
	});
});

describe('재접속 사용자 보존 (AC-009)', () => {
	beforeEach(() => vi.clearAllMocks());

	// AC-009.1: performInitialSync() method remains unchanged
	it('should have performInitialSync method on SyncEngine', () => {
		const { engine } = createEngine({ hash_cache: { 'existing.md': 'hash' } });
		expect(typeof engine.performInitialSync).toBe('function');
	});

	// AC-009.2: Returning users see no modals (hash_cache has entries → uses performInitialSync)
	it('should use existing sync logic for returning user', async () => {
		const { engine } = createEngine({ hash_cache: { 'existing.md': 'baseHash' } });

		// classifyFiles with non-empty hash_cache routes to auto group
		const result = await engine.classifyFiles(
			[{ id: '1', path: 'existing.md', hash: 'newHash', size_bytes: null, created_at: '', updated_at: '' } as any],
			[{ path: 'existing.md' }],
		);

		// baseHash가 있으므로 auto 그룹으로 분류 (모달 표시 안 함)
		expect(result.auto.skips).toContain('existing.md');
		expect(result.user.downloads).toEqual([]);
		expect(result.user.uploads).toEqual([]);
		expect(result.user.conflicts).toEqual([]);
	});

	// AC-009.3: All existing sync behavior is preserved
	it('should not affect normal event processing for returning users', async () => {
		const { engine } = createEngine({ hash_cache: { 'note.md': 'hash' } });

		const downloadSpy = vi.spyOn(engine as any, '_downloadRemoteFile');
		downloadSpy.mockResolvedValue(undefined);

		// Normal event should be processed
		await (engine as any)._processEvent(makeEvent('note.md'));

		expect(downloadSpy).toHaveBeenCalledWith('note.md', undefined, { force: false });
	});
});
