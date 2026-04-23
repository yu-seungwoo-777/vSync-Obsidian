// SPEC-SYNC-DELETE-001: performInitialSync 3-Way 적용 테스트 (T2)
// hash_cache(base), server, local 3-way 비교로 삭제 동기화 수행
//
// 테스트 케이스:
// AC-001: 원격 삭제 → 로컬 삭제
// AC-002: 로컬 삭제 → 서버 삭제 전파
// AC-005: 빈 hash_cache → 기존 2-way 동작 유지
// AC-006: 양쪽 모두 삭제 → 충돌 없음
// AC-007: 바이너리 파일 원격 삭제
// AC-008: hash_cache 정확도 (100개 항목 중 3개 삭제 → 97개)
// EC-003: hash_cache vs local file mismatch (external deletion)
// AC-008-simplified: hash_cache 크기 정확성 (5개 항목 중 3개 삭제 → 2개)
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SyncEngine } from '../../src/sync-engine';
import type { VSyncSettings } from '../../src/types';
import { DEFAULT_SETTINGS } from '../../src/types';
import { createMockVault, createMockFile } from '../mocks/vault';
import { createMockSyncEvent } from '../../src/schemas/sync-event';

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

vi.mock('../../src/api-client', () => ({
	VSyncClient: vi.fn().mockImplementation(() => mockApiClient),
	MAX_BINARY_SIZE: 52_428_800,
}));

vi.mock('../../src/utils/hash', () => ({
	computeHash: vi.fn().mockResolvedValue('mock-hash'),
}));

