// 재시도 유틸리티 테스트
// REQ-R5-005: 지수 백오프 재시도 로직
import { describe, it, expect, vi, afterEach } from 'vitest';
import { withRetry } from '../../src/utils/retry';
import { FileNotFoundError } from '../../src/errors';

/** setTimeout을 즉시 실행하도록 mock */
function mockSetTimeoutImmediate() {
	return vi.spyOn(globalThis, 'setTimeout').mockImplementation(((fn: () => void) => {
		// 마이크로태스크로 즉시 실행
		queueMicrotask(fn);
		return {} as ReturnType<typeof setTimeout>;
	}) as unknown as typeof setTimeout);
}

describe('withRetry', () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	// AC-005.1: 기본 시그니처
	it('성공하면 결과를 반환해야 한다', async () => {
		const fn = vi.fn().mockResolvedValue('success');
		const result = await withRetry(fn, 3, 'test');
		expect(result).toBe('success');
	});

	it('첫 시도에 성공하면 fn이 1번만 호출되어야 한다', async () => {
		const fn = vi.fn().mockResolvedValue('ok');
		await withRetry(fn, 3, 'test');
		expect(fn).toHaveBeenCalledTimes(1);
	});

	// AC-005.2: 지수 백오프 재시도 후 성공
	it('실패 후 재시도하여 성공하면 결과를 반환해야 한다', async () => {
		mockSetTimeoutImmediate();
		const fn = vi.fn()
			.mockRejectedValueOnce(new Error('fail 1'))
			.mockRejectedValueOnce(new Error('fail 2'))
			.mockResolvedValue('recovered');

		const result = await withRetry(fn, 3, 'test');
		expect(result).toBe('recovered');
		expect(fn).toHaveBeenCalledTimes(3);
	});

	it('지수 백오프 딜레이: 100ms, 200ms, 400ms를 적용해야 한다', async () => {
		const delays: number[] = [];
		vi.spyOn(globalThis, 'setTimeout').mockImplementation(((fn: () => void, delay?: number) => {
			delays.push(delay ?? 0);
			queueMicrotask(fn);
			return {} as ReturnType<typeof setTimeout>;
		}) as unknown as typeof setTimeout);

		const fn = vi.fn()
			.mockRejectedValueOnce(new Error('fail 1'))
			.mockRejectedValueOnce(new Error('fail 2'))
			.mockRejectedValueOnce(new Error('fail 3'))
			.mockResolvedValue('ok');

		const result = await withRetry(fn, 3, 'test');
		expect(result).toBe('ok');
		expect(delays).toEqual([100, 200, 400]);
	});

	// AC-005.5: 모든 재시도 소진 후 마지막 에러를 throw
	it('최대 재시도 횟수를 초과하면 마지막 에러를 throw해야 한다', async () => {
		mockSetTimeoutImmediate();
		const lastError = new Error('final failure');
		const fn = vi.fn()
			.mockRejectedValueOnce(new Error('fail 1'))
			.mockRejectedValueOnce(new Error('fail 2'))
			.mockRejectedValue(lastError);

		await expect(withRetry(fn, 3, 'test')).rejects.toThrow('final failure');
	});

	// AC-005.3: FileNotFoundError는 재시도하지 않음
	it('FileNotFoundError는 즉시 throw하고 재시도하지 않아야 한다', async () => {
		const notFoundError = new FileNotFoundError('missing.md');
		const fn = vi.fn().mockRejectedValue(notFoundError);

		await expect(withRetry(fn, 3, 'test')).rejects.toThrow(FileNotFoundError);
		expect(fn).toHaveBeenCalledTimes(1);
	});

	// AC-005.6: 각 재시도를 로그에 기록
	it('각 재시도마다 로그를 출력해야 한다', async () => {
		mockSetTimeoutImmediate();
		const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

		const fn = vi.fn()
			.mockRejectedValueOnce(new Error('fail'))
			.mockResolvedValue('ok');

		await withRetry(fn, 3, 'vault-read');

		expect(consoleSpy).toHaveBeenCalledWith(
			expect.stringContaining('vault-read'),
		);
		expect(consoleSpy).toHaveBeenCalledWith(
			expect.stringContaining('retry 1'),
		);
	});

	it('최대 재시도 소진 시에도 로그를 출력해야 한다', async () => {
		mockSetTimeoutImmediate();
		const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

		const fn = vi.fn().mockRejectedValue(new Error('persistent failure'));

		await expect(withRetry(fn, 2, 'vault-write')).rejects.toThrow('persistent failure');
		expect(consoleSpy).toHaveBeenCalled();
	});

	// 제네릭 타입 검증
	it('제네릭 타입을 올바르게 반환해야 한다', async () => {
		const fn = vi.fn().mockResolvedValue({ data: 42 });
		const result = await withRetry(fn, 3, 'test');
		expect(result).toEqual({ data: 42 });
	});

	it('maxRetries가 0이면 재시도하지 않고 즉시 실패해야 한다', async () => {
		const fn = vi.fn().mockRejectedValue(new Error('immediate fail'));
		await expect(withRetry(fn, 0, 'test')).rejects.toThrow('immediate fail');
		expect(fn).toHaveBeenCalledTimes(1);
	});

	it('maxRetries가 1이면 1회 재시도 후 실패해야 한다', async () => {
		mockSetTimeoutImmediate();
		const fn = vi.fn()
			.mockRejectedValueOnce(new Error('fail'))
			.mockRejectedValue(new Error('second fail'));

		await expect(withRetry(fn, 1, 'test')).rejects.toThrow('second fail');
		expect(fn).toHaveBeenCalledTimes(2);
	});
});
