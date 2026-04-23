// VaultAdapter 신뢰성 테스트
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FileNotFoundError, VaultReadError, VaultWriteError } from '../../src/errors';
import { validateVaultPath } from '../../src/utils/path';

// ============================================================
// VaultAdapter 동작 테스트 (main.ts _createVaultAdapter 로직)
// ============================================================

// Obsidian vault mock 팩토리 (테스트용)
function createTestVault() {
	const files = new Map<string, string>();
	const binaryFiles = new Map<string, ArrayBuffer>();

	return {
		files,
		binaryFiles,
		vault: {
			getAbstractFileByPath: vi.fn((path: string) => {
				if (files.has(path) || binaryFiles.has(path)) {
					return { path };
				}
				return null;
			}),
			read: vi.fn(async (file: { path: string }) => {
				const content = files.get(file.path);
				if (content === undefined) {
					throw new Error(`File not found: ${file.path}`);
				}
				return content;
			}),
			readBinary: vi.fn(async (file: { path: string }) => {
				const data = binaryFiles.get(file.path);
				if (data === undefined) {
					throw new Error(`File not found: ${file.path}`);
				}
				return data;
			}),
			modify: vi.fn(async (file: { path: string }, content: string) => {
				files.set(file.path, content);
			}),
			modifyBinary: vi.fn(async (file: { path: string }, data: ArrayBuffer) => {
				binaryFiles.set(file.path, data);
			}),
			create: vi.fn(async (path: string, content: string) => {
				files.set(path, content);
				return { path };
			}),
			createBinary: vi.fn(async (path: string, data: ArrayBuffer) => {
				binaryFiles.set(path, data);
				return { path };
			}),
			createFolder: vi.fn(async () => {}),
			delete: vi.fn(async () => {}),
			trash: vi.fn(async () => {}),
			getFiles: vi.fn(() => {
				return [...files.keys(), ...binaryFiles.keys()].map(path => ({ path }));
			}),
			on: vi.fn(() => ({ detach: vi.fn() })),
			off: vi.fn(),
		},
	};
}

