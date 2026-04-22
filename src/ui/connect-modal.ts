// 연결 설정 모달

import { Modal, Notice, Setting, requestUrl } from 'obsidian';
import type { VSyncSettings } from '../types';
import { login, fetchVaults } from '../api-client';
import type { LoginResult, VaultInfo } from '../api-client';

/** 연결 콜백 */
export type OnConnectCallback = (
	settings: Partial<VSyncSettings>,
) => Promise<boolean>;

/** 연결 해제 콜백 */
export type OnDisconnectCallback = () => Promise<void>;

export class ConnectModal extends Modal {
	private _settings: VSyncSettings;
	private _onConnect: OnConnectCallback;
	private _onDisconnect?: OnDisconnectCallback;

	// 모달 내 임시 상태
	private _loginResult: LoginResult | null = null;
	private _loginError = '';
	private _selectedVaultId = '';
	private _vaults: VaultInfo[] = [];
	private _isTesting = false;
	private _testResult: { success: boolean; message: string } | null = null;

	/** 입력값 (모달 내 임시) */
	private _serverUrl = '';
	private _username = '';
	private _password = '';

	/** 이미 연결된 상태인지 */
	private _wasConnected = false;

	constructor(
		app: any, // eslint-disable-line @typescript-eslint/no-explicit-any
		settings: VSyncSettings,
		onConnect: OnConnectCallback,
		onDisconnect?: OnDisconnectCallback,
	) {
		super(app);
		this._settings = settings;
		this._onConnect = onConnect;
		this._onDisconnect = onDisconnect;

		// 기존 설정으로 초기화
		this._serverUrl = settings.server_url;
		this._username = settings.username;
		this._password = settings.password;
		this._selectedVaultId = settings.vault_id;
		this._wasConnected = !!(settings.server_url && settings.session_token && settings.vault_id);
	}

	onOpen(): void {
		this.titleEl.setText('서버 연결');

		if (this._settings.session_token) {
			this._tryRestoreSession();
		} else {
			this._render();
		}
	}

	private _render(): void {
		const { contentEl } = this;
		contentEl.empty();

		// ── 서버 URL ──
		new Setting(contentEl)
			.setName('서버 URL')
			.setDesc('vSync 서버 주소 (예: http://localhost:3000)')
			.addText((text) =>
				text
					.setPlaceholder('http://localhost:3000')
					.setValue(this._serverUrl)
					.onChange((v) => {
						this._serverUrl = v.replace(/\/+$/, '');
					}),
			);

		// ── 사용자명 ──
		new Setting(contentEl)
			.setName('사용자명')
			.addText((text) =>
				text
					.setPlaceholder('username')
					.setValue(this._username)
					.onChange((v) => {
						this._username = v;
					}),
			);

		// ── 비밀번호 ──
		new Setting(contentEl)
			.setName('비밀번호')
			.addText((text) => {
				text
					.setPlaceholder('password')
					.setValue(this._password)
					.onChange((v) => {
						this._password = v;
					});
				text.inputEl.type = 'password';
			});

		// ── 로그인 버튼 ──
		new Setting(contentEl)
			.addButton((btn) =>
				btn
					.setButtonText('로그인')
					.setCta()
					.onClick(() => this._handleLogin()),
			);

		// ── 로그인 에러 ──
		if (this._loginError) {
			const errEl = contentEl.createDiv({ text: this._loginError });
			errEl.style.color = 'var(--text-error)';
			errEl.style.padding = '4px 0 8px 0';
		}

		// ── 로그인 성공 시: 볼트 선택 ──
		if (this._vaults.length > 0) {
			contentEl.createEl('h3', { text: '볼트 선택' });

			const vaultOptions: Record<string, string> = {};
			for (const v of this._vaults) {
				vaultOptions[v.id] = `${v.name} (${v.id.slice(0, 8)}...)`;
			}

			new Setting(contentEl)
				.setName('동기화할 볼트')
				.addDropdown((dd) => {
					dd.addOption('', '— 볼트를 선택하세요 —');
					dd.addOptions(vaultOptions);
					dd.setValue(this._selectedVaultId);
					dd.onChange((v) => {
						this._selectedVaultId = v;
						this._render();
					});
				});

			// ── 연결 테스트 (볼트 선택 후) ──
			if (this._selectedVaultId) {
				new Setting(contentEl)
					.setName('연결 테스트')
					.addButton((btn) => {
						btn
							.setButtonText(this._isTesting ? '테스트 중...' : '테스트')
							.setDisabled(this._isTesting)
							.onClick(() => this._handleTestConnection());
					});

				if (this._testResult) {
					const el = contentEl.createDiv({
						text: this._testResult.message,
					});
					el.style.color = this._testResult.success
						? 'var(--text-success)'
						: 'var(--text-error)';
					el.style.padding = '4px 0 8px 0';
				}

				// ── 하단 버튼: 연결 또는 연결 해제 중 하나만 ──
				if (this._wasConnected) {
					new Setting(contentEl)
						.addButton((btn) =>
							btn
								.setButtonText('연결 해제')
								.onClick(() => this._handleDisconnect()),
						);
				} else {
					new Setting(contentEl)
						.addButton((btn) =>
							btn
								.setButtonText('연결')
								.setCta()
								.onClick(() => this._handleConnect()),
						);
				}
			}
		}
	}

