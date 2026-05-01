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
	private _isLoggingIn = false;
	private _testResult: { success: boolean; message: string } | null = null;

	// UI 참조 (값 직접 읽기용)
	private _serverUrlInput: HTMLInputElement | null = null;
	private _usernameInput: HTMLInputElement | null = null;
	private _passwordInput: HTMLInputElement | null = null;
	private _loginBtn: HTMLButtonElement | null = null;

	// 리렌더 간 값 유지용 캐시
	private _cachedServerUrl = '';
	private _cachedUsername = '';
	private _cachedPassword = '';

	/** 디바이스 ID */
	private _deviceId = "";

	constructor(
		app: any, // eslint-disable-line @typescript-eslint/no-explicit-any
		settings: VSyncSettings,
		onConnect: OnConnectCallback,
		onDisconnect?: OnDisconnectCallback,
	) {
		super(app);
		this._settings = settings;
		this._deviceId = settings.device_id;
		this._onConnect = onConnect;
		this._onDisconnect = onDisconnect;
		this._selectedVaultId = settings.vault_id;
		this._cachedServerUrl = settings.server_url ?? '';
		this._cachedUsername = settings.username ?? '';
	}

	onOpen(): void {
		this.titleEl.setText('서버 연결');

		if (this._settings.session_token) {
			this._tryRestoreSession();
		} else {
			this._render();
		}
	}

	/** 입력값을 DOM에서 직접 읽기 (onChange 누락 방지) */
	private _readInputs(): { serverUrl: string; username: string; password: string } {
		if (this._serverUrlInput) this._cachedServerUrl = this._serverUrlInput.value.replace(/\/+$/, '');
		if (this._usernameInput) this._cachedUsername = this._usernameInput.value;
		if (this._passwordInput) this._cachedPassword = this._passwordInput.value;
		return {
			serverUrl: this._cachedServerUrl,
			username: this._cachedUsername,
			password: this._cachedPassword,
		};
	}

	private _render(): void {
		const { contentEl } = this;
		contentEl.empty();

		const prev = this._readInputs();

		// ── 서버 URL ──
		new Setting(contentEl)
			.setName('서버 URL')
			.setDesc('vSync 서버 주소 (예: http://localhost:3000)')
			.addText((text) => {
				text
					.setPlaceholder('http://localhost:3000')
					.setValue(prev.serverUrl)
					.onChange((v) => {
						// noop — 값은 _readInputs()에서 직접 읽음
					});
				this._serverUrlInput = text.inputEl;
			});

		// ── 사용자명 ──
		new Setting(contentEl)
			.setName('사용자명')
			.addText((text) => {
				text
					.setPlaceholder('username')
					.setValue(prev.username)
					.onChange(() => {});
				this._usernameInput = text.inputEl;
			});

		// ── 비밀번호 ──
		new Setting(contentEl)
			.setName('비밀번호')
			.addText((text) => {
				text
					.setPlaceholder('password')
					.setValue(prev.password)
					.onChange(() => {});
				text.inputEl.type = 'password';
				this._passwordInput = text.inputEl;
			});

		// ── 로그인 버튼 ──
		new Setting(contentEl)
			.addButton((btn) => {
				btn
					.setButtonText(this._isLoggingIn ? '로그인 중...' : '로그인')
					.setDisabled(this._isLoggingIn)
					.setCta()
					.onClick(() => this._handleLogin());
				this._loginBtn = btn.buttonEl;
			});

		// ── 로그인 에러 ──
		if (this._loginError) {
			const errEl = contentEl.createDiv({ text: this._loginError });
			errEl.style.color = 'var(--text-error)';
			errEl.style.padding = '4px 0 8px 0';
		}

		// ── 로그인 성공 시: 볼트 섹션 (항상 표시) ──
		if (this._loginResult) {
			contentEl.createEl('h3', { text: '볼트 선택' });

			if (this._vaults.length === 0) {
				const noVaultEl = contentEl.createDiv({
					text: '생성된 볼트가 없습니다. 먼저 서버에서 볼트를 생성하세요.',
				});
				noVaultEl.style.color = 'var(--text-warning)';
				noVaultEl.style.padding = '8px 0';
			} else {
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

					// ── 하단 버튼: 연결 + 연결 해제 ──
					new Setting(contentEl)
						.addButton((btn) =>
							btn
								.setButtonText('연결')
								.setCta()
								.onClick(() => this._handleConnect()),
						)
						.addButton((btn) =>
							btn
								.setButtonText('연결 해제')
								.onClick(() => this._handleDisconnect()),
						);
				}
			}
		}
	}

	/** 로그인 버튼을 직접 비활성화 + 텍스트 변경 (전체 리렌더 없이) */
	private _setLoginLoading(loading: boolean): void {
		this._isLoggingIn = loading;
		if (this._loginBtn) {
			this._loginBtn.textContent = loading ? '로그인 중...' : '로그인';
			this._loginBtn.disabled = loading;
		}
	}

	/** 세션 토큰이 있을 때 vaults 재조회 시도 */
	private async _tryRestoreSession(): Promise<void> {
		const { contentEl } = this;
		const loadingEl = contentEl.createDiv({ text: '세션 복원 중...' });
		loadingEl.style.color = 'var(--text-muted)';

		try {
			const vaults = await fetchVaults(
				this._settings.server_url,
				this._settings.session_token,
			);
			this._vaults = vaults;
			this._loginResult = { token: this._settings.session_token, user: { id: '', username: this._settings.username ?? '', role: '' }, vaults };
			this._loginError = '';
		} catch {
			this._vaults = [];
			this._loginError = '';
		}

		this._render();
	}

	/** 로그인 */
	private async _handleLogin(): Promise<void> {
		const { serverUrl, username, password } = this._readInputs();

		if (!serverUrl || !username || !password) {
			this._loginError = '서버 URL, 사용자명, 비밀번호를 모두 입력하세요';
			this._render();
			return;
		}

		this._loginError = '';
		this._vaults = [];
		this._selectedVaultId = '';
		this._testResult = null;

		// 버튼 직접 업데이트 (전체 리렌더 대신)
		this._setLoginLoading(true);

		try {
			const result = await login(serverUrl, username, password, this._deviceId);
			this._loginResult = result;
			this._vaults = result.vaults;

			if (result.vaults.length === 1) {
				this._selectedVaultId = result.vaults[0].id;
			}
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
		} finally {
			this._setLoginLoading(false);
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
			const { serverUrl } = this._readInputs();
			const url = `${serverUrl}/v1/vault/${this._selectedVaultId}/files`;
			const resp = await requestUrl({
				url,
				method: 'GET',
				headers: {
					Authorization: `Bearer ${this._loginResult.token}`,
					'X-Device-ID': this._deviceId,
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

		const { serverUrl, username } = this._readInputs();

		const newSettings: Partial<VSyncSettings> = {
			server_url: serverUrl,
			username,
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
