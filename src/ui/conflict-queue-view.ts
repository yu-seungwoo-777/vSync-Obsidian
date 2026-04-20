// ConflictQueueView - 충돌 목록 사이드 패널 뷰 (SPEC-P6-UX-002)
import { ItemView, type WorkspaceLeaf } from 'obsidian';
import type { ConflictQueue, ConflictQueueItem } from '../conflict';
// @MX:NOTE 충돌 목록 사이드 패널 뷰
export class ConflictQueueView extends ItemView {
	static VIEW_TYPE = 'vector-conflicts';
	private conflictQueue: ConflictQueue;
	private _onResolveItem: ((item: ConflictQueueItem) => void) | null = null;
	private _onBulkResolve: ((items: ConflictQueueItem[]) => void) | null = null;
	constructor(leaf: WorkspaceLeaf, conflictQueue: ConflictQueue) {
		super(leaf);
		this.conflictQueue = conflictQueue;
	}
	getViewType(): string {
		return ConflictQueueView.VIEW_TYPE;
	}
	getDisplayText(): string {
		return '충돌 해결';
	}
	getIcon(): string {
		return 'alert-circle';
	}
	async onOpen(): Promise<void> {
		this.renderList();
	}
	async onClose(): Promise<void> {
		this.contentEl.empty?.();
	}
	// @MX:NOTE 충돌 목록 렌더링 (AC-006.2, AC-006.3)
	private renderList(): void {
		this.contentEl.empty?.();
		const items = this.conflictQueue.getAll();
		if (items.length === 0) {
			this.contentEl.setText?.('해결할 충돌이 없습니다');
			return;
		}
		// 파일 경로 기준 정렬 (AC-006.2)
		const sorted = [...items].sort((a, b) => a.filePath.localeCompare(b.filePath));
		// 목록 컨테이너
		const listEl = this.contentEl.createDiv?.({ cls: 'conflict-queue-list' });
		for (const item of sorted) {
			const itemEl = listEl?.createDiv?.({ cls: 'conflict-queue-item' }) ??
				this.contentEl.createDiv?.({ cls: 'conflict-queue-item' });
			if (!itemEl) continue;
			// 파일 경로 표시
			itemEl.createDiv?.({
				text: item.filePath,
				cls: 'conflict-item-path',
			});
			// 충돌 유형 및 시간 표시 (AC-006.3)
			const metaEl = itemEl.createDiv?.({ cls: 'conflict-item-meta' });
			metaEl?.setText?.(`${item.type === 'diff' ? 'Diff' : 'Simple'} | ${new Date(item.timestamp).toLocaleTimeString()}`);
			// 클릭 이벤트 (AC-006.4)
			itemEl.addEventListener?.('click', () => {
				this._resolveItem(item);
			});
		}
		// "모두 원격 적용" 벌크 액션 버튼 (AC-006.5)
		this.contentEl.createEl?.('button', {
			text: '모두 원격 적용',
			cls: 'conflict-bulk-resolve-button',
		})?.addEventListener?.('click', () => {
			this._bulkResolveRemote(items);
		});
	}
	// @MX:NOTE 개별 충돌 해결 (AC-006.4)
	private _resolveItem(item: ConflictQueueItem): void {
		this._onResolveItem?.(item);
	}
	// @MX:NOTE 벌크 원격 적용 (AC-006.5)
	private _bulkResolveRemote(items: ConflictQueueItem[]): void {
		this._onBulkResolve?.(items);
	}
	/** 해결 콜백 설정 (외부에서 모달 열기 등) */
	setOnResolveItem(callback: (item: ConflictQueueItem) => void): void {
		this._onResolveItem = callback;
	}
	/** 벌크 해결 콜백 설정 */
	setOnBulkResolve(callback: (items: ConflictQueueItem[]) => void): void {
		this._onBulkResolve = callback;
	}
	/** 목록 새로고침 */
	refresh(): void {
		this.renderList();
	}
}