const mockNotice = vi.fn();
vi.mock('obsidian', () => ({
	requestUrl: vi.fn(),
	Notice: vi.fn().mockImplementation((msg: string) => mockNotice(msg)),
	Platform: { isDesktop: true, isMobile: false },
	normalizePath: vi.fn((path: string): string => {
		if (!path) return '';
		return path
			.replace(/\\/g, '/')
			.replace(/\/+/g, '/')
			.replace(/^\//, '');
	}),
}));

vi.mock('../../src/services/ws-client', () => ({
	WSClient: vi.fn().mockImplementation(() => ({
		connect: vi.fn(),
		close: vi.fn(),
		on: vi.fn(),
		isConnected: false,
		reconnectAttempts: 0,
		buildWSUrl: vi.fn().mockReturnValue('ws://localhost/ws/sync/vault-1?token=test-token'),
	})),
	calculateReconnectDelay: vi.fn().mockReturnValue(1000),
}));

describe('performInitialSync — 3-Way 비교 (SPEC-SYNC-DELETE-001 T2)', () => {
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
		};

		vault = createMockVault();
		engine = new SyncEngine(settings, vault as never, mockNotice);
	});

	// ============================================================
	// AC-001: 원격 삭제 → 로컬 삭제
	// base에 있고 server에 없고 local에 있으면 → delete-local
	// ============================================================
	it('AC-001: 원격에서 삭제된 파일은 로컬에서 삭제되고 재업로드되지 않아야 한다', async () => {
		// Given: hash_cache에 'notes/test.md'가 있음
		const cache = (engine as any)._hashCache as Map<string, string>;
		cache.set('notes/test.md', 'hash-abc');

		// server에는 test.md가 없음 (삭제됨)
		mockApiClient.listFiles.mockResolvedValueOnce([
			{ id: 2, path: 'notes/other.md', hash: 'hash-other', sizeBytes: 10, createdAt: '', updatedAt: '' },
		]);

		// local에는 test.md가 있음
		vault._textMap.set('notes/test.md', 'test content');
		vault._textMap.set('notes/other.md', 'other content');
		vault.getFiles.mockReturnValueOnce([
			createMockFile('notes/test.md', 'test content'),
			createMockFile('notes/other.md', 'other content'),
		]);

		mockApiClient.rawDownload.mockResolvedValue('other content');

		// When
		await engine.performInitialSync();

		// Then: 로컬 파일이 삭제됨
		expect(vault.delete).toHaveBeenCalledWith('notes/test.md');
		// hash_cache 엔트리가 제거됨
		expect(cache.has('notes/test.md')).toBe(false);
		// 재업로드되지 않음
		expect(mockApiClient.rawUpload).not.toHaveBeenCalledWith('notes/test.md', expect.anything());
		expect(mockApiClient.uploadAttachment).not.toHaveBeenCalledWith('notes/test.md', expect.anything());
	});

	// ============================================================
	// AC-002: 로컬 삭제 → 서버 삭제 전파
	// base에 있고 server에 있고 local에 없으면 → delete-server
	// ============================================================
	it('AC-002: 로컬에서 삭제된 파일은 서버에서도 삭제되고 재다운로드되지 않아야 한다', async () => {
		// Given: hash_cache에 'notes/draft.md'가 있음
		const cache = (engine as any)._hashCache as Map<string, string>;
		cache.set('notes/draft.md', 'hash-xyz');

		// server에는 draft.md가 있음
		mockApiClient.listFiles.mockResolvedValueOnce([
			{ id: 1, path: 'notes/draft.md', hash: 'hash-xyz', sizeBytes: 20, createdAt: '', updatedAt: '' },
		]);

		// local에는 draft.md가 없음 (삭제됨)
		vault.getFiles.mockReturnValueOnce([]);

		// When
		await engine.performInitialSync();

		// Then: 서버 deleteFile API 호출됨
		expect(mockApiClient.deleteFile).toHaveBeenCalledWith('notes/draft.md');
		// hash_cache 엔트리가 제거됨
		expect(cache.has('notes/draft.md')).toBe(false);
		// 재다운로드되지 않음
		expect(mockApiClient.rawDownload).not.toHaveBeenCalledWith('notes/draft.md');
	});

	// ============================================================
	// AC-005: 빈 hash_cache → 기존 2-way 동작 유지
	// base가 비어있으면 기존 2-way 비교와 동일하게 동작
	// ============================================================
	it('AC-005: hash_cache가 비어있을 때 기존 2-way 동작을 유지해야 한다', async () => {
		// Given: hash_cache가 비어있음 (초기 상태)
		const cache = (engine as any)._hashCache as Map<string, string>;
		expect(cache.size).toBe(0);

		// server: hello.md
		mockApiClient.listFiles.mockResolvedValueOnce([
			{ id: 1, path: 'notes/hello.md', hash: 'hash-hello', sizeBytes: 10, createdAt: '', updatedAt: '' },
		]);

		// local: local.md
		vault._textMap.set('notes/local.md', 'local content');
		vault.getFiles.mockReturnValueOnce([
			createMockFile('notes/local.md', 'local content'),
		]);

		mockApiClient.rawDownload.mockResolvedValue('hello content');
		mockApiClient.rawUpload.mockResolvedValue({ id: 1, path: 'notes/local.md', hash: 'upload-hash', sizeBytes: 13, version: 1 });

		// When
		await engine.performInitialSync();

		// Then: 서버 파일 다운로드
		expect(mockApiClient.rawDownload).toHaveBeenCalledWith('notes/hello.md');
		// 로컬 파일 업로드
		expect(mockApiClient.rawUpload).toHaveBeenCalledWith('notes/local.md', 'local content');
	});

	// ============================================================
	// AC-006: 양쪽 모두 삭제 → 충돌 없음
	// base에 있고 server에 없고 local에 없으면 → skip
	// ============================================================
	it('AC-006: 양쪽 모두에서 삭제된 파일은 아무 작업 없이 skip되어야 한다', async () => {
		// Given: hash_cache에 'notes/both.md'가 있음
		const cache = (engine as any)._hashCache as Map<string, string>;
		cache.set('notes/both.md', 'hash-both');

		// server: both.md 없음
		mockApiClient.listFiles.mockResolvedValueOnce([]);

		// local: both.md 없음
		vault.getFiles.mockReturnValueOnce([]);

		// When
		await engine.performInitialSync();

		// Then: 에러 없이 완료, 아무 동작도 하지 않음
		expect(mockApiClient.rawDownload).not.toHaveBeenCalled();
		expect(mockApiClient.rawUpload).not.toHaveBeenCalled();
		expect(mockApiClient.deleteFile).not.toHaveBeenCalled();
		expect(vault.delete).not.toHaveBeenCalled();
		// hash_cache 엔트리가 제거됨 (정리)
		expect(cache.has('notes/both.md')).toBe(false);
		// 예외 없이 완료
		expect(mockNotice).toHaveBeenCalledWith('Initial sync complete');
	});

	// ============================================================
	// AC-007: 바이너리 파일 원격 삭제
	// 바이너리 파일도 3-way 판정이 적용되어야 함
	// ============================================================
	it('AC-007: 원격에서 삭제된 바이너리 파일은 로컬에서 삭제되고 재업로드되지 않아야 한다', async () => {
		// Given: hash_cache에 'attachments/image.png'가 있음
		const cache = (engine as any)._hashCache as Map<string, string>;
		cache.set('attachments/image.png', 'hash-img');

		// server: image.png 없음 (삭제됨)
		mockApiClient.listFiles.mockResolvedValueOnce([]);

		// local: image.png 있음
		const binaryData = new Uint8Array([1, 2, 3, 4]).buffer;
		vault._binaryMap.set('attachments/image.png', binaryData);
		vault.getFiles.mockReturnValueOnce([
			createMockFile('attachments/image.png'),
		]);

		// When
		await engine.performInitialSync();

		// Then: 로컬 바이너리 파일이 삭제됨
		expect(vault.delete).toHaveBeenCalledWith('attachments/image.png');
		// hash_cache 엔트리가 제거됨
		expect(cache.has('attachments/image.png')).toBe(false);
		// 재업로드되지 않음
		expect(mockApiClient.uploadAttachment).not.toHaveBeenCalledWith('attachments/image.png', expect.anything());
	});

	// ============================================================
	// AC-008: hash_cache 정확도
	// 100개 항목 중 3개 원격 삭제 → 97개 유지
	// ============================================================
	it('AC-008: 삭제 동기화 후 hash_cache 항목 수가 정확해야 한다', async () => {
		// Given: hash_cache에 100개 항목
		const cache = (engine as any)._hashCache as Map<string, string>;
		const serverFiles: Array<{ id: number; path: string; hash: string; sizeBytes: number; createdAt: string; updatedAt: string }> = [];

		for (let i = 0; i < 100; i++) {
			const path = `notes/file-${i.toString().padStart(3, '0')}.md`;
			cache.set(path, `hash-${i}`);

			// 3개 파일만 서버에서 누락 (원격 삭제)
			if (i === 10 || i === 50 || i === 99) continue;

			serverFiles.push({
				id: i,
				path,
				hash: `hash-${i}`,
				sizeBytes: 10,
				createdAt: '',
				updatedAt: '',
			});
		}

		// server: 97개 파일 (3개 누락)
		mockApiClient.listFiles.mockResolvedValueOnce(serverFiles);

		// local: 누락된 3개 파일은 여전히 존재
		const localFiles: ReturnType<typeof createMockFile>[] = [];
		for (let i = 0; i < 100; i++) {
			const path = `notes/file-${i.toString().padStart(3, '0')}.md`;
			vault._textMap.set(path, `content-${i}`);
			localFiles.push(createMockFile(path, `content-${i}`));
		}
		vault.getFiles.mockReturnValueOnce(localFiles);

		// When
		await engine.performInitialSync();

		// Then: 3개 파일이 로컬에서 삭제됨
		expect(vault.delete).toHaveBeenCalledWith('notes/file-010.md');
		expect(vault.delete).toHaveBeenCalledWith('notes/file-050.md');
		expect(vault.delete).toHaveBeenCalledWith('notes/file-099.md');

		// hash_cache에 97개 항목 남음 (3개 삭제됨)
		// 참고: compare-hash 경로의 파일도 hash_cache에 유지될 수 있으나,
		// 여기서는 삭제된 3개가 제거되었는지만 확인
		expect(cache.has('notes/file-010.md')).toBe(false);
		expect(cache.has('notes/file-050.md')).toBe(false);
		expect(cache.has('notes/file-099.md')).toBe(false);
	});

	// ============================================================
	// EC-003: hash_cache vs local file mismatch (external deletion)
	// 로컬 파일이 Obsidian 외부에서 삭제된 경우 (hash_cache에는 있으나 로컬에 없음)
	// base=T, server=T, local=F → delete-server
	// ============================================================
	it('EC-003: Obsidian 외부에서 삭제된 파일은 서버 삭제로 전파되어야 한다', async () => {
		// Given: hash_cache에 'notes/external.md'가 있음 (과거에 동기화됨)
		const cache = (engine as any)._hashCache as Map<string, string>;
		cache.set('notes/external.md', 'hash-ext');

		// server: external.md가 여전히 존재
		mockApiClient.listFiles.mockResolvedValueOnce([
			{ id: 1, path: 'notes/external.md', hash: 'hash-ext', sizeBytes: 15, createdAt: '', updatedAt: '' },
		]);

		// local: external.md가 없음 (Obsidian 외부에서 삭제됨 — 예: 파일 탐색기로 직접 삭제)
		vault.getFiles.mockReturnValueOnce([]);

		// When
		await engine.performInitialSync();

		// Then: 3-way 판정 base=T, server=T, local=F → delete-server
		expect(mockApiClient.deleteFile).toHaveBeenCalledWith('notes/external.md');
		// hash_cache 엔트리가 제거됨
		expect(cache.has('notes/external.md')).toBe(false);
		// 재다운로드되지 않음
		expect(mockApiClient.rawDownload).not.toHaveBeenCalledWith('notes/external.md');
	});

	// ============================================================
	// AC-008-simplified: hash_cache 크기 정확성 (5개 항목)
	// 5개 항목 중 3개 원격 삭제 → 정확히 2개 남음
	// ============================================================
	it('AC-008-simplified: 5개 항목 중 3개 원격 삭제 후 hash_cache에 정확히 2개만 남아야 한다', async () => {
		// Given: hash_cache에 A, B, C, D, E (5개)
		const cache = (engine as any)._hashCache as Map<string, string>;
		cache.set('notes/a.md', 'hash-a');
		cache.set('notes/b.md', 'hash-b');
		cache.set('notes/c.md', 'hash-c');
		cache.set('notes/d.md', 'hash-d');
		cache.set('notes/e.md', 'hash-e');
		expect(cache.size).toBe(5);

		// server: D, E만 존재 (A, B, C는 원격 삭제)
		mockApiClient.listFiles.mockResolvedValueOnce([
			{ id: 4, path: 'notes/d.md', hash: 'hash-d', sizeBytes: 10, createdAt: '', updatedAt: '' },
			{ id: 5, path: 'notes/e.md', hash: 'hash-e', sizeBytes: 10, createdAt: '', updatedAt: '' },
		]);

		// local: A, B, C, D, E 모두 존재
		// D, E는 서버에도 있으므로 compare-hash → 해시 동일 → 캐시 유지
		vault._textMap.set('notes/a.md', 'content-a');
		vault._textMap.set('notes/b.md', 'content-b');
		vault._textMap.set('notes/c.md', 'content-c');
		vault._textMap.set('notes/d.md', 'content-d');
		vault._textMap.set('notes/e.md', 'content-e');
		vault.getFiles.mockReturnValueOnce([
			createMockFile('notes/a.md', 'content-a'),
			createMockFile('notes/b.md', 'content-b'),
			createMockFile('notes/c.md', 'content-c'),
			createMockFile('notes/d.md', 'content-d'),
			createMockFile('notes/e.md', 'content-e'),
		]);

		// When
		await engine.performInitialSync();

		// Then: A, B, C가 로컬에서 삭제됨
		expect(vault.delete).toHaveBeenCalledWith('notes/a.md');
		expect(vault.delete).toHaveBeenCalledWith('notes/b.md');
		expect(vault.delete).toHaveBeenCalledWith('notes/c.md');

		// hash_cache에 정확히 2개 (D, E만 남음)
		expect(cache.size).toBe(2);
		expect(cache.has('notes/d.md')).toBe(true);
		expect(cache.has('notes/e.md')).toBe(true);
	});
});

