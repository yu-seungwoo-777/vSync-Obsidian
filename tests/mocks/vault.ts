// Vault mock 팩토리
// SyncEngine 테스트에서 app.vault 동작을 시뮬레이션

import { vi } from 'vitest';

// TAbstractFile, TFile, TFolder mock
export interface MockTFile {
	path: string;
	name: string;
	extension: string;
	stat: { ctime: number; mtime: number; size: number };
	vault: unknown;
	parent: unknown;
}

export interface MockTFolder {
	path: string;
	name: string;
	children: (MockTFile | MockTFolder)[];
	vault: unknown;
	parent: unknown;
}

// Mock TFile 생성 헬퍼
export function createMockFile(path: string, content: string = ''): MockTFile {
	return {
		path,
		name: path.split('/').pop() || path,
		extension: path.split('.').pop() || '',
		stat: { ctime: Date.now(), mtime: Date.now(), size: content.length },
		vault: null,
		parent: null,
	};
}

// Vault mock 팩토리
// textMap: 텍스트 파일 맵, binaryMap: 바이너리 파일 맵
export function createMockVault(
	textMap: Map<string, string> = new Map(),
	binaryMap: Map<string, ArrayBuffer> = new Map()
) {
	const eventHandlers: Record<string, Array<(...args: unknown[]) => void>> = {};

	return {
		// 텍스트 파일 읽기/쓰기
		read: vi.fn().mockImplementation(async (pathOrFile: string | MockTFile) => {
			const path = typeof pathOrFile === 'string' ? pathOrFile : pathOrFile.path;
			return textMap.get(path) ?? '';
		}),
		readIfExists: vi.fn().mockImplementation(async (path: string) => {
			return textMap.has(path) ? (textMap.get(path) ?? null) : null;
		}),
		write: vi.fn().mockImplementation(async (path: string, content: string) => {
			textMap.set(path, content);
		}),
		modified: vi.fn(),
		modify: vi.fn().mockImplementation(async (file: MockTFile, content: string) => {
			textMap.set(file.path, content);
		}),
		create: vi.fn().mockImplementation(async (path: string, content: string) => {
			textMap.set(path, content);
			return createMockFile(path, content);
		}),
		delete: vi.fn().mockImplementation(async (pathOrFile: string | MockTFile) => {
			const path = typeof pathOrFile === 'string' ? pathOrFile : pathOrFile.path;
			textMap.delete(path);
			binaryMap.delete(path);
		}),
		// SPEC-OBSIDIAN-API-GAP-001 REQ-API-004: vault.trash mock (delete와 동일한 동작)
		trash: vi.fn().mockImplementation(async (pathOrFile: string | MockTFile, _system: boolean) => {
			const path = typeof pathOrFile === 'string' ? pathOrFile : pathOrFile.path;
			textMap.delete(path);
			binaryMap.delete(path);
		}),
		// SPEC-OBSIDIAN-API-GAP-001 REQ-API-003: vault.process mock
		process: vi.fn().mockImplementation(async (file: MockTFile, fn: (data: string) => string | null) => {
			const content = textMap.get(file.path) ?? '';
			const result = fn(content);
			if (result !== null) {
				textMap.set(file.path, result);
			}
			return result;
		}),
		// SPEC-OBSIDIAN-API-GAP-001 REQ-API-005: vault.cachedRead mock
		cachedRead: vi.fn().mockImplementation(async (pathOrFile: string | MockTFile) => {
			const path = typeof pathOrFile === 'string' ? pathOrFile : pathOrFile.path;
			return textMap.get(path) ?? '';
		}),
		// SPEC-OBSIDIAN-API-GAP-001 REQ-API-002: fileManager.renameFile 지원용
		renameFile: vi.fn().mockImplementation(async (oldPath: string, newPath: string) => {
			const content = textMap.get(oldPath);
			if (content !== undefined) {
				textMap.delete(oldPath);
				textMap.set(newPath, content);
			}
		}),
		rename: vi.fn().mockImplementation(async (file: MockTFile, newPath: string) => {
			const content = textMap.get(file.path);
			if (content !== undefined) {
				textMap.delete(file.path);
				textMap.set(newPath, content);
			}
			const binary = binaryMap.get(file.path);
			if (binary !== undefined) {
				binaryMap.delete(file.path);
				binaryMap.set(newPath, binary);
			}
		}),

		// 바이너리 파일 읽기/쓰기 (REQ-P6-004 ~ REQ-P6-006)
		readBinary: vi.fn().mockImplementation(async (pathOrFile: string | MockTFile) => {
			const path = typeof pathOrFile === 'string' ? pathOrFile : pathOrFile.path;
			const data = binaryMap.get(path);
			if (data === undefined) {
				throw new Error(`File not found: ${path}`);
			}
			return data;
		}),
		readBinaryIfExists: vi.fn().mockImplementation(async (path: string) => {
			return binaryMap.has(path) ? (binaryMap.get(path) ?? null) : null;
		}),
		writeBinary: vi.fn().mockImplementation(async (path: string, data: ArrayBuffer) => {
			binaryMap.set(path, data);
		}),

		// 파일 목록 조회 (shouldSyncPath 필터 적용)
		getFiles: vi.fn().mockImplementation(() => {
			const allFiles: MockTFile[] = [];
			for (const path of textMap.keys()) {
				allFiles.push(createMockFile(path, textMap.get(path) || ''));
			}
			for (const path of binaryMap.keys()) {
				allFiles.push(createMockFile(path, ''));
			}
			return allFiles;
		}),
		getAbstractFileByPath: vi.fn().mockImplementation((path: string) => {
			if (textMap.has(path) || binaryMap.has(path)) {
				return createMockFile(path, textMap.get(path) || '');
			}
			return null;
		}),

		// 이벤트 시스템
		on: vi.fn().mockImplementation((event: string, handler: (...args: unknown[]) => void) => {
			if (!eventHandlers[event]) {
				eventHandlers[event] = [];
			}
			eventHandlers[event].push(handler);
			return { detach: vi.fn() };
		}),
		off: vi.fn(),

		// 이벤트 발생 헬퍼 (테스트에서 사용)
		trigger: vi.fn().mockImplementation((event: string, ...args: unknown[]) => {
			const handlers = eventHandlers[event] || [];
			for (const handler of handlers) {
				handler(...args);
			}
		}),

		// 내부 상태 접근
		_textMap: textMap,
		_binaryMap: binaryMap,
		_eventHandlers: eventHandlers,
	};
}

// Plugin mock 팩토리
export function createMockPlugin(settings: Record<string, unknown> = {}) {
	const settingsStore = { ...settings };

	return {
		loadData: vi.fn().mockImplementation(async () => {
			return Object.keys(settingsStore).length > 0 ? { ...settingsStore } : null;
		}),
		saveData: vi.fn().mockImplementation(async (data: Record<string, unknown>) => {
			Object.assign(settingsStore, data);
		}),
		addStatusBarItem: vi.fn().mockReturnValue({
			setText: vi.fn(),
			setAttr: vi.fn(),
		}),
		registerInterval: vi.fn(),
		registerEvent: vi.fn().mockReturnValue({ detach: vi.fn() }),
		addCommand: vi.fn().mockReturnValue({ detach: vi.fn() }),
		addSettingTab: vi.fn(),
		app: {
			vault: createMockVault(),
			workspace: {
				getLeavesOfType: vi.fn().mockReturnValue([]),
			},
		},
		manifest: { id: 'vector', name: 'Vector', version: '0.1.0' },
		_settingsStore: settingsStore,
	};
}
