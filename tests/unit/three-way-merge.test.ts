// @MX:NOTE 플러그인 3-way merge UI 테스트 (SPEC-P5-3WAY-001, T-007)
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConflictResolveModal } from '../../src/ui/conflict-resolve-modal.js';
import type { ModalChoice } from '../../src/ui/conflict-resolve-modal.js';

describe('SPEC-P5-3WAY-001 - Plugin ConflictResolveModal (T-007)', () => {
	let mockApp: unknown;
	let choiceCallback: (choice: ModalChoice) => void;

	beforeEach(() => {
		mockApp = {
			vault: {},
			workspace: {},
		};
		choiceCallback = vi.fn();
	});

	// @MX:NOTE AC-006.1: ConflictResolveModal 클래스 구현
	describe('모달 기본 동작', () => {
		it('모달이 생성되고 열 수 있다', () => {
			const modal = new ConflictResolveModal(
				mockApp,
				'test.md',
				[{ op: 0, text: 'line1\n' }, { op: -1, text: 'old\n' }, { op: 1, text: 'new\n' }],
				choiceCallback,
			);

			modal.open();
			expect(modal._opened).toBe(true);
		});

		it('diff가 없는 경우에도 모달이 열린다', () => {
			const modal = new ConflictResolveModal(
				mockApp,
				'test.md',
				[],
				choiceCallback,
			);

			modal.open();
			expect(modal._opened).toBe(true);
		});
	});

	// @MX:NOTE AC-006.3: 버튼 제공
	describe('버튼 동작', () => {
		it('네 개의 선택지 버튼이 존재한다', () => {
			const modal = new ConflictResolveModal(
				mockApp,
				'test.md',
				[{ op: 0, text: 'common' }, { op: -1, text: 'deleted' }, { op: 1, text: 'added' }],
				choiceCallback,
			);

			modal.open();

			// 버튼 존재 확인
			expect(modal.getButtonCount()).toBe(4);
		});

		it('로컬 유지 버튼 클릭 시 "local" 선택이 콜백으로 전달된다', () => {
			const modal = new ConflictResolveModal(
				mockApp,
				'test.md',
				[{ op: 0, text: 'line1' }],
				choiceCallback,
			);

			modal.open();
			modal.clickButton('local');

			expect(choiceCallback).toHaveBeenCalledWith('local');
		});

		it('원격 적용 버튼 클릭 시 "remote" 선택이 콜백으로 전달된다', () => {
			const modal = new ConflictResolveModal(
				mockApp,
				'test.md',
				[{ op: 0, text: 'line1' }],
				choiceCallback,
			);

			modal.open();
			modal.clickButton('remote');

			expect(choiceCallback).toHaveBeenCalledWith('remote');
		});

		it('둘 다 보존 버튼 클릭 시 "both" 선택이 콜백으로 전달된다', () => {
			const modal = new ConflictResolveModal(
				mockApp,
				'test.md',
				[{ op: 0, text: 'line1' }],
				choiceCallback,
			);

			modal.open();
			modal.clickButton('both');

			expect(choiceCallback).toHaveBeenCalledWith('both');
		});

		it('나중에 버튼 클릭 시 "later" 선택이 콜백으로 전달된다', () => {
			const modal = new ConflictResolveModal(
				mockApp,
				'test.md',
				[{ op: 0, text: 'line1' }],
				choiceCallback,
			);

			modal.open();
			modal.clickButton('later');

			expect(choiceCallback).toHaveBeenCalledWith('later');
		});
	});

	// @MX:NOTE AC-006.4: 100KB 초과 diff
	describe('대용량 diff 처리', () => {
		it('100KB 초과 diff는 "diff가 너무 김" 메시지를 표시한다', () => {
			// 100KB+ diff 생성
			const largeDiff = [{ op: 0, text: 'x'.repeat(1024 * 100 + 1) }];

			const modal = new ConflictResolveModal(
				mockApp,
				'large.md',
				largeDiff,
				choiceCallback,
			);

			modal.open();
			expect(modal.isDiffTooLarge()).toBe(true);
		});

		it('100KB 이하 diff는 정상 렌더링된다', () => {
			const smallDiff = [{ op: 0, text: 'short content' }];

			const modal = new ConflictResolveModal(
				mockApp,
				'small.md',
				smallDiff,
				choiceCallback,
			);

			modal.open();
			expect(modal.isDiffTooLarge()).toBe(false);
		});
	});

	// @MX:NOTE AC-006.2: diff 색상 렌더링
	describe('diff 렌더링', () => {
		it('삭제(op=-1) diff 항목이 빨간색 클래스로 렌더링된다', () => {
			const modal = new ConflictResolveModal(
				mockApp,
				'test.md',
				[{ op: -1, text: 'deleted text' }],
				choiceCallback,
			);

			modal.open();
			const renderedItems = modal.getRenderedDiffItems();
			expect(renderedItems.some(item => item.type === 'delete')).toBe(true);
		});

		it('추가(op=1) diff 항목이 초록색 클래스로 렌더링된다', () => {
			const modal = new ConflictResolveModal(
				mockApp,
				'test.md',
				[{ op: 1, text: 'added text' }],
				choiceCallback,
			);

			modal.open();
			const renderedItems = modal.getRenderedDiffItems();
			expect(renderedItems.some(item => item.type === 'insert')).toBe(true);
		});

		it('동일(op=0) diff 항목이 회색 클래스로 렌더링된다', () => {
			const modal = new ConflictResolveModal(
				mockApp,
				'test.md',
				[{ op: 0, text: 'common text' }],
				choiceCallback,
			);

			modal.open();
			const renderedItems = modal.getRenderedDiffItems();
			expect(renderedItems.some(item => item.type === 'equal')).toBe(true);
		});
	});
});

