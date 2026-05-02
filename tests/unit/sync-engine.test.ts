// 동기화 엔진 테스트
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SyncEngine } from '../../src/sync-engine';
import { WSClient } from '../../src/services/ws-client';
import { ConflictQueue } from '../../src/conflict';
import type { VSyncSettings } from '../../src/types';
import { DEFAULT_SETTINGS } from '../../src/types';
import { createMockVault, createMockFile } from '../mocks/vault';
import { computeHash } from '../../src/utils/hash';
import type { MockTFile } from '../mocks/vault';

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
	// SPEC-P8-PLUGIN-API-001: 배치/이동/검색 API
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

// 해시 유틸리티 mock
vi.mock('../../src/utils/hash', () => ({
	computeHash: vi.fn().mockResolvedValue('mock-hash'),
}));

const mockNotice = vi.fn();
vi.mock('obsidian', () => ({
	requestUrl: vi.fn(),
	Notice: vi.fn().mockImplementation((msg: string) => mockNotice(msg)),
	Platform: { isDesktop: true, isMobile: false },
	// REQ-PLG-001: Obsidian 내장 normalizePath mock
	normalizePath: vi.fn((path: string): string => {
		if (!path) return '';
		return path
			.replace(/\\/g, '/')
			.replace(/\/+/g, '/')
			.replace(/^\//, '');
	}),
}));

// WS 클라이언트 mock
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

describe('SyncEngine', () => {
	let engine: SyncEngine;
	let vault: ReturnType<typeof createMockVault>;
	let settings: VSyncSettings;

	beforeEach(() => {
		vi.clearAllMocks();

		settings = {
			...DEFAULT_SETTINGS,
			server_url: 'https://sync.example.com',
			username: 'testuser', password: '', session_token: 'test-token', sync_enabled: true,
			vault_id: 'vault-1',
			device_id: 'device-1',
			sync_interval: 30,
		};

		vault = createMockVault();
		engine = new SyncEngine(settings, vault as never, mockNotice);
	});

	// ============================================================
	// T-008: Sync Engine Core (로컬 변경 감지)
	// ============================================================

	describe('로컬 파일 변경 감지 (REQ-P4-008)', () => {
		it('파일 생성 시 업로드해야 한다', async () => {
			vault._textMap.set('notes/test.md', 'content');
			const file = createMockFile('notes/test.md', 'content');
			mockApiClient.rawUpload.mockResolvedValueOnce({ id: 1, path: 'notes/test.md', hash: 'h', sizeBytes: 7, version: 1 });

			await engine.handleLocalCreate(file);

			expect(mockApiClient.rawUpload).toHaveBeenCalledWith('notes/test.md', 'content', undefined, undefined);
		});

		it('파일 수정 시 업로드해야 한다', async () => {
			vault._textMap.set('notes/test.md', 'modified content');
			const file = createMockFile('notes/test.md', 'modified content');
			mockApiClient.rawUpload.mockResolvedValueOnce({ id: 1, path: 'notes/test.md', hash: 'h', sizeBytes: 16, version: 1 });

			// handleLocalModify는 디바운스 적용 (SPEC-P6-DEDUP-003)
			vi.useFakeTimers();
			await engine.handleLocalModify(file);
			await vi.advanceTimersByTimeAsync(500);

			expect(mockApiClient.rawUpload).toHaveBeenCalledWith('notes/test.md', 'modified content', undefined, undefined);
			vi.useRealTimers();
		});

		it('.obsidian/ 파일은 무시해야 한다 (REQ-P4-013)', async () => {
			const file = createMockFile('.obsidian/config', 'config data');

			await engine.handleLocalCreate(file);
			await engine.handleLocalModify(file);

			expect(mockApiClient.rawUpload).not.toHaveBeenCalled();
		});

		it('미지원 확장자 파일은 무시해야 한다', async () => {
			const file = createMockFile('program.exe', 'binary');

			await engine.handleLocalCreate(file);

			expect(mockApiClient.rawUpload).not.toHaveBeenCalled();
			expect(mockApiClient.uploadAttachment).not.toHaveBeenCalled();
		});

		it('동기화 중 발생한 이벤트는 무시해야 한다 (REQ-P4-008 동기화 루프 방지)', async () => {
			const file = createMockFile('notes/test.md', 'content');

			// 동기화 중 상태 시뮬레이션
			engine.setSyncing(true);
			await engine.handleLocalCreate(file);

			expect(mockApiClient.rawUpload).not.toHaveBeenCalled();
		});
	});

	describe('로컬 파일 삭제 반영 (REQ-P4-009)', () => {
		it('파일 삭제 시 서버에 삭제 요청해야 한다', async () => {
			mockApiClient.deleteFile.mockResolvedValueOnce(undefined);

			await engine.handleLocalDelete('notes/old.md');

			expect(mockApiClient.deleteFile).toHaveBeenCalledWith('notes/old.md');
		});

		it('.obsidian/ 파일 삭제는 무시해야 한다', async () => {
			await engine.handleLocalDelete('.obsidian/config');

			expect(mockApiClient.deleteFile).not.toHaveBeenCalled();
		});
	});

	// ============================================================
	// T-009: Sync Engine Polling (원격 변경 처리)
	// ============================================================

	describe('이벤트 폴링 (REQ-P4-010)', () => {
		it('새 이벤트가 수신되면 파일을 다운로드해야 한다', async () => {
			mockApiClient.getEvents.mockResolvedValueOnce([
				{ id: '10', event_type: 'created', file_path: 'notes/remote.md', device_id: 'device-2', created_at: '2026-01-01' },
			]);
			mockApiClient.rawDownload.mockResolvedValueOnce('# Remote content');
			mockApiClient.updateSyncStatus.mockResolvedValueOnce(undefined);

			// vault에 해당 파일이 없음 (단순 다운로드)
			await engine.pollRemoteChanges();

			expect(mockApiClient.getEvents).toHaveBeenCalled();
			expect(mockApiClient.rawDownload).toHaveBeenCalledWith('notes/remote.md');
		});

		it('자기 자신의 디바이스 이벤트는 무시해야 한다', async () => {
			mockApiClient.getEvents.mockResolvedValueOnce([
				{ id: '10', event_type: 'created', file_path: 'notes/test.md', device_id: 'device-1', created_at: '2026-01-01' },
			]);

			await engine.pollRemoteChanges();

			expect(mockApiClient.rawDownload).not.toHaveBeenCalled();
		});

		it('deleted 이벤트 시 로컬 파일을 삭제해야 한다', async () => {
			vault._textMap.set('notes/deleted.md', 'old content');
			mockApiClient.getEvents.mockResolvedValueOnce([
				{ id: '10', event_type: 'deleted', file_path: 'notes/deleted.md', device_id: 'device-2', created_at: '2026-01-01' },
			]);
			mockApiClient.updateSyncStatus.mockResolvedValueOnce(undefined);

			await engine.pollRemoteChanges();

			expect(vault.delete).toHaveBeenCalled();
		});

		it('빈 이벤트 목록 시 추가 작업을 하지 않아야 한다', async () => {
			mockApiClient.getEvents.mockResolvedValueOnce([]);

			await engine.pollRemoteChanges();

			expect(mockApiClient.rawDownload).not.toHaveBeenCalled();
			expect(vault.delete).not.toHaveBeenCalled();
		});
	});

	describe('커서 업데이트 (REQ-P4-018)', () => {
		it('동기화 성공 후 커서를 업데이트해야 한다', async () => {
			mockApiClient.getEvents.mockResolvedValueOnce([
				{ id: '10', event_type: 'created', file_path: 'a.md', device_id: 'device-2', created_at: '2026-01-01' },
				{ id: '11', event_type: 'updated', file_path: 'b.md', device_id: 'device-2', created_at: '2026-01-01' },
			]);
			mockApiClient.rawDownload.mockResolvedValue('content');
			mockApiClient.updateSyncStatus.mockResolvedValueOnce(undefined);

			await engine.pollRemoteChanges();

			// 마지막 이벤트 ID로 업데이트
			expect(mockApiClient.updateSyncStatus).toHaveBeenCalledWith('11');
		});
	});

	// ============================================================
	// T-010: Sync Engine Initial Sync
	// ============================================================

	describe('초기 전체 동기화 (REQ-P4-012)', () => {
		it('서버에만 있는 파일을 다운로드해야 한다', async () => {
			// 서버: 3개 파일, 로컬: 0개 파일
			mockApiClient.listFiles.mockResolvedValueOnce([
				{ id: 1, path: 'a.md', hash: 'ha', sizeBytes: 10, createdAt: '', updatedAt: '' },
				{ id: 2, path: 'b.md', hash: 'hb', sizeBytes: 20, createdAt: '', updatedAt: '' },
				{ id: 3, path: 'c.md', hash: 'hc', sizeBytes: 30, createdAt: '', updatedAt: '' },
			]);
			vault.getFiles.mockReturnValueOnce([]);
			mockApiClient.rawDownload.mockResolvedValue('downloaded content');

			await engine.performInitialSync();

			expect(mockApiClient.rawDownload).toHaveBeenCalledTimes(3);
		});

		it('로컬에만 있는 파일을 업로드해야 한다', async () => {
			// 서버: 0개 파일, 로컬: 2개 파일
			mockApiClient.listFiles.mockResolvedValueOnce([]);
			vault._textMap.set('local1.md', 'content1');
			vault._textMap.set('local2.md', 'content2');
			vault.getFiles.mockReturnValueOnce([
				createMockFile('local1.md', 'content1'),
				createMockFile('local2.md', 'content2'),
			]);
			mockApiClient.rawUpload.mockResolvedValue({ id: 1, path: '', hash: '', sizeBytes: 0, version: 1 });

			await engine.performInitialSync();

			expect(mockApiClient.rawUpload).toHaveBeenCalledTimes(2);
		});

		it('양쪽에 모두 있는 파일은 해시 비교 후 서버 해시를 baseHash로 rawUpload해야 한다', async () => {
			// 서버: a.md (hash: server-hash)
			// 로컬: a.md (hash: local-hash, 다름)
			mockApiClient.listFiles.mockResolvedValueOnce([
				{ id: 1, path: 'a.md', hash: 'server-hash', sizeBytes: 10, createdAt: '', updatedAt: '' },
			]);
			vault._textMap.set('a.md', 'local content');
			vault.getFiles.mockReturnValueOnce([createMockFile('a.md', 'local content')]);
			// computeHash mock이 'mock-hash'를 반환하므로 'server-hash'와 다름 → rawUpload with baseHash
			mockApiClient.rawUpload.mockResolvedValue({ id: 1, path: 'a.md', hash: 'new-hash', sizeBytes: 0, version: 1 });

			await engine.performInitialSync();

			// 해시가 다르므로 서버 해시를 baseHash로 rawUpload
			expect(mockApiClient.rawUpload).toHaveBeenCalledWith('a.md', 'local content');
		});

		it('.obsidian/ 파일은 초기 동기화에서 제외해야 한다', async () => {
			vault._textMap.set('.obsidian/config', 'config');
			vault._textMap.set('notes.md', 'notes');
			vault.getFiles.mockReturnValueOnce([
				createMockFile('.obsidian/config', 'config'),
				createMockFile('notes.md', 'notes'),
			]);
			mockApiClient.listFiles.mockResolvedValueOnce([]);

			await engine.performInitialSync();

			// .obsidian 파일은 업로드되지 않아야 함
			const uploadCalls = mockApiClient.rawUpload.mock.calls;
			for (const call of uploadCalls) {
				expect(call[0]).not.toContain('.obsidian');
			}
		});
	});

	describe('start/stop', () => {
		it('start 시 폴링 타이머를 시작해야 한다', () => {
			const mockRegisterInterval = vi.fn();
			engine.start(mockRegisterInterval);

			expect(mockRegisterInterval).toHaveBeenCalled();
		});

		it('start 시 vault 이벤트 리스너를 등록해야 한다', () => {
			const mockRegisterInterval = vi.fn();
			engine.start(mockRegisterInterval);

			expect(vault.on).toHaveBeenCalledWith('create', expect.any(Function));
			expect(vault.on).toHaveBeenCalledWith('modify', expect.any(Function));
			expect(vault.on).toHaveBeenCalledWith('delete', expect.any(Function));
			expect(vault.on).toHaveBeenCalledWith('rename', expect.any(Function));
		});
	});

	describe('performFullSync (REQ-P4-019)', () => {
		it('전체 동기화 순서: 업로드 → 이벤트 폴링 → 커서 업데이트', async () => {
			vault._textMap.set('test.md', 'content');
			vault.getFiles.mockReturnValueOnce([createMockFile('test.md', 'content')]);
			mockApiClient.listFiles.mockResolvedValueOnce([]);
			mockApiClient.rawUpload.mockResolvedValue({ id: 1, path: 'test.md', hash: 'h', sizeBytes: 0, version: 1 });
			// _processDeletedEventsFirst + 이벤트 폴링에서 각각 getEvents 호출
			mockApiClient.getEvents
				.mockResolvedValueOnce([]) // _processDeletedEventsFirst
				.mockResolvedValueOnce([ // 이벤트 폴링
					{ id: '5', event_type: 'created', file_path: 'remote.md', device_id: 'device-2', created_at: '2026-01-01' },
				]);
			mockApiClient.rawDownload.mockResolvedValue('remote content');
			mockApiClient.listFiles.mockResolvedValue([]);
			mockApiClient.updateSyncStatus.mockResolvedValue(undefined);

			await engine.performFullSync();

			// 업로드 먼저, 그 다음 이벤트 폴링, 그 다음 커서 업데이트
			expect(mockApiClient.rawUpload).toHaveBeenCalled();
			expect(mockApiClient.getEvents).toHaveBeenCalled();
			expect(mockApiClient.updateSyncStatus).toHaveBeenCalled();
		});
	});

	// ============================================================
	// SPEC-SYNC-3WAY-FIX-001 T-004: performFullSync 서버 비교
	// ============================================================

	describe('performFullSync 서버 비교 (SPEC-SYNC-3WAY-FIX-001 T-004)', () => {
		it('서버 해시 == 로컬 해시 → 업로드 스킵', async () => {
			vault._textMap.set('same.md', 'content');
			vault.getFiles.mockReturnValueOnce([createMockFile('same.md', 'content')]);
			vi.mocked(computeHash).mockResolvedValueOnce('same-hash');
			mockApiClient.listFiles.mockResolvedValueOnce([
				{ id: 1, path: 'same.md', hash: 'same-hash', size_bytes: 7, created_at: '', updated_at: '' },
			]);
			mockApiClient.getEvents.mockResolvedValueOnce([]);
			mockApiClient.updateSyncStatus.mockResolvedValue(undefined);

			await engine.performFullSync();

			expect(mockApiClient.rawUpload).not.toHaveBeenCalled();
		});

		it('서버 해시 != 로컬 해시 → baseHash와 함께 업로드', async () => {
			vault._textMap.set('diff.md', 'new content');
			vault.getFiles.mockReturnValueOnce([createMockFile('diff.md', 'new content')]);
			vi.mocked(computeHash).mockResolvedValueOnce('local-hash');
			mockApiClient.listFiles.mockResolvedValueOnce([
				{ id: 1, path: 'diff.md', hash: 'server-hash', size_bytes: 10, created_at: '', updated_at: '' },
			]);
			mockApiClient.rawUpload.mockResolvedValue({ id: 1, path: 'diff.md', hash: 'merged-hash', sizeBytes: 10, version: 1 });
			mockApiClient.getEvents.mockResolvedValueOnce([]);
			mockApiClient.updateSyncStatus.mockResolvedValue(undefined);

			await engine.performFullSync();

			expect(mockApiClient.rawUpload).toHaveBeenCalledWith('diff.md', 'new content', 'server-hash', undefined);
		});

		it('서버에만 있는 파일 → 다운로드', async () => {
			vault.getFiles.mockReturnValueOnce([]);
			mockApiClient.listFiles.mockResolvedValueOnce([
				{ id: 1, path: 'server-only.md', hash: 'srv-h', size_bytes: 10, created_at: '', updated_at: '' },
			]);
			mockApiClient.rawDownload.mockResolvedValue('server content');
			mockApiClient.getEvents.mockResolvedValueOnce([]);
			mockApiClient.updateSyncStatus.mockResolvedValue(undefined);

			await engine.performFullSync();

			expect(mockApiClient.rawDownload).toHaveBeenCalledWith('server-only.md');
			// sf.hash 전달로 내부 listFiles 재호출이 없어야 함
			expect(mockApiClient.listFiles).toHaveBeenCalledTimes(1);
		});

		it('로컬에만 있는 파일 → baseHash 없이 업로드', async () => {
			vault._textMap.set('local-only.md', 'local content');
			vault.getFiles.mockReturnValueOnce([createMockFile('local-only.md', 'local content')]);
			mockApiClient.listFiles.mockResolvedValueOnce([]);
			vi.mocked(computeHash).mockResolvedValueOnce('local-hash');
			mockApiClient.rawUpload.mockResolvedValue({ id: 1, path: 'local-only.md', hash: 'uploaded-hash', sizeBytes: 13, version: 1 });
			mockApiClient.getEvents.mockResolvedValueOnce([]);
			mockApiClient.updateSyncStatus.mockResolvedValue(undefined);

			await engine.performFullSync();

			expect(mockApiClient.rawUpload).toHaveBeenCalledWith('local-only.md', 'local content', undefined, undefined);
		});
	});

	// ============================================================
	// REQ-P6-011 ~ REQ-P6-016: 바이너리 파일 동기화	// ============================================================
	// REQ-P6-011 ~ REQ-P6-016: 바이너리 파일 동기화
	// ============================================================

	describe('바이너리 로컬 파일 업로드 (REQ-P6-011)', () => {
		it('바이너리 파일 생성 시 readBinary → uploadAttachment 경로를 사용해야 한다', async () => {
			const binaryData = new Uint8Array([1, 2, 3, 4, 5]).buffer;
			vault._binaryMap.set('images/photo.png', binaryData);
			const file = createMockFile('images/photo.png');
			mockApiClient.uploadAttachment.mockResolvedValueOnce({
				id: 1, path: 'images/photo.png', hash: 'binhash', sizeBytes: 5, version: 1,
			});

			await engine.handleLocalCreate(file);

			expect(vault.readBinary).toHaveBeenCalledWith('images/photo.png');
			expect(mockApiClient.uploadAttachment).toHaveBeenCalledWith('images/photo.png', binaryData);
			expect(mockApiClient.rawUpload).not.toHaveBeenCalled();
		});

		it('50MB 초과 바이너리 파일은 업로드하지 않고 Notice를 표시해야 한다', async () => {
			// 50MB + 1바이트
			const oversized = new ArrayBuffer(52_428_801);
			vault._binaryMap.set('large/video.mp4', oversized);
			const file = createMockFile('large/video.mp4');
			mockApiClient.uploadAttachment.mockResolvedValueOnce({
				id: 1, path: 'large/video.mp4', hash: 'h', sizeBytes: 0, version: 1,
			});

			await engine.handleLocalCreate(file);

			expect(mockApiClient.uploadAttachment).not.toHaveBeenCalled();
			expect(mockNotice).toHaveBeenCalledWith(expect.stringContaining('50MB'));
		});

		it('바이너리 파일 수정 시에도 uploadAttachment를 사용해야 한다', async () => {
			const binaryData = new Uint8Array([10, 20, 30]).buffer;
			vault._binaryMap.set('images/photo.png', binaryData);
			const file = createMockFile('images/photo.png');
			mockApiClient.uploadAttachment.mockResolvedValueOnce({
				id: 1, path: 'images/photo.png', hash: 'h', sizeBytes: 3, version: 1,
			});

			// handleLocalModify는 디바운스 적용 (SPEC-P6-DEDUP-003)
			vi.useFakeTimers();
			await engine.handleLocalModify(file);
			await vi.advanceTimersByTimeAsync(500);

			expect(vault.readBinary).toHaveBeenCalledWith('images/photo.png');
			expect(mockApiClient.uploadAttachment).toHaveBeenCalledWith('images/photo.png', binaryData);
			vi.useRealTimers();
		});
	});

	describe('바이너리 원격 다운로드 (REQ-P6-012)', () => {
		it('바이너리 파일 다운로드 시 downloadAttachment → writeBinary 경로를 사용해야 한다', async () => {
			const remoteData = new Uint8Array([100, 200, 150]).buffer;
			mockApiClient.getEvents.mockResolvedValueOnce([
				{ id: '10', event_type: 'created', file_path: 'images/remote.png', device_id: 'device-2', created_at: '2026-01-01' },
			]);
			mockApiClient.downloadAttachment.mockResolvedValueOnce(remoteData);
			mockApiClient.updateSyncStatus.mockResolvedValueOnce(undefined);

			await engine.pollRemoteChanges();

			expect(mockApiClient.downloadAttachment).toHaveBeenCalledWith('images/remote.png');
			expect(vault.writeBinary).toHaveBeenCalledWith('images/remote.png', remoteData);
		});
	});

	describe('바이너리 충돌 해결 (REQ-P6-015, REQ-P6-016)', () => {
		it('바이너리 충돌 시 latest-wins 정책으로 서버 버전을 덮어쓰고 Notice를 표시해야 한다', async () => {
			const localData = new Uint8Array([1, 2, 3]).buffer;
			const serverData = new Uint8Array([4, 5, 6]).buffer;
			vault._binaryMap.set('images/conflict.png', localData);

			mockApiClient.getEvents.mockResolvedValueOnce([
				{ id: '10', event_type: 'updated', file_path: 'images/conflict.png', device_id: 'device-2', created_at: '2026-01-01' },
			]);
			mockApiClient.downloadAttachment.mockResolvedValueOnce(serverData);
			mockApiClient.updateSyncStatus.mockResolvedValueOnce(undefined);

			// 로컬 해시와 원격 해시가 다르면 충돌 감지
			vi.mocked(computeHash)
				.mockResolvedValueOnce('local-hash')
				.mockResolvedValueOnce('remote-hash')
				.mockResolvedValueOnce('cache-hash');

			await engine.pollRemoteChanges();

			// 서버 버전으로 덮어쓰기 확인
			expect(vault.writeBinary).toHaveBeenCalledWith('images/conflict.png', serverData);
			// latest-wins Notice 표시
			expect(mockNotice).toHaveBeenCalledWith(expect.stringContaining('latest-wins'));
		});
	});

	describe('바이너리 파일 삭제 (REQ-P6-014)', () => {
		it('바이너리 파일 삭제 시 동일한 DELETE API를 호출해야 한다', async () => {
			mockApiClient.deleteFile.mockResolvedValueOnce(undefined);

			await engine.handleLocalDelete('images/old-photo.png');

			expect(mockApiClient.deleteFile).toHaveBeenCalledWith('images/old-photo.png');
		});

		it('원격 바이너리 삭제 이벤트 시 로컬 파일을 삭제해야 한다', async () => {
			vault._binaryMap.set('images/to-delete.png', new Uint8Array([1]).buffer);
			mockApiClient.getEvents.mockResolvedValueOnce([
				{ id: '10', event_type: 'deleted', file_path: 'images/to-delete.png', device_id: 'device-2', created_at: '2026-01-01' },
			]);
			mockApiClient.updateSyncStatus.mockResolvedValueOnce(undefined);

			await engine.pollRemoteChanges();

			expect(vault.delete).toHaveBeenCalledWith('images/to-delete.png');
		});
	});

	describe('바이너리 초기 동기화 (REQ-P6-013)', () => {
		it('초기 동기화에 바이너리 파일이 포함되어야 한다', async () => {
			// 서버: 바이너리 파일 1개
			mockApiClient.listFiles.mockResolvedValueOnce([
				{ id: 1, path: 'images/server-only.png', hash: 'server-hash', sizeBytes: 100, createdAt: '', updatedAt: '' },
			]);
			// 로컬: 바이너리 파일 1개
			const localBinary = new Uint8Array([1, 2, 3]).buffer;
			vault._binaryMap.set('images/local-only.png', localBinary);
			vault._textMap.set('notes.md', 'content');
			vault.getFiles.mockReturnValueOnce([
				createMockFile('images/local-only.png'),
				createMockFile('notes.md', 'content'),
			]);
			mockApiClient.downloadAttachment.mockResolvedValueOnce(new Uint8Array([10, 20]).buffer);
			mockApiClient.uploadAttachment.mockResolvedValueOnce({
				id: 2, path: 'images/local-only.png', hash: 'h', sizeBytes: 3, version: 1,
			});

			await engine.performInitialSync();

			// 서버에만 있는 바이너리 → 다운로드
			expect(mockApiClient.downloadAttachment).toHaveBeenCalledWith('images/server-only.png');
			// 로컬에만 있는 바이너리 → 업로드
			expect(mockApiClient.uploadAttachment).toHaveBeenCalledWith('images/local-only.png', localBinary);
		});
	});

	describe('마크다운 회귀 테스트 (REQ-P6-015)', () => {
		it('.md 파일은 여전히 Raw MD API를 사용해야 한다', async () => {
			// 로컬 .md 업로드
			vault._textMap.set('notes/test.md', '# Test');
			const file = createMockFile('notes/test.md', '# Test');
			mockApiClient.rawUpload.mockResolvedValueOnce({ id: 1, path: 'notes/test.md', hash: 'h', sizeBytes: 6, version: 1 });

			await engine.handleLocalCreate(file);

			expect(mockApiClient.rawUpload).toHaveBeenCalledWith('notes/test.md', '# Test', undefined, undefined);
			expect(mockApiClient.uploadAttachment).not.toHaveBeenCalled();
		});

		it('.md 파일 다운로드는 여전히 rawDownload를 사용해야 한다', async () => {
			mockApiClient.getEvents.mockResolvedValueOnce([
				{ id: '10', event_type: 'created', file_path: 'notes/remote.md', device_id: 'device-2', created_at: '2026-01-01' },
			]);
			mockApiClient.rawDownload.mockResolvedValueOnce('# Remote');
			mockApiClient.updateSyncStatus.mockResolvedValueOnce(undefined);

			await engine.pollRemoteChanges();

			expect(mockApiClient.rawDownload).toHaveBeenCalledWith('notes/remote.md');
			expect(mockApiClient.downloadAttachment).not.toHaveBeenCalled();
		});
	});

	// ============================================================
	// SPEC-P6-EVENT-007: WS 이벤트 멱등성 및 직렬 처리
	// ============================================================

	describe('이벤트 큐 직렬 처리 (REQ-EVT-001)', () => {
		it('3개 이벤트를 큐에 넣으면 _processEvent가 순차적으로 3번 호출되어야 한다', async () => {
			const callOrder: string[] = [];
			mockApiClient.getEvents.mockResolvedValueOnce([
				{ id: 'e1', event_type: 'created', file_path: 'a.md', device_id: 'device-2', created_at: '2026-01-01' },
				{ id: 'e2', event_type: 'created', file_path: 'b.md', device_id: 'device-2', created_at: '2026-01-01' },
				{ id: 'e3', event_type: 'created', file_path: 'c.md', device_id: 'device-2', created_at: '2026-01-01' },
			]);
			mockApiClient.rawDownload.mockImplementation(async (path: string) => {
				callOrder.push(path);
				return `content-${path}`;
			});
			mockApiClient.updateSyncStatus.mockResolvedValue(undefined);

			await engine.pollRemoteChanges();

			expect(callOrder).toEqual(['a.md', 'b.md', 'c.md']);
			expect(mockApiClient.updateSyncStatus).toHaveBeenCalledWith('e3');
		});
	});

	describe('이벤트 중복 제거 (REQ-EVT-002, REQ-EVT-004)', () => {
		it('동일한 이벤트 ID를 두 번 처리해도 _processEvent는 한 번만 호출되어야 한다', async () => {
			mockApiClient.getEvents.mockResolvedValueOnce([
				{ id: 'dup-1', event_type: 'created', file_path: 'dup.md', device_id: 'device-2', created_at: '2026-01-01' },
			]);
			mockApiClient.rawDownload.mockResolvedValue('content');
			mockApiClient.updateSyncStatus.mockResolvedValue(undefined);

			await engine.pollRemoteChanges();

			expect(mockApiClient.rawDownload).toHaveBeenCalledTimes(1);

			// 두 번째 호출에서 같은 이벤트 ID가 다시 들어오면 무시
			mockApiClient.getEvents.mockResolvedValueOnce([
				{ id: 'dup-1', event_type: 'created', file_path: 'dup.md', device_id: 'device-2', created_at: '2026-01-01' },
			]);
			vi.clearAllMocks();
			mockApiClient.updateSyncStatus.mockResolvedValue(undefined);

			await engine.pollRemoteChanges();

			expect(mockApiClient.rawDownload).not.toHaveBeenCalled();
		});

		it('중복 이벤트가 섞여 있어도 고유 이벤트만 처리해야 한다', async () => {
			mockApiClient.getEvents.mockResolvedValueOnce([
				{ id: 'a', event_type: 'created', file_path: 'a.md', device_id: 'device-2', created_at: '2026-01-01' },
				{ id: 'a', event_type: 'created', file_path: 'a.md', device_id: 'device-2', created_at: '2026-01-01' },
				{ id: 'b', event_type: 'created', file_path: 'b.md', device_id: 'device-2', created_at: '2026-01-01' },
			]);
			mockApiClient.rawDownload.mockResolvedValue('content');
			mockApiClient.updateSyncStatus.mockResolvedValue(undefined);

			await engine.pollRemoteChanges();

			expect(mockApiClient.rawDownload).toHaveBeenCalledTimes(2);
		});
	});

	describe('WS 콜백이 큐를 통해 라우팅 (REQ-EVT-001)', () => {
		it('enableRealtimeMode의 syncEvent 콜백이 _enqueueEvent를 사용해야 한다', async () => {
			// WSClient mock에서 on 콜백 캡처
			const capturedCallbacks: Record<string, Function> = {};
			const mockWsClient = {
				connect: vi.fn(),
				close: vi.fn(),
				on: vi.fn((event: string, handler: Function) => {
					capturedCallbacks[event] = handler;
				}),
				isConnected: false,
				reconnectAttempts: 0,
				buildWSUrl: vi.fn().mockReturnValue('ws://localhost/ws/sync/vault-1?token=test-token'),
			};
			vi.mocked(WSClient).mockReturnValueOnce(mockWsClient as any);

			engine.enableRealtimeMode();

			// syncEvent 콜백이 등록되었는지 확인
			expect(mockWsClient.on).toHaveBeenCalledWith('syncEvent', expect.any(Function));

			// 콜백 실행 시 _processEvent가 아닌 큐를 통해 처리되는지 확인
			const syncEventCallback = capturedCallbacks['syncEvent'];
			expect(syncEventCallback).toBeDefined();

			// 이벤트 전송
			mockApiClient.rawDownload.mockResolvedValue('ws-content');
			mockApiClient.updateSyncStatus.mockResolvedValue(undefined);

			await syncEventCallback({
				id: 'ws-evt-1',
				event_type: 'created',
				file_path: 'ws-file.md',
				device_id: 'device-2',
				created_at: '2026-01-01',
			});

			expect(mockApiClient.rawDownload).toHaveBeenCalledWith('ws-file.md');
			expect(mockApiClient.updateSyncStatus).toHaveBeenCalledWith('ws-evt-1');
		});
	});

	describe('폴링이 큐를 통해 라우팅 (REQ-EVT-001)', () => {
		it('pollRemoteChanges가 이벤트를 _enqueueEvent로 처리해야 한다', async () => {
			mockApiClient.getEvents.mockResolvedValueOnce([
				{ id: 'p1', event_type: 'updated', file_path: 'polled.md', device_id: 'device-2', created_at: '2026-01-01' },
			]);
			mockApiClient.rawDownload.mockResolvedValue('polled-content');
			mockApiClient.updateSyncStatus.mockResolvedValue(undefined);

			await engine.pollRemoteChanges();

			expect(mockApiClient.rawDownload).toHaveBeenCalledWith('polled.md');
			expect(mockApiClient.updateSyncStatus).toHaveBeenCalledWith('p1');
		});
	});

	describe('performFullSync가 큐를 통해 라우팅 (REQ-EVT-001)', () => {
		it('performFullSync의 이벤트 처리가 _enqueueEvent를 사용해야 한다', async () => {
			vault._textMap.set('local.md', 'local-content');
			vault.getFiles.mockReturnValueOnce([createMockFile('local.md', 'local-content')]);
			mockApiClient.listFiles.mockResolvedValueOnce([]);
			mockApiClient.rawUpload.mockResolvedValue({ id: 1, path: 'local.md', hash: 'h', sizeBytes: 0, version: 1 });
			// _processDeletedEventsFirst + 이벤트 폴링에서 각각 getEvents 호출
			mockApiClient.getEvents
				.mockResolvedValueOnce([]) // _processDeletedEventsFirst
				.mockResolvedValueOnce([ // 이벤트 폴링
					{ id: 'fs1', event_type: 'created', file_path: 'remote-fs.md', device_id: 'device-2', created_at: '2026-01-01' },
				]);
			mockApiClient.rawDownload.mockResolvedValue('remote-content');
			mockApiClient.listFiles.mockResolvedValue([]);
			mockApiClient.updateSyncStatus.mockResolvedValue(undefined);

			await engine.performFullSync();

			expect(mockApiClient.rawDownload).toHaveBeenCalledWith('remote-fs.md');
			expect(mockApiClient.updateSyncStatus).toHaveBeenCalledWith('fs1');
		});

	});

		// ============================================================
		// SPEC-P6-DEDUP-003: 해시 기반 업로드 중복 제거
		// ============================================================

		describe('해시 캐시 (SPEC-P6-DEDUP-003)', () => {
			it('동일 해시면 업로드를 스킵해야 한다 (AC-002.2)', async () => {
				vault._textMap.set('notes/test.md', 'content');
				const cache = (engine as any)._hashCache as Map<string, string>;
				cache.set('notes/test.md', 'same-hash');
				vi.mocked(computeHash).mockResolvedValueOnce('same-hash');
				await (engine as any)._uploadLocalFile('notes/test.md');
				expect(mockApiClient.rawUpload).not.toHaveBeenCalled();
			});

			it('다른 해시면 업로드해야 한다 (AC-002.3)', async () => {
				vault._textMap.set('notes/test.md', 'new content');
				const cache = (engine as any)._hashCache as Map<string, string>;
				cache.set('notes/test.md', 'old-hash');
				vi.mocked(computeHash).mockResolvedValueOnce('new-hash');
				mockApiClient.rawUpload.mockResolvedValueOnce({ id: 1, path: 'notes/test.md', hash: 'server-new', sizeBytes: 11, version: 1 });
				await (engine as any)._uploadLocalFile('notes/test.md');
				expect(mockApiClient.rawUpload).toHaveBeenCalledWith('notes/test.md', 'new content', 'old-hash', undefined);
			});

			// ============================================================
			// SPEC-SYNC-3WAY-FIX-001 T-002: baseHash 전파
			// ============================================================

			it('업로드 시 캐시된 해시를 baseHash로 rawUpload에 전달해야 한다', async () => {
				vault._textMap.set('notes/test.md', 'content');
				const cache = (engine as any)._hashCache as Map<string, string>;
				cache.set('notes/test.md', 'cached-hash-abc');
				vi.mocked(computeHash).mockResolvedValueOnce('different-hash');
				mockApiClient.rawUpload.mockResolvedValueOnce({ id: 1, path: 'notes/test.md', hash: 'server-hash', sizeBytes: 7, version: 1 });
				await (engine as any)._uploadLocalFile('notes/test.md');
				expect(mockApiClient.rawUpload).toHaveBeenCalledWith('notes/test.md', 'content', 'cached-hash-abc', undefined);
			});

			it('업로드 성공 시 서버 해시로 캐시를 업데이트해야 한다 (AC-003.1)', async () => {
				vault._textMap.set('notes/test.md', 'content');
				vi.mocked(computeHash).mockResolvedValueOnce('client-hash');
				mockApiClient.rawUpload.mockResolvedValueOnce({ id: 1, path: 'notes/test.md', hash: 'server-hash-abc', sizeBytes: 7, version: 1 });
				await (engine as any)._uploadLocalFile('notes/test.md');
				const cache = (engine as any)._hashCache as Map<string, string>;
				expect(cache.get('notes/test.md')).toBe('server-hash-abc');
			});

			it('업로드 실패 시 캐시를 업데이트하지 않아야 한다 (AC-003.4)', async () => {
				vault._textMap.set('notes/test.md', 'content');
				const cache = (engine as any)._hashCache as Map<string, string>;
				cache.set('notes/test.md', 'original-hash');
				vi.mocked(computeHash).mockResolvedValueOnce('new-hash');
				mockApiClient.rawUpload.mockRejectedValueOnce(new Error('Network error'));
				await (engine as any)._uploadLocalFile('notes/test.md');
				expect(cache.get('notes/test.md')).toBe('original-hash');
			});

			it('설정에서 해시 캐시를 복원해야 한다 (AC-006.2)', () => {
				const s: VSyncSettings = { ...settings, hash_cache: { 'a.md': 'ha', 'b.md': 'hb' } };
				const e = new SyncEngine(s, vault as never, mockNotice);
				const c = (e as any)._hashCache as Map<string, string>;
				expect(c.size).toBe(2);
				expect(c.get('a.md')).toBe('ha');
			});

			it('hashCache 없는 설정으로 정상 시작 (AC-006.6)', () => {
				const e = new SyncEngine(settings, vault as never, mockNotice);
				expect(((e as any)._hashCache as Map<string, string>).size).toBe(0);
			});

			it('설정 변경 시 캐시를 초기화해야 한다 (AC-007.1)', () => {
				const cache = (engine as any)._hashCache as Map<string, string>;
				cache.set('test.md', 'hash');
				engine.updateSettings({ ...settings });
				// updateSettings creates a new Map instance
				const updatedCache = (engine as any)._hashCache as Map<string, string>;
				expect(updatedCache.size).toBe(0);
			});

			it('파일 삭제 시 캐시 엔트리를 제거해야 한다 (AC-007.3)', async () => {
				const cache = (engine as any)._hashCache as Map<string, string>;
				cache.set('notes/old.md', 'old-hash');
				mockApiClient.deleteFile.mockResolvedValueOnce(undefined);
				await engine.handleLocalDelete('notes/old.md');
				expect(cache.has('notes/old.md')).toBe(false);
			});

			// ============================================================
			// SPEC-SYNC-3WAY-FIX-001 T-003: 다운로드 후 캐시 업데이트
			// ============================================================
			it('원격 다운로드 후 캐시를 서버 해시로 업데이트해야 한다', async () => {
				const cache = (engine as any)._hashCache as Map<string, string>;
				cache.set('notes/remote.md', 'old-hash');
				mockApiClient.getEvents.mockResolvedValueOnce([
					{ id: '10', event_type: 'updated', file_path: 'notes/remote.md', device_id: 'device-2', created_at: '2026-01-01' },
				]);
				mockApiClient.rawDownload.mockResolvedValueOnce('remote content');
				// listFiles에서 서버 해시를 제공하여 캐시 업데이트에 사용
				mockApiClient.listFiles.mockResolvedValueOnce([
					{ id: 1, path: 'notes/remote.md', hash: 'server-hash-new', size_bytes: 14, created_at: '', updated_at: '' },
				]);
				mockApiClient.updateSyncStatus.mockResolvedValueOnce(undefined);
				await engine.pollRemoteChanges();
				expect(cache.get('notes/remote.md')).toBe('server-hash-new');
			});

			it('캐시 업데이트 시 onCacheUpdate 콜백을 호출해야 한다 (AC-006.3)', async () => {
				const cb = vi.fn();
				engine.setOnCacheUpdate(cb);
				vault._textMap.set('notes/test.md', 'content');
				vi.mocked(computeHash).mockResolvedValueOnce('hash-1');
				mockApiClient.rawUpload.mockResolvedValueOnce({ id: 1, path: 'notes/test.md', hash: 'sh', sizeBytes: 7, version: 1 });
				await (engine as any)._uploadLocalFile('notes/test.md');
				expect(cb).toHaveBeenCalledWith(expect.any(Map));
			});
		});

		describe('디바운스 (SPEC-P6-DEDUP-003 REQ-DP-008)', () => {
			it('연속 modify 시 마지막만 처리 (AC-008.2, AC-008.3)', async () => {
				vault._textMap.set('notes/test.md', 'content');
				const file = createMockFile('notes/test.md', 'content');
				vi.mocked(computeHash).mockResolvedValue('hash');
				mockApiClient.rawUpload.mockResolvedValue({ id: 1, path: 'notes/test.md', hash: 'h', sizeBytes: 7, version: 1 });
				vi.useFakeTimers();
				await engine.handleLocalModify(file);
				await engine.handleLocalModify(file);
				await engine.handleLocalModify(file);
				expect(mockApiClient.rawUpload).not.toHaveBeenCalled();
				await vi.advanceTimersByTimeAsync(500);
				expect(mockApiClient.rawUpload).toHaveBeenCalledTimes(1);
				vi.useRealTimers();
			});

			it('handleLocalCreate는 즉시 업로드 (AC-008.5)', async () => {
				vault._textMap.set('notes/new.md', 'new content');
				vi.mocked(computeHash).mockResolvedValueOnce('hash');
				mockApiClient.rawUpload.mockResolvedValueOnce({ id: 1, path: 'notes/new.md', hash: 'h', sizeBytes: 11, version: 1 });
				await engine.handleLocalCreate(createMockFile('notes/new.md', 'new content'));
				expect(mockApiClient.rawUpload).toHaveBeenCalledWith('notes/new.md', 'new content', undefined, undefined);
			});

			it('destroy 시 타이머 정리 (AC-008.6)', async () => {
				vault._textMap.set('notes/a.md', 'a');
				vault._textMap.set('notes/b.md', 'b');
				vi.useFakeTimers();
				await engine.handleLocalModify(createMockFile('notes/a.md', 'a'));
				await engine.handleLocalModify(createMockFile('notes/b.md', 'b'));
				engine.destroy();
				await vi.advanceTimersByTimeAsync(500);
				expect(mockApiClient.rawUpload).not.toHaveBeenCalled();
				vi.useRealTimers();
			});
		});

		describe('LRU 캐시 (SPEC-P6-DEDUP-003 REQ-DP-009)', () => {
			it('동일 키 업데이트 시 맨 뒤로 이동 (AC-009.4)', () => {
				(engine as any)._updateHashCache('a.md', 'hash-a');
				(engine as any)._updateHashCache('b.md', 'hash-b');
				(engine as any)._updateHashCache('a.md', 'hash-a-v2');
				const cache = (engine as any)._hashCache as Map<string, string>;
				expect([...cache.keys()]).toEqual(['b.md', 'a.md']);
				expect(cache.get('a.md')).toBe('hash-a-v2');
			});
		});

		describe('초기 동기화 캐시 (SPEC-P6-DEDUP-003 REQ-DP-004)', () => {
			it('서버 파일 목록으로 캐시 초기화 (AC-004.1)', async () => {
				mockApiClient.listFiles.mockResolvedValueOnce([
					{ id: 1, path: 'a.md', hash: 'sha', sizeBytes: 10, createdAt: '', updatedAt: '' },
					{ id: 2, path: 'b.md', hash: 'shb', sizeBytes: 20, createdAt: '', updatedAt: '' },
				]);
				vault.getFiles.mockReturnValueOnce([]);
				mockApiClient.rawDownload.mockResolvedValue('content');
				await engine.performInitialSync();
				const cache = (engine as any)._hashCache as Map<string, string>;
				expect(cache.get('a.md')).toBe('sha');
				expect(cache.get('b.md')).toBe('shb');
			});

			it('로컬에만 있는 파일은 업로드 후 캐시 업데이트 (AC-004.2)', async () => {
				mockApiClient.listFiles.mockResolvedValueOnce([]);
				vault._textMap.set('local.md', 'content');
				vault.getFiles.mockReturnValueOnce([createMockFile('local.md', 'content')]);
				mockApiClient.rawUpload.mockResolvedValueOnce({ id: 1, path: 'local.md', hash: 'uh', sizeBytes: 7, version: 1 });
				await engine.performInitialSync();
				const cache = (engine as any)._hashCache as Map<string, string>;
				expect(cache.get('local.md')).toBe('uh');
			});
		});

		describe('전체 동기화 캐시 재구축 (SPEC-P6-DEDUP-003 REQ-DP-005)', () => {
			it('performFullSync 시 캐시 비우고 재구축 (AC-005.1, AC-005.2)', async () => {
				const cache = (engine as any)._hashCache as Map<string, string>;
				cache.set('old.md', 'old-hash');
				vault._textMap.set('test.md', 'content');
				vault.getFiles.mockReturnValueOnce([createMockFile('test.md', 'content')]);
				mockApiClient.rawUpload.mockResolvedValue({ id: 1, path: 'test.md', hash: 'nh', sizeBytes: 7, version: 1 });
				mockApiClient.getEvents.mockResolvedValueOnce([]);
				mockApiClient.updateSyncStatus.mockResolvedValue(undefined);
				await engine.performFullSync();
				expect(cache.has('old.md')).toBe(false);
				expect(cache.get('test.md')).toBe('nh');
			});
		});

	// ============================================================
	// SPEC-P6-PERSIST-004: 오프라인 큐 Flush 트리거
	// ============================================================

	describe('flushOfflineQueue (SPEC-P6-PERSIST-004)', () => {
		it('flushOfflineQueue이 client.flushQueue를 호출해야 한다', async () => {
			await engine.flushOfflineQueue();
			expect(mockApiClient.flushQueue).toHaveBeenCalled();
		});
	});

	describe('WS 재연결 시 flush 트리거 (REQ-P6-008)', () => {
		it('WS connected 이벤트 시 flushOfflineQueue를 호출해야 한다', async () => {
			const capturedCallbacks: Record<string, Function> = {};
			const mockWsClient = {
				connect: vi.fn(),
				close: vi.fn(),
				on: vi.fn((event: string, handler: Function) => {
					capturedCallbacks[event] = handler;
				}),
				isConnected: false,
				reconnectAttempts: 0,
				buildWSUrl: vi.fn().mockReturnValue('ws://localhost/ws/sync/vault-1?token=test-token'),
			};
			vi.mocked(WSClient).mockReturnValueOnce(mockWsClient as any);

			engine.enableRealtimeMode();

			const statusChangeCallback = capturedCallbacks['statusChange'];
			expect(statusChangeCallback).toBeDefined();

			mockApiClient.getEvents.mockResolvedValueOnce([]);
			statusChangeCallback('connected', 'realtime');

			// flushOfflineQueue가 호출되었는지 확인 (비동기)
			await new Promise((resolve) => setTimeout(resolve, 10));
			expect(mockApiClient.flushQueue).toHaveBeenCalled();
		});
	});

	describe('performFullSync 시 큐 flush 우선 (REQ-P6-008)', () => {
		it('performFullSync 시작 시 flushQueue를 먼저 호출해야 한다', async () => {
			vault._textMap.set('test.md', 'content');
			vault.getFiles.mockReturnValueOnce([createMockFile('test.md', 'content')]);
			mockApiClient.rawUpload.mockResolvedValue({ id: 1, path: 'test.md', hash: 'h', sizeBytes: 0, version: 1 });
			mockApiClient.getEvents.mockResolvedValueOnce([]);
			mockApiClient.updateSyncStatus.mockResolvedValue(undefined);

			await engine.performFullSync();

			expect(mockApiClient.flushQueue).toHaveBeenCalled();
		});
	});

		// ============================================================
		// SPEC-P8-PLUGIN-API-001 Cycle 3: 배치 연산 (T-006, T-007, T-008)
		// ============================================================

		describe('배치 파일 업로드 (REQ-PA-001, T-006)', () => {
			it('텍스트 파일 120개를 50개 단위 청크로 batchOperations를 호출해야 한다', async () => {
				mockApiClient.listFiles.mockResolvedValueOnce([]);
				const localFiles: MockTFile[] = [];
				for (let i = 0; i < 120; i++) {
					const name = `notes/file-${i}.md`;
					vault._textMap.set(name, `content-${i}`);
					localFiles.push(createMockFile(name, `content-${i}`));
				}
				vault.getFiles.mockReturnValueOnce(localFiles);

				mockApiClient.batchOperations.mockResolvedValue({
					results: localFiles.map((f) => ({ path: f.path, status: 200, hash: `hash-${f.path}` })),
				});

				await engine.performInitialSync();

				expect(mockApiClient.batchOperations).toHaveBeenCalledTimes(3);
				const calls = mockApiClient.batchOperations.mock.calls;
				expect(calls[0][0]).toHaveLength(50);
				expect(calls[1][0]).toHaveLength(50);
				expect(calls[2][0]).toHaveLength(20);
			});

			it('바이너리 파일은 배치에서 제외하고 개별 업로드해야 한다', async () => {
				mockApiClient.listFiles.mockResolvedValueOnce([]);
				const textFile = createMockFile('notes/text.md', 'text content');
				const binaryFile = createMockFile('images/photo.png');
				vault._textMap.set('notes/text.md', 'text content');
				const binaryData = new Uint8Array([1, 2, 3]).buffer;
				vault._binaryMap.set('images/photo.png', binaryData);
				vault.getFiles.mockReturnValueOnce([textFile, binaryFile]);

				mockApiClient.batchOperations.mockResolvedValue({
					results: [{ path: 'notes/text.md', status: 200, hash: 'h1' }],
				});
				mockApiClient.uploadAttachment.mockResolvedValue({
					id: 2, path: 'images/photo.png', hash: 'h2', sizeBytes: 3, version: 1,
				});

				await engine.performInitialSync();

				expect(mockApiClient.batchOperations).toHaveBeenCalledTimes(1);
				expect(mockApiClient.batchOperations.mock.calls[0][0]).toHaveLength(1);
				expect(mockApiClient.batchOperations.mock.calls[0][0][0].type).toBe('create');
				expect(mockApiClient.uploadAttachment).toHaveBeenCalledWith('images/photo.png', binaryData);
			});

			it('배치 실패 시 개별 업로드로 폴백해야 한다', async () => {
				mockApiClient.listFiles.mockResolvedValueOnce([]);
				const f1 = createMockFile('a.md', 'a');
				const f2 = createMockFile('b.md', 'b');
				vault._textMap.set('a.md', 'a');
				vault._textMap.set('b.md', 'b');
				vault.getFiles.mockReturnValueOnce([f1, f2]);

				mockApiClient.batchOperations.mockRejectedValueOnce(new Error('Batch not supported'));
				mockApiClient.rawUpload
					.mockResolvedValueOnce({ id: 1, path: 'a.md', hash: 'ha', sizeBytes: 1, version: 1 })
					.mockResolvedValueOnce({ id: 2, path: 'b.md', hash: 'hb', sizeBytes: 1, version: 1 });

				await engine.performInitialSync();

				expect(mockApiClient.rawUpload).toHaveBeenCalledTimes(2);
			});
		});

		describe('배치 혼합 연산 (REQ-PA-002, T-007)', () => {
			it('업로드와 삭제가 혼합된 배치를 전송해야 한다', async () => {
				const uploadFiles = [
					{ path: 'new1.md', content: 'c1', hash: 'h1' },
					{ path: 'new2.md', content: 'c2', hash: 'h2' },
				];
				const deletePaths = ['old1.md', 'old2.md'];

				mockApiClient.batchOperations.mockResolvedValueOnce({
					results: [
						{ path: 'new1.md', status: 200, hash: 'rh1' },
						{ path: 'new2.md', status: 200, hash: 'rh2' },
						{ path: 'old1.md', status: 200 },
						{ path: 'old2.md', status: 200 },
					],
				});

				await (engine as any)._batchUploadFiles(uploadFiles, deletePaths);

				expect(mockApiClient.batchOperations).toHaveBeenCalledTimes(1);
				const ops = mockApiClient.batchOperations.mock.calls[0][0];
				expect(ops).toHaveLength(4);
				const creates = ops.filter((op: any) => op.type === 'create');
				const deletes = ops.filter((op: any) => op.type === 'delete');
				expect(creates).toHaveLength(2);
				expect(deletes).toHaveLength(2);
			});
		});

		describe('배치 부분 실패 (REQ-PA-003, T-008)', () => {
			it('207 Multi-Status: 실패 항목은 오프라인 큐로, 성공은 캐시 업데이트', async () => {
				const uploadFiles = [
					{ path: 'ok1.md', content: 'c1', hash: 'h1' },
					{ path: 'ok2.md', content: 'c2', hash: 'h2' },
					{ path: 'fail.md', content: 'c3', hash: 'h3' },
				];

				mockApiClient.batchOperations.mockResolvedValueOnce({
					results: [
						{ path: 'ok1.md', status: 200, hash: 'rh1' },
						{ path: 'ok2.md', status: 200, hash: 'rh2' },
						{ path: 'fail.md', status: 500 },
					],
				});

				await (engine as any)._batchUploadFiles(uploadFiles, []);

				const cache = (engine as any)._hashCache as Map<string, string>;
				expect(cache.get('ok1.md')).toBe('rh1');
				expect(cache.get('ok2.md')).toBe('rh2');
				expect(mockApiClient.enqueue).toHaveBeenCalledWith(
					expect.objectContaining({ filePath: 'fail.md', operation: 'upload' })
				);
			});

			it('200 전체 성공: 모든 해시를 캐시에 업데이트해야 한다', async () => {
				const uploadFiles = [
					{ path: 'a.md', content: 'ca', hash: 'ha' },
					{ path: 'b.md', content: 'cb', hash: 'hb' },
				];

				mockApiClient.batchOperations.mockResolvedValueOnce({
					results: [
						{ path: 'a.md', status: 200, hash: 'ra' },
						{ path: 'b.md', status: 200, hash: 'rb' },
					],
				});

				await (engine as any)._batchUploadFiles(uploadFiles, []);

				const cache = (engine as any)._hashCache as Map<string, string>;
				expect(cache.get('a.md')).toBe('ra');
				expect(cache.get('b.md')).toBe('rb');
				expect(mockApiClient.enqueue).not.toHaveBeenCalled();
			});
		});

		// ============================================================
		// SPEC-P8-PLUGIN-API-001 Cycle 4: 파일 이동 감지 (T-009, T-010, T-011)
		// ============================================================

		describe('handleLocalRename (REQ-RN-001 ~ REQ-RN-005)', () => {
			it('AC-001: rename 이벤트로 서버 moveFile 호출', async () => {
				mockApiClient.moveFile.mockResolvedValueOnce({ success: true, from: 'old.md', to: 'new.md' });

				await (engine as any).handleLocalRename('old.md', 'new.md');

				expect(mockApiClient.moveFile).toHaveBeenCalledWith('old.md', 'new.md', undefined);
			});

			it('AC-002: rename 성공 시 해시 캐시 이관', async () => {
				mockApiClient.moveFile.mockResolvedValueOnce({ success: true, from: 'notes/old.md', to: 'notes/new.md' });
				const cache = (engine as any)._hashCache as Map<string, string>;
				cache.set('notes/old.md', 'hash-abc');

				await (engine as any).handleLocalRename('notes/old.md', 'notes/new.md');

				expect(cache.has('notes/old.md')).toBe(false);
				expect(cache.get('notes/new.md')).toBe('hash-abc');
			});

			it('AC-003: rename 실패 시 graceful degradation', async () => {
				mockApiClient.moveFile.mockRejectedValueOnce(new Error('Server error'));

				await (engine as any).handleLocalRename('old.md', 'new.md');

				expect(mockApiClient.moveFile).toHaveBeenCalledWith('old.md', 'new.md', undefined);
				// 에러가 catch되고 notice 호출 - 크래시 없음
				expect(mockNotice).toHaveBeenCalledWith(expect.stringContaining('Rename failed'));
			});

			it('AC-004: 동기화 대상이 아닌 파일 스킵', async () => {
				await (engine as any).handleLocalRename('.obsidian/config', '.obsidian/config-new');

				expect(mockApiClient.moveFile).not.toHaveBeenCalled();
			});

			it('AC-005: 바이너리 파일 rename 지원', async () => {
				mockApiClient.moveFile.mockResolvedValueOnce({ success: true, from: 'old.png', to: 'new.png' });

				await (engine as any).handleLocalRename('old.png', 'new.png');

				expect(mockApiClient.moveFile).toHaveBeenCalledWith('old.png', 'new.png', undefined);
			});

			it('syncing 중일 때 스킵', async () => {
				engine.setSyncing(true);

				await (engine as any).handleLocalRename('old.md', 'new.md');

				expect(mockApiClient.moveFile).not.toHaveBeenCalled();

				engine.setSyncing(false);
			});

			it('oldPath가 동기화 대상이 아니면 스킵', async () => {
				await (engine as any).handleLocalRename('.obsidian/old.md', 'new.md');

				expect(mockApiClient.moveFile).not.toHaveBeenCalled();
			});
		});



		describe('REQ-SYNC-004: Upload redirect hashCache update', () => {
			it('redirected_from 응답 시 hashCache에서 이전 경로 제거 후 새 해시 설정', async () => {
				const cache = (engine as any)._hashCache as Map<string, string>;
				cache.set('notes/old.md', 'hash-old');

				mockApiClient.rawUpload.mockResolvedValueOnce({
					id: 'file-id',
					path: 'notes/new.md',
					hash: 'hash-new',
					size_bytes: 100,
					version: 2,
					redirected_from: 'notes/old.md',
				});

				vault._textMap.set('notes/old.md', 'updated content');
				await (engine as any)._uploadLocalFile('notes/old.md');

				// redirected_from 처리 후 _updateHashCache가 실행되므로
				// normalizedPath(notes/old.md)에 새 해시가 설정됨
				expect(cache.get('notes/old.md')).toBe('hash-new');
				// rawUpload가 호출되었는지 확인
				expect(mockApiClient.rawUpload).toHaveBeenCalledWith(
					'notes/old.md', 'updated content', 'hash-old', undefined
				);
			});
		});

		describe('REQ-SYNC-005: Rename optimistic locking', () => {
			it('409 Conflict 시 conflict queue에 적재되어야 한다', async () => {
				const conflictError = new Error('Conflict') as Error & { status: number };
				conflictError.status = 409;
				mockApiClient.moveFile.mockRejectedValueOnce(conflictError);

				const cache = (engine as any)._hashCache as Map<string, string>;
				cache.set('notes/old.md', 'hash-abc');

				await (engine as any).handleLocalRename('notes/old.md', 'notes/new.md');

				const conflictQueue = (engine as any)._conflictQueue;
				if (conflictQueue) {
					const items = conflictQueue.getAll();
					expect(items.length).toBe(1);
					expect(items[0].file_path).toBe('notes/new.md');
					expect(items[0].type).toBe('rename');
				}
			});
		});

		describe('moved 이벤트 처리 (REQ-PA-005, T-010)', () => {
			it('moved 이벤트 시 로컬 파일을 새 경로로 이동', async () => {
				vault._textMap.set('notes/old.md', 'content');
				mockApiClient.getEvents.mockResolvedValueOnce([
					{ id: 'm1', event_type: 'moved', file_path: 'notes/new.md', device_id: 'device-2', created_at: '2026-01-01', from_path: 'notes/old.md' },
				]);
				mockApiClient.rawDownload.mockResolvedValueOnce('content');
				mockApiClient.updateSyncStatus.mockResolvedValueOnce(undefined);

				await engine.pollRemoteChanges();

				expect(vault.readIfExists).toHaveBeenCalledWith('notes/old.md');
				// SPEC-OBSIDIAN-API-GAP-001 REQ-API-002: renameFile 사용으로 변경
				expect(vault.renameFile).toHaveBeenCalledWith('notes/old.md', 'notes/new.md');
			});

			it('moved 이벤트: 대상 경로에 파일 존재 → 충돌 큐', async () => {
				vault._textMap.set('notes/old.md', 'old content');
				vault._textMap.set('notes/new.md', 'existing content');
				const cq = new ConflictQueue();
				(engine as any)._conflictQueue = cq;

				mockApiClient.getEvents.mockResolvedValueOnce([
					{ id: 'm2', event_type: 'moved', file_path: 'notes/new.md', device_id: 'device-2', created_at: '2026-01-01', from_path: 'notes/old.md' },
				]);
				mockApiClient.updateSyncStatus.mockResolvedValueOnce(undefined);

				await engine.pollRemoteChanges();

				expect(cq.size()).toBe(1);
				expect(cq.peek()?.file_path).toBe('notes/new.md');
			});
		});

		describe('null file_path 이벤트 처리', () => {
			it('file_path가 null인 이벤트는 스킵해야 한다', async () => {
				mockApiClient.getEvents.mockResolvedValueOnce([
					{ id: 'n1', event_type: 'deleted', file_path: null, device_id: 'device-2', created_at: '2026-01-01' },
				]);
				mockApiClient.updateSyncStatus.mockResolvedValueOnce(undefined);

				await engine.pollRemoteChanges();

				// null file_path 이벤트는 크래시 없이 스킵
				expect(mockApiClient.rawDownload).not.toHaveBeenCalled();
				expect(vault.delete).not.toHaveBeenCalled();
			});

			it('moved 이벤트에서 from_path가 없으면 created로 폴백', async () => {
				mockApiClient.getEvents.mockResolvedValueOnce([
					{ id: 'm-fb1', event_type: 'moved', file_path: 'notes/fallback.md', device_id: 'device-2', created_at: '2026-01-01' },
				]);
				mockApiClient.rawDownload.mockResolvedValueOnce('fallback content');
				mockApiClient.updateSyncStatus.mockResolvedValueOnce(undefined);

				await engine.pollRemoteChanges();

				// from_path 없으면 created로 폴백하여 다운로드
				expect(mockApiClient.rawDownload).toHaveBeenCalledWith('notes/fallback.md');
			});
		});

		describe('이동 충돌 (REQ-PA-006, T-011)', () => {
			it('POST /move 409 → 충돌 해결 inline 호출 (local/server content 포함)', async () => {
				mockApiClient.moveFile.mockRejectedValueOnce(Object.assign(new Error('Conflict'), { status: 409 }));
			mockApiClient.rawDownload.mockReset();
				mockApiClient.rawDownload.mockResolvedValue('server content');

				const cq = new ConflictQueue();
				(engine as any)._conflictQueue = cq;

				await (engine as any).handleLocalRename('notes/old.md', 'notes/new.md');

				// 409 → _resolveConflictInline 호출 → _onConflict 없으면 큐에 적재
				expect(mockApiClient.rawDownload).toHaveBeenCalledWith('notes/new.md');
				expect(cq.size()).toBe(1);
				const item = cq.getAll()[0];
				expect(item.file_path).toBe('notes/new.md');
				expect(item.type).toBe('rename');
				expect(item.server_content).toBe('server content');
			});
		});

		// ============================================================
		// SPEC-P8-PLUGIN-API-001 Cycle 5: 서버 충돌 해결 (T-012, T-015)
		// ============================================================

		describe('서버 충돌 동기화 (REQ-PA-007, T-012)', () => {
			it('시작 시 서버 충돌 목록을 로컬 큐에 머지', async () => {
				const cq = new ConflictQueue();
				(engine as any)._conflictQueue = cq;

				mockApiClient.getConflicts.mockResolvedValueOnce([
					{ id: 'sc-1', original_path: 'notes/a.md', conflict_path: 'notes/a.sync-conflict.md', created_at: '2026-04-19T00:00:00Z' },
					{ id: 'sc-2', original_path: 'notes/b.md', conflict_path: 'notes/b.sync-conflict.md', created_at: '2026-04-19T00:00:00Z' },
				]);

				await (engine as any).syncServerConflicts();

				expect(cq.size()).toBe(2);
				expect(cq.getAll()[0].file_path).toBe('notes/a.md');
				expect(cq.getAll()[0].conflict_id).toBe('sc-1');
			});

			it('중복 충돌은 큐에 추가하지 않음', async () => {
				const cq = new ConflictQueue();
				(engine as any)._conflictQueue = cq;
				cq.enqueue({
					id: 'local-1',
					file_path: 'notes/a.md',
					local_content: '',
					server_content: '',
					diff: null,
					base_hash: null,
					conflict_id: 'sc-1',
					type: 'simple',
					timestamp: Date.now(),
					source: 'download',
				});

				mockApiClient.getConflicts.mockResolvedValueOnce([
					{ id: 'sc-1', original_path: 'notes/a.md', conflict_path: 'notes/a.sync-conflict.md', created_at: '2026-04-19T00:00:00Z' },
				]);

				await (engine as any).syncServerConflicts();

				expect(cq.size()).toBe(1);
			});

			it('getConflicts 실패 시 무시 (graceful degradation)', async () => {
				const cq = new ConflictQueue();
				(engine as any)._conflictQueue = cq;
				mockApiClient.getConflicts.mockRejectedValueOnce(new Error('Network error'));

				await (engine as any).syncServerConflicts();

				expect(cq.size()).toBe(0);
			});
		});

		describe('자동 병합 (REQ-PA-010, T-015)', () => {
			it('can_auto_merge=true 시 충돌 큐 생략 후 자동 병합', async () => {
				const cq = new ConflictQueue();
				(engine as any)._conflictQueue = cq;
				vi.mocked(computeHash).mockResolvedValueOnce('merged-hash');
				mockApiClient.rawUpload.mockResolvedValueOnce({ id: 1, path: 'auto.md', hash: 'merged-hash', sizeBytes: 10, version: 2 });
				mockApiClient.mergeResolve.mockResolvedValueOnce(undefined);

				const result = await (engine as any)._tryAutoMerge('auto.md', 'local content', 'server content', 'conflict-id-1');

				expect(result).toBe(true);
				expect(cq.size()).toBe(0);
				expect(mockApiClient.rawUpload).toHaveBeenCalled();
				expect(mockApiClient.mergeResolve).toHaveBeenCalledWith('conflict-id-1', 'local content', 'merged-hash');
			});

			it('자동 병합 실패 시 false 반환', async () => {
				const cq = new ConflictQueue();
				(engine as any)._conflictQueue = cq;
				vi.mocked(computeHash).mockResolvedValueOnce('hash');
				mockApiClient.rawUpload.mockRejectedValueOnce(new Error('Upload failed'));

				const result = await (engine as any)._tryAutoMerge('fail.md', 'local', 'server', 'conflict-id-2');

				expect(result).toBe(false);
			});
		});


		// ============================================================
		// SPEC-P8-PLUGIN-API-001 Cycle 6: 디바이스 관리 (T-016, T-017)
		// ============================================================

		describe('디바이스 목록 조회 (REQ-PA-011, T-016)', () => {
			it('getDevices를 통해 디바이스 목록 반환', async () => {
				mockApiClient.getDevices.mockResolvedValueOnce([
					{ device_id: 'dev-1', lastSyncAt: '2026-01-01T00:00:00Z', isCurrent: true },
					{ device_id: 'dev-2', lastSyncAt: '2026-01-02T00:00:00Z', isCurrent: false },
				]);

				const devices = await (engine as any).getDevices();

				expect(devices).toHaveLength(2);
				expect(devices[0].isCurrent).toBe(true);
				expect(devices[1].isCurrent).toBe(false);
			});

			it('getDevices 실패 시 빈 배열 반환', async () => {
				mockApiClient.getDevices.mockRejectedValueOnce(new Error('Network'));

				const devices = await (engine as any).getDevices();

				expect(devices).toEqual([]);
			});
		});

		describe('디바이스 제거 (REQ-PA-012, T-017)', () => {
			it('removeDevice를 호출하여 디바이스 제거', async () => {
				mockApiClient.removeDevice.mockResolvedValueOnce(undefined);

				await (engine as any).removeDevice('dev-2');

				expect(mockApiClient.removeDevice).toHaveBeenCalledWith('dev-2');
			});

			it('현재 디바이스는 제거 불가', async () => {
				await expect((engine as any).removeDevice(settings.device_id))
					.rejects.toThrow('Cannot remove current device');
				expect(mockApiClient.removeDevice).not.toHaveBeenCalled();
			});
		});


		// ============================================================
		// SPEC-P8-PLUGIN-API-001 Cycle 7: 검색 연동 (T-018, T-019)
		// ============================================================

		describe('서버 전문 검색 (REQ-PA-013, T-018)', () => {
			it('searchFiles를 통해 검색 결과 반환', async () => {
				mockApiClient.searchFiles.mockResolvedValueOnce({
					results: [
						{ path: 'notes/a.md', snippet: 'hello world', score: 0.95 },
						{ path: 'notes/b.md', snippet: 'hello there', score: 0.8 },
					],
					total: 2,
				});

				const results = await (engine as any).searchFiles('hello');

				expect(results.results).toHaveLength(2);
				expect(results.total).toBe(2);
				expect(mockApiClient.searchFiles).toHaveBeenCalledWith('hello', undefined);
			});

			it('검색 옵션 전달 (limit, folder)', async () => {
				mockApiClient.searchFiles.mockResolvedValueOnce({ results: [], total: 0 });

				await (engine as any).searchFiles('test', { limit: 10 });

				expect(mockApiClient.searchFiles).toHaveBeenCalledWith('test', { limit: 10 });
			});

			it('검색 실패 시 빈 결과 반환', async () => {
				mockApiClient.searchFiles.mockRejectedValueOnce(new Error('Network'));

				const results = await (engine as any).searchFiles('fail');

				expect(results.results).toEqual([]);
				expect(results.total).toBe(0);
			});
		});

		describe('검색 결과 표시 (REQ-PA-014, T-019)', () => {
			it('검색 결과에 path, snippet, score 포함', async () => {
				mockApiClient.searchFiles.mockResolvedValueOnce({
					results: [
						{ path: 'notes/doc.md', snippet: 'match text here', score: 0.92 },
					],
					total: 1,
				});

				const results = await (engine as any).searchFiles('match');

				expect(results.results[0].path).toBe('notes/doc.md');
				expect(results.results[0].snippet).toContain('match');
				expect(results.results[0].score).toBeGreaterThan(0);
			});
		});


		// ============================================================
		// SPEC-P8-PLUGIN-API-001 Cycle 8: API 최적화 (T-020, T-021)
		// ============================================================

		describe('페이지네이션 지원 (REQ-PA-018, T-020)', () => {
			it('listFiles 페이지네이션: hasMore=true 시 다음 페이지 조회', async () => {
				// 첫 번째 페이지
				mockApiClient.listFiles.mockResolvedValueOnce({
					files: [
						{ id: 1, path: 'a.md', hash: 'ha', sizeBytes: 10, createdAt: '2026-01-01', updatedAt: '2026-01-01' },
					],
					hasMore: true,
					cursor: 'cursor-1',
				});
				// 두 번째 페이지
				mockApiClient.listFiles.mockResolvedValueOnce({
					files: [
						{ id: 2, path: 'b.md', hash: 'hb', sizeBytes: 20, createdAt: '2026-01-01', updatedAt: '2026-01-01' },
					],
					hasMore: false,
				});

				const result = await (engine as any).listFilesPaginated();

				expect(result).toHaveLength(2);
				expect(mockApiClient.listFiles).toHaveBeenCalledTimes(2);
				expect(mockApiClient.listFiles).toHaveBeenNthCalledWith(2, { cursor: 'cursor-1' });
			});

			it('hasMore 없으면 전체 결과 사용 (하위 호환)', async () => {
				mockApiClient.listFiles.mockResolvedValueOnce([
					{ id: 1, path: 'a.md', hash: 'ha', sizeBytes: 10, createdAt: '2026-01-01', updatedAt: '2026-01-01' },
				]);

				const result = await (engine as any).listFilesPaginated();

				expect(result).toHaveLength(1);
				expect(mockApiClient.listFiles).toHaveBeenCalledTimes(1);
			});
		});

		describe('타겟팅된 해시 조회 (REQ-PA-019, T-021)', () => {
			it('로컬 파일 없으면 충돌 감지 없이 다운로드 후 listFiles로 캐시 업데이트', async () => {
				// 로컬 파일 존재하지 않음 → 충돌 감지 생략, listFiles는 캐시 업데이트용 호출
				mockApiClient.rawDownload.mockResolvedValueOnce('remote content');
				mockApiClient.listFiles.mockResolvedValueOnce([
					{ id: 1, path: 'remote.md', hash: 'server-h', size_bytes: 14, created_at: '', updated_at: '' },
				]);
				mockApiClient.updateSyncStatus.mockResolvedValue(undefined);

				const events = [
					{ id: 'h1', event_type: 'updated', file_path: 'remote.md', device_id: 'dev-2', created_at: '2026-01-01' },
				];
				mockApiClient.getEvents.mockResolvedValueOnce(events);

				await engine.pollRemoteChanges();

				expect(mockApiClient.rawDownload).toHaveBeenCalledWith('remote.md');
				// 캐시 업데이트를 위해 listFiles 호출
				expect(mockApiClient.listFiles).toHaveBeenCalled();
				const cache = (engine as any)._hashCache as Map<string, string>;
				expect(cache.get('remote.md')).toBe('server-h');
			});
		});

	
		// ============================================================
		// SPEC-SYNC-3WAY-FIX-001 T-006: 통합 시나리오 테스트
		// ============================================================
		describe('통합 시나리오 (SPEC-SYNC-3WAY-FIX-001 T-006)', () => {
			it('시나리오 1: 다중 기기 편집 충돌 시 baseHash 전달', async () => {
				// 기기 A에서 파일 생성 → 서버에 업로드됨 (hash: 'v1-hash')
				// 기기 B에서 동일 파일 수정 → 서버에 업로드됨 (hash: 'v2-hash')
				// 기기 A가 performFullSync → 서버 해시('v2-hash')를 baseHash로 전달
				vault._textMap.set('shared.md', 'A edits');
				vault.getFiles.mockReturnValueOnce([createMockFile('shared.md', 'A edits')]);
				vi.mocked(computeHash).mockResolvedValueOnce('v1-hash');
				mockApiClient.listFiles.mockResolvedValueOnce([
					{ id: 1, path: 'shared.md', hash: 'v2-hash', size_bytes: 10, created_at: '', updated_at: '' },
				]);
				mockApiClient.rawUpload.mockResolvedValue({ id: 1, path: 'shared.md', hash: 'merged-hash', sizeBytes: 8, version: 2 });
				mockApiClient.getEvents.mockResolvedValueOnce([]);
				mockApiClient.updateSyncStatus.mockResolvedValue(undefined);

				await engine.performFullSync();

				// baseHash로 서버 해시 전달 → 3-way merge 트리거
				expect(mockApiClient.rawUpload).toHaveBeenCalledWith('shared.md', 'A edits', 'v2-hash', undefined);
				// 캐시에 merge 결과 해시 저장
				const cache = (engine as any)._hashCache as Map<string, string>;
				expect(cache.get('shared.md')).toBe('merged-hash');
			});

			it('시나리오 2: 전체 동기화 후 해시 캐시 일관성', async () => {
				// 3개 파일: 동일(skip), 다름(upload), 서버에만 있음(download)
				vault._textMap.set('same.md', 'same content');
				vault._textMap.set('changed.md', 'new content');
				vault.getFiles.mockReturnValueOnce([
					createMockFile('same.md', 'same content'),
					createMockFile('changed.md', 'new content'),
				]);
				vi.mocked(computeHash)
					.mockResolvedValueOnce('same-hash')   // same.md 로컬 해시
					.mockResolvedValueOnce('changed-hash'); // changed.md 로컬 해시
				mockApiClient.listFiles.mockResolvedValueOnce([
					{ id: 1, path: 'same.md', hash: 'same-hash', size_bytes: 12, created_at: '', updated_at: '' },
					{ id: 2, path: 'changed.md', hash: 'old-hash', size_bytes: 10, created_at: '', updated_at: '' },
					{ id: 3, path: 'remote-only.md', hash: 'remote-hash', size_bytes: 8, created_at: '', updated_at: '' },
				]);
				mockApiClient.rawUpload.mockResolvedValue({ id: 2, path: 'changed.md', hash: 'uploaded-hash', sizeBytes: 12, version: 2 });
				mockApiClient.rawDownload.mockResolvedValue('remote content');
				mockApiClient.getEvents.mockResolvedValueOnce([]);
				mockApiClient.updateSyncStatus.mockResolvedValue(undefined);

				await engine.performFullSync();

				const cache = (engine as any)._hashCache as Map<string, string>;
				// same.md: 스킵, 서버 해시로 캐시 업데이트
				expect(cache.get('same.md')).toBe('same-hash');
				// changed.md: 업로드, 결과 해시로 캐시 업데이트
				expect(cache.get('changed.md')).toBe('uploaded-hash');
				// same.md는 rawUpload 호출되지 않음
				expect(mockApiClient.rawUpload).not.toHaveBeenCalledWith('same.md', expect.anything(), expect.anything());
				// changed.md는 baseHash와 함께 업로드
				expect(mockApiClient.rawUpload).toHaveBeenCalledWith('changed.md', 'new content', 'old-hash', undefined);
				// remote-only.md 다운로드됨
				expect(mockApiClient.rawDownload).toHaveBeenCalledWith('remote-only.md');
			});

			it('시나리오 3: 새 파일 생성 시 baseHash 없이 업로드 후 캐시 구축', async () => {
				// 로컬에만 있는 새 파일 → 서버에 업로드
				vault._textMap.set('new-note.md', 'new file content');
				vault.getFiles.mockReturnValueOnce([createMockFile('new-note.md', 'new file content')]);
				vi.mocked(computeHash).mockResolvedValueOnce('new-hash');
				mockApiClient.listFiles.mockResolvedValueOnce([]);
				mockApiClient.rawUpload.mockResolvedValue({ id: 1, path: 'new-note.md', hash: 'server-new-hash', sizeBytes: 16, version: 1 });
				mockApiClient.getEvents.mockResolvedValueOnce([]);
				mockApiClient.updateSyncStatus.mockResolvedValue(undefined);

				await engine.performFullSync();

				// baseHash 없이 업로드 (서버에 없으므로)
				expect(mockApiClient.rawUpload).toHaveBeenCalledWith('new-note.md', 'new file content', undefined, undefined);
				// 캐시에 서버 응답 해시 저장
				const cache = (engine as any)._hashCache as Map<string, string>;
				expect(cache.get('new-note.md')).toBe('server-new-hash');
			});
		});

	});
