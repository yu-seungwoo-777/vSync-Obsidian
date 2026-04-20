// SHA-256 해시 유틸리티 테스트
// REQ-P4-014: 충돌 감지를 위한 해시 비교
// REQ-P6-010: ArrayBuffer 해시 계산 지원
import { describe, it, expect } from 'vitest';
import { computeHash } from '../../../src/utils/hash';

describe('computeHash', () => {
	it('빈 문자열의 SHA-256 해시를 계산해야 한다', async () => {
		// 빈 문자열의 SHA-256: e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
		const hash = await computeHash('');
		expect(hash).toBe(
			'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
		);
	});

	it('"hello"의 SHA-256 해시를 계산해야 한다', async () => {
		// SHA-256("hello"): 2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824
		const hash = await computeHash('hello');
		expect(hash).toBe(
			'2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824'
		);
	});

	it('한국어 텍스트의 해시를 올바르게 계산해야 한다', async () => {
		const hash = await computeHash('안녕하세요');
		// 해시 길이가 64자(256비트 hex)인지만 확인
		expect(hash).toHaveLength(64);
		expect(hash).toMatch(/^[a-f0-9]{64}$/);
	});

	it('긴 텍스트도 처리해야 한다', async () => {
		const longText = 'a'.repeat(10000);
		const hash = await computeHash(longText);
		expect(hash).toHaveLength(64);
		expect(hash).toMatch(/^[a-f0-9]{64}$/);
	});

	it('동일한 입력은 동일한 해시를 반환해야 한다', async () => {
		const content = 'test content for consistency';
		const hash1 = await computeHash(content);
		const hash2 = await computeHash(content);
		expect(hash1).toBe(hash2);
	});

	it('다른 입력은 다른 해시를 반환해야 한다', async () => {
		const hash1 = await computeHash('content A');
		const hash2 = await computeHash('content B');
		expect(hash1).not.toBe(hash2);
	});

	it('마크다운 콘텐츠의 해시를 계산해야 한다', async () => {
		const markdown = `# 제목

이것은 테스트 문서입니다.

- 항목 1
- 항목 2

\`\`\`js
console.log('hello');
\`\`\``;
		const hash = await computeHash(markdown);
		expect(hash).toHaveLength(64);
	});
});

// ============================================================
// REQ-P6-010: ArrayBuffer 해시 계산
// ============================================================

describe('computeHash (ArrayBuffer)', () => {
	it('빈 ArrayBuffer의 SHA-256 해시를 계산해야 한다', async () => {
		const data = new Uint8Array([]).buffer;
		const hash = await computeHash(data);
		// 빈 데이터의 SHA-256은 빈 문자열과 동일
		expect(hash).toBe(
			'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
		);
	});

	it('문자열 "hello"와 동일한 바이트의 ArrayBuffer 해시를 계산해야 한다', async () => {
		// "hello"의 UTF-8 바이트: [104, 101, 108, 108, 111]
		const data = Uint8Array.from([104, 101, 108, 108, 111]).buffer;
		const hash = await computeHash(data);
		expect(hash).toBe(
			'2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824'
		);
	});

	it('문자열 입력은 기존과 동일하게 동작해야 한다 (회귀)', async () => {
		// 동일한 내용을 문자열로 전달해도 같은 해시 반환
		const stringHash = await computeHash('hello');
		expect(stringHash).toBe(
			'2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824'
		);
	});
});
