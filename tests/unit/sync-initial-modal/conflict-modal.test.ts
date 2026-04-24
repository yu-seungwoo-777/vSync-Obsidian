// InitialSyncConflictModal 테스트 (SPEC-INITIAL-SYNC-MODAL-001 AC-005)
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { InitialSyncConflictModal } from '../../../src/ui/initial-sync-conflict-modal';
import type { ConflictFile } from '../../../src/types';
import { Setting } from '../../mocks/obsidian';

const mockApp = { vault: {} };

function getButtonHandlers(): ((...a: unknown[]) => void)[] {
	const handlers: ((...a: unknown[]) => void)[] = [];
	for (const s of Setting._instances) {
		handlers.push(...s.onClickHandlers);
	}
	return handlers;
}

function getDropdownHandlers(): ((v: string) => void)[] {
	const handlers: ((v: string) => void)[] = [];
	for (const s of Setting._instances) {
		handlers.push(...s.onDropdownChangeHandlers);
	}
	return handlers;
}

describe('InitialSyncConflictModal (AC-005)', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		Setting._instances = [];
	});

	it('should not invoke callback until button clicked', () => {
		const files: ConflictFile[] = [
			{ path: 'conflict.md', serverHash: 'h1', localContent: null },
		];
		const callback = vi.fn();
		const modal = new InitialSyncConflictModal(mockApp, files, callback);
		modal.onOpen();
		expect(callback).not.toHaveBeenCalled();
	});

	// AC-005.3: Default is server for all
	// AC-005.4: Submit returns resolution map
	it('should default to server for all conflicts', () => {
		const files: ConflictFile[] = [
			{ path: 'f1.md', serverHash: 'h1', localContent: null },
			{ path: 'f2.md', serverHash: 'h2', localContent: null },
		];
		const callback = vi.fn();
		const modal = new InitialSyncConflictModal(mockApp, files, callback);
		modal.onOpen();

		// Submit = [건너뛰기(전체), 충돌 동기화 진행]
		getButtonHandlers()[1]();

		const result = callback.mock.calls[0][0];
		expect(result.resolutions.get('f1.md')).toBe('server');
		expect(result.resolutions.get('f2.md')).toBe('server');
		expect(result.skippedPaths).toEqual([]);
	});

	// AC-005.2: Radio buttons change resolution
	it('should allow changing resolution via dropdown', () => {
		const files: ConflictFile[] = [
			{ path: 'f1.md', serverHash: 'h1', localContent: null },
		];
		const callback = vi.fn();
		const modal = new InitialSyncConflictModal(mockApp, files, callback);
		modal.onOpen();

		// Change to local
		getDropdownHandlers()[0]('local');

		getButtonHandlers()[1]();

		expect(callback.mock.calls[0][0].resolutions.get('f1.md')).toBe('local');
	});

	// AC-005.5: 건너뛰기(전체)
	it('should skip all conflicts when skip-all clicked', () => {
		const files: ConflictFile[] = [
			{ path: 'f1.md', serverHash: 'h1', localContent: null },
			{ path: 'f2.md', serverHash: 'h2', localContent: null },
		];
		const callback = vi.fn();
		const modal = new InitialSyncConflictModal(mockApp, files, callback);
		modal.onOpen();

		getButtonHandlers()[0]();

		const result = callback.mock.calls[0][0];
		expect(result.resolutions.size).toBe(0);
		expect(result.skippedPaths).toEqual(['f1.md', 'f2.md']);
	});

	// Mixed resolutions
	it('should handle mixed resolutions', () => {
		const files: ConflictFile[] = [
			{ path: 'keep-server.md', serverHash: 'h1', localContent: null },
			{ path: 'keep-local.md', serverHash: 'h2', localContent: null },
			{ path: 'skip-this.md', serverHash: 'h3', localContent: null },
		];
		const callback = vi.fn();
		const modal = new InitialSyncConflictModal(mockApp, files, callback);
		modal.onOpen();

		const ddHandlers = getDropdownHandlers();
		ddHandlers[1]('local');
		ddHandlers[2]('skip');

		getButtonHandlers()[1]();

		const result = callback.mock.calls[0][0];
		expect(result.resolutions.get('keep-server.md')).toBe('server');
		expect(result.resolutions.get('keep-local.md')).toBe('local');
		expect(result.resolutions.get('skip-this.md')).toBe('skip');
		expect(result.skippedPaths).toEqual(['skip-this.md']);
	});

	it('should return empty plan for empty conflict list', () => {
		const callback = vi.fn();
		const modal = new InitialSyncConflictModal(mockApp, [], callback);
		modal.onOpen();

		expect(callback).toHaveBeenCalledTimes(1);
		expect(callback.mock.calls[0][0].resolutions).toBeInstanceOf(Map);
		expect(callback.mock.calls[0][0].resolutions.size).toBe(0);
		expect(callback.mock.calls[0][0].skippedPaths).toEqual([]);
	});
});
