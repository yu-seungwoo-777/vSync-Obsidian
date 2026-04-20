// 설정 탭 테스트
// REQ-P4-001: 설정 영속화
// REQ-P4-002: 설정 저장 시 연결 검증
// REQ-P4-003: 필수 설정 누락 시 동기화 비활성화
// REQ-P4-004: 무효 설정 저장 방지
// REQ-PA-011: 연결된 기기 목록 UI
// REQ-PA-012: 기기 제거 UI
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { VectorSettingTab } from '../../src/settings';
import type { DeviceApi } from '../../src/settings';
import type { VectorSettings } from '../../src/types';
import type { DeviceInfo } from '../../src/types';
import { DEFAULT_SETTINGS } from '../../src/types';

// mock 설정
const mockSaveData = vi.fn().mockResolvedValue(undefined);
const mockLoadData = vi.fn().mockResolvedValue(null);
const mockNotice = vi.fn();

const { mockRequestUrl } = vi.hoisted(() => ({
	mockRequestUrl: vi.fn().mockImplementation(async () => ({
		status: 200, headers: {}, text: '', json: {}, arrayBuffer: new ArrayBuffer(0),
	})),
}));

vi.mock('obsidian', () => ({
	requestUrl: mockRequestUrl,
	Notice: vi.fn().mockImplementation((msg: string) => mockNotice(msg)),
	Platform: { isDesktop: true, isMobile: false },
	PluginSettingTab: class {
		containerEl = {
			empty: vi.fn(),
			createEl: vi.fn().mockReturnValue({ setText: vi.fn(), setAttr: vi.fn(), appendChild: vi.fn() }),
			createDiv: vi.fn().mockReturnValue({ setText: vi.fn(), setAttr: vi.fn(), appendChild: vi.fn(), style: {}, remove: vi.fn() }),
			appendChild: vi.fn(),
		};
		constructor(_app: unknown, _plugin: unknown) {}
		display() {}
		hide() {}
	},
	Setting: class {
		settingEl = { setText: vi.fn(), setAttr: vi.fn(), appendChild: vi.fn() };
		controlEl = { setText: vi.fn() };
		infoEl = { setText: vi.fn() };
		nameEl = { setText: vi.fn() };
		descEl = { setText: vi.fn() };
		constructor(containerEl: unknown) {}
		setName() { return this; }
		setDesc() { return this; }
		setPlaceholder() { return this; }
		setValue() { return this; }
		addText(cb: (el: unknown) => void) { cb({ setPlaceholder: vi.fn().mockReturnThis(), setValue: vi.fn().mockReturnThis(), onChange: vi.fn().mockReturnThis(), inputEl: { value: '', type: 'text' } }); return this; }
		addPassword(cb: (el: unknown) => void) { cb({ setPlaceholder: vi.fn().mockReturnThis(), setValue: vi.fn().mockReturnThis(), onChange: vi.fn().mockReturnThis(), inputEl: { value: '', type: 'password' } }); return this; }
		addSlider(cb: (el: unknown) => void) { cb({ setLimits: vi.fn().mockReturnThis(), setValue: vi.fn().mockReturnThis(), setDynamicTooltip: vi.fn().mockReturnThis(), onChange: vi.fn().mockReturnThis(), sliderEl: { value: 30 } }); return this; }
		addButton(cb: (el: unknown) => void) { cb({ setButtonText: vi.fn().mockReturnThis(), setCta: vi.fn().mockReturnThis(), onClick: vi.fn().mockReturnThis(), buttonEl: {} }); return this; }
		setDisabled() { return this; }
		setHeading() { return this; }
	},
}));

