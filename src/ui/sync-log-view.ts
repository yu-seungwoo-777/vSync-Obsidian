// 동기화 로그 뷰어 - 사이드 패널
import { ItemView } from 'obsidian';
import { syncLogger } from '../sync-logger';
import type { LogLevel } from '../sync-logger';
export class SyncLogView extends ItemView {
	static VIEW_TYPE = 'vector-log';
	private unsubscribe: (() => void) | null = null;
	private filter_level: LogLevel | 'all' = 'all';
	private auto_scroll = true;
	getViewType(): string {
		return SyncLogView.VIEW_TYPE;
	}
	getDisplayText(): string {
		return 'Sync Log';
	}
	getIcon(): string {
		return 'scroll';
	}
	async onOpen(): Promise<void> {
		this.unsubscribe = syncLogger.on_update(() => this.render());
		this.render();
	}
	async onClose(): Promise<void> {
		this.unsubscribe?.();
		this.contentEl.empty();
	}
	private render(): void {
		this.contentEl.empty();
		const container = this.contentEl.createDiv({ cls: 'sync-log-container' });
		// 툴바
		const toolbar = container.createDiv({ cls: 'sync-log-toolbar' });
		// 필터 버튼
		const filterLevels: Array<LogLevel | 'all'> = ['all', 'info', 'warn', 'error'];
		for (const level of filterLevels) {
			const btn = toolbar.createEl('button', {
				text: level === 'all' ? 'All' : level.toUpperCase(),
				cls: level === this.filter_level ? 'sync-log-filter-active' : '',
			});
			btn.addEventListener('click', () => {
				this.filter_level = level;
				this.render();
			});
		}
		// 클리어 버튼
		toolbar.createEl('button', { text: 'Clear' }).addEventListener('click', () => {
			syncLogger.clear();
		});
		// 자동 스크롤 토글
		const autoBtn = toolbar.createEl('button', {
			text: this.auto_scroll ? 'Auto-scroll ON' : 'Auto-scroll OFF',
		});
		autoBtn.addEventListener('click', () => {
			this.auto_scroll = !this.auto_scroll;
			this.render();
		});
		// 로그 목록
		const list = container.createDiv({ cls: 'sync-log-list' });
		const entries = syncLogger.get_all().filter((e) =>
			this.filter_level === 'all' || e.level === this.filter_level
		);
		if (entries.length === 0) {
			list.createDiv({ text: 'No logs', cls: 'sync-log-empty' });
			return;
		}
		for (const entry of entries) {
			const row = list.createDiv({ cls: `sync-log-entry sync-log-${entry.level}` });
			const time = new Date(entry.timestamp).toLocaleTimeString();
			row.createSpan({ text: time, cls: 'sync-log-time' });
			row.createSpan({ text: `[${entry.level.toUpperCase()}]`, cls: 'sync-log-level' });
			row.createSpan({ text: entry.message, cls: 'sync-log-msg' });
			// 클릭 시 복사
			row.addEventListener('click', async () => {
					try { await window.navigator.clipboard.writeText(entry.message); } catch { /* 클립보드 접근 불가 시 무시 */ }
				});
		}
		// 자동 스크롤
		if (this.auto_scroll) {
			requestAnimationFrame(() => {
				list.scrollTop = list.scrollHeight;
			});
		}
	}
}
