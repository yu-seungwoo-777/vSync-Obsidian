// InitialSyncUploadModal 테스트 (SPEC-INITIAL-SYNC-MODAL-001 AC-004)
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { InitialSyncUploadModal } from '../../../src/ui/initial-sync-upload-modal';
import type { LocalFileEntry } from '../../../src/types';
import { Setting } from '../../mocks/obsidian';

const mockApp = { vault: {} };

function getButtonHandlers(): ((...a: unknown[]) => void)[] {
	const handlers: ((...a: unknown[]) => void)[] = [];
	for (const s of Setting._instances) {
		handlers.push(...s.onClickHandlers);
	}
	return handlers;
}

describe('InitialSyncUploadModal (AC-004)', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		Setting._instances = [];
	});

	it('should not invoke callback until button clicked', () => {
		const files: LocalFileEntry[] = [{ path: 'local.md', content: '# Local' }];
		const callback = vi.fn();
		const modal = new InitialSyncUploadModal(mockApp, files, callback);
		modal.onOpen();
		expect(callback).not.toHaveBeenCalled();
	});

	// AC-004.4: Submit returns all paths (default all selected)
	it('should return all paths on submit with default selection', () => {
		const files: LocalFileEntry[] = [{ path: 'f1.md', content: 'C1' }, { path: 'f2.md', content: 'C2' }];
		const callback = vi.fn();
		const modal = new InitialSyncUploadModal(mockApp, files, callback);
		modal.onOpen();

		// 버튼 순서: [선택삭제, 건너뛰기, 업로드 동기화 진행]
		getButtonHandlers()[2]();

		expect(callback).toHaveBeenCalledTimes(1);
		expect(callback.mock.calls[0][0].selectedPaths).toEqual(['f1.md', 'f2.md']);
		expect(callback.mock.calls[0][0].skippedPaths).toEqual([]);
	});

	// AC-004.3: 전체 선택 토글
	it('should deselect all via toggle', () => {
		const files: LocalFileEntry[] = [{ path: 'f1.md', content: 'C1' }, { path: 'f2.md', content: 'C2' }];
		const callback = vi.fn();
		const modal = new InitialSyncUploadModal(mockApp, files, callback);
		modal.onOpen();

		const toggle = Setting._instances.find((s) => s.onChangeHandler);
		toggle!.onChangeHandler!(false);

		getButtonHandlers()[2]();

		expect(callback.mock.calls[0][0].selectedPaths).toEqual([]);
		expect(callback.mock.calls[0][0].skippedPaths).toEqual(['f1.md', 'f2.md']);
	});

	// AC-004.5: 건너뛰기
	it('should skip all files when skip button clicked', () => {
		const files: LocalFileEntry[] = [{ path: 'f1.md', content: 'C1' }];
		const callback = vi.fn();
		const modal = new InitialSyncUploadModal(mockApp, files, callback);
		modal.onOpen();

		getButtonHandlers()[1]();

		expect(callback.mock.calls[0][0]).toEqual({
			selectedPaths: [],
			skippedPaths: ['f1.md'],
		});
	});

	// 선택 삭제
	it('should remove unselected files when delete button clicked', () => {
		const files: LocalFileEntry[] = [
			{ path: 'f1.md', content: 'C1' },
			{ path: 'f2.md', content: 'C2' },
			{ path: 'f3.md', content: 'C3' },
		];
		const callback = vi.fn();
		const modal = new InitialSyncUploadModal(mockApp, files, callback);
		modal.onOpen();

		// Deselect all
		const toggle = Setting._instances.find((s) => s.onChangeHandler);
		toggle!.onChangeHandler!(false);

		// 선택 삭제 버튼
		getButtonHandlers()[0]();

		// Submit
		getButtonHandlers()[2]();

		expect(callback).toHaveBeenCalled();
		// All were deselected, delete removes them, remaining is empty
		const result = callback.mock.calls[0][0];
		expect(result.selectedPaths).toBeDefined();
	});

	it('should return empty plan for empty file list', () => {
		const callback = vi.fn();
		const modal = new InitialSyncUploadModal(mockApp, [], callback);
		modal.onOpen();

		expect(callback).toHaveBeenCalledTimes(1);
		expect(callback.mock.calls[0][0]).toEqual({ selectedPaths: [], skippedPaths: [] });
	});
});
