// Obsidian 모듈 전체 mock
// vitest.config.ts alias로 obsidian → 이 파일을 가리킴
// main.ts, apiClient.ts, settings.ts 등에서 `import { ... } from 'obsidian'`이 여기서 해석됨
import { vi } from 'vitest';
// globalThis.crypto 모킹 (테스트 환경에서 randomUUID 사용)
if (!globalThis.crypto?.randomUUID) {
	Object.defineProperty(globalThis, 'crypto', {
		value: {
			randomUUID: () => 'test-uuid-' + Math.random().toString(36).slice(2, 9),
			subtle: {
				digest: async () => new ArrayBuffer(32),
			},
		},
		writable: true,
	});
}
// ============================================================
// 타입 정의
// ============================================================
export interface RequestUrlParam {
	url: string;
	method?: string;
	headers?: Record<string, string>;
	body?: string | ArrayBuffer;
	contentType?: string;
	throw?: boolean;
}
export interface RequestUrlResponse {
	status: number;
	headers: Record<string, string>;
	text: string;
	json: Record<string, unknown>;
	arrayBuffer: ArrayBuffer;
}
// ============================================================
// 최상위 mock 내보내기
// ============================================================
// requestUrl - 각 테스트에서 vi.mocked로 오버라이드 가능
export const requestUrl = vi.fn<[], Promise<RequestUrlResponse>>().mockImplementation(async () => ({
	status: 200,
	headers: {},
	text: '',
	json: {} as Record<string, unknown>,
	arrayBuffer: new ArrayBuffer(0),
}));
export const Notice = vi.fn().mockImplementation((text: string) => ({ _text: text }));
export const Platform = {
	isDesktop: true,
	isMobile: false,
};
export const moment = vi.fn().mockReturnValue({
	format: vi.fn().mockReturnValue('20260417120000'),
});
// Plugin 기본 클래스 mock
export class Plugin {
	loadData = vi.fn<[], Promise<unknown>>().mockResolvedValue(null);
	saveData = vi.fn().mockResolvedValue(undefined);
	addStatusBarItem = vi.fn().mockReturnValue({
		setText: vi.fn().mockReturnThis(),
		setAttr: vi.fn().mockReturnThis(),
		onClickEvent: vi.fn(),
		_lastText: '',
	});
	registerInterval = vi.fn();
	registerEvent = vi.fn().mockReturnValue({ detach: vi.fn() });
	addCommand = vi.fn().mockReturnValue({ detach: vi.fn() });
	addSettingTab = vi.fn();
	registerView = vi.fn();
	addRibbonIcon = vi.fn().mockReturnValue({ detach: vi.fn() });
	app = {
		vault: {
			on: vi.fn().mockReturnValue({ detach: vi.fn() }),
			off: vi.fn(),
			read: vi.fn().mockResolvedValue(''),
			getFiles: vi.fn().mockReturnValue([]),
			getAbstractFileByPath: vi.fn().mockReturnValue(null),
			modify: vi.fn(),
			create: vi.fn(),
			delete: vi.fn(),
		},
		workspace: {
			getLeavesOfType: vi.fn().mockReturnValue([]),
			activeLeaf: null,
		},
	};
	manifest = { id: 'vector', name: 'Vector', version: '0.1.0' };
}
// Modal 기본 클래스 mock (SPEC-P5-3WAY-001)
export class Modal {
	containerEl: HTMLElement;
	app: unknown;
	contentEl: HTMLElement;
	titleEl: HTMLElement;
	modalEl: HTMLElement;
	_opened = false;
	_onClose?: () => void;
	constructor(app: unknown) {
		this.app = app;
		const mockEl = {
			empty: vi.fn(),
			setText: vi.fn(),
			setAttr: vi.fn(),
			createEl: vi.fn().mockReturnValue({ setText: vi.fn(), setAttr: vi.fn(), appendChild: vi.fn(), addClass: vi.fn(), className: '', innerHTML: '', textContent: '', addEventListener: vi.fn() }),
			createDiv: vi.fn().mockReturnValue({ setText: vi.fn(), setAttr: vi.fn(), appendChild: vi.fn(), addClass: vi.fn(), className: '', innerHTML: '', textContent: '' }),
			appendChild: vi.fn(),
			addEventListener: vi.fn(),
			className: '',
			innerHTML: '',
			textContent: '',
		};
		// @ts-ignore - 테스트 환경에서 DOM 없이 동작
		this.containerEl = mockEl as unknown as HTMLElement;
		this.contentEl = this.containerEl;
		this.titleEl = this.containerEl;
		this.modalEl = this.containerEl;
	}
	open() { this._opened = true; this.onOpen(); }
	close() { this._opened = false; this._onClose?.(); }
	onOpen() {}
	onClose() {}
}
// ItemView 기본 클래스 mock (SPEC-P6-UX-002)
export class ItemView {
	containerEl: HTMLElement;
	app: unknown;
	contentEl: HTMLElement;
	leaf: unknown;
	constructor(leaf: unknown) {
		this.leaf = leaf;
		const mockEl = {
			empty: vi.fn(),
			setText: vi.fn(),
			setAttr: vi.fn(),
			createEl: vi.fn().mockReturnValue({
				setText: vi.fn(),
				setAttr: vi.fn(),
				appendChild: vi.fn(),
				addClass: vi.fn(),
				className: '',
				innerHTML: '',
				textContent: '',
				addEventListener: vi.fn(),
			}),
			createDiv: vi.fn().mockReturnValue({
				setText: vi.fn(),
				setAttr: vi.fn(),
				appendChild: vi.fn(),
				addClass: vi.fn(),
				className: '',
				innerHTML: '',
				textContent: '',
			}),
			appendChild: vi.fn(),
			addEventListener: vi.fn(),
			className: '',
			innerHTML: '',
			textContent: '',
		};
		// @ts-ignore - 테스트 환경에서 DOM 없이 동작
		this.containerEl = mockEl as unknown as HTMLElement;
		this.contentEl = this.containerEl;
	}
	onOpen() {}
	onClose() {}
	getViewType() { return ''; }
	getDisplayText() { return ''; }
	getIcon() { return 'file'; }
	getState() { return {}; }
}
// PluginSettingTab 기본 클래스 mock
export class PluginSettingTab {
	containerEl: Record<string, unknown>;
	constructor(_app: unknown, _plugin: unknown) {
		this.containerEl = {
			empty: vi.fn(),
			createEl: vi.fn().mockReturnValue({ setText: vi.fn(), setAttr: vi.fn(), appendChild: vi.fn() }),
			createDiv: vi.fn().mockReturnValue({ setText: vi.fn(), setAttr: vi.fn(), appendChild: vi.fn() }),
			appendChild: vi.fn(),
		};
	}
	display() {}
	hide() {}
}
// Setting 클래스 mock
export class Setting {
	settingEl: Record<string, unknown>;
	controlEl: Record<string, unknown>;
	infoEl: Record<string, unknown>;
	nameEl: Record<string, unknown>;
	descEl: Record<string, unknown>;
	constructor(_containerEl: unknown) {
		this.settingEl = {};
		this.controlEl = {};
		this.infoEl = {};
		this.nameEl = {};
		this.descEl = {};
	}
	setName() { return this; }
	setDesc() { return this; }
	setPlaceholder() { return this; }
	setValue() { return this; }
	addText(cb: (el: unknown) => void) {
		cb({ setPlaceholder: vi.fn().mockReturnThis(), setValue: vi.fn().mockReturnThis(), onChange: vi.fn().mockReturnThis(), inputEl: { value: '', type: 'text' } });
		return this;
	}
	addPassword(cb: (el: unknown) => void) {
		cb({ setPlaceholder: vi.fn().mockReturnThis(), setValue: vi.fn().mockReturnThis(), onChange: vi.fn().mockReturnThis(), inputEl: { value: '', type: 'password' } });
		return this;
	}
	addSlider(cb: (el: unknown) => void) {
		cb({ setLimits: vi.fn().mockReturnThis(), setValue: vi.fn().mockReturnThis(), setDynamicTooltip: vi.fn().mockReturnThis(), onChange: vi.fn().mockReturnThis(), sliderEl: { value: 30 } });
		return this;
	}
	addButton(cb: (el: unknown) => void) {
		cb({ setButtonText: vi.fn().mockReturnThis(), setCta: vi.fn().mockReturnThis(), onClick: vi.fn().mockReturnThis(), buttonEl: {} });
		return this;
	}
	addExtraButton() { return this; }
	setDisabled() { return this; }
	setHeading() { return this; }
	setClass() { return this; }
}
// 헬퍼 함수
export function createMockRequestUrl() {
	return vi.fn().mockImplementation(async (): Promise<RequestUrlResponse> => ({
		status: 200,
		headers: {},
		text: '',
		json: {} as Record<string, unknown>,
		arrayBuffer: new ArrayBuffer(0),
	}));
}
