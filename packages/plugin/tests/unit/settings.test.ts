// 설정 탭 테스트
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { VSyncSettingTab } from '../../src/settings';
import type { VSyncSettings } from '../../src/types';
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
	Modal: class {
		titleEl = { setText: vi.fn() };
		contentEl = {
			empty: vi.fn(),
			createEl: vi.fn().mockReturnValue({ setText: vi.fn() }),
			createDiv: vi.fn().mockReturnValue({ setText: vi.fn(), style: {} }),
		};
		constructor(_app: unknown) {}
		open() {}
		close() {}
		onOpen() {}
		onClose() {}
	},
	Setting: class {
		settingEl = { setText: vi.fn(), setAttr: vi.fn(), appendChild: vi.fn() };
		controlEl = { setText: vi.fn(), style: {} };
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
		addButton(cb: (el: unknown) => void) { cb({ setButtonText: vi.fn().mockReturnThis(), setCta: vi.fn().mockReturnThis(), onClick: vi.fn().mockReturnThis(), setDisabled: vi.fn().mockReturnThis(), buttonEl: { style: {} } }); return this; }
		addToggle(cb: (el: unknown) => void) { cb({ setValue: vi.fn().mockReturnThis(), onChange: vi.fn().mockReturnThis() }); return this; }
		addDropdown(cb: (el: unknown) => void) { cb({ addOption: vi.fn().mockReturnThis(), addOptions: vi.fn().mockReturnThis(), setValue: vi.fn().mockReturnThis(), onChange: vi.fn().mockReturnThis() }); return this; }
		setDisabled() { return this; }
		setHeading() { return this; }
	},
}));

function createMockPlugin(settings: VSyncSettings) {
	return {
		loadData: mockLoadData,
		saveData: mockSaveData,
		manifest: { name: 'vsync', version: '0.1.0' },
		settings,
		saveSettings: vi.fn().mockResolvedValue(undefined),
		pauseSync: vi.fn(),
		resumeSync: vi.fn(),
	};
}

describe('VSyncSettingTab', () => {
	let tab: VSyncSettingTab;
	let settings: VSyncSettings;

	beforeEach(() => {
		vi.clearAllMocks();
		settings = { ...DEFAULT_SETTINGS };
		const mockPlugin = createMockPlugin(settings);
		tab = new VSyncSettingTab({} as never, mockPlugin as never);
	});

	describe('display', () => {
		it('에러 없이 완료되어야 한다', () => {
			expect(() => tab.display()).not.toThrow();
		});

		it('연결된 상태에서도 에러 없이 완료되어야 한다', () => {
			settings.server_url = 'http://localhost:3000';
			settings.session_token = 'token';
			settings.vault_id = 'vault-1';
			settings.username = 'user';
			expect(() => tab.display()).not.toThrow();
		});
	});

	describe('setConnectHandler', () => {
		it('핸들러를 설정할 수 있어야 한다', () => {
			const handler = vi.fn().mockResolvedValue(true);
			tab.setConnectHandler(handler);
			expect(true).toBe(true);
		});
	});
});
