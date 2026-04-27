import { Modal, Notice, Setting, type App } from 'obsidian';
import { checkPluginUpdate, downloadPluginFile } from '../api-client';
import type { PluginUpdateInfo } from '../api-client';

/** 플러그인 업데이트 모달 */
export class UpdateModal extends Modal {
	private _serverUrl: string;
	private _currentVersion: string;
	private _pluginDir: string;
	private _onComplete?: () => void;

	constructor(
		app: App,
		serverUrl: string,
		currentVersion: string,
		pluginDir: string,
		onComplete?: () => void,
	) {
		super(app);
		this._serverUrl = serverUrl;
		this._currentVersion = currentVersion;
		this._pluginDir = pluginDir;
		this._onComplete = onComplete;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl('h2', { text: '플러그인 업데이트' });

		// 버전 확인 중
		contentEl.createEl('p', { text: '서버에서 버전 정보를 확인하는 중...' });

		this._checkAndRender();
	}

	private async _checkAndRender() {
		const { contentEl } = this;
		let info: PluginUpdateInfo;

		try {
			info = await checkPluginUpdate(this._serverUrl, this._currentVersion);
		} catch (error) {
			contentEl.empty();
			contentEl.createEl('h2', { text: '플러그인 업데이트' });
			contentEl.createEl('p', {
				text: `버전 확인 실패: ${(error as Error).message}`,
				cls: 'vSync-error',
			});
			new Setting(contentEl).addButton((btn) =>
				btn.setButtonText('닫기').onClick(() => this.close()),
			);
			return;
		}

		contentEl.empty();
		contentEl.createEl('h2', { text: '플러그인 업데이트' });

		if (!info.hasUpdate) {
			contentEl.createEl('p', {
				text: `현재 최신 버전을 사용 중입니다 (v${info.currentVersion})`,
			});
			new Setting(contentEl).addButton((btn) =>
				btn.setButtonText('닫기').onClick(() => this.close()),
			);
			return;
		}

		// 업데이트 가능
		contentEl.createEl('p', {
			text: `새 버전이 available합니다: v${info.latestVersion}`,
			cls: 'vSync-update-available',
		});

		new Setting(contentEl)
			.setName('현재 버전')
			.setDesc(`v${info.currentVersion}`);

		new Setting(contentEl)
			.setName('최신 버전')
			.setDesc(`v${info.latestVersion}`);

		const statusEl = contentEl.createEl('p', { text: '' });

		new Setting(contentEl).addButton((btn) =>
			btn
				.setButtonText('업데이트')
				.setCta()
				.onClick(async () => {
					btn.setButtonText('업데이트 중...').setDisabled(true);
					await this._performUpdate(info, statusEl);
				}),
		);
	}

	private async _performUpdate(info: PluginUpdateInfo, statusEl: HTMLElement): Promise<void> {
		try {
			const { vault } = this.app;
			const adapter = vault.adapter;

			for (const filename of info.files) {
				statusEl.setText(`다운로드 중: ${filename}...`);
				const content = await downloadPluginFile(this._serverUrl, filename);
				const filePath = `${this._pluginDir}/${filename}`;

				if (typeof content === 'string') {
					await adapter.write(filePath, content);
				} else {
					await adapter.writeBinary(filePath, content as ArrayBuffer);
				}
			}

			statusEl.setText('');
			new Notice(`v${info.latestVersion}으로 업데이트 완료. Obsidian을 재시작해주세요.`);

			this._onComplete?.();
			this.close();
		} catch (error) {
			statusEl.setText(`업데이트 실패: ${(error as Error).message}`);
			new Notice(`업데이트 실패: ${(error as Error).message}`);
		}
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}
