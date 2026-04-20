// SimpleConflictModal - diff 없는 심플 충돌 선택 모달 (SPEC-P6-UX-002)
import { Modal, type App } from 'obsidian';
// @MX:NOTE 사용자 선택 결과 타입
export type SimpleModalChoice = 'local' | 'remote' | 'both' | 'later';
// @MX:NOTE 심플 충돌 모달: diff 없이 파일 경로와 4개 선택 버튼만 표시
export class SimpleConflictModal extends Modal {
	private filePath: string;
	private onChoose: (choice: SimpleModalChoice) => void;
	private _buttons: HTMLButtonElement[] = [];
	constructor(
		app: App,
		filePath: string,
		onChoose: (choice: SimpleModalChoice) => void,
	) {
		super(app);
		this.filePath = filePath;
		this.onChoose = onChoose;
	}
	onOpen(): void {
		// 타이틀 설정
		this.titleEl.setText(`충돌 해결: ${this.filePath}`);
		// 파일 경로 표시
		this.contentEl.createDiv({
			text: `파일: ${this.filePath}`,
			cls: 'conflict-file-path',
		});
		// 버튼 생성
		this.createButtons();
	}
	// @MX:NOTE 4개 선택 버튼 생성
	private createButtons(): void {
		const buttons = [
			{ label: '로컬 유지', choice: 'local' as SimpleModalChoice },
			{ label: '원격 적용', choice: 'remote' as SimpleModalChoice },
			{ label: '둘 다 보존', choice: 'both' as SimpleModalChoice },
			{ label: '나중에', choice: 'later' as SimpleModalChoice },
		];
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
		return 4; // 항상 4개 버튼
	}
}
