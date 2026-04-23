// SyncEvent Zod 스키마 테스트 (SPEC-TYPE-SAFETY-001)
//
// 목적: SyncEventSchema가 OpenAPI 명세의 SyncEvent 타입과 일치하는지,
// createMockSyncEvent이 유효한 목 데이터만 생성하는지 검증합니다.

import { describe, it, expect } from 'vitest';
import { SyncEventSchema, createMockSyncEvent } from '../../../src/schemas/sync-event';

describe('SyncEventSchema', () => {
	// ---- 기본 검증 ----

	it('유효한 SyncEvent 데이터를 통과시킨다', () => {
		const event = createMockSyncEvent();
		const result = SyncEventSchema.safeParse(event);
		expect(result.success).toBe(true);
	});

	it('모든 event_type 값을 허용한다', () => {
		for (const type of ['created', 'updated', 'deleted', 'moved'] as const) {
			const event = createMockSyncEvent({ event_type: type });
			expect(SyncEventSchema.safeParse(event).success).toBe(true);
		}
	});

	it('file_path가 null이어도 통과한다', () => {
		const event = createMockSyncEvent({ file_path: null });
		expect(SyncEventSchema.safeParse(event).success).toBe(true);
	});

	it('선택적 필드(file_type, from_path, sequence)가 있어도 통과한다', () => {
		const event = createMockSyncEvent({
			file_type: 'markdown',
			from_path: 'old/path.md',
			sequence: 42,
		});
		expect(SyncEventSchema.safeParse(event).success).toBe(true);
	});

	// ---- 거부 케이스 ----

	it('잘못된 event_type을 거부한다', () => {
		expect(SyncEventSchema.safeParse({
			id: '00000000-0000-0000-0000-000000000000',
			event_type: 'invalid',
			file_path: 'test.md',
			device_id: 'device-1',
			created_at: '2026-01-01T00:00:00Z',
		}).success).toBe(false);
	});

	it('id가 UUID가 아니면 거부한다', () => {
		expect(SyncEventSchema.safeParse({
			id: 'not-a-uuid',
			event_type: 'created',
			file_path: 'test.md',
			device_id: 'device-1',
			created_at: '2026-01-01T00:00:00Z',
		}).success).toBe(false);
	});

	it('필수 필드가 누락되면 거부한다', () => {
		const { id, ...noId } = createMockSyncEvent();
		expect(SyncEventSchema.safeParse(noId).success).toBe(false);
	});

	// ---- createMockSyncEvent 팩토리 ----

	it('override 없이 유효한 기본값을 생성한다', () => {
		const event = createMockSyncEvent();
		expect(event.id).toBe('00000000-0000-0000-0000-000000000000');
		expect(event.event_type).toBe('created');
		expect(event.file_path).toBe('notes/test.md');
		expect(event.device_id).toBe('device-1');
		expect(event.created_at).toBe('2026-01-01T00:00:00Z');
	});

	it('override 값이 결과에 반영된다', () => {
		const event = createMockSyncEvent({
			id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
			event_type: 'updated',
			file_path: 'docs/readme.md',
		});
		expect(event.id).toBe('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11');
		expect(event.event_type).toBe('updated');
		expect(event.file_path).toBe('docs/readme.md');
	});

	it('무효한 override가 들어가면 parse 에러를 던진다', () => {
		expect(() =>
			createMockSyncEvent({ event_type: 'invalid' as never })
		).toThrow();
	});
});