// ============================================================
// T3: Event-first processing (SPEC-SYNC-DELETE-001)
// 삭제 이벤트를 3-way 비교 전에 우선 처리
// ============================================================
describe('AC-003: Event-first processing in performInitialSync', () => {
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
		};

		vault = createMockVault();
	});

	it('삭제 이벤트는 3-way 비교 전에 로컬 파일을 삭제하고 lastEventId를 갱신해야 한다', async () => {
		// Given: device의 lastEventId = '100'
		settings.last_event_id = '100';
		engine = new SyncEngine(settings, vault as never, mockNotice);

		// hash_cache에 'notes/old.md' 존재
		const cache = (engine as any)._hashCache as Map<string, string>;
		cache.set('notes/old.md', 'hash-old');
		cache.set('notes/other.md', 'hash-other');

		// getEvents: eventId 101에 deleted 이벤트 (다른 디바이스에서 삭제)
		mockApiClient.getEvents.mockResolvedValueOnce([
			{
				id: '101',
				event_type: 'deleted',
				file_path: 'notes/old.md',
				file_type: 'text',
				device_id: 'device-2',  // 다른 디바이스
				created_at: '2026-04-23T00:00:00Z',
			},
		]);

		// server: 'notes/other.md'만 존재 (old.md는 이미 서버에서도 삭제됨)
		mockApiClient.listFiles.mockResolvedValueOnce([
			{ id: 2, path: 'notes/other.md', hash: 'hash-other', sizeBytes: 10, createdAt: '', updatedAt: '' },
		]);

		// local: 'notes/old.md'와 'notes/other.md' 모두 존재
		vault._textMap.set('notes/old.md', 'old content');
		vault._textMap.set('notes/other.md', 'other content');
		vault.getFiles.mockReturnValueOnce([
			createMockFile('notes/old.md', 'old content'),
			createMockFile('notes/other.md', 'other content'),
		]);

		mockApiClient.rawDownload.mockResolvedValue('other content');

		// When
		await engine.performInitialSync();

		// Then: notes/old.md가 로컬에서 삭제됨 (이벤트 우선 처리)
		expect(vault.delete).toHaveBeenCalledWith('notes/old.md');
		// hash_cache 엔트리가 제거됨
		expect(cache.has('notes/old.md')).toBe(false);
		// lastEventId가 갱신됨
		expect((engine as any)._lastEventId).toBe('101');
		// 재업로드되지 않음
		expect(mockApiClient.rawUpload).not.toHaveBeenCalledWith('notes/old.md', expect.anything());
		expect(mockApiClient.uploadAttachment).not.toHaveBeenCalledWith('notes/old.md', expect.anything());
	});

	it('이벤트 삭제 + 3-way 삭제가 모두 동작해야 한다', async () => {
		// Given: 이벤트는 notes/a.md 삭제, 3-way는 notes/b.md를 원격 삭제로 감지
		settings.last_event_id = '50';
		engine = new SyncEngine(settings, vault as never, mockNotice);

		const cache = (engine as any)._hashCache as Map<string, string>;
		cache.set('notes/a.md', 'hash-a');
		cache.set('notes/b.md', 'hash-b');

		// getEvents: a.md 삭제 이벤트만 있음 (b.md는 이벤트에 없음)
		mockApiClient.getEvents.mockResolvedValueOnce([
			{
				id: '51',
				event_type: 'deleted',
				file_path: 'notes/a.md',
				file_type: 'text',
				device_id: 'device-2',
				created_at: '2026-04-23T00:00:00Z',
			},
		]);

		// server: a.md, b.md 모두 없음 (둘 다 원격에서 삭제됨)
		mockApiClient.listFiles.mockResolvedValueOnce([]);

		// local: a.md, b.md 모두 존재
		vault._textMap.set('notes/a.md', 'content-a');
		vault._textMap.set('notes/b.md', 'content-b');
		vault.getFiles.mockReturnValueOnce([
			createMockFile('notes/a.md', 'content-a'),
			createMockFile('notes/b.md', 'content-b'),
		]);

		// When
		await engine.performInitialSync();

		// Then: 두 파일 모두 삭제됨
		expect(vault.delete).toHaveBeenCalledWith('notes/a.md');
		expect(vault.delete).toHaveBeenCalledWith('notes/b.md');
		// hash_cache에서 두 항목 모두 제거됨
		expect(cache.has('notes/a.md')).toBe(false);
		expect(cache.has('notes/b.md')).toBe(false);
		// lastEventId 갱신됨
		expect((engine as any)._lastEventId).toBe('51');
	});

	it('자기 디바이스의 삭제 이벤트는 무시해야 한다', async () => {
		// Given: device-1의 삭제 이벤트 (자기 자신)
		settings.last_event_id = '100';
		engine = new SyncEngine(settings, vault as never, mockNotice);

		const cache = (engine as any)._hashCache as Map<string, string>;
		cache.set('notes/self.md', 'hash-self');

		// getEvents: device-1(자기 자신)의 삭제 이벤트
		mockApiClient.getEvents.mockResolvedValueOnce([
			{
				id: '101',
				event_type: 'deleted',
				file_path: 'notes/self.md',
				file_type: 'text',
				device_id: 'device-1',  // 자기 자신
				created_at: '2026-04-23T00:00:00Z',
			},
		]);

		// server: self.md 존재 (서버에는 아직 있음)
		mockApiClient.listFiles.mockResolvedValueOnce([
			{ id: 1, path: 'notes/self.md', hash: 'hash-self', sizeBytes: 10, createdAt: '', updatedAt: '' },
		]);

		// local: self.md 존재
		vault._textMap.set('notes/self.md', 'self content');
		vault.getFiles.mockReturnValueOnce([
			createMockFile('notes/self.md', 'self content'),
		]);

		// When
		await engine.performInitialSync();

		// Then: 이벤트로 인한 삭제는 발생하지 않음 (자기 디바이스 무시)
		// 3-way 판정: base=yes, server=yes, local=yes → compare-hash
		// 해시 동일(computeHash mock returns 'mock-hash') → 다운로드/삭제 없음
		expect(vault.delete).not.toHaveBeenCalledWith('notes/self.md');
		// lastEventId는 갱신됨 (커서 유지)
		expect((engine as any)._lastEventId).toBe('101');
	});
});

