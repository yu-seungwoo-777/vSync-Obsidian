// WebSocket 클라이언트
// REQ-P3-008: WS 연결, URL 변환, 메시지 처리
// REQ-P3-009: 자동 재연결 (지수 백오프 + 지터)
// REQ-P3-010: 클라이언트 하트비트 (30초 ping, 3회 누락 시 연결 종료)

import type { WSMessage, WSSyncEventData, SyncEvent } from '../types';

// @MX:NOTE 하트비트 설정
const HEARTBEAT_INTERVAL_MS = 30_000;
const MAX_MISSED_PONGS = 3;

// @MX:NOTE 재연결 설정
const INITIAL_RECONNECT_DELAY_MS = 1000;
const MAX_RECONNECT_DELAY_MS = 30_000;
const JITTER_MAX_MS = 500;

/**
 * @MX:NOTE 지수 백오프 계산 (순수 함수, 테스트 가능)
 */
export function calculateReconnectDelay(attempt: number): number {
	const baseDelay = Math.min(
		INITIAL_RECONNECT_DELAY_MS * Math.pow(2, attempt),
		MAX_RECONNECT_DELAY_MS,
	);
	const jitter = Math.random() * JITTER_MAX_MS;
	return baseDelay + jitter;
}

/** WS 클라이언트 상태 변경 콜백 */
export type OnStatusChange = (status: 'connected' | 'disconnected' | 'reconnecting', mode: 'realtime' | 'polling') => void;

/** WS 이벤트 수신 콜백 */
export type OnSyncEvent = (event: SyncEvent) => void;

/**
 * @MX:ANCHOR WSClient: WebSocket 클라이언트 (재연결, 하트비트 포함)
 * @MX:REASON 실시간 동기화의 클라이언트 핵심, 플러그인 생명주기와 연결됨
 */
export class WSClient {
	private _server_url: string;
	private _api_key: string;
	private _vault_id: string;
	private _device_id: string;

	private _ws: WebSocket | null = null;
	private _is_intentional_close = false;
	private _reconnect_attempts = 0;
	private _reconnect_timer: ReturnType<typeof setTimeout> | null = null;

	private _heartbeat_interval: ReturnType<typeof setInterval> | null = null;
	private _missed_pongs = 0;

	private _on_sync_event: OnSyncEvent | null = null;
	private _on_status_change: OnStatusChange | null = null;

	// 테스트용 주입 가능한 타이머/설정
	private _heartbeat_interval_ms: number;

	constructor(options: {
		server_url: string;
		api_key: string;
		vault_id: string;
		device_id: string;
		heartbeat_interval_ms?: number;
	}) {
		this._server_url = options.server_url;
		this._api_key = options.api_key;
		this._vault_id = options.vault_id;
		this._device_id = options.device_id;
		this._heartbeat_interval_ms = options.heartbeat_interval_ms ?? HEARTBEAT_INTERVAL_MS;
	}

	/** 이벤트 콜백 설정 */
	on(event: 'syncEvent', handler: OnSyncEvent): void;
	on(event: 'statusChange', handler: OnStatusChange): void;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any -- EventEmitter overload catch-all, handler type varies by event
	on(event: string, handler: any): void {
		if (event === 'syncEvent') {
			this._on_sync_event = handler;
		} else if (event === 'statusChange') {
			this._on_status_change = handler;
		}
	}

	/** 연결 상태 */
	get isConnected(): boolean {
		return this._ws !== null && this._ws.readyState === WebSocket.OPEN;
	}

	/** 재연결 시도 횟수 */
	get reconnectAttempts(): number {
		return this._reconnect_attempts;
	}

