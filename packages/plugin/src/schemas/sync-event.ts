// SyncEvent Zod 스키마 — 런타임 검증 및 테스트 목 데이터 생성 (SPEC-TYPE-SAFETY-001)
//
// OpenAPI 명세의 SyncEvent 타입과 동일한 구조를 검증합니다.
// 자동 생성된 정적 타입(api-types.ts)과 런타임 검증을 일치시키는 것이 목적입니다.

import { z } from 'zod';

/** SyncEvent 런타임 검증 스키마 */
export const SyncEventSchema = z.object({
	id: z.string().uuid(),
	event_type: z.enum(['created', 'updated', 'deleted', 'moved']),
	file_path: z.string().nullable(),
	file_type: z.string().nullable().optional(),
	device_id: z.string(),
	from_path: z.string().nullable().optional(),
	sequence: z.number().nullable().optional(),
	created_at: z.string(),
});

/** 스키마 입력 타입 (부분적 override 허용) */
export type SyncEventInput = z.input<typeof SyncEventSchema>;

/**
 * 테스트용 SyncEvent 목 데이터 팩토리
 *
 * 기본값으로 유효한 SyncEvent를 생성하며, 필요한 필드만 override 가능합니다.
 * 스키마 검증을 통과한 데이터만 반환합니다.
 */
export function createMockSyncEvent(overrides: Partial<SyncEventInput> = {}): z.infer<typeof SyncEventSchema> {
	const defaults: SyncEventInput = {
		id: '00000000-0000-0000-0000-000000000000',
		event_type: 'created',
		file_path: 'notes/test.md',
		device_id: 'device-1',
		created_at: '2026-01-01T00:00:00Z',
	};
	return SyncEventSchema.parse({ ...defaults, ...overrides });
}