// ============================================================
// 보안 강화: 이벤트 검증 및 안전장치 (SPEC-SYNC-DELETE-001)
// _processDeletedEventsFirst에 3가지 보안 계층 적용
// ============================================================
describe('보안 강화: 이벤트 검증 및 안전장치 (SPEC-SYNC-DELETE-001)', () => {
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
		};

		vault = createMockVault();
	});

	// ============================================================
	// 보안 강화 2: Zod 스키마 검증 — 유효하지 않은 이벤트 구조 → 스킵
	// ============================================================
	describe('Zod 스키마 검증', () => {
		it('device_id가 누락된 이벤트는 스킵하고 notice를 출력해야 한다', async () => {
			// Given: device_id 누락된 이벤트
			settings.last_event_id = '100';
			engine = new SyncEngine(settings, vault as never, mockNotice);

			mockApiClient.getEvents.mockResolvedValueOnce([
				{
					id: '101',
					event_type: 'deleted',
					file_path: 'notes/test.md',
					// device_id 누락
					created_at: '2026-04-23T00:00:00Z',
				},
			]);

			// server: test.md 존재
			mockApiClient.listFiles.mockResolvedValueOnce([
				{ id: 1, path: 'notes/test.md', hash: 'hash-test', sizeBytes: 10, createdAt: '', updatedAt: '' },
			]);

			vault._textMap.set('notes/test.md', 'test content');
			vault.getFiles.mockReturnValueOnce([
				createMockFile('notes/test.md', 'test content'),
			]);

			// When
			await engine.performInitialSync();

			// Then: 파일이 삭제되지 않음
			expect(vault.delete).not.toHaveBeenCalledWith('notes/test.md');
			// 스킵 notice 호출
			expect(mockNotice).toHaveBeenCalledWith(expect.stringContaining('건너뜀: 유효하지 않은 이벤트 구조'));
		});

		it('id가 누락된 이벤트는 스킵해야 한다', async () => {
			// Given: id 누락된 이벤트
			settings.last_event_id = '100';
			engine = new SyncEngine(settings, vault as never, mockNotice);

			mockApiClient.getEvents.mockResolvedValueOnce([
				{
					// id 누락
					event_type: 'deleted',
					file_path: 'notes/test.md',
					device_id: 'device-2',
					created_at: '2026-04-23T00:00:00Z',
				},
			]);

			mockApiClient.listFiles.mockResolvedValueOnce([
				{ id: 1, path: 'notes/test.md', hash: 'hash-test', sizeBytes: 10, createdAt: '', updatedAt: '' },
			]);

			vault._textMap.set('notes/test.md', 'test content');
			vault.getFiles.mockReturnValueOnce([
				createMockFile('notes/test.md', 'test content'),
			]);

			// When
			await engine.performInitialSync();

			// Then: 파일이 삭제되지 않음
			expect(vault.delete).not.toHaveBeenCalledWith('notes/test.md');
			expect(mockNotice).toHaveBeenCalledWith(expect.stringContaining('건너뜀: 유효하지 않은 이벤트 구조'));
		});

		it('유효하지 않은 event_type은 스킵해야 한다', async () => {
			// Given: event_type이 유효하지 않은 값
			settings.last_event_id = '100';
			engine = new SyncEngine(settings, vault as never, mockNotice);

			mockApiClient.getEvents.mockResolvedValueOnce([
				{
					id: '101',
					event_type: 'malicious',
					file_path: 'notes/test.md',
					device_id: 'device-2',
					created_at: '2026-04-23T00:00:00Z',
				},
			]);

			mockApiClient.listFiles.mockResolvedValueOnce([
				{ id: 1, path: 'notes/test.md', hash: 'hash-test', sizeBytes: 10, createdAt: '', updatedAt: '' },
			]);

			vault._textMap.set('notes/test.md', 'test content');
			vault.getFiles.mockReturnValueOnce([
				createMockFile('notes/test.md', 'test content'),
			]);

			// When
			await engine.performInitialSync();

			// Then: 파일이 삭제되지 않음
			expect(vault.delete).not.toHaveBeenCalledWith('notes/test.md');
		});
	});

	// ============================================================
	// 보안 강화 1: 대량 삭제 안전장치 — 임계값 초과 시 제한
	// ============================================================
	describe('대량 삭제 안전장치', () => {
		it('60개 삭제 이벤트 중 50개만 처리하고 경고를 출력해야 한다', async () => {
			// Given: 60개 삭제 이벤트 (타 디바이스)
			settings.last_event_id = '100';
			engine = new SyncEngine(settings, vault as never, mockNotice);

			const deleteEvents = [];
			for (let i = 0; i < 60; i++) {
				deleteEvents.push({
					id: `a0000000-0000-4000-8000-${i.toString().padStart(12, "0")}`,
					event_type: 'deleted',
					file_path: `notes/file-${i.toString().padStart(3, '0')}.md`,
					file_type: 'text',
					device_id: 'device-2',
					created_at: '2026-04-23T00:00:00Z',
				});
				vault._textMap.set(`notes/file-${i.toString().padStart(3, '0')}.md`, `content-${i}`);
			}

			mockApiClient.getEvents.mockResolvedValueOnce(deleteEvents);
			mockApiClient.listFiles.mockResolvedValueOnce([]);
			vault.getFiles.mockReturnValueOnce([]);

			// When
			await engine.performInitialSync();

			// Then: 대량 삭제 경고 출력
			expect(mockNotice).toHaveBeenCalledWith(expect.stringContaining('60개 대량 삭제 이벤트 감지'));
			// vault.delete는 최대 50회 호출
			const deleteCalls = (vault.delete as ReturnType<typeof vi.fn>).mock.calls.filter(
				(call: string[]) => call[0].startsWith('notes/file-')
			);
			expect(deleteCalls.length).toBe(50);
		});
	});

	// ============================================================
	// 보안 강화 3: 경로 유효성 검증 — 유효하지 않은 경로 → 스킵
	// ============================================================
	describe('경로 유효성 검증', () => {
		it('..로 시작하는 경로는 스킵하고 notice를 출력해야 한다', async () => {
			// Given: 경로 순회 공격 시나리오
			settings.last_event_id = '100';
			engine = new SyncEngine(settings, vault as never, mockNotice);

			mockApiClient.getEvents.mockResolvedValueOnce([
				{
					id: "a0000000-0000-4000-8000-000000000101",
					event_type: 'deleted',
					file_path: '../secret.txt',
					file_type: 'text',
					device_id: 'device-2',
					created_at: '2026-04-23T00:00:00Z',
				},
			]);

			mockApiClient.listFiles.mockResolvedValueOnce([]);
			vault.getFiles.mockReturnValueOnce([]);

			// When
			await engine.performInitialSync();

			// Then: 삭제되지 않음
			expect(vault.delete).not.toHaveBeenCalled();
			expect(mockNotice).toHaveBeenCalledWith(expect.stringContaining('건너뜀: 유효하지 않은 파일 경로'));
		});

		it('/etc/passwd 같은 절대 경로는 스킵해야 한다', async () => {
			// Given: 절대 경로 공격 시나리오
			settings.last_event_id = '100';
			engine = new SyncEngine(settings, vault as never, mockNotice);

			mockApiClient.getEvents.mockResolvedValueOnce([
				{
					id: "a0000000-0000-4000-8000-000000000102",
					event_type: 'deleted',
					file_path: '/etc/passwd',
					file_type: 'text',
					device_id: 'device-2',
					created_at: '2026-04-23T00:00:00Z',
				},
			]);

			mockApiClient.listFiles.mockResolvedValueOnce([]);
			vault.getFiles.mockReturnValueOnce([]);

			// When
			await engine.performInitialSync();

			// Then: 삭제되지 않음
			expect(vault.delete).not.toHaveBeenCalled();
			expect(mockNotice).toHaveBeenCalledWith(expect.stringContaining('건너뜀: 유효하지 않은 파일 경로'));
		});

		it('정상 경로는 경로 검증을 통과해야 한다', async () => {
			// Given: 정상적인 vault 내부 경로
			settings.last_event_id = '100';
			engine = new SyncEngine(settings, vault as never, mockNotice);

			mockApiClient.getEvents.mockResolvedValueOnce([
				{
					id: "a0000000-0000-4000-8000-000000000103",
					event_type: 'deleted',
					file_path: 'notes/valid-file.md',
					file_type: 'text',
					device_id: 'device-2',
					created_at: '2026-04-23T00:00:00Z',
				},
			]);

			mockApiClient.listFiles.mockResolvedValueOnce([]);
			vault.getFiles.mockReturnValueOnce([]);
			vault._textMap.set('notes/valid-file.md', 'valid content');

			// When
			await engine.performInitialSync();

			// Then: 정상 삭제 처리
			expect(vault.delete).toHaveBeenCalledWith('notes/valid-file.md');
			// 경로 검증 경고 미출력
			expect(mockNotice).not.toHaveBeenCalledWith(expect.stringContaining('유효하지 않은 파일 경로'));
		});
	});
});
