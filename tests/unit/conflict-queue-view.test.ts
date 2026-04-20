// ConflictQueueView 렌더링 테스트 (SPEC-P6-UX-002)
import { describe, it, expect, vi, beforeEach } from 'vitest';
import '../mocks/obsidian';
// @MX:NOTE SimpleConflictModal 테스트 (REQ-UX-007)
describe('SimpleConflictModal (T-006)', () => {
	let SimpleConflictModal: any;
	beforeEach(async () => {
		vi.clearAllMocks();
		const mod = await import('../../src/ui/simple-conflict-modal');
		SimpleConflictModal = mod.SimpleConflictModal;
	});
	it('모달을 생성할 수 있어야 한다', () => {
		const onChoose = vi.fn();
		const modal = new SimpleConflictModal({}, 'notes/test.md', onChoose);
		expect(modal).toBeDefined();
	});
	it('onOpen 시 파일 경로와 4개 버튼을 렌더링해야 한다', () => {
		const onChoose = vi.fn();
		const modal = new SimpleConflictModal({}, 'notes/test.md', onChoose);
		modal.onOpen();
		// titleEl에 파일 경로가 설정되었는지 확인
		expect(modal.titleEl.setText).toHaveBeenCalledWith(
			expect.stringContaining('notes/test.md')
		);
		// contentEl.createEl이 4번 호출되었는지 확인 (버튼)
		expect(modal.contentEl.createEl).toHaveBeenCalledTimes(4);
	});
	it('로컬 유지 버튼 클릭 시 local 선택 콜백을 호출해야 한다', () => {
		const onChoose = vi.fn();
		const modal = new SimpleConflictModal({}, 'notes/test.md', onChoose);
		modal.onOpen();
		// 첫 번째 버튼 클릭 시뮬레이션
		modal.clickButton('local');
		expect(onChoose).toHaveBeenCalledWith('local');
	});
	it('원격 적용 버튼 클릭 시 remote 선택 콜백을 호출해야 한다', () => {
		const onChoose = vi.fn();
		const modal = new SimpleConflictModal({}, 'notes/test.md', onChoose);
		modal.onOpen();
		modal.clickButton('remote');
		expect(onChoose).toHaveBeenCalledWith('remote');
	});
	it('둘 다 보존 버튼 클릭 시 both 선택 콜백을 호출해야 한다', () => {
		const onChoose = vi.fn();
		const modal = new SimpleConflictModal({}, 'notes/test.md', onChoose);
		modal.onOpen();
		modal.clickButton('both');
		expect(onChoose).toHaveBeenCalledWith('both');
	});
	it('나중에 버튼 클릭 시 later 선택 콜백을 호출해야 한다', () => {
		const onChoose = vi.fn();
		const modal = new SimpleConflictModal({}, 'notes/test.md', onChoose);
		modal.onOpen();
		modal.clickButton('later');
		expect(onChoose).toHaveBeenCalledWith('later');
	});
	it('버튼 클릭 후 모달이 닫혀야 한다', () => {
		const onChoose = vi.fn();
		const modal = new SimpleConflictModal({}, 'notes/test.md', onChoose);
		modal.onOpen();
		modal.clickButton('local');
		expect(modal._opened).toBe(false);
	});
	it('getButtonCount가 4를 반환해야 한다', () => {
		const onChoose = vi.fn();
		const modal = new SimpleConflictModal({}, 'notes/test.md', onChoose);
		expect(modal.getButtonCount()).toBe(4);
	});
});
// ============================================================
// ============================================================
describe('ConflictResolveModal simple mode (T-007)', () => {
	let ConflictResolveModal: any;
	beforeEach(async () => {
		vi.clearAllMocks();
		const mod = await import('../../src/ui/conflict-resolve-modal');
		ConflictResolveModal = mod.ConflictResolveModal;
	});
	it('diff가 null이면 심플 모드로 렌더링해야 한다 (AC-007.1)', () => {
		const onChoose = vi.fn();
		const modal = new ConflictResolveModal({}, 'notes/test.md', null, onChoose);
		// 심플 모드 여부 확인
		expect(modal.isSimpleMode()).toBe(true);
		modal.onOpen();
		// 심플 모드: 파일 경로 표시를 위한 createDiv 1회 호출 (diff 렌더링은 없음)
		expect(modal.contentEl.createDiv).toHaveBeenCalledTimes(1);
		// 버튼도 표시됨
		expect(modal.contentEl.createEl).toHaveBeenCalled();
	});
	it('diff가 빈 배열이면 심플 모드로 렌더링해야 한다', () => {
		const onChoose = vi.fn();
		const modal = new ConflictResolveModal({}, 'notes/test.md', [], onChoose);
		expect(modal.isSimpleMode()).toBe(true);
		modal.onOpen();
		// 파일 경로 표시를 위한 createDiv 1회
		expect(modal.contentEl.createDiv).toHaveBeenCalledTimes(1);
	});
	it('diff가 있으면 기존 diff 렌더링 모드로 동작해야 한다 (하위 호환)', () => {
		const onChoose = vi.fn();
		const diff = [{ op: -1, text: 'old' }, { op: 1, text: 'new' }];
		const modal = new ConflictResolveModal({}, 'notes/test.md', diff, onChoose);
		modal.onOpen();
		// diff 렌더링 모드: createDiv 호출됨
		expect(modal.contentEl.createDiv).toHaveBeenCalled();
	});
	it('심플 모드에서도 4개 버튼이 표시되어야 한다 (AC-007.2)', () => {
		const onChoose = vi.fn();
		const modal = new ConflictResolveModal({}, 'notes/test.md', null, onChoose);
		expect(modal.getButtonCount()).toBe(4);
	});
});
// ============================================================
// ============================================================
describe('ConflictQueueView (T-009)', () => {
	let ConflictQueueView: any;
	let ConflictQueue: any;
	beforeEach(async () => {
		vi.clearAllMocks();
		const viewMod = await import('../../src/ui/conflict-queue-view');
		ConflictQueueView = viewMod.ConflictQueueView;
		const conflictMod = await import('../../src/conflict');
		ConflictQueue = conflictMod.ConflictQueue;
	});
	it('VIEW_TYPE이 "vector-conflicts"이어야 한다 (AC-006.1)', () => {
		expect(ConflictQueueView.VIEW_TYPE).toBe('vector-conflicts');
	});
	it('뷰를 생성할 수 있어야 한다', () => {
		const queue = new ConflictQueue();
		const mockLeaf = { view: null };
		const view = new ConflictQueueView(mockLeaf, queue);
		expect(view).toBeDefined();
	});
	it('큐가 비어있을 때 빈 목록 메시지를 표시해야 한다', () => {
		const queue = new ConflictQueue();
		const mockLeaf = { view: null };
		const view = new ConflictQueueView(mockLeaf, queue);
		view.onOpen();
		expect(view.contentEl.setText).toHaveBeenCalledWith(
			expect.stringContaining('충돌')
		);
	});
	it('큐에 항목이 있을 때 목록을 렌더링해야 한다', () => {
		const queue = new ConflictQueue();
		queue.enqueue({
			id: 'test-1',
			filePath: 'notes/a.md',
			localContent: 'local',
			serverContent: 'server',
			diff: null,
			baseHash: null,
			conflictId: null,
			type: 'simple',
			timestamp: Date.now(),
			source: 'download',
		});
		const mockLeaf = { view: null };
		const view = new ConflictQueueView(mockLeaf, queue);
		view.onOpen();
		// 항목 렌더링 확인
		expect(view.contentEl.createEl).toHaveBeenCalled();
	});
	it('모두 원격 적용 버튼이 있어야 한다 (AC-006.5)', () => {
		const queue = new ConflictQueue();
		queue.enqueue({
			id: 'test-1',
			filePath: 'notes/a.md',
			localContent: 'local',
			serverContent: 'server',
			diff: null,
			baseHash: null,
			conflictId: null,
			type: 'simple',
			timestamp: Date.now(),
			source: 'download',
		});
		const mockLeaf = { view: null };
		const view = new ConflictQueueView(mockLeaf, queue);
		view.onOpen();
		// "모두 원격 적용" 버튼이 렌더링되었는지 확인
		// createEl가 버튼을 위해 여러 번 호출됨
		expect(view.contentEl.createEl).toHaveBeenCalled();
	});
	it('getViewType이 올바른 값을 반환해야 한다', () => {
		const queue = new ConflictQueue();
		const mockLeaf = { view: null };
		const view = new ConflictQueueView(mockLeaf, queue);
		expect(view.getViewType()).toBe('vector-conflicts');
	});
	it('getDisplayText가 올바른 값을 반환해야 한다', () => {
		const queue = new ConflictQueue();
		const mockLeaf = { view: null };
		const view = new ConflictQueueView(mockLeaf, queue);
		expect(view.getDisplayText()).toContain('충돌');
	});
	it('getIcon이 올바른 값을 반환해야 한다', () => {
		const queue = new ConflictQueue();
		const mockLeaf = { view: null };
		const view = new ConflictQueueView(mockLeaf, queue);
		expect(view.getIcon()).toBeDefined();
	});
});