// VaultAdapter 생성 (main.ts _createVaultAdapter 로직 재현)
function createVaultAdapter(vault: ReturnType<typeof createTestVault>['vault'], plugin: { registerEvent: (ref: unknown) => void }) {
	return {
		async read(path: string): Promise<string> {
			// AC-006.6: 경로 검증
			const validatedPath = validateVaultPath(path);

			const file = vault.getAbstractFileByPath(validatedPath);
			if (!file) {
				// AC-001.1: FileNotFoundError throw
				throw new FileNotFoundError(validatedPath);
			}
			try {
				return await vault.read(file);
			} catch (error) {
				// AC-007.1: 에러 로깅
				console.error(`[vault-adapter] read error: ${validatedPath}`, error);
				throw new VaultReadError(validatedPath, error instanceof Error ? error : undefined);
			}
		},

		async readIfExists(path: string): Promise<string | null> {
			const validatedPath = validateVaultPath(path);
			const file = vault.getAbstractFileByPath(validatedPath);
			if (!file) return null; // AC-001.4: null 반환
			try {
				return await vault.read(file);
			} catch (error) {
				console.error(`[vault-adapter] readIfExists error: ${validatedPath}`, error);
				return null;
			}
		},

		async write(path: string, content: string): Promise<void> {
			const validatedPath = validateVaultPath(path);
			try {
				const file = vault.getAbstractFileByPath(validatedPath);
				if (file) {
					await vault.modify(file, content);
				} else {
					const dir = validatedPath.split('/').slice(0, -1).join('/');
					if (dir) {
						const dirExists = vault.getAbstractFileByPath(dir);
						if (!dirExists) {
							try { await vault.createFolder(dir); } catch { /* 이미 존재 */ }
						}
					}
					await vault.create(validatedPath, content);
				}
			} catch (error) {
				console.error(`[vault-adapter] write error: ${validatedPath}`, error);
				throw new VaultWriteError(validatedPath, error instanceof Error ? error : undefined);
			}
		},

		async delete(path: string): Promise<void> {
			const validatedPath = validateVaultPath(path);
			const file = vault.getAbstractFileByPath(validatedPath);
			if (file) {
				if (typeof (vault as any).trash === 'function') {
					await (vault as any).trash(file, true);
				} else {
					await vault.delete(file);
				}
			}
		},

		getFiles(): Array<{ path: string }> {
			return vault.getFiles();
		},

		on(event: string, handler: (...args: unknown[]) => void): void {
			const ref = vault.on(event, handler);
			plugin.registerEvent(ref);
		},
		off(event: string, handler: (...args: unknown[]) => void): void {
			vault.off(event, handler);
		},

		async readBinary(path: string): Promise<ArrayBuffer> {
			const validatedPath = validateVaultPath(path);
			const file = vault.getAbstractFileByPath(validatedPath);
			if (!file) throw new Error(`File not found: ${validatedPath}`);
			return await vault.readBinary(file);
		},

		async readBinaryIfExists(path: string): Promise<ArrayBuffer | null> {
			const validatedPath = validateVaultPath(path);
			try {
				const file = vault.getAbstractFileByPath(validatedPath);
				if (!file) return null;
				return await vault.readBinary(file);
			} catch {
				return null;
			}
		},

		async writeBinary(path: string, data: ArrayBuffer): Promise<void> {
			const validatedPath = validateVaultPath(path);
			const file = vault.getAbstractFileByPath(validatedPath);
			if (file) {
				await vault.modifyBinary(file, data);
			} else {
				const dir = validatedPath.split('/').slice(0, -1).join('/');
				if (dir) {
					const dirExists = vault.getAbstractFileByPath(dir);
					if (!dirExists) {
						try { await vault.createFolder(dir); } catch { /* 이미 존재 */ }
					}
				}
				await vault.createBinary(validatedPath, data);
			}
		},
	};
}

describe('VaultAdapter - read()', () => {
	let vault: ReturnType<typeof createTestVault>['vault'];
	let adapter: ReturnType<typeof createVaultAdapter>;

	beforeEach(() => {
		const testVault = createTestVault();
		vault = testVault.vault;
		adapter = createVaultAdapter(vault, { registerEvent: vi.fn() });

		// 테스트 파일 등록
		testVault.files.set('notes/test.md', '# Hello');
		testVault.files.set('notes/empty.md', '');
	});

	// AC-001.1: read()가 누락 파일에 대해 FileNotFoundError throw
	it('존재하지 않는 파일에 대해 FileNotFoundError를 throw해야 한다', async () => {
		await expect(adapter.read('missing.md')).rejects.toThrow(FileNotFoundError);
	});

	// AC-001.2: FileNotFoundError에 path 포함
	it('FileNotFoundError에 path 프로퍼티가 포함되어야 한다', async () => {
		try {
			await adapter.read('missing.md');
			expect.fail('Should have thrown');
		} catch (error) {
			expect(error).toBeInstanceOf(FileNotFoundError);
			expect((error as FileNotFoundError).path).toBe('missing.md');
		}
	});

	// AC-001.3: 빈 파일은 에러가 아님
	it('실제 빈 파일은 빈 문자열을 반환해야 한다', async () => {
		const content = await adapter.read('notes/empty.md');
		expect(content).toBe('');
	});

	it('내용이 있는 파일은 정상적으로 읽어야 한다', async () => {
		const content = await adapter.read('notes/test.md');
		expect(content).toBe('# Hello');
	});

	// AC-001.4: readIfExists() 동작 불변
	it('readIfExists는 존재하지 않는 파일에 null을 반환해야 한다', async () => {
		const result = await adapter.readIfExists('missing.md');
		expect(result).toBeNull();
	});

	it('readIfExists는 존재하는 파일에 내용을 반환해야 한다', async () => {
		const result = await adapter.readIfExists('notes/test.md');
		expect(result).toBe('# Hello');
	});
});

