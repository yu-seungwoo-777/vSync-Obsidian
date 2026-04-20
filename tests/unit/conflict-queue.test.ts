// ConflictQueue 단위 테스트 (SPEC-P6-UX-002)
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConflictQueue } from '../../src/conflict';
import type { ConflictQueueItem } from '../../src/conflict';
import type { ConflictResult } from '../../src/types';
// crypto 모킹이 아직 로드되지 않은 경우 보장
import '../mocks/obsidian';
// @MX:NOTE 테스트용 ConflictQueueItem 팩토리
let _itemIdCounter = 0;
function createTestItem(overrides: Partial<ConflictQueueItem> = {}): ConflictQueueItem {
	_itemIdCounter++;
	return {
		id: `test-id-${_itemIdCounter}`,
		filePath: 'notes/test.md',
		localContent: 'local content',
		serverContent: 'server content',
		diff: null,
		baseHash: null,
		conflictId: null,
		type: 'simple',
		timestamp: Date.now(),
		source: 'download',
		...overrides,
	};
}
describe('ConflictQueueItem type', () => {
	it('필수 필드를 모두 포함해야 한다', () => {
		const item = createTestItem();
		expect(item.id).toBeDefined();
		expect(typeof item.id).toBe('string');
		expect(item.filePath).toBe('notes/test.md');
		expect(item.localContent).toBe('local content');
		expect(item.serverContent).toBe('server content');
		expect(item.diff).toBeNull();
		expect(item.baseHash).toBeNull();
		expect(item.conflictId).toBeNull();
		expect(item.type).toBe('simple');
		expect(typeof item.timestamp).toBe('number');
		expect(item.source).toBe('download');
	});
	it('diff 타입 충돌 항목을 생성할 수 있어야 한다', () => {
		const diffOps = [{ op: -1, text: 'removed' }, { op: 1, text: 'added' }];
		const item = createTestItem({
			type: 'diff',
			diff: diffOps,
			baseHash: 'base-hash-123',
			conflictId: 'conflict-uuid-456',
			source: 'upload',
		});
		expect(item.type).toBe('diff');
		expect(item.diff).toHaveLength(2);
		expect(item.baseHash).toBe('base-hash-123');
		expect(item.conflictId).toBe('conflict-uuid-456');
		expect(item.source).toBe('upload');
	});
});
describe('ConflictResult type', () => {
	it('conflict: true discriminator를 가져야 한다', () => {
		const result: ConflictResult = {
			conflict: true,
			current_hash: 'hash-current',
			incoming_hash: 'hash-incoming',
			conflict_path: 'notes/test.md',
		};
		expect(result.conflict).toBe(true);
		expect(result.current_hash).toBeDefined();
		expect(result.incoming_hash).toBeDefined();
		expect(result.conflict_path).toBeDefined();
	});
	it('선택적 필드를 포함할 수 있어야 한다', () => {
		const result: ConflictResult = {
			conflict: true,
			current_hash: 'hash-current',
			incoming_hash: 'hash-incoming',
			conflict_path: 'notes/test.md',
			base_hash: 'base-hash',
			diff: [{ op: 1, text: 'added line' }],
			can_auto_merge: false,
		};
		expect(result.base_hash).toBe('base-hash');
		expect(result.diff).toHaveLength(1);
		expect(result.can_auto_merge).toBe(false);
	});
});
// ============================================================
// ============================================================
describe('ConflictQueue', () => {
	let queue: ConflictQueue;
	beforeEach(() => {
		queue = new ConflictQueue();
	});
	describe('enqueue + size', () => {
		it('항목을 큐에 추가하고 크기를 반환해야 한다 (AC-003.1)', () => {
			expect(queue.size()).toBe(0);
			queue.enqueue(createTestItem());
			expect(queue.size()).toBe(1);
			queue.enqueue(createTestItem({ filePath: 'notes/other.md' }));
			expect(queue.size()).toBe(2);
		});
		it('동일 파일 경로에 대해 기존 항목을 덮어쓰지 않고 신규로 추가해야 한다 (AC-003.3)', () => {
			const item1 = createTestItem({ filePath: 'notes/shared.md', localContent: 'version1' });
			const item2 = createTestItem({ filePath: 'notes/shared.md', localContent: 'version2' });
			queue.enqueue(item1);
			queue.enqueue(item2);
			expect(queue.size()).toBe(2);
			const all = queue.getAll();
			expect(all).toHaveLength(2);
			expect(all[0].localContent).toBe('version1');
			expect(all[1].localContent).toBe('version2');
		});
	});
	describe('dequeue', () => {
		it('FIFO 순서로 항목을 꺼내야 한다 (AC-003.1)', () => {
			const item1 = createTestItem({ filePath: 'first.md' });
			const item2 = createTestItem({ filePath: 'second.md' });
			queue.enqueue(item1);
			queue.enqueue(item2);
			const dequeued = queue.dequeue();
			expect(dequeued?.filePath).toBe('first.md');
			expect(queue.size()).toBe(1);
		});
		it('빈 큐에서 undefined를 반환해야 한다', () => {
			expect(queue.dequeue()).toBeUndefined();
		});
	});
	describe('peek', () => {
		it('큐의 첫 항목을 제거하지 않고 반환해야 한다', () => {
			const item = createTestItem({ filePath: 'peek-test.md' });
			queue.enqueue(item);
			const peeked = queue.peek();
			expect(peeked?.filePath).toBe('peek-test.md');
			expect(queue.size()).toBe(1);
		});
		it('빈 큐에서 undefined를 반환해야 한다', () => {
			expect(queue.peek()).toBeUndefined();
		});
	});
	describe('getAll', () => {
		it('모든 항목의 복사본을 반환해야 한다', () => {
			queue.enqueue(createTestItem({ filePath: 'a.md' }));
			queue.enqueue(createTestItem({ filePath: 'b.md' }));
			const all = queue.getAll();
			expect(all).toHaveLength(2);
			// 반환된 배열을 수정해도 큐에 영향 없음
			all.pop();
			expect(queue.size()).toBe(2);
		});
	});
	describe('resolve', () => {
		it('지정된 ID의 항목을 큐에서 제거해야 한다', () => {
			const item1 = createTestItem({ filePath: 'keep.md' });
			const item2 = createTestItem({ filePath: 'remove.md' });
			queue.enqueue(item1);
			queue.enqueue(item2);
			queue.resolve(item2.id);
			expect(queue.size()).toBe(1);
			const remaining = queue.getAll();
			expect(remaining[0].filePath).toBe('keep.md');
		});
		it('존재하지 않는 ID로 resolve 시 에러 없이 무시해야 한다', () => {
			queue.enqueue(createTestItem());
			queue.resolve('non-existent-id');
			expect(queue.size()).toBe(1);
		});
		it('resolve 후 onUpdate 콜백이 호출되어야 한다', () => {
			const onUpdate = vi.fn();
			queue.onUpdate(onUpdate);
			const item = createTestItem();
			queue.enqueue(item);
			onUpdate.mockClear();
			queue.resolve(item.id);
			expect(onUpdate).toHaveBeenCalledTimes(1);
		});
	});
	describe('clear', () => {
		it('모든 항목을 제거해야 한다', () => {
			queue.enqueue(createTestItem({ filePath: 'a.md' }));
			queue.enqueue(createTestItem({ filePath: 'b.md' }));
			queue.clear();
			expect(queue.size()).toBe(0);
			expect(queue.getAll()).toHaveLength(0);
		});
		it('clear 후 onUpdate 콜백이 호출되어야 한다', () => {
			const onUpdate = vi.fn();
			queue.onUpdate(onUpdate);
			queue.enqueue(createTestItem());
			onUpdate.mockClear();
			queue.clear();
			expect(onUpdate).toHaveBeenCalledTimes(1);
		});
	});
	describe('onUpdate', () => {
		it('enqueue 시 콜백이 호출되어야 한다 (AC-003.5)', () => {
			const onUpdate = vi.fn();
			queue.onUpdate(onUpdate);
			queue.enqueue(createTestItem());
			expect(onUpdate).toHaveBeenCalledTimes(1);
			expect(onUpdate).toHaveBeenCalledWith(expect.any(Array));
		});
		it('콜백에 현재 큐 상태를 전달해야 한다', () => {
			const onUpdate = vi.fn();
			queue.onUpdate(onUpdate);
			queue.enqueue(createTestItem({ filePath: 'test.md' }));
			const passedItems = onUpdate.mock.calls[0][0];
			expect(passedItems).toHaveLength(1);
			expect(passedItems[0].filePath).toBe('test.md');
		});
		it('새 콜백 등록 시 이전 콜백을 대체해야 한다', () => {
			const callback1 = vi.fn();
			const callback2 = vi.fn();
			queue.onUpdate(callback1);
			queue.onUpdate(callback2);
			queue.enqueue(createTestItem());
			expect(callback1).not.toHaveBeenCalled();
			expect(callback2).toHaveBeenCalledTimes(1);
		});
	});
});
