// InitialSyncDownloadModal 테스트 (SPEC-INITIAL-SYNC-MODAL-001 AC-003)
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { InitialSyncDownloadModal } from '../../../src/ui/initial-sync-download-modal';
import type { FileInfo } from '../../../src/types';
import { Setting } from '../../mocks/obsidian';

const mockApp = { vault: {} };

function makeFileInfo(path: string, hash: string): FileInfo {
	return { id: '1', path, hash, size_bytes: null, created_at: '', updated_at: '' } as FileInfo;
}

/** 모든 Setting 인스턴스에서 onClick 핸들러를 순서대로 수집 */
function getButtonHandlers(): ((...a: unknown[]) => void)[] {
	const handlers: ((...a: unknown[]) => void)[] = [];
	for (const s of Setting._instances) {
		handlers.push(...s.onClickHandlers);
	}
	return handlers;
}

describe('InitialSyncDownloadModal (AC-003)', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		Setting._instances = [];
	});

	it('should not invoke callback until button clicked', () => {
		const files = [makeFileInfo('note1.md', 'hash1'), makeFileInfo('photo.jpg', 'hash2')];
		const callback = vi.fn();
		const modal = new InitialSyncDownloadModal(mockApp, files, callback);
		modal.onOpen();
		expect(callback).not.toHaveBeenCalled();
	});

	// AC-003.4: Submit returns all paths when all selected (default)
	it('should return all file paths on submit with default selection', () => {
		const files = [makeFileInfo('file1.md', 'h1'), makeFileInfo('file2.md', 'h2')];
		const callback = vi.fn();
		const modal = new InitialSyncDownloadModal(mockApp, files, callback);
		modal.onOpen();

		// 버튼 순서: [건너뛰기, 다운로드 동기화 진행]
		getButtonHandlers()[1]();

		expect(callback).toHaveBeenCalledTimes(1);
		expect(callback.mock.calls[0][0]).toEqual({
			selectedPaths: ['file1.md', 'file2.md'],
			skippedPaths: [],
		});
	});

	// AC-003.3: 전체 선택 토글
	it('should deselect all via toggle then submit', () => {
		const files = [makeFileInfo('file1.md', 'h1'), makeFileInfo('file2.md', 'h2')];
		const callback = vi.fn();
		const modal = new InitialSyncDownloadModal(mockApp, files, callback);
		modal.onOpen();

		const toggle = Setting._instances.find((s) => s.onChangeHandler);
		toggle!.onChangeHandler!(false);

		getButtonHandlers()[1]();

		expect(callback.mock.calls[0][0].selectedPaths).toEqual([]);
		expect(callback.mock.calls[0][0].skippedPaths).toEqual(['file1.md', 'file2.md']);
	});

	it('should reselect all via toggle', () => {
		const files = [makeFileInfo('file1.md', 'h1')];
		const callback = vi.fn();
		const modal = new InitialSyncDownloadModal(mockApp, files, callback);
		modal.onOpen();

		const toggle = Setting._instances.find((s) => s.onChangeHandler);
		toggle!.onChangeHandler!(false);
		toggle!.onChangeHandler!(true);

		getButtonHandlers()[1]();

		expect(callback.mock.calls[0][0].selectedPaths).toEqual(['file1.md']);
	});

	// AC-003.5: 건너뛰기 버튼
	it('should skip all files when skip button clicked', () => {
		const files = [makeFileInfo('file1.md', 'h1'), makeFileInfo('file2.md', 'h2')];
		const callback = vi.fn();
		const modal = new InitialSyncDownloadModal(mockApp, files, callback);
		modal.onOpen();

		getButtonHandlers()[0]();

		expect(callback.mock.calls[0][0]).toEqual({
			selectedPaths: [],
			skippedPaths: ['file1.md', 'file2.md'],
		});
	});

	it('should return empty plan for empty file list', () => {
		const callback = vi.fn();
		const modal = new InitialSyncDownloadModal(mockApp, [], callback);
		modal.onOpen();

		expect(callback).toHaveBeenCalledTimes(1);
		expect(callback.mock.calls[0][0]).toEqual({ selectedPaths: [], skippedPaths: [] });
	});

	it('should return all skipped when toggle off then submit', () => {
		const files = [makeFileInfo('a.md', 'h1'), makeFileInfo('b.md', 'h2'), makeFileInfo('c.md', 'h3')];
		const callback = vi.fn();
		const modal = new InitialSyncDownloadModal(mockApp, files, callback);
		modal.onOpen();

		const toggle = Setting._instances.find((s) => s.onChangeHandler);
		toggle!.onChangeHandler!(false);

		getButtonHandlers()[1]();

		expect(callback.mock.calls[0][0].selectedPaths).toEqual([]);
		expect(callback.mock.calls[0][0].skippedPaths).toEqual(['a.md', 'b.md', 'c.md']);
	});
});
