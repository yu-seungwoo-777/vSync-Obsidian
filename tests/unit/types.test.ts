// 타입 정의 테스트
import { describe, it, expect } from 'vitest';
import {
	DEFAULT_SETTINGS,
	isVSyncSettings,
	isFileInfo,
	isSyncEvent,
} from '../../src/types';
import type {
	VSyncSettings,
	FileInfo,
	SyncEvent,
	SyncStatusResponse,
	UploadResult,
	SyncState,
	OfflineQueueItem,
} from '../../src/types';

describe('Type Definitions', () => {
	describe('DEFAULT_SETTINGS', () => {
		it('기본 설정값이 올바른 구조를 가져야 한다', () => {
			expect(DEFAULT_SETTINGS).toEqual({
				server_url: '',
				api_key: '',
				vault_id: '',
				sync_interval: 30,
				device_id: '',
			});
		});

		it('필수 필드가 모두 존재해야 한다', () => {
			const keys = Object.keys(DEFAULT_SETTINGS);
			expect(keys).toContain('server_url');
			expect(keys).toContain('api_key');
			expect(keys).toContain('vault_id');
			expect(keys).toContain('sync_interval');
			expect(keys).toContain('device_id');
		});
	});

	describe('isVSyncSettings (타입 가드)', () => {
		it('유효한 설정 객체를 true로 판별해야 한다', () => {
			const valid: VSyncSettings = {
				server_url: 'https://example.com',
				api_key: 'test-key',
				vault_id: 'vault-1',
				sync_interval: 30,
				device_id: 'device-1',
			};
			expect(isVSyncSettings(valid)).toBe(true);
		});

		it('lastEventId가 포함된 설정도 true여야 한다', () => {
			const withCursor: VSyncSettings = {
				server_url: 'https://example.com',
				api_key: 'test-key',
				vault_id: 'vault-1',
				sync_interval: 30,
				device_id: 'device-1',
				last_event_id: '42',
			};
			expect(isVSyncSettings(withCursor)).toBe(true);
		});

		it('필수 필드가 누락되면 false를 반환해야 한다', () => {
			expect(isVSyncSettings({})).toBe(false);
			expect(isVSyncSettings({ server_url: 'test' })).toBe(false);
			expect(isVSyncSettings(null)).toBe(false);
			expect(isVSyncSettings(undefined)).toBe(false);
		});

		it('잘못된 타입의 필드가 있으면 false를 반환해야 한다', () => {
			expect(
				isVSyncSettings({
					server_url: 123,
					api_key: 'key',
					vault_id: 'v',
					sync_interval: 30,
					device_id: 'd',
				})
			).toBe(false);
		});
	});

	describe('isFileInfo (타입 가드)', () => {
		it('유효한 FileInfo 객체를 true로 판별해야 한다', () => {
			const valid: FileInfo = {
				id: '1',
				path: 'notes/test.md',
				hash: 'abc123',
				size_bytes: 100,
				created_at: '2026-01-01T00:00:00Z',
				updated_at: '2026-01-01T00:00:00Z',
			};
			expect(isFileInfo(valid)).toBe(true);
		});

		it('필수 필드가 누락되면 false를 반환해야 한다', () => {
			expect(isFileInfo({})).toBe(false);
			expect(isFileInfo({ id: 1, path: 'test.md' })).toBe(false);
			expect(isFileInfo(null)).toBe(false);
		});
	});

	describe('isSyncEvent (타입 가드)', () => {
		it('유효한 SyncEvent 객체를 true로 판별해야 한다', () => {
			const valid: SyncEvent = {
				id: '1',
				event_type: 'created',
				file_path: 'notes/test.md',
				device_id: 'device-1',
				created_at: '2026-01-01T00:00:00Z',
			};
			expect(isSyncEvent(valid)).toBe(true);
		});

		it('모든 이벤트 타입을 허용해야 한다', () => {
			for (const type of ['created', 'updated', 'deleted']) {
				const event = {
					id: '1',
					event_type: type,
					file_path: 'test.md',
					device_id: 'd',
					created_at: '2026-01-01',
				};
				expect(isSyncEvent(event)).toBe(true);
			}
		});

		it('잘못된 이벤트 타입은 false를 반환해야 한다', () => {
			const invalid = {
				id: '1',
				event_type: 'invalid',
				file_path: 'test.md',
				device_id: 'd',
				created_at: '2026-01-01',
			};
			expect(isSyncEvent(invalid)).toBe(false);
		});
	});

	// ============================================================
	// REQ-P6-017: 바이너리 오프라인 큐 항목
	// ============================================================

	describe('OfflineQueueItem (바이너리 지원)', () => {
		it('content가 string인 항목을 생성할 수 있어야 한다', () => {
			const item: OfflineQueueItem = {
				filePath: 'notes/test.md',
				content: '# Hello',
				operation: 'upload',
				timestamp: Date.now(),
				retryCount: 0,
			};
			expect(item.content).toBe('# Hello');
		});

		it('content가 ArrayBuffer인 항목을 생성할 수 있어야 한다', () => {
			const binaryData = new Uint8Array([1, 2, 3, 4, 5]).buffer;
			const item: OfflineQueueItem = {
				filePath: 'images/photo.png',
				content: binaryData,
				operation: 'upload',
				timestamp: Date.now(),
				retryCount: 0,
			};
			expect(item.content).toBeInstanceOf(ArrayBuffer);
		});
	});

	// ============================================================
	// SPEC-P6-EVENT-007: SyncEvent sequence 필드 (REQ-EVT-003)
	// ============================================================

	describe('SyncEvent sequence (REQ-EVT-003)', () => {
		it('SyncEvent에 sequence 필드를 포함할 수 있어야 한다', () => {
			const event: SyncEvent = {
				id: '1',
				event_type: 'created',
				file_path: 'notes/test.md',
				device_id: 'device-1',
				created_at: '2026-01-01T00:00:00Z',
				sequence: 42,
			};
			expect(event.sequence).toBe(42);
		});

		it('sequence 없는 SyncEvent도 유효해야 한다 (하위 호환)', () => {
			const event: SyncEvent = {
				id: '1',
				event_type: 'created',
				file_path: 'notes/test.md',
				device_id: 'device-1',
				created_at: '2026-01-01T00:00:00Z',
			};
			expect(event.sequence).toBeUndefined();
		});
	});
});
