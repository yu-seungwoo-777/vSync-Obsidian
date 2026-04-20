// WS 클라이언트 테스트
// T6: REQ-P3-008 - WS 연결, URL 변환, 메시지 처리
// T7: REQ-P3-009 - 자동 재연결 (지수 백오프 + 지터)
// T8: REQ-P3-010 - 클라이언트 하트비트
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WSClient, calculateReconnectDelay } from '../../src/services/ws-client';
import type { SyncEvent } from '../../src/types';

// Mock WebSocket
class MockWebSocket {
	static OPEN = 1;
	static CLOSED = 3;

	url: string;
	readyState: number = MockWebSocket.OPEN;
	onopen: (() => void) | null = null;
	onmessage: ((event: { data: string }) => void) | null = null;
	onclose: (() => void) | null = null;
	onerror: (() => void) | null = null;

	static lastInstance: MockWebSocket | null = null;
	static connectUrl: string | null = null;

	constructor(url: string) {
		this.url = url;
		MockWebSocket.lastInstance = this;
		MockWebSocket.connectUrl = url;
		this.readyState = MockWebSocket.OPEN;
	}

	send = vi.fn();
	close = vi.fn().mockImplementation(() => {
		this.readyState = MockWebSocket.CLOSED;
		this.onclose?.();
	});

	// 테스트 헬퍼: 서버에서 메시지 시뮬레이션
	simulateMessage(data: object): void {
		this.onmessage?.({ data: JSON.stringify(data) });
	}

	simulateOpen(): void {
		this.readyState = MockWebSocket.OPEN;
		this.onopen?.();
	}

	simulateClose(): void {
		this.readyState = MockWebSocket.CLOSED;
		this.onclose?.();
	}

	simulateError(): void {
		this.onerror?.();
	}
}

// globalThis.WebSocket mock
const originalWebSocket = globalThis.WebSocket;

