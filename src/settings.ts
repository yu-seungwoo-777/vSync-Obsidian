// vSync 설정 탭

import { PluginSettingTab, requestUrl, Notice, Setting } from 'obsidian';
import type { VSyncSettings, DeviceInfo } from './types';
import { DEFAULT_SETTINGS } from './types';

/** 설정 검증 결과 */
export interface ValidationResult {
	server_url: boolean;
	api_key: boolean;
	vault_id: boolean;
	all: boolean;
}

/** 연결 테스트 결과 */
export interface ConnectionTestResult {
	success: boolean;
	file_count?: number;
	error?: string;
}

/** 디바이스 관리 API 인터페이스 (REQ-PA-011, REQ-PA-012) */
export interface DeviceApi {
	getDevices: () => Promise<DeviceInfo[]>;
	removeDevice: (device_id: string) => Promise<void>;
	/** 현재 기기 device_id */
	getCurrentDeviceId: () => string;
}

export class VSyncSettingTab extends PluginSettingTab {
	plugin: { settings: VSyncSettings; saveSettings: () => Promise<void> };
	private _deviceApi: DeviceApi | null = null;

	constructor(
		app: any, // eslint-disable-line @typescript-eslint/no-explicit-any -- Obsidian PluginSettingTab 생성자가 App 타입 요구
		plugin: { settings: VSyncSettings; saveSettings: () => Promise<void> },
	) {
		super(app, plugin as any); // eslint-disable-line @typescript-eslint/no-explicit-any -- Obsidian PluginSettingTab 생성자가 Plugin 타입 요구
		this.plugin = plugin;
	}

	/** 디바이스 API 주입 (REQ-PA-011, REQ-PA-012) */
	setDeviceApi(api: DeviceApi): void {
		this._deviceApi = api;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		containerEl.createEl('h2', { text: 'vSync Settings' });

		// 서버 URL
		new Setting(containerEl)
			.setName('Server URL')
			.setDesc('vSync server URL (e.g. http://localhost:3000)')
			.addText((text) =>
				text
					.setPlaceholder('http://localhost:3000')
					.setValue(this.plugin.settings.server_url)
					.onChange(async (value) => {
						this.plugin.settings.server_url = value.replace(/\/+$/, '');
						await this.plugin.saveSettings();
					}),
			);

		// API Key
		new Setting(containerEl)
			.setName('API Key')
			.setDesc('Vault API key (generated on vault creation)')
			.addText((text) => {
				text
					.setPlaceholder('Enter API key')
					.setValue(this.plugin.settings.api_key)
					.onChange(async (value) => {
						this.plugin.settings.api_key = value;
						await this.plugin.saveSettings();
					});
				text.inputEl.type = 'password';
			});

		// Vault ID
		new Setting(containerEl)
			.setName('Vault ID')
			.setDesc('Vault UUID')
			.addText((text) =>
				text
					.setPlaceholder('xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx')
					.setValue(this.plugin.settings.vault_id)
					.onChange(async (value) => {
						this.plugin.settings.vault_id = value.trim();
						await this.plugin.saveSettings();
					}),
			);

		// 동기화 주기
		new Setting(containerEl)
			.setName('Sync interval')
			.setDesc('Polling interval in seconds (default: 30)')
			.addText((text) =>
				text
					.setPlaceholder('30')
					.setValue(String(this.plugin.settings.sync_interval || 30))
					.onChange(async (value) => {
						const num = parseInt(value, 10);
						if (!isNaN(num) && num >= 5) {
							this.plugin.settings.sync_interval = num;
							await this.plugin.saveSettings();
						}
					}),
			);

		// 연결 테스트
		new Setting(containerEl)
			.setName('Test Connection')
			.setDesc('Verify server connection with current settings')
			.addButton((btn) =>
				btn.setButtonText('Test').onClick(async () => {
					const result = await this.testConnection(this.plugin.settings);
					if (result.success) {
						new Notice(`Connected! ${result.file_count} files found.`);
					} else {
						new Notice(`Connection failed: ${result.error}`);
					}
				}),
			);

		// Device ID (편집 + 랜덤 생성)
		new Setting(containerEl)
			.setName('Device ID')
			.setDesc('Identifies this device to prevent sync loops. Change when using multiple devices.')
			.addText((text) =>
				text
					.setPlaceholder('Enter or generate Device ID')
					.setValue(this.plugin.settings.device_id)
					.onChange(async (value) => {
						this.plugin.settings.device_id = value.trim();
						await this.plugin.saveSettings();
					}),
			)
			.addButton((btn) =>
				btn.setButtonText('Generate').onClick(async () => {
					this.plugin.settings.device_id = globalThis.crypto.randomUUID();
					await this.plugin.saveSettings();
					this.display();
					new Notice(`New Device ID: ${this.plugin.settings.device_id.slice(0, 8)}...`);
				}),
			);

		// 연결된 기기 관리 (REQ-PA-011, REQ-PA-012)
		this._renderDeviceSection(containerEl);
	}