	/** 세션 토큰이 있을 때 vaults 재조회 시도 */
	private async _tryRestoreSession(): Promise<void> {
		const { contentEl } = this;
		const loadingEl = contentEl.createDiv({ text: '세션 복원 중...' });
		loadingEl.style.color = 'var(--text-muted)';

		try {
			const vaults = await fetchVaults(
				this._serverUrl,
				this._settings.session_token,
			);
			this._vaults = vaults;
			this._loginError = '';
		} catch {
			this._vaults = [];
			this._loginError = '';
		}

		this._render();
	}

	/** 로그인 */
	private async _handleLogin(): Promise<void> {
		if (!this._serverUrl || !this._username || !this._password) {
			this._loginError = '서버 URL, 사용자명, 비밀번호를 모두 입력하세요';
			this._render();
			return;
		}

		this._loginError = '';
		this._vaults = [];
		this._selectedVaultId = '';
		this._testResult = null;
		this._render();

		try {
			const result = await login(this._serverUrl, this._username, this._password, this._settings.device_id);
			this._loginResult = result;
			this._vaults = result.vaults;

			if (result.vaults.length === 1) {
				this._selectedVaultId = result.vaults[0].id;
			}

			this._render();
		} catch (error) {
			let msg = '로그인 실패';
			if (error && typeof error === 'object' && 'status' in error) {
				const status = (error as { status: number }).status;
				msg = status === 401
					? '인증 실패: 사용자명 또는 비밀번호가 올바르지 않습니다'
					: `로그인 실패: HTTP ${status}`;
			} else if (error instanceof Error) {
				msg = `로그인 실패: ${error.message}`;
			}
			this._loginError = msg;
			this._render();
		}
	}

	/** 연결 테스트 */
	private async _handleTestConnection(): Promise<void> {
		if (!this._selectedVaultId || !this._loginResult) return;

		this._isTesting = true;
		this._testResult = null;
		this._render();

		try {
			const url = `${this._serverUrl}/v1/vault/${this._selectedVaultId}/files`;
			const resp = await requestUrl({
				url,
				method: 'GET',
				headers: {
					Authorization: `Bearer ${this._loginResult.token}`,
				},
			});
			const files = Array.isArray(resp.json) ? resp.json : (resp.json as any).files ?? []; // eslint-disable-line @typescript-eslint/no-explicit-any
			this._testResult = {
				success: true,
				message: `연결 성공! ${files.length}개 파일`,
			};
		} catch (error) {
			let msg = '연결 실패';
			if (error && typeof error === 'object' && 'status' in error) {
				const status = (error as { status: number }).status;
				if (status === 401) msg = '인증 실패';
				else if (status === 404) msg = '볼트를 찾을 수 없습니다';
				else msg = `HTTP ${status}`;
			} else if (error instanceof Error) {
				msg = error.message;
			}
			this._testResult = { success: false, message: msg };
		} finally {
			this._isTesting = false;
			this._render();
		}
	}

	/** 연결 */
	private async _handleConnect(): Promise<void> {
		if (!this._selectedVaultId || !this._loginResult) {
			new Notice('볼트를 선택하세요');
			return;
		}

		const newSettings: Partial<VSyncSettings> = {
			server_url: this._serverUrl,
			username: this._username,
			password: '', // REQ-004: 평문 비밀번호 저장 방지
			session_token: this._loginResult.token,
			vault_id: this._selectedVaultId,
		};

		const ok = await this._onConnect(newSettings);
		this.close();

		if (ok) {
			new Notice('서버에 연결되었습니다');
		} else {
			new Notice('연결에 실패했습니다. 다시 시도하세요');
		}
	}

	/** 연결 해제 */
	private async _handleDisconnect(): Promise<void> {
		if (this._onDisconnect) {
			await this._onDisconnect();
		}
		this.close();
		new Notice('연결이 해제되었습니다');
	}
}