beforeEach(() => {
	MockWebSocket.lastInstance = null;
	MockWebSocket.connectUrl = null;
	vi.stubGlobal('WebSocket', MockWebSocket);
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe('WSClient', () => {
	function createClient(options?: { heartbeat_interval_ms?: number }) {
		return new WSClient({
			server_url: 'https://sync.example.com',
			api_key: 'test-api-key',
			vault_id: 'vault-123',
			device_id: 'device-abc',
			heartbeat_interval_ms: options?.heartbeat_interval_ms ?? 30_000,
		});
	}

	// ============================================================
	// T6: WS 클라이언트 기본
	// ============================================================

	describe('T6: WS Client + Types (REQ-P3-008)', () => {
		it('http:// 서버 URL은 ws://로 변환해야 한다', () => {
			const client = new WSClient({
				server_url: 'http://sync.example.com',
				api_key: 'key',
				vault_id: 'vault-1',
				device_id: 'dev-1',
			});

			expect(client.buildWSUrl()).toBe(
				'ws://sync.example.com/ws/sync/vault-1?apiKey=key',
			);
		});

		it('https:// 서버 URL은 wss://로 변환해야 한다', () => {
			const client = createClient();

			expect(client.buildWSUrl()).toBe(
				'wss://sync.example.com/ws/sync/vault-123?apiKey=test-api-key',
			);
		});

		it('trailing slash가 있으면 제거해야 한다', () => {
			const client = new WSClient({
				server_url: 'https://sync.example.com/',
				api_key: 'key',
				vault_id: 'vault-1',
				device_id: 'dev-1',
			});

			expect(client.buildWSUrl()).toBe(
				'wss://sync.example.com/ws/sync/vault-1?apiKey=key',
			);
		});

		it('연결 성공 시 statusChange 콜백이 호출되어야 한다', () => {
			const client = createClient();
			const statusSpy = vi.fn();
			client.on('statusChange', statusSpy);

			client.connect();
			MockWebSocket.lastInstance!.simulateOpen();

			expect(statusSpy).toHaveBeenCalledWith('connected', 'realtime');
		});

		it('sync_event 메시지를 수신하면 onSyncEvent 콜백을 호출해야 한다', () => {
			const client = createClient();
			const eventSpy = vi.fn();
			client.on('syncEvent', eventSpy);

			client.connect();
			MockWebSocket.lastInstance!.simulateOpen();

			MockWebSocket.lastInstance!.simulateMessage({
				type: 'sync_event',
				data: {
					id: 'event-42',
					event_type: 'updated',
					file_path: 'notes/test.md',
					file_type: 'markdown',
					device_id: 'device-other',
					created_at: '2026-04-17T10:00:00Z',
				},
			});

			expect(eventSpy).toHaveBeenCalledTimes(1);
			expect(eventSpy).toHaveBeenCalledWith(
				expect.objectContaining({
					id: 'event-42',
					event_type: 'updated',
					file_path: 'notes/test.md',
					device_id: 'device-other',
				}),
			);
		});

		it('연결 실패 시 에러 상태로 전환되어야 한다', () => {
			const client = createClient();
			const statusSpy = vi.fn();
			client.on('statusChange', statusSpy);

			client.connect();
			MockWebSocket.lastInstance!.simulateError();
			MockWebSocket.lastInstance!.simulateClose();

			// 재연결 시도 상태
			expect(statusSpy).toHaveBeenCalledWith('reconnecting', 'polling');
		});

		it('close() 호출 시 WebSocket이 정상 종료되어야 한다', () => {
			const client = createClient();

			client.connect();
			const ws = MockWebSocket.lastInstance!;

			client.close();

			expect(ws.close).toHaveBeenCalled();
			expect(client.isConnected).toBe(false);
		});
	});

	// ============================================================
	// T7: 자동 재연결
	// ============================================================

	describe('T7: Auto-Reconnect (REQ-P3-009)', () => {
		it('연결 해제 시 재연결을 시도해야 한다', () => {
			const client = createClient();
			const statusSpy = vi.fn();
			client.on('statusChange', statusSpy);

			client.connect();
			MockWebSocket.lastInstance!.simulateOpen();

			// 연결 해제
			MockWebSocket.lastInstance!.simulateClose();

			expect(statusSpy).toHaveBeenCalledWith('reconnecting', 'polling');
		});

		it('지수 백오프: 1s, 2s, 4s, 8s, 16s, 30s (최대)', () => {
			// delay = min(1000 * 2^attempt, 30000) + jitter
			const delays = [];
			for (let i = 0; i < 6; i++) {
				vi.spyOn(Math, 'random').mockReturnValue(0); // jitter = 0
				delays.push(calculateReconnectDelay(i));
			}
			vi.restoreAllMocks();

			expect(delays[0]).toBe(1000); // 1s
			expect(delays[1]).toBe(2000); // 2s
			expect(delays[2]).toBe(4000); // 4s
			expect(delays[3]).toBe(8000); // 8s
			expect(delays[4]).toBe(16000); // 16s
			expect(delays[5]).toBe(30000); // capped at 30s
		});

		it('각 시도에 0-500ms 랜덤 지터가 추가되어야 한다', () => {
			vi.spyOn(Math, 'random').mockReturnValue(0.5);
			const delay = calculateReconnectDelay(0); // 1000 + 250 = 1250
			expect(delay).toBe(1250);
			vi.restoreAllMocks();
		});

		it('close() 호출 시 재연결이 중단되어야 한다', () => {
			const client = createClient();
			const statusSpy = vi.fn();
			client.on('statusChange', statusSpy);

			client.connect();
			MockWebSocket.lastInstance!.simulateOpen();

			client.close();

			// 의도적 close 후에는 reconnecting이 아닌 disconnected
			expect(statusSpy).toHaveBeenCalledWith('disconnected', 'polling');
			expect(statusSpy).not.toHaveBeenCalledWith('reconnecting', 'polling');
		});

		it('재연결 성공 시 백오프가 초기화되어야 한다', () => {
			const client = createClient();

			client.connect();
			MockWebSocket.lastInstance!.simulateOpen();

			// 연결 해제 후 재연결 시도
			MockWebSocket.lastInstance!.simulateClose();
			expect(client.reconnectAttempts).toBe(1);

			// 새 연결 성공 시뮬레이션
			MockWebSocket.lastInstance!.simulateOpen();
			expect(client.reconnectAttempts).toBe(0);
		});

		it('최대 재시도 횟수 제한이 없어야 한다 (무한 재시도)', () => {
			// calculateReconnectDelay는 항상 유효한 delay를 반환
			for (let i = 0; i < 100; i++) {
				const delay = calculateReconnectDelay(i);
				expect(delay).toBeGreaterThan(0);
				expect(delay).toBeLessThanOrEqual(30500); // 30000 + 500 jitter
			}
		});
	});

	// ============================================================
	// T8: 클라이언트 하트비트
	// ============================================================

	describe('T8: Client Heartbeat (REQ-P3-010)', () => {
		beforeEach(() => {
			vi.useFakeTimers();
		});

		afterEach(() => {
			vi.useRealTimers();
		});

		it('연결 후 주기적으로 ping 메시지를 전송해야 한다', () => {
			const client = createClient({ heartbeat_interval_ms: 100 });
			client.connect();
			MockWebSocket.lastInstance!.simulateOpen();

			// 첫 번째 heartbeat 주기 후 ping 확인
			vi.advanceTimersByTime(150);

			expect(MockWebSocket.lastInstance!.send).toHaveBeenCalledWith(
				JSON.stringify({ type: 'ping' }),
			);
			client.close();
		});

		it('pong 수신 시 누락 카운터가 리셋되어야 한다', () => {
			const client = createClient({ heartbeat_interval_ms: 100 });
			client.connect();
			MockWebSocket.lastInstance!.simulateOpen();

			// 첫 ping 전송
			vi.advanceTimersByTime(100);
			expect(MockWebSocket.lastInstance!.send).toHaveBeenCalledTimes(1);

			// pong 응답 → 누락 카운터 리셋
			MockWebSocket.lastInstance!.simulateMessage({ type: 'pong' });

			// 다음 주기에도 정상 ping
			vi.advanceTimersByTime(100);
			expect(MockWebSocket.lastInstance!.send).toHaveBeenCalledTimes(2);
			client.close();
		});

		it('3회 연속 pong 누락 시 연결을 종료해야 한다', () => {
			const client = createClient({ heartbeat_interval_ms: 50 });
			const statusSpy = vi.fn();
			client.on('statusChange', statusSpy);

			client.connect();
			MockWebSocket.lastInstance!.simulateOpen();

			// 3번 ping 전송 (누락 누적) + 4번째에서 close
			vi.advanceTimersByTime(250);

			// close가 호출되었는지 확인
			expect(MockWebSocket.lastInstance!.close).toHaveBeenCalled();
			client.close();
		});

		it('close() 호출 시 하트비트 타이머가 해제되어야 한다', () => {
			const client = createClient({ heartbeat_interval_ms: 100 });

			client.connect();
			MockWebSocket.lastInstance!.simulateOpen();
			client.close();

			const sendCountBefore = MockWebSocket.lastInstance!.send.mock.calls.length;

			// 시간이 흘러도 send가 추가로 호출되지 않았는지 확인
			vi.advanceTimersByTime(300);

			expect(MockWebSocket.lastInstance!.send.mock.calls.length).toBe(sendCountBefore);
		});

		// ============================================================
		// SPEC-P6-EVENT-007: 하트비트 회귀 테스트 (REQ-EVT-005)
		// ============================================================

		describe('Heartbeat Regression (REQ-EVT-005)', () => {
			beforeEach(() => {
				vi.useFakeTimers();
			});

			afterEach(() => {
				vi.useRealTimers();
			});

			it('_missedPongs가 ping 전송 전에 증가해야 한다', () => {
				const client = createClient({ heartbeat_interval_ms: 100 });
				const statusSpy = vi.fn();
				client.on('statusChange', statusSpy);
				client.connect();
				MockWebSocket.lastInstance!.simulateOpen();

				// 주기 1: missedPongs=0 → check(0 < 3) → ++(1) → ping
				vi.advanceTimersByTime(100);
				expect(MockWebSocket.lastInstance!.send).toHaveBeenCalledTimes(1);

				// 주기 2: missedPongs=1 → check(1 < 3) → ++(2) → ping
				vi.advanceTimersByTime(100);
				expect(MockWebSocket.lastInstance!.send).toHaveBeenCalledTimes(2);

				// 주기 3: missedPongs=2 → check(2 < 3) → ++(3) → ping
				vi.advanceTimersByTime(100);
				expect(MockWebSocket.lastInstance!.send).toHaveBeenCalledTimes(3);

				// 주기 4: missedPongs=3 → check(3 >= 3) → close 트리거
				vi.advanceTimersByTime(100);
				expect(MockWebSocket.lastInstance!.close).toHaveBeenCalled();

				client.close();
			});

			it('pong 수신 시 _missedPongs가 0으로 리셋되어야 한다', () => {
				const client = createClient({ heartbeat_interval_ms: 100 });
				client.connect();
				MockWebSocket.lastInstance!.simulateOpen();

				// 2번 ping (missedPongs = 2)
				vi.advanceTimersByTime(200);
				expect(MockWebSocket.lastInstance!.send).toHaveBeenCalledTimes(2);

				// pong 수신 → missedPongs = 0
				MockWebSocket.lastInstance!.simulateMessage({ type: 'pong' });

				// 2번 더 ping → missedPongs = 2 (close 안됨)
				vi.advanceTimersByTime(200);
				// close가 호출되지 않아야 함 (3회 누락 필요, 현재 2회)
				expect(MockWebSocket.lastInstance!.close).not.toHaveBeenCalled();

				client.close();
			});
		});
	});
});