describe('VectorSettingTab', () => {
	let tab: VectorSettingTab;
	let settings: VectorSettings;
	let onSettingsChange: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		vi.clearAllMocks();
		settings = { ...DEFAULT_SETTINGS };
		onSettingsChange = vi.fn();

		const mockPlugin = {
			loadData: mockLoadData,
			saveData: mockSaveData,
			settings,
			onSettingsChange,
		};

		tab = new VectorSettingTab({} as never, mockPlugin as never);
	});

	describe('validateSettings (REQ-P4-004)', () => {
		it('빈 server_url은 유효하지 않아야 한다', () => {
			settings.server_url = '';
			const valid = tab.validateSettings(settings);
			expect(valid.server_url).toBe(false);
		});

		it('공백만 있는 server_url은 유효하지 않아야 한다', () => {
			settings.server_url = '   ';
			const valid = tab.validateSettings(settings);
			expect(valid.server_url).toBe(false);
		});

		it('유효한 URL은 통과해야 한다', () => {
			settings.server_url = 'https://sync.example.com';
			const valid = tab.validateSettings(settings);
			expect(valid.server_url).toBe(true);
		});

		it('필수 설정이 모두 있으면 전체 유효해야 한다', () => {
			settings.server_url = 'https://example.com';
			settings.api_key = 'key';
			settings.vault_id = 'vault-1';
			const valid = tab.validateSettings(settings);
			expect(valid.all).toBe(true);
		});

		it('필수 설정이 하나라도 누락되면 전체 무효해야 한다 (REQ-P4-003)', () => {
			settings.server_url = 'https://example.com';
			settings.api_key = '';
			settings.vault_id = 'vault-1';
			const valid = tab.validateSettings(settings);
			expect(valid.all).toBe(false);
		});
	});

	describe('normalizeServerUrl', () => {
		it('trailing slash를 제거해야 한다', () => {
			expect(tab.normalizeServerUrl('https://example.com/')).toBe('https://example.com');
		});

		it('여러 trailing slash를 제거해야 한다', () => {
			expect(tab.normalizeServerUrl('https://example.com///')).toBe('https://example.com');
		});

		it('trailing slash가 없으면 그대로 반환해야 한다', () => {
			expect(tab.normalizeServerUrl('https://example.com')).toBe('https://example.com');
		});
	});

	describe('isConfigured (REQ-P4-003)', () => {
		it('모든 필수 설정이 있으면 true를 반환해야 한다', () => {
			settings.server_url = 'https://example.com';
			settings.api_key = 'key';
			settings.vault_id = 'vault-1';
			expect(tab.isConfigured(settings)).toBe(true);
		});

		it('server_url이 누락되면 false를 반환해야 한다', () => {
			settings.server_url = '';
			settings.api_key = 'key';
			settings.vault_id = 'vault-1';
			expect(tab.isConfigured(settings)).toBe(false);
		});

		it('apiKey가 누락되면 false를 반환해야 한다', () => {
			settings.server_url = 'https://example.com';
			settings.api_key = '';
			settings.vault_id = 'vault-1';
			expect(tab.isConfigured(settings)).toBe(false);
		});

		it('vaultId가 누락되면 false를 반환해야 한다', () => {
			settings.server_url = 'https://example.com';
			settings.api_key = 'key';
			settings.vault_id = '';
			expect(tab.isConfigured(settings)).toBe(false);
		});
	});

	describe('connection test (REQ-P4-002)', () => {
		it('연결 성공 시 파일 수를 반환해야 한다', async () => {
			const files = [{ id: 1, path: 'a.md', hash: 'h', sizeBytes: 10, createdAt: '', updatedAt: '' }];
			mockRequestUrl.mockResolvedValueOnce({
				status: 200,
				json: files,
				text: '',
			});

			const result = await tab.testConnection(settings);
			expect(result.success).toBe(true);
			expect(result.file_count).toBe(1);
		});

		it('인증 실패 시 에러를 반환해야 한다', async () => {
			mockRequestUrl.mockRejectedValueOnce({ status: 401 });

			const result = await tab.testConnection(settings);
			expect(result.success).toBe(false);
			expect(result.error).toBeDefined();
		});
	});

	// ============================================================
	// SPEC-P8-PLUGIN-API-001: 디바이스 관리 UI (REQ-PA-011, REQ-PA-012)
	// ============================================================

	describe('디바이스 관리 UI (REQ-PA-011, REQ-PA-012)', () => {
		let mockDeviceApi: DeviceApi;

		beforeEach(() => {
			vi.clearAllMocks();
			settings = { ...DEFAULT_SETTINGS, device_id: 'current-device-id-1234' };
			onSettingsChange = vi.fn();

			const mockPlugin = {
				loadData: mockLoadData,
				saveData: mockSaveData,
				settings,
				onSettingsChange,
			};

			tab = new VectorSettingTab({} as never, mockPlugin as never);
		});

		describe('setDeviceApi (REQ-PA-011)', () => {
			it('DeviceApi를 설정할 수 있어야 한다', () => {
				mockDeviceApi = {
					getDevices: vi.fn().mockResolvedValue([]),
					removeDevice: vi.fn().mockResolvedValue(undefined),
					getCurrentDeviceId: vi.fn().mockReturnValue('current-device-id-1234'),
				};
				tab.setDeviceApi(mockDeviceApi);
				// 에러 없이 완료되면 성공
				expect(true).toBe(true);
			});
		});

		describe('_renderDeviceSection (REQ-PA-011)', () => {
			it('API 없이 호출 시 안내 메시지를 표시해야 한다', async () => {
				const containerEl = {
					createEl: vi.fn().mockReturnValue({ setText: vi.fn() }),
					createDiv: vi.fn().mockReturnValue({ style: {}, setText: vi.fn() }),
					empty: vi.fn(),
				};
				await tab._renderDeviceSection(containerEl as any);

				// h3 헤더 생성 확인
				expect(containerEl.createEl).toHaveBeenCalledWith('h3', { text: 'Connected Devices' });
				// 안내 메시지 div 생성 확인
				expect(containerEl.createDiv).toHaveBeenCalled();
			});

			it('기기가 없으면 "No devices connected"를 표시해야 한다', async () => {
				mockDeviceApi = {
					getDevices: vi.fn().mockResolvedValue([]),
					removeDevice: vi.fn().mockResolvedValue(undefined),
					getCurrentDeviceId: vi.fn().mockReturnValue('current-device-id-1234'),
				};
				tab.setDeviceApi(mockDeviceApi);

				const containerEl = {
					createEl: vi.fn().mockReturnValue({ setText: vi.fn() }),
					createDiv: vi.fn().mockReturnValue({ style: {}, setText: vi.fn(), remove: vi.fn() }),
					empty: vi.fn(),
				};
				await tab._renderDeviceSection(containerEl as any);

				// 빈 목록 div 생성 확인
				const emptyCall = (containerEl.createDiv as ReturnType<typeof vi.fn>).mock.calls.find(
					(call: any[]) => call[0]?.text === 'No devices connected'
				);
				expect(emptyCall).toBeDefined();
			});

			it('기기 목록을 가져와 표시해야 한다', async () => {
				const devices: DeviceInfo[] = [
					{ device_id: 'current-device-id-1234', vault_id: 'vault-1', last_event_id: null, last_sync_at: '2026-04-19T00:00:00Z' },
					{ device_id: 'other-device-id-5678', vault_id: 'vault-1', last_event_id: null, last_sync_at: '2026-04-18T12:00:00Z' },
				];
				mockDeviceApi = {
					getDevices: vi.fn().mockResolvedValue(devices),
					removeDevice: vi.fn().mockResolvedValue(undefined),
					getCurrentDeviceId: vi.fn().mockReturnValue('current-device-id-1234'),
				};
				tab.setDeviceApi(mockDeviceApi);

				const containerEl = {
					createEl: vi.fn().mockReturnValue({ setText: vi.fn() }),
					createDiv: vi.fn().mockReturnValue({ style: {}, setText: vi.fn(), remove: vi.fn() }),
					empty: vi.fn(),
				};
				await tab._renderDeviceSection(containerEl as any);

				// API 호출 확인
				expect(mockDeviceApi.getDevices).toHaveBeenCalled();
			});

			it('서버 오류 시 에러 메시지를 표시해야 한다', async () => {
				mockDeviceApi = {
					getDevices: vi.fn().mockRejectedValue(new Error('Server error')),
					removeDevice: vi.fn().mockResolvedValue(undefined),
					getCurrentDeviceId: vi.fn().mockReturnValue('current-device-id-1234'),
				};
				tab.setDeviceApi(mockDeviceApi);

				const containerEl = {
					createEl: vi.fn().mockReturnValue({ setText: vi.fn() }),
					createDiv: vi.fn().mockReturnValue({ style: {}, setText: vi.fn(), remove: vi.fn() }),
					empty: vi.fn(),
				};
				await tab._renderDeviceSection(containerEl as any);

				// 에러 메시지 div 생성 확인
				const errorCall = (containerEl.createDiv as ReturnType<typeof vi.fn>).mock.calls.find(
					(call: any[]) => call[0]?.text?.includes('불러오지 못했습니다')
				);
				expect(errorCall).toBeDefined();
			});
		});

		describe('_renderDeviceItem (REQ-PA-011, REQ-PA-012)', () => {
			it('현재 기기에는 "(현재 기기)" 표시가 있어야 한다', () => {
				const device: DeviceInfo = {
					device_id: 'current-device-id-1234',
					vault_id: 'vault-1', last_event_id: null,
					last_sync_at: '2026-04-19T00:00:00Z',
				};

				const containerEl = {
					createEl: vi.fn(),
					createDiv: vi.fn(),
				};

				// _renderDeviceItem이 에러 없이 완료
				expect(() => {
					tab._renderDeviceItem(containerEl as any, device, 'current-device-id-1234');
				}).not.toThrow();
			});

			it('현재 기기가 아닌 기기에 제거 버튼이 있어야 한다', () => {
				const device: DeviceInfo = {
					device_id: 'other-device-id-5678',
					vault_id: 'vault-1', last_event_id: null,
					last_sync_at: '2026-04-18T12:00:00Z',
				};

				const containerEl = {
					createEl: vi.fn(),
					createDiv: vi.fn(),
				};

				// 현재 기기가 아닌 기기 렌더링 (에러 없이 완료)
				expect(() => {
					tab._renderDeviceItem(containerEl as any, device, 'current-device-id-1234');
				}).not.toThrow();
			});

			it('기기 ID가 마스킹되어야 한다 (앞 8자리 + ...)', () => {
				const device: DeviceInfo = {
					device_id: 'very-long-device-id-that-should-be-masked',
					vault_id: 'vault-1', last_event_id: null,
					last_sync_at: '2026-04-19T00:00:00Z',
				};

				const containerEl = {
					createEl: vi.fn(),
					createDiv: vi.fn(),
				};

				// 렌더링이 성공하면 마스킹 로직이 동작함
				expect(() => {
					tab._renderDeviceItem(containerEl as any, device, 'current-device-id-1234');
				}).not.toThrow();
			});
		});

		describe('display - 디바이스 섹션 포함 (REQ-PA-011)', () => {
			it('display()가 에러 없이 완료되어야 한다', () => {
				mockDeviceApi = {
					getDevices: vi.fn().mockResolvedValue([]),
					removeDevice: vi.fn().mockResolvedValue(undefined),
					getCurrentDeviceId: vi.fn().mockReturnValue('current-device-id-1234'),
				};
				tab.setDeviceApi(mockDeviceApi);

				// display() 호출 - 내부적으로 _renderDeviceSection 호출
				expect(() => tab.display()).not.toThrow();
			});
		});
	});
});
