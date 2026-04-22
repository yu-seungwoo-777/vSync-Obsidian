// 동기화 로그 수집기
// 사이드바 로그 뷰어와 클릭 복사 토스트에서 사용

export type LogLevel = 'info' | 'warn' | 'error';

export interface LogEntry {
	timestamp: number;
	level: LogLevel;
	message: string;
}

const MAX_ENTRIES = 500;

export class SyncLogger {
	private entries: LogEntry[] = [];
	private listeners: (() => void)[] = [];

	log(level: LogLevel, message: string): void {
		this.entries.push({ timestamp: Date.now(), level, message });
		if (this.entries.length > MAX_ENTRIES) {
			this.entries = this.entries.slice(-MAX_ENTRIES);
		}
		for (const fn of this.listeners) fn();
	}

	info(message: string): void { this.log('info', message); }
	warn(message: string): void { this.log('warn', message); }
	error(message: string): void { this.log('error', message); }

	getAll(): LogEntry[] {
		return [...this.entries];
	}

	clear(): void {
		this.entries = [];
		for (const fn of this.listeners) fn();
	}

	onUpdate(fn: () => void): () => void {
		this.listeners.push(fn);
		return () => {
			this.listeners = this.listeners.filter((f) => f !== fn);
		};
	}
}

// 글로벌 싱글톤
export const syncLogger = new SyncLogger();
