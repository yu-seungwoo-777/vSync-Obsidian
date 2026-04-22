// vSync 설정 탭

import { PluginSettingTab, requestUrl, Notice, Setting } from 'obsidian';
import type { VSyncSettings, DeviceInfo } from './types';
import { DEFAULT_SETTINGS } from './types';
import { login, fetchVaults } from './api-client';
import type { LoginResult } from './api-client';

/** 설정 검증 결과 */
export interface ValidationResult {
	server_url: boolean;
	credentials: boolean;
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
	plugin: { settings: VSyncSettings; saveSettings: () => Promise<void>; pauseSync?: () => void; resumeSync?: () => void };
	private _deviceApi: DeviceApi | null = null;
	// @MX:NOTE 로그인 결과 캐시 (설정 화면 리프레시 시 유지)
	private _loginResult: LoginResult | null = null;
	// @MX:NOTE 로그인 에러 메시지
	private _loginError: string = '';

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

		// 동기화 활성화 토글
		new Setting(containerEl)
			.setName('Enable Sync')
			.setDesc('Toggle automatic synchronization on or off')
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.sync_enabled)
					.onChange(async (value) => {
						this.plugin.settings.sync_enabled = value;
						await this.plugin.saveSettings();
						if (value) {
							this.plugin.resumeSync?.();
						} else {
							this.plugin.pauseSync?.();
						}
						this.display();
					}),
			);

		// ============================================================
		// Section 1: 연결 설정 (로그인)
		// ============================================================
		containerEl.createEl('h3', { text: 'Connection' });

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

		// 사용자명
		new Setting(containerEl)
			.setName('Username')
			.setDesc('Login username')
			.addText((text) =>
				text
					.setPlaceholder('Enter username')
					.setValue(this.plugin.settings.username)
					.onChange(async (value) => {
						this.plugin.settings.username = value;
						await this.plugin.saveSettings();
					}),
			);

		// 비밀번호
		new Setting(containerEl)
			.setName('Password')
			.setDesc('Login password')
			.addText((text) => {
				text
					.setPlaceholder('Enter password')
					.setValue(this.plugin.settings.password)
					.onChange(async (value) => {
						this.plugin.settings.password = value;
						await this.plugin.saveSettings();
					});
				text.inputEl.type = 'password';
			});

		// 로그인 버튼 + 에러 메시지 영역
		new Setting(containerEl)
			.setName('Login')
			.setDesc('Authenticate with the vSync server')
			.addButton((btn) =>
				btn.setButtonText('Login').onClick(async () => {
					await this._handleLogin();
				}),
			);

		// 에러 메시지 표시
		if (this._loginError) {
			const errorEl = containerEl.createDiv({
				text: this._loginError,
			});
			errorEl.style.color = 'var(--text-error)';
			errorEl.style.padding = '4px 0 8px 0';
		}

		// 로그인 성공 상태 표시
		if (this.plugin.settings.session_token) {
			const statusEl = containerEl.createDiv({
				text: 'Logged in as ' + this.plugin.settings.username,
			});
			statusEl.style.color = 'var(--text-success)';
			statusEl.style.padding = '4px 0 8px 0';
		}

		// ============================================================
		// Section 2: 볼트 선택 (로그인 후에만 표시)
		// ============================================================
		if (this.plugin.settings.session_token || this._loginResult) {
			containerEl.createEl('h3', { text: 'Vault Selection' });

			// 볼트 목록 (로그인 결과에서 가져오거나 다시 조회)
			const vaults = this._loginResult?.vaults ?? [];

			if (vaults.length > 0) {
				// 볼트 선택 드롭다운
				const vaultOptions: Record<string, string> = {};
				for (const vault of vaults) {
					vaultOptions[vault.id] = `${vault.name} (${vault.id.slice(0, 8)}...)`;
				}

				new Setting(containerEl)
					.setName('Select Vault')
					.setDesc('Choose the vault to sync with this device')
					.addDropdown((dropdown) => {
						dropdown
							.addOptions(vaultOptions)
							.setValue(this.plugin.settings.vault_id || vaults[0].id)
							.onChange(async (value) => {
								this.plugin.settings.vault_id = value;
								await this.plugin.saveSettings();
							});

						// 단일 볼트면 자동 선택
						if (vaults.length === 1 && !this.plugin.settings.vault_id) {
							this.plugin.settings.vault_id = vaults[0].id;
							this.plugin.saveSettings();
						}
					});

				// 연결(Connect) 버튼
				new Setting(containerEl)
					.setName('Connect')
					.setDesc('Apply vault selection and start syncing')
					.addButton((btn) =>
						btn.setButtonText('Connect').onClick(async () => {
							if (!this.plugin.settings.vault_id) {
								new Notice('볼트를 선택하세요');
								return;
							}
						// 설정 저장
							await this.plugin.saveSettings();
							new Notice(`볼트 ${this.plugin.settings.vault_id}에 연결되었습니다`);
							this.display();
						}),
					);

				// 현재 선택된 볼트 정보
				if (this.plugin.settings.vault_id) {
					const selectedVault = vaults.find((v) => v.id === this.plugin.settings.vault_id);
					if (selectedVault) {
						const infoEl = containerEl.createDiv({
							text: `Connected to: ${selectedVault.name} (${selectedVault.id})`,
						});
						infoEl.style.color = 'var(--text-success)';
						infoEl.style.padding = '4px 0 8px 0';
					}
				}
			} else {
				// 볼트가 없는 경우 — 다시 불러오기 버튼
				new Setting(containerEl)
					.setName('No vaults found')
					.setDesc('No vaults available for this account')
					.addButton((btn) =>
						btn.setButtonText('Refresh').onClick(async () => {
							await this._handleRefreshVaults();
						}),
					);
			}
		}

		// ============================================================
		// Section 3: 동기화 설정
		// ============================================================

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
	 * 로그인 처리
	 */
	private async _handleLogin(): Promise<void> {
		const { server_url, username, password } = this.plugin.settings;

		if (!server_url || !username || !password) {
			this._loginError = '서버 URL, 사용자명, 비밀번호를 모두 입력하세요';
			this.display();
			return;
		}

		this._loginError = '';

		try {
			const result = await login(server_url, username, password);
			this.plugin.settings.session_token = result.token;
			this._loginResult = result;

			// 단일 볼트면 자동 선택
			if (result.vaults.length === 1) {
				this.plugin.settings.vault_id = result.vaults[0].id;
			}

			await this.plugin.saveSettings();
			new Notice(`로그인 성공: ${result.user.username}`);
			this.display();
		} catch (error) {
			let msg = '로그인 실패';
			if (error && typeof error === 'object' && 'status' in error) {
				const status = (error as { status: number }).status;
				if (status === 401) {
					msg = '인증 실패: 사용자명 또는 비밀번호가 올바르지 않습니다';
				} else {
					msg = `로그인 실패: HTTP ${status}`;
				}
			} else if (error instanceof Error) {
				msg = `로그인 실패: ${error.message}`;
			}
			this._loginError = msg;
			this.display();
		}
	}

	/**
	 * 볼트 목록 새로고침
	 */
	private async _handleRefreshVaults(): Promise<void> {
		if (!this.plugin.settings.session_token) {
			new Notice('세션이 만료되었습니다. 다시 로그인하세요');
			return;
		}

		try {
			const vaults = await fetchVaults(
				this.plugin.settings.server_url,
				this.plugin.settings.session_token,
			);
			// 로그인 결과 업데이트
			if (this._loginResult) {
				this._loginResult = {
					...this._loginResult,
					vaults,
				};
			}
			this.display();
		} catch (error) {
			const msg = (error instanceof Error) ? error.message : '알 수 없는 오류';
			new Notice(`볼트 목록을 불러오지 못했습니다: ${msg}`);
		}
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
		const hasCredentials = !!settings.session_token;
		const hasVaultId = settings.vault_id.trim().length > 0;

		return {
			server_url: hasServerUrl,
			credentials: hasCredentials,
			vault_id: hasVaultId,
			all: hasServerUrl && hasCredentials && hasVaultId,
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

			// JWT Bearer 토큰만 사용
			const headers: Record<string, string> = {
				'Authorization': `Bearer ${settings.session_token}`,
			};

		try {
			const response = await requestUrl({
				url,
				method: 'GET',
				headers,
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
					errorMessage = 'Authentication failed. Check your credentials.';
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
