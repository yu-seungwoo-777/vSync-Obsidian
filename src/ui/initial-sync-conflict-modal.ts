// Step 3: 양쪽 충돌 파일 해결 모달
// SPEC: SPEC-INITIAL-SYNC-MODAL-001 REQ-IS-005

import { Modal, Setting } from 'obsidian';
import type { ConflictFile, ConflictPlan } from '../types';

const MAX_MODAL_FILES = 1000;

function getFolder(path: string): string {
	const idx = path.lastIndexOf('/');
	return idx > 0 ? path.substring(0, idx) : '/';
}

function groupByFolder<T extends { path: string }>(files: T[]): Map<string, T[]> {
	const map = new Map<string, T[]>();
	for (const file of files) {
		const folder = getFolder(file.path);
		if (!map.has(folder)) map.set(folder, []);
		map.get(folder)!.push(file);
	}
	return new Map([...map.entries()].sort((a, b) => a[0].localeCompare(b[0])));
}

export class InitialSyncConflictModal extends Modal {
	private _files: ConflictFile[];
	private _onResolve: (plan: ConflictPlan) => void;
	private _resolutions: Map<string, 'server' | 'local' | 'skip'>;
	private _resolved = false;

	constructor(
		app: any,
		files: ConflictFile[],
		onResolve: (plan: ConflictPlan) => void,
	) {
		super(app);
		this._files = files;
		this._onResolve = onResolve;
		this._resolutions = new Map(files.map((f) => [f.path, 'server'] as const));
	}

	onOpen(): void {
		if (this._files.length === 0) {
			this._resolve({ resolutions: new Map(), skippedPaths: [] });
			this.close();
			return;
		}

		this.titleEl.setText('초기 동기화 — 충돌 해결');

		const { contentEl } = this;

		contentEl.createEl('p', {
			text: '서버와 로컬 양쪽에 존재하지만 내용이 다른 파일입니다.',
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

		const listEl = contentEl.createDiv({ cls: 'initial-sync-file-list' });
		listEl.style.maxHeight = '400px';
		listEl.style.overflowY = 'auto';
		listEl.style.marginBottom = '12px';
		this._renderFileList(listEl);

		new Setting(contentEl)
			.addButton((btn) =>
				btn.setButtonText('건너뛰기(전체)').onClick(() => {
					this._resolve({
						resolutions: new Map(),
						skippedPaths: this._files.map((f) => f.path),
					});
					this.close();
				}),
			)
			.addButton((btn) =>
				btn
					.setButtonText('충돌 동기화 진행')
					.setCta()
					.onClick(() => {
						const skipped: string[] = [];
						for (const [path, resolution] of this._resolutions) {
							if (resolution === 'skip') skipped.push(path);
						}
						this._resolve({ resolutions: this._resolutions, skippedPaths: skipped });
						this.close();
					}),
			);
	}

	private _resolve(plan: ConflictPlan): void {
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
				.addDropdown((dd) => {
					dd.addOption('', '— 폴더 전체 설정 —');
					dd.addOption('server', '모두 서버(Server)');
					dd.addOption('local', '모두 로컬(Local)');
					dd.addOption('skip', '모두 건너뛰기(Skip)');
					dd.setValue('');
					dd.onChange((v) => {
						if (!v) return;
						for (const f of files) {
							this._resolutions.set(f.path, v as 'server' | 'local' | 'skip');
						}
						this._renderFileList(container);
					});
				});

			for (const file of files) {
				const fileName = file.path.substring(file.path.lastIndexOf('/') + 1) || file.path;
				const setting = new Setting(container).setName(fileName);

				setting.addDropdown((dd) => {
					dd.addOption('server', '서버(Server)');
					dd.addOption('local', '로컬(Local)');
					dd.addOption('skip', '건너뛰기(Skip)');
					dd.setValue(this._resolutions.get(file.path) ?? 'server');
					dd.onChange((v) => {
						this._resolutions.set(file.path, v as 'server' | 'local' | 'skip');
					});
				});
			}
		}
	}

	onClose(): void {
		this.contentEl.empty();
		this._resolve({
			resolutions: new Map(),
			skippedPaths: this._files.map((f) => f.path),
		});
	}
}

/** 모달을 Promise로 래핑 */
export function showConflictModal(
	app: any,
	files: ConflictFile[],
): Promise<ConflictPlan> {
	return new Promise((resolve) => {
		const modal = new InitialSyncConflictModal(app, files, resolve);
		modal.open();
	});
}
