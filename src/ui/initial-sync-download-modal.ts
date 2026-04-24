// Step 1: 서버에만 존재하는 파일 다운로드 모달
// SPEC: SPEC-INITIAL-SYNC-MODAL-001 REQ-IS-003

import { Modal, Setting } from 'obsidian';
import type { FileInfo, DownloadPlan } from '../types';

const MAX_MODAL_FILES = 1000;

export class InitialSyncDownloadModal extends Modal {
	private _files: FileInfo[];
	private _onResolve: (plan: DownloadPlan) => void;
	private _selectedPaths: Set<string>;

	constructor(
		app: any,
		files: FileInfo[],
		onResolve: (plan: DownloadPlan) => void,
	) {
		super(app);
		this._files = files;
		this._onResolve = onResolve;
		this._selectedPaths = new Set(files.map((f) => f.path));
	}

	onOpen(): void {
		// 파일이 없으면 즉시 빈 plan 반환
		if (this._files.length === 0) {
			this._onResolve({ selectedPaths: [], skippedPaths: [] });
			this.close();
			return;
		}

		this.titleEl.setText('초기 동기화 — 서버 파일 다운로드');

		const { contentEl } = this;

		contentEl.createEl('p', {
			text: '서버에만 존재하는 파일입니다. 다운로드할 파일을 선택하세요.',
		});
		contentEl.createEl('p', {
			text: `${this._files.length}개 파일`,
			cls: 'mod-info',
		});

		// NFR-IS-002: 대량 파일 안내
		if (this._files.length > MAX_MODAL_FILES) {
			contentEl.createEl('p', {
				text: `나머지 ${this._files.length - MAX_MODAL_FILES}개 파일은 자동 처리됩니다`,
				cls: 'mod-warning',
			});
		}

		// 전체 선택/해제
		new Setting(contentEl)
			.setName('전체 선택')
			.addToggle((toggle) => {
				toggle.setValue(true);
				toggle.onChange((v) => {
					if (v) {
						this._files.forEach((f) => this._selectedPaths.add(f.path));
					} else {
						this._selectedPaths.clear();
					}
					this._renderFileList(listEl);
				});
			});

		const listEl = contentEl.createDiv({ cls: 'initial-sync-file-list' });
		this._renderFileList(listEl);

		// 버튼 영역
		new Setting(contentEl)
			.addButton((btn) =>
				btn.setButtonText('건너뛰기').onClick(() => {
					const skipped = this._files.map((f) => f.path);
					this._onResolve({ selectedPaths: [], skippedPaths: skipped });
					this.close();
				}),
			)
			.addButton((btn) =>
				btn
					.setButtonText('다운로드 동기화 진행')
					.setCta()
					.onClick(() => {
						const selected = [...this._selectedPaths];
						const skipped = this._files
							.map((f) => f.path)
							.filter((p) => !this._selectedPaths.has(p));
						this._onResolve({ selectedPaths: selected, skippedPaths: skipped });
						this.close();
					}),
			);
	}

	private _renderFileList(container: HTMLElement): void {
		container.empty();
		const filesToShow = this._files.slice(0, MAX_MODAL_FILES);

		for (const file of filesToShow) {
			new Setting(container)
				.setName(file.path)
				.addToggle((toggle) => {
					toggle.setValue(this._selectedPaths.has(file.path));
					toggle.onChange((v) => {
						if (v) {
							this._selectedPaths.add(file.path);
						} else {
							this._selectedPaths.delete(file.path);
						}
					});
				});
		}
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

/** 모달을 Promise로 래핑 */
export function showDownloadModal(
	app: any,
	files: FileInfo[],
): Promise<DownloadPlan> {
	return new Promise((resolve) => {
		const modal = new InitialSyncDownloadModal(app, files, resolve);
		modal.open();
	});
}