	/**
	 * 연결된 기기 섹션 렌더링 (REQ-PA-011, REQ-PA-012)
	 * 서버에서 기기 목록을 가져와 표시하고, 현재 기기가 아닌 경우 제거 버튼 제공
	 */
	private async _renderDeviceSection(containerEl: HTMLElement): Promise<void> {
		// 섹션 헤더
		containerEl.createEl('h3', { text: 'Connected Devices' });

		// API가 설정되지 않은 경우 안내 메시지
		if (!this._deviceApi) {
			const noApiEl = containerEl.createDiv({
				text: '서버에 연결하여 기기 목록을 불러올 수 없습니다. 설정을 먼저 구성하세요.',
			});
			noApiEl.style.color = 'var(--text-muted)';
			noApiEl.style.padding = '8px 0';
			return;
		}

		// 로딩 상태 표시 영역
		const loadingEl = containerEl.createDiv({
			text: '기기 목록을 불러오는 중...',
		});
		loadingEl.style.color = 'var(--text-muted)';
		loadingEl.style.padding = '8px 0';

		try {
			const devices = await this._deviceApi.getDevices();
			loadingEl.remove();

			// 기기가 없는 경우
			if (devices.length === 0) {
				const emptyEl = containerEl.createDiv({
					text: 'No devices connected',
				});
				emptyEl.style.color = 'var(--text-faint)';
				emptyEl.style.padding = '8px 0';
				return;
			}

			// 현재 기기 ID
			const currentDeviceId = this._deviceApi.getCurrentDeviceId();

			// 각 기기 표시
			for (const device of devices) {
				this._renderDeviceItem(containerEl, device, currentDeviceId);
			}
		} catch (error) {
			loadingEl.remove();
			const errorEl = containerEl.createDiv({
				text: `기기 목록을 불러오지 못했습니다: ${(error as Error).message}`,
			});
			errorEl.style.color = 'var(--text-error)';
			errorEl.style.padding = '8px 0';
		}
	}

	/**
	 * 개별 기기 항목 렌더링 (REQ-PA-011, REQ-PA-012)
	 */
	private _renderDeviceItem(
		containerEl: HTMLElement,
		device: DeviceInfo,
		currentDeviceId: string,
	): void {
		const isCurrent = device.device_id === currentDeviceId;

		// 기기 ID 마스킹 (앞 8자리만 표시)
		const maskedId = device.device_id.slice(0, 8) + '...';

		// 마지막 동기화 시간 포맷팅
		const lastSyncText = device.last_sync_at
			? new Date(device.last_sync_at).toLocaleString()
			: '없음';

		const setting = new Setting(containerEl)
			.setName(`${maskedId}${isCurrent ? ' (현재 기기)' : ''}`)
			.setDesc(`마지막 동기화: ${lastSyncText}`);

		// 현재 기기가 아닌 경우 제거 버튼 추가 (REQ-PA-012)
		if (!isCurrent) {
			setting.addButton((btn) =>
				btn.setButtonText('제거').onClick(async () => {
					try {
						if (this._deviceApi) {
							await this._deviceApi.removeDevice(device.device_id);
							new Notice(`기기 ${maskedId}가 제거되었습니다`);
							// 설정 화면 새로고침
							this.display();
						}
					} catch (error) {
						const msg = (error as Error).message || '알 수 없는 오류';
						new Notice(`기기 제거 실패: ${msg}`);
					}
				}),
			);
		} else {
			// 현재 기기는 제거 불가 안내
			setting.setDesc(`마지막 동기화: ${lastSyncText} (현재 기기는 제거할 수 없습니다)`);
		}
	}

	/**
	 * 설정값 검증 (REQ-P4-004)
	 */
	validateSettings(settings: VSyncSettings): ValidationResult {
		const hasServerUrl = settings.server_url.trim().length > 0;
		const hasApiKey = settings.api_key.trim().length > 0;
		const hasVaultId = settings.vault_id.trim().length > 0;

		return {
			server_url: hasServerUrl,
			api_key: hasApiKey,
			vault_id: hasVaultId,
			all: hasServerUrl && hasApiKey && hasVaultId,
		};
	}

	/**
	 * 서버 URL 정규화 (trailing slash 제거)
	 */
	normalizeServerUrl(url: string): string {
		return url.replace(/\/+$/, '');
	}

	/**
	 * 필수 설정이 모두 구성되었는지 확인 (REQ-P4-003)
	 */
	isConfigured(settings: VSyncSettings): boolean {
		return this.validateSettings(settings).all;
	}

	/**
	 * 서버 연결 테스트 (REQ-P4-002)
	 */
	async testConnection(settings: VSyncSettings): Promise<ConnectionTestResult> {
		const baseUrl = this.normalizeServerUrl(settings.server_url);
		const url = `${baseUrl}/v1/vault/${settings.vault_id}/files`;

		try {
			const response = await requestUrl({
				url,
				method: 'GET',
				headers: {
					'X-API-Key': settings.api_key,
				},
			});
			const files = response.json as unknown[];
			return {
				success: true,
				file_count: files.length,
			};
		} catch (error: unknown) {
			let errorMessage = 'Unknown error';
			if (error && typeof error === 'object' && 'status' in error) {
				const status = (error as { status: number }).status;
				if (status === 401) {
					errorMessage = 'Authentication failed. Check your API key.';
				} else if (status === 404) {
					errorMessage = 'Vault not found. Check your Vault ID.';
				} else {
					errorMessage = `HTTP ${status}`;
				}
			} else if (error instanceof Error) {
				errorMessage = error.message;
			}
			return {
				success: false,
				error: errorMessage,
			};
		}
	}
}

export { DEFAULT_SETTINGS };
export type { VSyncSettings };
