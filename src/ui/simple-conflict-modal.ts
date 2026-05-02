// SimpleConflictModal - diff 없는 심플 충돌 선택 모달 (SPEC-P6-UX-002)
import { Modal, type App } from 'obsidian';

// @MX:NOTE 사용자 선택 결과 타입
export type SimpleModalChoice = 'local' | 'remote' | 'both' | 'later';

// @MX:NOTE 모달 옵션 — 버튼 숨김 제어
export type SimpleModalOptions = {
	hideBoth?: boolean;
	hideLater?: boolean;
};

// @MX:NOTE 심플 충돌 모달: diff 없이 파일 경로와 선택 버튼 표시
export class SimpleConflictModal extends Modal {
	private filePath: string;
	private onChoose: (choice: SimpleModalChoice) => void;
	private _options: SimpleModalOptions;
	private _buttons: HTMLButtonElement[] = [];

	constructor(
		app: App,
		filePath: string,
		onChoose: (choice: SimpleModalChoice) => void,
		options?: SimpleModalOptions,
	) {
		super(app);
		this.filePath = filePath;
		this.onChoose = onChoose;
		this._options = options ?? {};
	}

	onOpen(): void {
		this.titleEl.setText(`충돌 해결: ${this.filePath}`);

		this.contentEl.createDiv({
			text: `파일: ${this.filePath}`,
			cls: 'conflict-file-path',
		});

		this.createButtons();
	}

	// @MX:NOTE 선택 버튼 생성 (옵션에 따라 2~4개)
	private createButtons(): void {
		const allButtons = [
			{ label: '로컬 유지', choice: 'local' as SimpleModalChoice },
			{ label: '원격 적용', choice: 'remote' as SimpleModalChoice },
			{ label: '둘 다 보존', choice: 'both' as SimpleModalChoice },
			{ label: '나중에', choice: 'later' as SimpleModalChoice },
		];

		const buttons = allButtons.filter((btn) => {
			if (btn.choice === 'both' && this._options.hideBoth) return false;
			if (btn.choice === 'later' && this._options.hideLater) return false;
			return true;
		});

		this._buttons = [];
		for (const btn of buttons) {
			const buttonEl = this.contentEl.createEl('button', {
				text: btn.label,
				cls: 'conflict-resolve-button',
			});
			buttonEl.addEventListener('click', () => {
				this.onChoose(btn.choice);
				this.close();
			});
			this._buttons.push(buttonEl);
		}
	}

	// @MX:NOTE 테스트용: 버튼 클릭 시뮬레이션
	clickButton(choice: SimpleModalChoice): void {
		this.onChoose(choice);
		this.close();
	}

	// @MX:NOTE 테스트용: 버튼 수 반환
	getButtonCount(): number {
		return this._buttons.length;
	}
}
