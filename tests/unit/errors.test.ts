// 커스텀 에러 타입 테스트
import { describe, it, expect } from 'vitest';
import {
	FileNotFoundError,
	VaultReadError,
	VaultWriteError,
} from '../../src/errors';
// ============================================================
// ============================================================
describe('FileNotFoundError', () => {
	it('Error를 상속해야 한다', () => {
		const error = new FileNotFoundError('notes/test.md');
		expect(error).toBeInstanceOf(Error);
		expect(error).toBeInstanceOf(FileNotFoundError);
	});
	it('path 프로퍼티를 가져야 한다', () => {
		const error = new FileNotFoundError('notes/test.md');
		expect(error.path).toBe('notes/test.md');
	});
	// AC-004.6: name 프로퍼티가 클래스명과 일치
	it('name 프로퍼티가 클래스명이어야 한다', () => {
		const error = new FileNotFoundError('notes/test.md');
		expect(error.name).toBe('FileNotFoundError');
	});
	it('기본 메시지를 포함해야 한다', () => {
		const error = new FileNotFoundError('notes/test.md');
		expect(error.message).toContain('notes/test.md');
	});
	it('커스텀 메시지를 지원해야 한다', () => {
		const error = new FileNotFoundError('notes/test.md', 'Custom message');
		expect(error.message).toBe('Custom message');
		expect(error.path).toBe('notes/test.md');
	});
});
// ============================================================
// ============================================================
describe('VaultReadError', () => {
	it('Error를 상속해야 한다', () => {
		const error = new VaultReadError('notes/test.md');
		expect(error).toBeInstanceOf(Error);
		expect(error).toBeInstanceOf(VaultReadError);
	});
	it('path 프로퍼티를 가져야 한다', () => {
		const error = new VaultReadError('notes/test.md');
		expect(error.path).toBe('notes/test.md');
	});
	it('cause 프로퍼티를 옵셔널로 가져야 한다', () => {
		const error = new VaultReadError('notes/test.md');
		expect(error.cause).toBeUndefined();
	});
	// AC-004.4: Obsidian vault API 에러를 래핑
	it('원인 에러를 cause로 래핑해야 한다', () => {
		const originalError = new Error('Vault read failed');
		const error = new VaultReadError('notes/test.md', originalError);
		expect(error.cause).toBe(originalError);
	});
	// AC-004.6
	it('name 프로퍼티가 클래스명이어야 한다', () => {
		const error = new VaultReadError('notes/test.md');
		expect(error.name).toBe('VaultReadError');
	});
	it('메시지에 경로를 포함해야 한다', () => {
		const error = new VaultReadError('notes/test.md');
		expect(error.message).toContain('notes/test.md');
	});
});
// ============================================================
// ============================================================
describe('VaultWriteError', () => {
	it('Error를 상속해야 한다', () => {
		const error = new VaultWriteError('notes/test.md');
		expect(error).toBeInstanceOf(Error);
		expect(error).toBeInstanceOf(VaultWriteError);
	});
	it('path 프로퍼티를 가져야 한다', () => {
		const error = new VaultWriteError('notes/test.md');
		expect(error.path).toBe('notes/test.md');
	});
	it('cause 프로퍼티를 옵셔널로 가져야 한다', () => {
		const error = new VaultWriteError('notes/test.md');
		expect(error.cause).toBeUndefined();
	});
	// AC-004.5: Obsidian vault API 에러를 래핑
	it('원인 에러를 cause로 래핑해야 한다', () => {
		const originalError = new Error('Vault write failed');
		const error = new VaultWriteError('notes/test.md', originalError);
		expect(error.cause).toBe(originalError);
	});
	// AC-004.6
	it('name 프로퍼티가 클래스명이어야 한다', () => {
		const error = new VaultWriteError('notes/test.md');
		expect(error.name).toBe('VaultWriteError');
	});
	it('메시지에 경로를 포함해야 한다', () => {
		const error = new VaultWriteError('notes/test.md');
		expect(error.message).toContain('notes/test.md');
	});
});
// ============================================================
// 에러 타입 구분
// ============================================================
describe('에러 타입 구분', () => {
	it('FileNotFoundError와 VaultReadError는 구분 가능해야 한다', () => {
		const notFound = new FileNotFoundError('test.md');
		const readError = new VaultReadError('test.md');
		expect(notFound).toBeInstanceOf(FileNotFoundError);
		expect(notFound).not.toBeInstanceOf(VaultReadError);
		expect(readError).toBeInstanceOf(VaultReadError);
		expect(readError).not.toBeInstanceOf(FileNotFoundError);
	});
	it('VaultReadError와 VaultWriteError는 구분 가능해야 한다', () => {
		const readError = new VaultReadError('test.md');
		const writeError = new VaultWriteError('test.md');
		expect(readError).toBeInstanceOf(VaultReadError);
		expect(readError).not.toBeInstanceOf(VaultWriteError);
		expect(writeError).toBeInstanceOf(VaultWriteError);
		expect(writeError).not.toBeInstanceOf(VaultReadError);
	});
	it('instanceof 체인이 올바르게 동작해야 한다', () => {
		const errors = [
			new FileNotFoundError('a.md'),
			new VaultReadError('b.md'),
			new VaultWriteError('c.md'),
		];
		for (const error of errors) {
			expect(error).toBeInstanceOf(Error);
		}
	});
});
