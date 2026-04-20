// SyncEngine 신뢰성 테스트
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SyncEngine } from '../../src/sync-engine';
import { FileNotFoundError, VaultReadError } from '../../src/errors';
import { DEFAULT_SETTINGS } from '../../src/types';
import type { VectorSettings } from '../../src/types';
import { createMockVault } from '../mocks/vault';
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
};
vi.mock('../../src/api-client', () => ({
	VectorClient: vi.fn().mockImplementation(() => mockApiClient),
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
}));
// WS 클라이언트 mock
vi.mock('../../src/services/ws-client', () => ({
	WSClient: vi.fn().mockImplementation(() => ({
		connect: vi.fn(),
		close: vi.fn(),
		on: vi.fn(),
		isConnected: false,
		reconnectAttempts: 0,
		buildWSUrl: vi.fn().mockReturnValue('ws://localhost/ws/sync/vault-1?apiKey=test-key'),
	})),
	calculateReconnectDelay: vi.fn().mockReturnValue(1000),
}));
describe('SyncEngine - 신뢰성 (SPEC-P6-RELIABLE-005)', () => {
	let engine: SyncEngine;
	let vault: ReturnType<typeof createMockVault>;
	let settings: VectorSettings;
	beforeEach(() => {
		vi.clearAllMocks();
		settings = {
			...DEFAULT_SETTINGS,
			server_url: 'https://sync.example.com',
			api_key: 'test-key',
			vault_id: 'vault-1',
			device_id: 'device-1',
			sync_interval: 30,
		};
		vault = createMockVault();
		engine = new SyncEngine(settings, vault as never, mockNotice);
	});
	// ============================================================
	// REQ-R5-002: _uploadLocalFile readIfExists 사용
	// ============================================================
	describe('_uploadLocalFile - readIfExists (REQ-R5-002)', () => {
		// AC-002.1: readIfExists 사용
		it('존재하는 텍스트 파일은 정상 업로드해야 한다', async () => {
			vault._textMap.set('notes/test.md', 'content');
			mockApiClient.rawUpload.mockResolvedValue({ hash: 'hash-1' });
			await (engine as any)._uploadLocalFile('notes/test.md');
			expect(vault.readIfExists).toHaveBeenCalledWith('notes/test.md');
			expect(mockApiClient.rawUpload).toHaveBeenCalledWith('notes/test.md', 'content');
		});
		// AC-002.2: null 반환 시 스킵 (에러 없이)
		it('존재하지 않는 파일(null)은 에러 없이 스킵해야 한다', async () => {
			// 파일이 vault에 없음
			await (engine as any)._uploadLocalFile('missing.md');
			// rawUpload가 호출되지 않아야 함
			expect(mockApiClient.rawUpload).not.toHaveBeenCalled();
			// notice가 호출되지 않아야 함 (에러가 아님)
			expect(mockNotice).not.toHaveBeenCalled();
		});
		// AC-002.3: 빈 문자열 파일은 정상 업로드
		it('빈 문자열 파일은 정상 업로드해야 한다', async () => {
			vault._textMap.set('notes/empty.md', '');
			mockApiClient.rawUpload.mockResolvedValue({ hash: 'hash-empty' });
			await (engine as any)._uploadLocalFile('notes/empty.md');
			expect(mockApiClient.rawUpload).toHaveBeenCalledWith('notes/empty.md', '');
		});
		// AC-002.4: VaultReadError catch
		it('VaultReadError 발생 시 Notice를 표시해야 한다', async () => {
			vault._textMap.set('notes/broken.md', 'content');
			vault.readIfExists.mockRejectedValueOnce(new VaultReadError('notes/broken.md', new Error('read error')));
			await (engine as any)._uploadLocalFile('notes/broken.md');
			expect(mockNotice).toHaveBeenCalledWith(
				expect.stringContaining('broken.md'),
			);
		});
	});
	// ============================================================
	// REQ-R5-003: performInitialSync/performFullSync readIfExists 사용
	// ============================================================
	describe('performInitialSync - readIfExists (REQ-R5-003)', () => {
		beforeEach(() => {
			mockApiClient.listFiles.mockResolvedValue([]);
		});
		// AC-003.1: 로컬에만 있는 파일 업로드 시 readIfExists 사용
		it('로컬에만 있는 텍스트 파일을 readIfExists로 읽고 업로드해야 한다', async () => {
			vault._textMap.set('local-only.md', 'local content');
			mockApiClient.rawUpload.mockResolvedValue({ hash: 'hash-local' });
			mockApiClient.listFiles.mockResolvedValue([]);
			await engine.performInitialSync();
			// readIfExists가 호출되었는지 확인 (read가 아닌)
			expect(vault.readIfExists).toHaveBeenCalled();
		});
		// AC-003.3: null 반환 시 스킵하고 계속
		it('파일이 삭제된 경우(null) 스킵하고 다음 파일로 진행해야 한다', async () => {
			// 파일 목록에는 있지만 실제로는 없는 상황
			vault.getFiles.mockReturnValueOnce([{ path: 'deleted.md' }]);
			vault.readIfExists.mockResolvedValueOnce(null);
			mockApiClient.listFiles.mockResolvedValue([]);
			await engine.performInitialSync();
			// rawUpload가 호출되지 않아야 함
			expect(mockApiClient.rawUpload).not.toHaveBeenCalledWith(
				expect.stringContaining('deleted.md'),
				expect.anything(),
			);
			// 에러 없이 완료되어야 함
			expect(mockNotice).toHaveBeenCalledWith('Initial sync complete');
		});
		// 서버 파일과 해시 비교 시 readIfExists 사용
		it('양쪽에 있는 텍스트 파일을 readIfExists로 해시 비교해야 한다', async () => {
			vault._textMap.set('shared.md', 'content');
			mockApiClient.listFiles.mockResolvedValue([{ path: 'shared.md', hash: 'different-hash' }]);
			mockApiClient.rawUpload.mockResolvedValue({ hash: 'hash-shared' });
			await engine.performInitialSync();
			expect(vault.readIfExists).toHaveBeenCalled();
		});
	});
	describe('performFullSync - readIfExists (REQ-R5-003)', () => {
		// AC-003.2: performFullSync에서도 readIfExists 사용
		it('로컬 파일 업로드 시 readIfExists를 사용해야 한다', async () => {
			vault._textMap.set('note.md', 'content');
			mockApiClient.rawUpload.mockResolvedValue({ hash: 'hash-note' });
			mockApiClient.getEvents.mockResolvedValue([]);
			await engine.performFullSync();
			expect(vault.readIfExists).toHaveBeenCalled();
		});
		it('파일이 존재하지 않으면 스킵해야 한다', async () => {
			vault.getFiles.mockReturnValueOnce([{ path: 'ghost.md' }]);
			vault.readIfExists.mockResolvedValueOnce(null);
			mockApiClient.rawUpload.mockResolvedValue({ hash: 'hash' });
			mockApiClient.getEvents.mockResolvedValue([]);
			await engine.performFullSync();
			expect(mockApiClient.rawUpload).not.toHaveBeenCalledWith(
				'ghost.md',
				expect.anything(),
			);
		});
	});
	// ============================================================
	// REQ-R5-008: _downloadRemoteFile null 안전성
	// ============================================================
	describe('_downloadRemoteFile - null 안전성 (REQ-R5-008)', () => {
		// AC-008.1: readIfExists null 반환 시 안전하게 처리
		it('_downloadRemoteText에서 로컬 파일이 null이면 충돌 없이 다운로드해야 한다', async () => {
			mockApiClient.rawDownload.mockResolvedValue('remote content');
			mockApiClient.listFiles.mockResolvedValue([{ path: 'remote.md', hash: 'remote-hash' }]);
			vault.readIfExists.mockResolvedValueOnce(null); // 로컬에 없음
			await (engine as any)._downloadRemoteFile('remote.md', 'remote-hash');
			// write가 호출되어야 함 (다운로드 후 저장)
			expect(vault.write).toHaveBeenCalledWith('remote.md', 'remote content');
		});
		// AC-008.2: readIfExists가 로컬 내용을 반환하면 충돌 감지
		it('로컬 파일이 있으면 충돌 감지를 수행해야 한다', async () => {
			mockApiClient.rawDownload.mockResolvedValue('remote content');
			vault.readIfExists.mockResolvedValueOnce('local content');
			await (engine as any)._downloadRemoteFile('local.md', 'server-hash');
			// serverHash 제공 시 listFiles 없이 충돌 감지 (REQ-PA-019)
			expect(mockApiClient.listFiles).not.toHaveBeenCalled();
			expect(mockApiClient.rawDownload).toHaveBeenCalledWith('local.md');
		});
		// AC-008.3: null 반환 시 예외 없이 정상 동작
		it('readIfExists가 null을 반환해도 예외가 발생하지 않아야 한다', async () => {
			mockApiClient.rawDownload.mockResolvedValue('new content');
			vault.readIfExists.mockResolvedValueOnce(null);
			await expect(
				(engine as any)._downloadRemoteFile('new-file.md'),
			).resolves.not.toThrow();
		});
	});
});