// ─── T-008: Plugin conflict.ts 3-way merge 통합 ──────────
describe('SPEC-P5-3WAY-001 - Plugin conflict.ts 통합 (T-008)', () => {
	const mockNotice = vi.fn();

	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe('handleMergeConflict', () => {
		it('diff 데이터가 있으면 모달을 띄운다', async () => {
			const { ConflictResolver } = await import('../../src/conflict.js');
			const resolver = new ConflictResolver(mockNotice);

			let capturedModal: any = null;
			const openModalMock = vi.fn().mockImplementation((modal: any) => {
				capturedModal = modal;
				// 즉시 'local' 선택하여 resolve
				modal.clickButton('local');
			});
			resolver.setOpenModal(openModalMock);

			const result = await resolver.handleMergeConflict({
				file_path: 'test.md',
				conflict_path: 'test.sync-conflict-123.md',
				diff: [{ op: -1, text: 'old' }, { op: 1, text: 'new' }],
				conflict_id: 'conflict-123',
				server_content: 'server version',
				local_content: 'local version',
			});

			expect(openModalMock).toHaveBeenCalled();
			expect(result).toBe('local');
		});

		it('diff 데이터가 없으면 기존 동작을 유지한다', async () => {
			const { ConflictResolver } = await import('../../src/conflict.js');
			const resolver = new ConflictResolver(mockNotice);

			const result = await resolver.handleMergeConflict({
				file_path: 'test.md',
				conflict_path: 'test.sync-conflict-123.md',
				diff: null,
				conflictId: null,
				server_content: 'server version',
				local_content: 'local version',
			});

			// 기존 동작: conflict 파일 경로 반환
			expect(result).toContain('.sync-conflict-');
			expect(mockNotice).toHaveBeenCalled();
		});

		it('"나중에" 선택 시 충돌 상태가 유지된다', async () => {
			const { ConflictResolver } = await import('../../src/conflict.js');
			const resolver = new ConflictResolver(mockNotice);

			const openModalMock = vi.fn().mockImplementation((modal: any) => {
				// "나중에" 선택
				modal.clickButton('later');
			});
			resolver.setOpenModal(openModalMock);

			const result = await resolver.handleMergeConflict({
				file_path: 'test.md',
				conflict_path: 'test.sync-conflict-123.md',
				diff: [{ op: -1, text: 'old' }],
				conflict_id: 'conflict-123',
				server_content: 'server version',
				local_content: 'local version',
			});

			expect(result).toBe('later');
		});
	});
});
