// 경로 검증 테스트
import { describe, it, expect } from 'vitest';
import { validateVaultPath } from '../../src/utils/path';
describe('validateVaultPath', () => {
	// AC-006.1: 정상 경로는 정규화된 경로를 반환
	it('정상 경로를 정규화하여 반환해야 한다', () => {
		expect(validateVaultPath('notes/test.md')).toBe('notes/test.md');
	});
	it('역슬래시를 슬래시로 변환하여 반환해야 한다', () => {
		expect(validateVaultPath('notes\\test.md')).toBe('notes/test.md');
	});
	it('선행 슬래시를 제거하여 반환해야 한다', () => {
		expect(validateVaultPath('/notes/test.md')).toBe('notes/test.md');
	});
	// AC-006.2: .. 세그먼트 거부 (경로 순회 공격 방지)
	it('.. 세그먼트가 포함된 경로를 거부해야 한다', () => {
		expect(() => validateVaultPath('../secret.md')).toThrow();
	});
	it('중간에 .. 이 포함된 경로를 거부해야 한다', () => {
		expect(() => validateVaultPath('notes/../../etc/passwd')).toThrow();
	});
	it('인코딩된 .. 세그먼트도 거부해야 한다', () => {
		expect(() => validateVaultPath('..')).toThrow();
		expect(() => validateVaultPath('a/..')).toThrow();
	});
	// AC-006.3: null byte 거부
	it('null byte가 포함된 경로를 거부해야 한다', () => {
		expect(() => validateVaultPath('test\x00.md')).toThrow();
	});
	it('경로 시작의 null byte를 거부해야 한다', () => {
		expect(() => validateVaultPath('\x00test.md')).toThrow();
	});
	// AC-006.4: 빈 문자열 거부
	it('빈 문자열을 거부해야 한다', () => {
		expect(() => validateVaultPath('')).toThrow();
	});
	// AC-006.5: 정규화 후 빈 문자열이 되는 경로 거부
	it('정규화 후 빈 문자열이 되는 경로를 거부해야 한다', () => {
		expect(() => validateVaultPath('/')).toThrow();
	});
	it('공백만 있는 경로를 거부해야 한다', () => {
		expect(() => validateVaultPath('   ')).toThrow();
	});
	// 에러 메시지 검증
	it('거부 시 에러 메시지에 이유를 포함해야 한다', () => {
		expect(() => validateVaultPath('')).toThrow(/path/i);
	});
	it('.. 거부 시 에러 메시지에 path traversal을 명시해야 한다', () => {
		expect(() => validateVaultPath('../secret')).toThrow(/traversal|\.\./i);
	});
	it('null byte 거부 시 에러 메시지에 null byte를 명시해야 한다', () => {
		expect(() => validateVaultPath('test\x00.md')).toThrow(/null/i);
	});
});
