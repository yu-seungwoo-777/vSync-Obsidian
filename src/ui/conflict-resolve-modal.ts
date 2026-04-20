// @MX:NOTE 충돌 해결 모달 - diff 시각적 렌더링 및 사용자 선택 (SPEC-P5-3WAY-001)
import { Modal, type App } from 'obsidian';
// @MX:NOTE 사용자 선택 결과 타입
export type ModalChoice = 'local' | 'remote' | 'both' | 'later';
// @MX:NOTE diff 연산 타입 (서버에서 전달)
export type DiffOperation = {
	op: number; // -1: 삭제, 0: 동일, 1: 추가
	text: string;
};
// @MX:NOTE 렌더링된 diff 항목
export type RenderedDiffItem = {
	type: 'delete' | 'insert' | 'equal';
	text: string;
};
// @MX:NOTE 대용량 diff 기준 (100KB)
const MAX_DIFF_SIZE = 100 * 1024;
// @MX:ANCHOR 충돌 해결 모달: diff 시각적 렌더링 + 4개 선택 버튼
// @MX:REASON 사용자 충돌 해결 UX의 핵심 컴포넌트, 데이터 무손실 보장
export class ConflictResolveModal extends Modal {
	private filePath: string;
	private diff: DiffOperation[] | null;
	private onChoose: (choice: ModalChoice) => void;
	private renderedItems: RenderedDiffItem[] = [];
	private diffTooLarge: boolean = false;
	private _isSimpleMode: boolean = false;
	constructor(
		app: App,
		filePath: string,
		diff: DiffOperation[] | null,
		onChoose: (choice: ModalChoice) => void,
	) {
		super(app);
		this.filePath = filePath;
		this.diff = diff;
		this.onChoose = onChoose;
		// @MX:NOTE diff가 null 또는 빈 배열이면 심플 모드 (AC-007.1)
		this._isSimpleMode = !diff || diff.length === 0;
	}
	onOpen(): void {
		// 타이틀 설정
		this.titleEl.setText(`충돌 해결: ${this.filePath}`);
		if (this._isSimpleMode) {
			// @MX:NOTE 심플 모드: 파일 경로만 표시 (AC-007.1, AC-007.2)
			this.contentEl.createDiv({
				text: `파일: ${this.filePath}`,
				cls: 'conflict-file-path',
			});
		} else {
			// diff 크기 확인
			const totalDiffSize = this.diff!.reduce((sum, d) => sum + d.text.length, 0);
			this.diffTooLarge = totalDiffSize > MAX_DIFF_SIZE;
			if (this.diffTooLarge) {
				// 대용량 diff: 메시지만 표시
				this.contentEl.createDiv({
					text: '(diff가 너무 김)',
					cls: 'conflict-diff-too-large',
				});
			} else {
				// diff 렌더링
				this.renderDiff();
			}
		}
		// 버튼 생성
		this.createButtons();
	}
	// @MX:NOTE diff를 색상별로 렌더링
	private renderDiff(): void {
		this.renderedItems = [];
		for (const item of this.diff!) {
			let type: RenderedDiffItem['type'];
			let cls: string;
			if (item.op === -1) {
				type = 'delete';
				cls = 'conflict-diff-delete'; // 빨강
			} else if (item.op === 1) {
				type = 'insert';
				cls = 'conflict-diff-insert'; // 초록
			} else {
				type = 'equal';
				cls = 'conflict-diff-equal'; // 회색
			}
			this.renderedItems.push({ type, text: item.text });
			const div = this.contentEl.createDiv({ cls });
			div.setText(item.text);
		}
	}
	// @MX:NOTE 4개 선택 버튼 생성
	private createButtons(): void {
		const buttons = [
			{ label: '로컬 유지', choice: 'local' as ModalChoice },
			{ label: '원격 적용', choice: 'remote' as ModalChoice },
			{ label: '둘 다 보존', choice: 'both' as ModalChoice },
			{ label: '나중에', choice: 'later' as ModalChoice },
		];
		for (const btn of buttons) {
			const buttonEl = this.contentEl.createEl('button', {
				text: btn.label,
				cls: 'conflict-resolve-button',
			});
			buttonEl.addEventListener('click', () => {
				this.onChoose(btn.choice);
				this.close();
			});
		}
	}
	// @MX:NOTE 테스트용: 버튼 클릭 시뮬레이션
	clickButton(choice: ModalChoice): void {
		this.onChoose(choice);
		this.close();
	}
	// @MX:NOTE 테스트용: 버튼 수 반환
	getButtonCount(): number {
		return 4; // 항상 4개 버튼
	}
	// @MX:NOTE 테스트용: diff 크기 초과 여부
	isDiffTooLarge(): boolean {
		return this.diffTooLarge;
	}
	// @MX:NOTE 테스트용: 렌더링된 diff 항목 반환
	getRenderedDiffItems(): RenderedDiffItem[] {
		return this.renderedItems;
	}
	// @MX:NOTE 테스트용: 심플 모드 여부
	isSimpleMode(): boolean {
		return this._isSimpleMode;
	}
}