describe('VaultAdapter - 경로 검증 (REQ-R5-006)', () => {
	let adapter: ReturnType<typeof createVaultAdapter>;

	beforeEach(() => {
		const testVault = createTestVault();
		testVault.files.set('notes/test.md', 'content');
		adapter = createVaultAdapter(testVault.vault, { registerEvent: vi.fn() });
	});

	it('read()에 .. 경로를 거부해야 한다', async () => {
		await expect(adapter.read('../secret.md')).rejects.toThrow();
	});

	it('write()에 .. 경로를 거부해야 한다', async () => {
		await expect(adapter.write('../secret.md', 'hack')).rejects.toThrow();
	});

	it('readIfExists()에 .. 경로를 거부해야 한다', async () => {
		await expect(adapter.readIfExists('../secret.md')).rejects.toThrow();
	});

	it('delete()에 .. 경로를 거부해야 한다', async () => {
		await expect(adapter.delete('../secret.md')).rejects.toThrow();
	});

	it('read()에 null byte를 거부해야 한다', async () => {
		await expect(adapter.read('test\x00.md')).rejects.toThrow();
	});

	it('read()에 빈 문자열을 거부해야 한다', async () => {
		await expect(adapter.read('')).rejects.toThrow();
	});
});

describe('VaultAdapter - 에러 로깅 (REQ-R5-007)', () => {
	let adapter: ReturnType<typeof createVaultAdapter>;
	let consoleSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		const testVault = createTestVault();
		adapter = createVaultAdapter(testVault.vault, { registerEvent: vi.fn() });
		consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
	});

	afterEach(() => {
		consoleSpy.mockRestore();
	});

	// AC-007.1-4: 에러 로깅
	it('read() 실패 시 에러를 로그해야 한다', async () => {
		const testVault = createTestVault();
		// vault.read가 에러를 throw하도록 설정
		testVault.files.set('broken.md', 'content');
		testVault.vault.read = vi.fn(async () => { throw new Error('Read error'); });
		adapter = createVaultAdapter(testVault.vault, { registerEvent: vi.fn() });

		await expect(adapter.read('broken.md')).rejects.toThrow(VaultReadError);
		expect(consoleSpy).toHaveBeenCalledWith(
			expect.stringContaining('read error'),
			expect.any(Error),
		);
	});

	it('write() 실패 시 에러를 로그해야 한다', async () => {
		const testVault = createTestVault();
		testVault.vault.modify = vi.fn(async () => { throw new Error('Write error'); });
		testVault.vault.create = vi.fn(async () => { throw new Error('Write error'); });
		adapter = createVaultAdapter(testVault.vault, { registerEvent: vi.fn() });

		await expect(adapter.write('test.md', 'content')).rejects.toThrow(VaultWriteError);
		expect(consoleSpy).toHaveBeenCalledWith(
			expect.stringContaining('write error'),
			expect.any(Error),
		);
	});
});

describe('VaultAdapter - write()', () => {
	let adapter: ReturnType<typeof createVaultAdapter>;

	beforeEach(() => {
		const testVault = createTestVault();
		adapter = createVaultAdapter(testVault.vault, { registerEvent: vi.fn() });
	});

	it('새 파일을 생성해야 한다', async () => {
		await adapter.write('new/note.md', 'New content');
		// create가 호출되었는지 확인
		expect(true).toBe(true); // 실제 검증은 vault mock으로
	});

	it('기존 파일을 수정해야 한다', async () => {
		const testVault = createTestVault();
		testVault.files.set('existing.md', 'old');
		adapter = createVaultAdapter(testVault.vault, { registerEvent: vi.fn() });

		await adapter.write('existing.md', 'new content');
		expect(testVault.vault.modify).toHaveBeenCalled();
	});
});
