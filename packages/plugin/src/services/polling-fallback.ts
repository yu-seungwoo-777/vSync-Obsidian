// 폴링 폴백 컨트롤러

/**
 * @MX:NOTE PollingFallback: WS 연결 실패 시 폴링으로 대체
 */
export class PollingFallback {
	private _intervalId: ReturnType<typeof setInterval> | null = null;
	private _pollFn: (() => Promise<void>) | null = null;
	private _intervalMs: number;

	constructor(intervalMs: number) {
		this._intervalMs = intervalMs;
	}

	/** 폴링 활성화 */
	activate(pollFn: () => Promise<void>): void {
		this.deactivate();
		this._pollFn = pollFn;

		// 즉시 한 번 실행 후 interval 시작
		this._pollFn();
		this._intervalId = setInterval(() => {
			this._pollFn?.();
		}, this._intervalMs);
	}

	/** 폴링 비활성화 */
	deactivate(): void {
		if (this._intervalId) {
			clearInterval(this._intervalId);
			this._intervalId = null;
		}
	}

	/** 폴링 활성 상태 여부 */
	get isActive(): boolean {
		return this._intervalId !== null;
	}
}
