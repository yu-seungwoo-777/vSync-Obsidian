// 타입 정의 테스트 (SPEC-INITIAL-SYNC-MODAL-001 T-001)
import { describe, it, expect } from 'vitest';
import type {
	VSyncSettings,
	SyncClassification,
	LocalFileEntry,
	ConflictFile,
} from '../../../src/types';
import { DEFAULT_SETTINGS } from '../../../src/types';

describe('SyncClassification Types (T-001)', () => {
	// REQ-IS-001: SyncClassification 타입 존재 확인
	it('should have SyncClassification type with auto and user groups', () => {
		// 타입이 존재하는지 컴파일 타임에 확인
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

		expect(classification.auto).toBeDefined();
		expect(classification.user).toBeDefined();
		expect(classification.auto.downloads).toEqual([]);
		expect(classification.auto.uploads).toEqual([]);
		expect(classification.auto.deletions).toEqual([]);
		expect(classification.auto.skips).toEqual([]);
		expect(classification.user.downloads).toEqual([]);
		expect(classification.user.uploads).toEqual([]);
		expect(classification.user.conflicts).toEqual([]);
	});

	// REQ-IS-001: LocalFileEntry 타입 확인
	it('should have LocalFileEntry type with path and content', () => {
		const entry: LocalFileEntry = {
			path: 'test.md',
			content: 'test content',
		};

		expect(entry.path).toBe('test.md');
		expect(entry.content).toBe('test content');
	});

	// REQ-IS-001: ConflictFile 타입 확인
	it('should have ConflictFile type with path, serverHash, and localContent', () => {
		const conflict: ConflictFile = {
			path: 'conflict.md',
			serverHash: 'abc123',
			localContent: 'local content',
		};

		expect(conflict.path).toBe('conflict.md');
		expect(conflict.serverHash).toBe('abc123');
		expect(conflict.localContent).toBe('local content');
	});

	// REQ-IS-008: VSyncSettings.skipped_paths 타입 확인
	it('should have skipped_paths field in VSyncSettings', () => {
		const settings: VSyncSettings = {
			server_url: 'https://example.com',
			vault_id: 'vault-1',
			sync_interval: 30,
			connection_mode: 'realtime',
			device_id: 'device-1',
			sync_enabled: true,
			username: 'user',
			password: 'pass',
			session_token: 'token',
			skipped_paths: ['path1.md', 'path2.md'],
		};

		expect(settings.skipped_paths).toBeDefined();
		expect(settings.skipped_paths).toEqual(['path1.md', 'path2.md']);
	});

	// REQ-IS-008: DEFAULT_SETTINGS에 skipped_paths 초기값 확인
	it('should have skipped_paths initialized to empty array in DEFAULT_SETTINGS', () => {
		expect(DEFAULT_SETTINGS.skipped_paths).toBeDefined();
		expect(DEFAULT_SETTINGS.skipped_paths).toEqual([]);
	});
});
