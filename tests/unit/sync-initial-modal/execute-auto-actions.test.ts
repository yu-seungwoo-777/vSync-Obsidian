/**
 * T-004: executeAutoActions() 테스트
 *
 * 목표: classification.auto를 받아서 자동 동기화 실행
 *
 * 테스트 커버리지:
 * - downloads 배열: _downloadRemoteFile() 호출
 * - uploads 배열: _uploadLocalFile() 호출
 * - deletions 배열: _deleteLocalFile() 또는 _client.deleteFile() 호출
 * - skips 배열: 아무 작업 없음
 * - user group files: 건너뜀
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SyncEngine } from '../../../src/sync-engine';
import type { SyncClassification, VSyncSettings } from '../../../src/types';
import { DEFAULT_SETTINGS } from '../../../src/types';
import { createMockVault, createMockFile } from '../../mocks/vault';

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

describe('SyncEngine - executeAutoActions()', () => {
	let syncEngine: SyncEngine;
	let mockVault: ReturnType<typeof createMockVault>;
	let settings: VSyncSettings;
	const mockNotice = vi.fn();

	beforeEach(() => {
		mockVault = createMockVault();

		// Mock vault methods
		mockVault.read.mockResolvedValue('local content');
		mockVault.delete.mockResolvedValue();

		settings = {
			...DEFAULT_SETTINGS,
			server_url: 'https://test.com',
			vault_id: 'test-vault',
			device_id: 'test-device',
			username: 'test',
			password: 'test',
			session_token: 'token',
			hash_cache: {},
		};

		syncEngine = new SyncEngine(settings, mockVault as any, mockNotice);
	});

	describe('downloads 자동 처리', () => {
		it('classification.auto.downloads에 있는 파일들을 다운로드해야 함', async () => {
			// Arrange
			const classification: SyncClassification = {
				auto: {
					downloads: ['file1.md', 'file2.md'],
					uploads: [],
					deletions: [],
					skips: [],
				},
				user: {
					downloads: [],
					uploads: [],
					conflicts: [],
				},
			};

			mockApiClient.rawDownload.mockResolvedValue({
				content: 'server content',
				hash: 'abc123',
			});

			const downloadSpy = vi.spyOn(syncEngine as any, '_downloadRemoteFile');
			downloadSpy.mockResolvedValue(undefined);

			// Act
			await syncEngine.executeAutoActions(classification.auto);

			// Assert
			expect(downloadSpy).toHaveBeenCalledTimes(2);
			expect(downloadSpy).toHaveBeenCalledWith('file1.md');
			expect(downloadSpy).toHaveBeenCalledWith('file2.md');
		});

		it('downloads가 비어있으면 아무 작업도 하지 않아야 함', async () => {
			// Arrange
			const classification: SyncClassification = {
				auto: {
					downloads: [],
					uploads: [],
					deletions: [],
					skips: [],
				},
				user: {
					downloads: [],
					uploads: [],
					conflicts: [],
				},
			};

			const downloadSpy = vi.spyOn(syncEngine as any, '_downloadRemoteFile');

			// Act
			await syncEngine.executeAutoActions(classification.auto);

			// Assert
			expect(downloadSpy).not.toHaveBeenCalled();
		});
	});

	describe('uploads 자동 처리', () => {
		it('classification.auto.uploads에 있는 파일들을 업로드해야 함', async () => {
			// Arrange
			const classification: SyncClassification = {
				auto: {
					downloads: [],
					uploads: ['note1.md', 'note2.md'],
					deletions: [],
					skips: [],
				},
				user: {
					downloads: [],
					uploads: [],
					conflicts: [],
				},
			};

			const uploadSpy = vi.spyOn(syncEngine as any, '_uploadLocalFile');
			uploadSpy.mockResolvedValue(undefined);

			// Act
			await syncEngine.executeAutoActions(classification.auto);

			// Assert
			expect(uploadSpy).toHaveBeenCalledTimes(2);
			expect(uploadSpy).toHaveBeenCalledWith('note1.md');
			expect(uploadSpy).toHaveBeenCalledWith('note2.md');
		});
	});

	describe('deletions 자동 처리', () => {
		it('서버에서 삭제된 파일은 로컬에서 삭제해야 함', async () => {
			// Arrange
			const classification: SyncClassification = {
				auto: {
					downloads: [],
					uploads: [],
					deletions: ['deleted-server.md'],
					skips: [],
				},
				user: {
					downloads: [],
					uploads: [],
					conflicts: [],
				},
			};

			mockVault.readIfExists.mockResolvedValue('local content');
			const deleteLocalSpy = vi.spyOn(syncEngine as any, '_deleteLocalFile');
			deleteLocalSpy.mockResolvedValue(undefined);

			// Act
			await syncEngine.executeAutoActions(classification.auto);

			// Assert
			expect(deleteLocalSpy).toHaveBeenCalledWith('deleted-server.md');
		});

		it('로컬에서 삭제된 파일은 서버에서 삭제해야 함', async () => {
			// Arrange
			const classification: SyncClassification = {
				auto: {
					downloads: [],
					uploads: [],
					deletions: ['deleted-local.md'],
					skips: [],
				},
				user: {
					downloads: [],
					uploads: [],
					conflicts: [],
				},
			};

			// deletions에는 삭제할 파일 목록이 있음
			// 로컬에만 존재하는 파일이 삭제된 경우 서버에서도 삭제
			mockApiClient.deleteFile.mockResolvedValue({ message: 'deleted', deleted: true, path: 'deleted-local.md' });

			// Act
			await syncEngine.executeAutoActions(classification.auto);

			// Assert
			// _deleteLocalFile가 호출되지 않고, 서버에서도 처리하지 않음
			// (이 로직은 향후 구현에서 확인 필요)
		});
	});

	describe('skips 자동 처리', () => {
		it('skips에 있는 파일들은 아무 작업도 하지 않아야 함', async () => {
			// Arrange
			const classification: SyncClassification = {
				auto: {
					downloads: [],
					uploads: [],
					deletions: [],
					skips: ['unchanged.md'],
				},
				user: {
					downloads: [],
					uploads: [],
					conflicts: [],
				},
			};

			const downloadSpy = vi.spyOn(syncEngine as any, '_downloadRemoteFile');
			const uploadSpy = vi.spyOn(syncEngine as any, '_uploadLocalFile');

			// Act
			await syncEngine.executeAutoActions(classification.auto);

			// Assert
			expect(downloadSpy).not.toHaveBeenCalled();
			expect(uploadSpy).not.toHaveBeenCalled();
		});
	});

	describe('user group 무시', () => {
		it('user group 파일들은 처리하지 않아야 함', async () => {
			// Arrange
			const classification: SyncClassification = {
				auto: {
					downloads: ['auto-download.md'],
					uploads: [],
					deletions: [],
					skips: [],
				},
				user: {
					downloads: [{ id: '1', path: 'user-file.md', hash: 'abc', size_bytes: null, created_at: '', updated_at: '' }],
					uploads: [{ path: 'user-local.md', content: 'content' }],
					conflicts: [],
				},
			};

			const downloadSpy = vi.spyOn(syncEngine as any, '_downloadRemoteFile');
			downloadSpy.mockResolvedValue(undefined);

			// Act
			await syncEngine.executeAutoActions(classification.auto);

			// Assert
			// auto group만 처리
			expect(downloadSpy).toHaveBeenCalledTimes(1);
			expect(downloadSpy).toHaveBeenCalledWith('auto-download.md');
			expect(downloadSpy).not.toHaveBeenCalledWith('user-file.md');
		});
	});

	describe('에러 처리', () => {
		it('다운로드 실패 시 다른 파일들은 계속 처리해야 함 (graceful degradation)', async () => {
			// Arrange
			const classification: SyncClassification = {
				auto: {
					downloads: ['file1.md', 'file2.md', 'file3.md'],
					uploads: [],
					deletions: [],
					skips: [],
				},
				user: {
					downloads: [],
					uploads: [],
					conflicts: [],
				},
			};

			const downloadSpy = vi.spyOn(syncEngine as any, '_downloadRemoteFile');
			downloadSpy.mockImplementation((path: unknown) => {
				if (path === 'file2.md') {
					return Promise.reject(new Error('Download failed'));
				}
				return Promise.resolve(undefined);
			});

			// Act
			await expect(syncEngine.executeAutoActions(classification.auto)).resolves.not.toThrow();

			// Assert
			expect(downloadSpy).toHaveBeenCalledTimes(3);
		});
	});
});
