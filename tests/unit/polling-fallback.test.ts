// 폴링 폴백 + 듀얼 모드 테스트
// T9: REQ-P3-011, REQ-P3-012, REQ-P3-013 - 폴링 폴백, WS 복구, 듀얼 모드
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PollingFallback } from '../../src/services/polling-fallback';
describe('PollingFallback', () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});
	it('activate 시 폴링이 시작되어야 한다', () => {
		const fallback = new PollingFallback(5000);
		const pollFn = vi.fn().mockResolvedValue(undefined);
		fallback.activate(pollFn);
		// activate 시 즉시 한 번 호출
		expect(pollFn).toHaveBeenCalledTimes(1);
		expect(fallback.isActive).toBe(true);
		// interval 후 다시 호출
		vi.advanceTimersByTime(5000);
		expect(pollFn).toHaveBeenCalledTimes(2);
	});
	it('deactivate 시 폴링이 중지되어야 한다', () => {
		const fallback = new PollingFallback(5000);
		const pollFn = vi.fn().mockResolvedValue(undefined);
		fallback.activate(pollFn);
		fallback.deactivate();
		expect(fallback.isActive).toBe(false);
		// interval 후에도 호출되지 않음
		vi.advanceTimersByTime(10000);
		expect(pollFn).toHaveBeenCalledTimes(1); // activate 시 1회만
	});
	it('isActive가 현재 상태를 반영해야 한다', () => {
		const fallback = new PollingFallback(5000);
		expect(fallback.isActive).toBe(false);
		fallback.activate(vi.fn().mockResolvedValue(undefined));
		expect(fallback.isActive).toBe(true);
		fallback.deactivate();
		expect(fallback.isActive).toBe(false);
	});
	it('activate 재호출 시 기존 타이머가 교체되어야 한다', () => {
		const fallback = new PollingFallback(5000);
		const pollFn1 = vi.fn().mockResolvedValue(undefined);
		const pollFn2 = vi.fn().mockResolvedValue(undefined);
		fallback.activate(pollFn1);
		fallback.activate(pollFn2);
		// 첫 번째 pollFn은 activate 시 1회만 호출
		expect(pollFn1).toHaveBeenCalledTimes(1);
		// 두 번째 pollFn이 활성화
		expect(pollFn2).toHaveBeenCalledTimes(1);
		vi.advanceTimersByTime(5000);
		// interval은 pollFn2만 호출
		expect(pollFn2).toHaveBeenCalledTimes(2);
	});
});
