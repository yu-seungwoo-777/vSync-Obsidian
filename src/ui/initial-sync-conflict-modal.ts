// Step 3: 양쪽 충돌 파일 해결 모달
// SPEC: SPEC-INITIAL-SYNC-MODAL-001 REQ-IS-005

import { Modal, Setting } from 'obsidian';
import type { ConflictFile, ConflictPlan } from '../types';

const MAX_MODAL_FILES = 1000;

export class InitialSyncConflictModal extends Modal {
	private _files: ConflictFile[];
	private _onResolve: (plan: ConflictPlan) => void;
	private _resolutions: Map<string, 'server' | 'local' | 'skip'>;

	constructor(
		app: any,
		files: ConflictFile[],
		onResolve: (plan: ConflictPlan) => void,
	) {
		super(app);
		this._files = files;
		this._onResolve = onResolve;
		// 기본 선택: 서버 (SPEC REQ-IS-005)
		this._resolutions = new Map(files.map((f) => [f.path, 'server'] as const));
	}

	onOpen(): void {
		if (this._files.length === 0) {
			this._onResolve({ resolutions: new Map(), skippedPaths: [] });
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
		this._renderFileList(listEl);

		// 버튼 영역
		new Setting(contentEl)
			.addButton((btn) =>
				btn.setButtonText('건너뛰기(전체)').onClick(() => {
					const resolutions = new Map<string, 'server' | 'local' | 'skip'>();
					const skipped = this._files.map((f) => f.path);
					this._onResolve({ resolutions, skippedPaths: skipped });
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
						this._onResolve({ resolutions: this._resolutions, skippedPaths: skipped });
						this.close();
					}),
			);
	}

	private _renderFileList(container: HTMLElement): void {
		container.empty();
		const filesToShow = this._files.slice(0, MAX_MODAL_FILES);

		for (const file of filesToShow) {
			const setting = new Setting(container).setName(file.path);

			// 라디오 버튼 그룹을 드롭다운으로 구현
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

	onClose(): void {
		this.contentEl.empty();
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