	/** 서버 URL → WebSocket URL 변환 */
	buildWSUrl(): string {
		let wsUrl = this._server_url;

		// trailing slash 제거
		if (wsUrl.endsWith('/')) {
			wsUrl = wsUrl.slice(0, -1);
		}

		// http → ws, https → wss 변환
		if (wsUrl.startsWith('https://')) {
			wsUrl = 'wss://' + wsUrl.slice(8);
		} else if (wsUrl.startsWith('http://')) {
			wsUrl = 'ws://' + wsUrl.slice(7);
		}

		return `${wsUrl}/ws/sync/${this._vault_id}?apiKey=${this._api_key}`;
	}

	/** WebSocket 연결 */
	connect(): void {
		this._is_intentional_close = false;
		this._reconnect_attempts = 0;

		const url = this.buildWSUrl();
		this._ws = new WebSocket(url);

		this._ws.onopen = () => {
			this._reconnect_attempts = 0;
			this._startHeartbeat();
			this._on_status_change?.('connected', 'realtime');
		};

		this._ws.onmessage = (event) => {
			this._handleMessage(event.data as string);
		};

		this._ws.onclose = () => {
			this._stopHeartbeat();
			if (!this._is_intentional_close) {
				this._on_status_change?.('reconnecting', 'polling');
				this._scheduleReconnect();
			} else {
				this._on_status_change?.('disconnected', 'polling');
			}
		};

		this._ws.onerror = () => {
			// onclose가 이후에 호출됨
		};
	}

	/** WebSocket 연결 종료 */
	close(): void {
		this._is_intentional_close = true;
		this._stopHeartbeat();
		this._clearReconnectTimer();

		if (this._ws) {
			this._ws.close();
			this._ws = null;
		}

		this._on_status_change?.('disconnected', 'polling');
	}

	/** 메시지 처리 */
	private _handleMessage(data: string): void {
		try {
			const msg: WSMessage = JSON.parse(data);

			switch (msg.type) {
				case 'connected':
					// 연결 성공 확인
					break;
				case 'sync_event':
					if (msg.data && this._on_sync_event) {
						this._on_sync_event(this._convertToSyncEvent(msg.data));
					}
					break;
				case 'pong':
					this._missed_pongs = 0;
					break;
			}
		} catch {
			// 파싱 불가한 메시지는 무시
		}
	}

	/** WSSyncEventData → SyncEvent 변환 */
	private _convertToSyncEvent(data: WSSyncEventData): SyncEvent {
		return {
			id: data.id,
			event_type: data.event_type as SyncEvent['event_type'],
			file_path: data.file_path,
			device_id: data.device_id,
			created_at: data.created_at,
			sequence: data.sequence,
		};
	}

	/** 하트비트 시작 */
	private _startHeartbeat(): void {
		this._stopHeartbeat();
		this._missed_pongs = 0;

		this._heartbeat_interval = setInterval(() => {
			if (!this._ws || this._ws.readyState !== WebSocket.OPEN) {
				this._stopHeartbeat();
				return;
			}

			// ping 전송 전 누락 체크
			if (this._missed_pongs >= MAX_MISSED_PONGS) {
				// 연결이 죽은 것으로 간주, 재연결 트리거
				this._stopHeartbeat();
				this._ws.close();
				return;
			}

			this._missed_pongs++;
			this._ws.send(JSON.stringify({ type: 'ping' }));
		}, this._heartbeat_interval_ms);
	}

	/** 하트비트 중지 */
	private _stopHeartbeat(): void {
		if (this._heartbeat_interval) {
			clearInterval(this._heartbeat_interval);
			this._heartbeat_interval = null;
		}
	}

	/** 재연결 예약 */
	private _scheduleReconnect(): void {
		if (this._is_intentional_close) return;

		const delay = calculateReconnectDelay(this._reconnect_attempts);
		this._reconnect_attempts++;

		this._reconnect_timer = setTimeout(() => {
			this._reconnect_timer = null;
			this.connect();
		}, delay);
	}

	/** 재연결 타이머 해제 */
	private _clearReconnectTimer(): void {
		if (this._reconnect_timer) {
			clearTimeout(this._reconnect_timer);
			this._reconnect_timer = null;
		}
	}
}
