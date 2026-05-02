// vSync 설정 탭

import { PluginSettingTab, Notice, Setting, type Plugin } from 'obsidian';
import type { VSyncSettings } from './types';
import { ConnectModal } from './ui/connect-modal';
import { UpdateModal } from './ui/update-modal';

export class VSyncSettingTab extends PluginSettingTab {
	plugin: Plugin & {
		settings: VSyncSettings;
		saveSettings: () => Promise<void>;
		pauseSync: () => void;
		resumeSync: () => void;
	};
	private _connectHandler: ((settings: Partial<VSyncSettings>) => Promise<boolean>) | null = null;
	private _disconnectHandler: (() => Promise<void>) | null = null;

	constructor(
		app: any, // eslint-disable-line @typescript-eslint/no-explicit-any
		plugin: Plugin & {
			settings: VSyncSettings;
			saveSettings: () => Promise<void>;
			pauseSync: () => void;
			resumeSync: () => void;
			isOutdated: boolean;
		},
	) {
		super(app, plugin);
		this.plugin = plugin;
	}

	setConnectHandler(handler: (settings: Partial<VSyncSettings>) => Promise<boolean>): void {
		this._connectHandler = handler;
	}

	setDisconnectHandler(handler: () => Promise<void>): void {
		this._disconnectHandler = handler;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		containerEl.createEl('h2', { text: 'vSync 설정' });

		const s = this.plugin.settings;
		const isConnected = !!(s.server_url && s.session_token && s.vault_id);

		// ── 동기화 활성화 토글 (연결 전에는 즉시 복귀) ──
		new Setting(containerEl)
			.setName('동기화 활성화')
			.setDesc(isConnected ? '자동 동기화 켜기/끄기' : '서버에 먼저 연결하세요')
			.addToggle((toggle) =>
				toggle
					.setValue(s.sync_enabled && isConnected && !this.plugin.isOutdated)
					.onChange(async (value) => {
						if (value && !isConnected) {
							new Notice('서버에 연결 후 활성화할 수 있습니다');
							toggle.setValue(false);
							return;
						}
						this.plugin.settings.sync_enabled = value;
						await this.plugin.saveSettings();
						if (value) {
							this.plugin.resumeSync?.();
						} else {
							this.plugin.pauseSync?.();
						}
					}),
			);

		// ── 서버 연결 버튼 ──
		this._renderConnectButton(containerEl);

		// ── 동기화 설정 ──
		containerEl.createEl('h3', { text: '동기화 설정' });

		// 연결 모드: 실시간 / 폴링
		new Setting(containerEl)
			.setName('연결 모드')
			.setDesc(s.connection_mode === 'realtime' ? 'WebSocket 실시간 동기화' : '주기적 폴링 동기화')
			.addDropdown((dd) =>
				dd
					.addOptions({ realtime: '실시간', polling: '폴링' })
					.setValue(s.connection_mode)
					.onChange(async (value: string) => {
						this.plugin.settings.connection_mode = value as 'realtime' | 'polling';
						await this.plugin.saveSettings();
						this.display();
					}),
			);

		// 동기화 주기 — 폴링 모드에서만 활성
		const isPolling = s.connection_mode === 'polling';
		const intervalSetting = new Setting(containerEl)
			.setName('동기화 주기')
			.setDesc(isPolling ? '폴링 간격 (초, 기본: 30)' : '실시간 모드에서는 사용하지 않습니다')
			.addText((text) =>
				text
					.setPlaceholder('30')
					.setValue(String(s.sync_interval || 30))
					.onChange(async (value) => {
						const num = parseInt(value, 10);
						if (!isNaN(num) && num >= 5) {
							this.plugin.settings.sync_interval = num;
							await this.plugin.saveSettings();
						}
					}),
			);

		// 폴링 모드가 아니면 반투명 비활성
		if (!isPolling) {
			intervalSetting.controlEl.style.opacity = '0.4';
			intervalSetting.controlEl.style.pointerEvents = 'none';
		}

			// ── 플러그인 업데이트 ──
			containerEl.createEl('h3', { text: '업데이트' });

			new Setting(containerEl)
				.setName('현재 버전')
				.setDesc(`v${this.plugin.manifest?.version ?? 'unknown'}`)
				.addButton((btn) => {
					btn
						.setButtonText('업데이트 확인')
						.setDisabled(!isConnected)
						.onClick(() => {
							const s = this.plugin.settings;
							const pluginDir = '.obsidian/plugins/vsync';
							const modal = new UpdateModal(
								this.app,
								s.server_url,
								this.plugin.manifest?.version ?? '0.0.0',
								pluginDir,
							);
							modal.open();
						});
					if (!isConnected) {
						btn.setTooltip('서버에 연결 후 사용 가능합니다');
					}
				});
	}

	/** 서버 연결 버튼 */
	private _renderConnectButton(containerEl: HTMLElement): void {
		const s = this.plugin.settings;
		const isConnected = !!(s.server_url && s.session_token && s.vault_id);

		const setting = new Setting(containerEl)
			.setName('서버 연결')
			.setDesc(
				isConnected
					? `${s.username}@${s.server_url} — 볼트 ${s.vault_id.slice(0, 8)}...`
					: '서버에 연결되지 않았습니다',
			);

		if (isConnected) {
			setting.addButton((btn) => {
				btn
					.setButtonText('연결됨')
					.onClick(() => this._openConnectModal());
				btn.buttonEl.style.backgroundColor = 'var(--text-success)';
				btn.buttonEl.style.color = 'var(--background-primary)';
				btn.buttonEl.style.borderColor = 'var(--text-success)';
			});
		} else {
			setting.addButton((btn) =>
				btn
					.setButtonText('연결')
					.setCta()
					.onClick(() => this._openConnectModal()),
			);
		}
	}

	/** 연결 모달 열기 */
	private _openConnectModal(): void {
		const modal = new ConnectModal(
			this.app,
			this.plugin.settings,
			async (newSettings) => {
				Object.assign(this.plugin.settings, newSettings);
				await this.plugin.saveSettings();

				if (this._connectHandler) {
					return await this._connectHandler(newSettings);
				}
				return true;
			},
			async () => {
				if (this._disconnectHandler) {
					await this._disconnectHandler();
				}
			},
		);
		modal.onClose = () => this.display();
		modal.open();
	}
}

export { DEFAULT_SETTINGS } from './types';
export type { VSyncSettings };
