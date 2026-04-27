// Step 1: 서버에만 존재하는 파일 다운로드 모달
// SPEC: SPEC-INITIAL-SYNC-MODAL-001 REQ-IS-003

import { Modal, Setting } from 'obsidian';
import type { FileInfo, DownloadPlan } from '../types';

const MAX_MODAL_FILES = 1000;

/** 파일 경로에서 폴더 경로 추출 */
function getFolder(path: string): string {
	const idx = path.lastIndexOf('/');
	return idx > 0 ? path.substring(0, idx) : '/';
}

/** 파일 목록을 폴더별로 그룹핑 (알파벳 정렬) */
function groupByFolder<T extends { path: string }>(files: T[]): Map<string, T[]> {
	const map = new Map<string, T[]>();
	for (const file of files) {
		const folder = getFolder(file.path);
		if (!map.has(folder)) map.set(folder, []);
		map.get(folder)!.push(file);
	}
	return new Map([...map.entries()].sort((a, b) => a[0].localeCompare(b[0])));
}

export class InitialSyncDownloadModal extends Modal {
	private _files: FileInfo[];
	private _onResolve: (plan: DownloadPlan) => void;
	private _selectedPaths: Set<string>;
	private _resolved = false;

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
		if (this._files.length === 0) {
			this._resolve({ selectedPaths: [], skippedPaths: [] });
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

		if (this._files.length > MAX_MODAL_FILES) {
			contentEl.createEl('p', {
				text: `나머지 ${this._files.length - MAX_MODAL_FILES}개 파일은 자동 처리됩니다`,
				cls: 'mod-warning',
			});
		}

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
		listEl.style.maxHeight = '400px';
		listEl.style.overflowY = 'auto';
		listEl.style.marginBottom = '12px';
		this._renderFileList(listEl);

		new Setting(contentEl)
			.addButton((btn) =>
				btn.setButtonText('건너뛰기').onClick(() => {
					this._resolve({ selectedPaths: [], skippedPaths: this._files.map((f) => f.path) });
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
						this._resolve({ selectedPaths: selected, skippedPaths: skipped });
						this.close();
					}),
			);
	}

	private _resolve(plan: DownloadPlan): void {
		if (this._resolved) return;
		this._resolved = true;
		this._onResolve(plan);
	}

	private _renderFileList(container: HTMLElement): void {
		container.empty();
		const filesToShow = this._files.slice(0, MAX_MODAL_FILES);
		const folders = groupByFolder(filesToShow);

		for (const [folder, files] of folders) {
			const folderLabel = folder === '/' ? '/ (루트)' : folder;

			new Setting(container)
				.setName(folderLabel)
				.setDesc(`${files.length}개 파일`)
				.setHeading()
				.addToggle((toggle) => {
					const allSelected = files.every((f) => this._selectedPaths.has(f.path));
					toggle.setValue(allSelected);
					toggle.onChange((v) => {
						for (const f of files) {
							if (v) this._selectedPaths.add(f.path);
							else this._selectedPaths.delete(f.path);
						}
						this._renderFileList(container);
					});
				});

			for (const file of files) {
				const fileName = file.path.substring(file.path.lastIndexOf('/') + 1) || file.path;
				new Setting(container)
					.setName(fileName)
					.addToggle((toggle) => {
						toggle.setValue(this._selectedPaths.has(file.path));
						toggle.onChange((v) => {
							if (v) this._selectedPaths.add(file.path);
							else this._selectedPaths.delete(file.path);
						});
					});
			}
		}
	}

	onClose(): void {
		this.contentEl.empty();
		// X 버튼으로 닫은 경우: 전체 건너뛰기와 동일하게 처리
		this._resolve({ selectedPaths: [], skippedPaths: this._files.map((f) => f.path) });
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
