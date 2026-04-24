// SPEC-SYNC-DELETE-001: performFullSync 이벤트 우선 처리 테스트 (T4 + T5)
// 삭제 이벤트를 업로드 루프 전에 처리하여 재업로드 방지
//
// 테스트 케이스:
// AC-004: Event-first processing prevents re-upload in performFullSync
// - 서버에 삭제 이벤트가 있고 로컬에 파일이 존재할 때, 삭제 이벤트가 먼저 처리되어 재업로드 방지
// - 삭제된 파일은 업로드 루프에서 제외되어야 함
// T5-EC: Binary file upload exclusion after delete event
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SyncEngine } from '../../src/sync-engine';
import type { VSyncSettings } from '../../src/types';
import { DEFAULT_SETTINGS } from '../../src/types';
import { createMockVault, createMockFile } from '../mocks/vault';

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

describe('performFullSync — Event-first processing (SPEC-SYNC-DELETE-001 T4)', () => {
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
	// AC-004: Event-first processing prevents re-upload
	// 서버에 삭제 이벤트가 있고 로컬에 파일이 있으면,
	// 이벤트 처리가 업로드 전에 실행되어 재업로드를 방지
	// ============================================================
	it('AC-004: 삭제 이벤트가 업로드 전에 처리되어 삭제된 파일이 재업로드되지 않아야 한다', async () => {
		// Given: device의 lastEventId = '100'
		settings.last_event_id = '100';
		engine = new SyncEngine(settings, vault as never, mockNotice);

		// 로컬에 notes/temp.md 존재
		vault._textMap.set('notes/temp.md', 'temp content');
		vault.getFiles.mockReturnValueOnce([
			createMockFile('notes/temp.md', 'temp content'),
		]);

		// 서버 파일 목록: 빈 배열 (temp.md는 삭제 예정)
		mockApiClient.listFiles.mockResolvedValueOnce([]);

		// _processDeletedEventsFirst용 getEvents: temp.md 삭제 이벤트 (다른 디바이스)
		mockApiClient.getEvents
			.mockResolvedValueOnce([
				{
					id: 'a0000000-0000-4000-8000-000000000101',
					event_type: 'deleted',
					file_path: 'notes/temp.md',
					file_type: 'text',
					device_id: 'device-2',
					created_at: '2026-04-23T00:00:00Z',
				},
			])
			// 업로드 후 이벤트 폴링용 getEvents: 빈 배열
			.mockResolvedValueOnce([]);

		mockApiClient.rawUpload.mockResolvedValue({
			id: 1, path: 'notes/temp.md', hash: 'upload-hash', sizeBytes: 12, version: 1,
		});

		// When
		await engine.performFullSync();

		// Then: 로컬 파일이 삭제됨 (이벤트 우선 처리)
		expect(vault.delete).toHaveBeenCalledWith('notes/temp.md');
		// 재업로드되지 않음
		expect(mockApiClient.rawUpload).not.toHaveBeenCalledWith(
			'notes/temp.md', expect.anything()
		);
		// lastEventId가 갱신됨
		expect((engine as any)._lastEventId).toBe('a0000000-0000-4000-8000-000000000101');
	});

	// ============================================================
	// Upload exclusion after event processing
	// 삭제 이벤트로 처리된 파일은 업로드 루프에서 제외
	// ============================================================
	it('이벤트 처리로 삭제된 파일은 업로드에서 제외되고, 나머지 파일은 정상 업로드되어야 한다', async () => {
		// Given: device의 lastEventId = '200'
		settings.last_event_id = '200';
		engine = new SyncEngine(settings, vault as never, mockNotice);

		// 로컬에 A, B, C 세 파일 존재
		vault._textMap.set('notes/a.md', 'content-a');
		vault._textMap.set('notes/b.md', 'content-b');
		vault._textMap.set('notes/c.md', 'content-c');
		vault.getFiles.mockReturnValueOnce([
			createMockFile('notes/a.md', 'content-a'),
			createMockFile('notes/b.md', 'content-b'),
			createMockFile('notes/c.md', 'content-c'),
		]);

		// 서버 파일 목록: a.md, c.md만 서버에 존재
		mockApiClient.listFiles.mockResolvedValueOnce([
			{ id: 1, path: 'notes/a.md', hash: 'hash-a', size_bytes: 10, created_at: '', updated_at: '' },
			{ id: 2, path: 'notes/c.md', hash: 'hash-c', size_bytes: 10, created_at: '', updated_at: '' },
		]);

		// _processDeletedEventsFirst: b.md 삭제 이벤트 (다른 디바이스)
		mockApiClient.getEvents
			.mockResolvedValueOnce([
				{
					id: 'a0000000-0000-4000-8000-000000000201',
					event_type: 'deleted',
					file_path: 'notes/b.md',
					file_type: 'text',
					device_id: 'device-2',
					created_at: '2026-04-23T00:00:00Z',
				},
			])
			// 업로드 후 이벤트 폴링: 빈 배열
			.mockResolvedValueOnce([]);

		mockApiClient.rawUpload.mockResolvedValue({
			id: 1, path: '', hash: 'upload-hash', sizeBytes: 10, version: 1,
		});

		// When
		await engine.performFullSync();

		// Then: b.md는 로컬에서 삭제됨
		expect(vault.delete).toHaveBeenCalledWith('notes/b.md');
		// b.md는 업로드되지 않음
		expect(mockApiClient.rawUpload).not.toHaveBeenCalledWith(
			'notes/b.md', expect.anything()
		);
		// a.md와 c.md는 baseHash와 함께 정상 업로드됨
		expect(mockApiClient.rawUpload).toHaveBeenCalledWith(
			'notes/a.md', 'content-a', 'hash-a'
		);
		expect(mockApiClient.rawUpload).toHaveBeenCalledWith(
			'notes/c.md', 'content-c', 'hash-c'
		);
		// 총 2회 업로드 (a, c만)
		expect(mockApiClient.rawUpload).toHaveBeenCalledTimes(2);
	});

	// ============================================================
	// T5-EC: Binary file upload exclusion after delete event
	// 삭제 이벤트로 처리된 바이너리 파일은 uploadAttachment에서 제외
	// ============================================================
	it('삭제 이벤트가 있는 바이너리 파일은 uploadAttachment가 호출되지 않아야 한다', async () => {
		// Given: device의 lastEventId = '300'
		settings.last_event_id = '300';
		engine = new SyncEngine(settings, vault as never, mockNotice);

		// 로컬에 바이너리 파일 존재
		const binaryData = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]).buffer; // PNG header
		vault._binaryMap.set('attachments/img.png', binaryData);
		vault.getFiles.mockReturnValueOnce([
			createMockFile('attachments/img.png'),
		]);

		// 서버 파일 목록: 빈 배열 (img.png는 삭제 예정)
		mockApiClient.listFiles.mockResolvedValueOnce([]);

		// _processDeletedEventsFirst: img.png 삭제 이벤트 (다른 디바이스)
		mockApiClient.getEvents
			.mockResolvedValueOnce([
				{
					id: 'a0000000-0000-4000-8000-000000000301',
					event_type: 'deleted',
					file_path: 'attachments/img.png',
					file_type: 'binary',
					device_id: 'device-2',
					created_at: '2026-04-23T00:00:00Z',
				},
			])
			// 업로드 후 이벤트 폴링: 빈 배열
			.mockResolvedValueOnce([]);

		// When
		await engine.performFullSync();

		// Then: 바이너리 파일이 로컬에서 삭제됨
		expect(vault.delete).toHaveBeenCalledWith('attachments/img.png');
		// uploadAttachment가 호출되지 않음 (재업로드 방지)
		expect(mockApiClient.uploadAttachment).not.toHaveBeenCalledWith(
			'attachments/img.png', expect.anything()
		);
		// lastEventId가 갱신됨
		expect((engine as any)._lastEventId).toBe('a0000000-0000-4000-8000-000000000301');
	});
});
