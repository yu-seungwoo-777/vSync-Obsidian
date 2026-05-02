// SimpleConflictModal - diff 없는 심플 충돌 선택 모달 (SPEC-P6-UX-002)
import { Modal, type App } from 'obsidian';

// @MX:NOTE 사용자 선택 결과 타입
export type SimpleModalChoice = 'local' | 'remote' | 'both' | 'later';

// @MX:NOTE 모달 옵션 — 버튼 숨김 제어
export type SimpleModalOptions = {
	hideBoth?: boolean;
	hideLater?: boolean;
	localContent?: string;
	serverContent?: string;
};

// 라인 diff 결과
type LineDiff = {
	type: 'equal' | 'local-only' | 'server-only';
	text: string;
};

function diffLines(local: string, server: string): LineDiff[] {
	const localLines = local.split('\n');
	const serverLines = server.split('\n');
	const result: LineDiff[] = [];

	// LCS 기반 라인 비교
	const m = localLines.length;
	const n = serverLines.length;

	// LCS 길이 테이블
	const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
	for (let i = 1; i <= m; i++) {
		for (let j = 1; j <= n; j++) {
			if (localLines[i - 1] === serverLines[j - 1]) {
				dp[i][j] = dp[i - 1][j - 1] + 1;
			} else {
				dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
			}
		}
	}

	// 역추적으로 diff 생성
	const rawDiff: Array<{ op: number; line: string }> = [];
	let i = m, j = n;
	while (i > 0 || j > 0) {
		if (i > 0 && j > 0 && localLines[i - 1] === serverLines[j - 1]) {
			rawDiff.push({ op: 0, line: localLines[i - 1] });
			i--; j--;
		} else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
			rawDiff.push({ op: 1, line: serverLines[j - 1] });
			j--;
		} else {
			rawDiff.push({ op: -1, line: localLines[i - 1] });
			i--;
		}
	}
	rawDiff.reverse();

	// 인접한 변경 라인을 그룹화
	for (const entry of rawDiff) {
		if (entry.op === 0) {
			result.push({ type: 'equal', text: entry.line });
		} else if (entry.op === -1) {
			result.push({ type: 'local-only', text: entry.line });
		} else {
			result.push({ type: 'server-only', text: entry.line });
		}
	}
	return result;
}

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

		// 파일 경로
		this.contentEl.createDiv({
			text: this.filePath,
			cls: 'conflict-file-path',
		});

		// 좌우 분할 diff 뷰 (내용이 있을 때만)
		if (this._options.localContent !== undefined && this._options.serverContent !== undefined) {
			this.createDiffView(this._options.localContent, this._options.serverContent);
		}

		this.createButtons();
	}

	private createDiffView(localContent: string, serverContent: string): void {
		const container = this.contentEl.createDiv({ cls: 'conflict-diff-split' });

		// 왼쪽: 로컬
		const localPane = container.createDiv({ cls: 'conflict-diff-pane local' });
		localPane.createDiv({ text: '로컬 버전', cls: 'conflict-diff-pane-title' });
		const localBody = localPane.createDiv({ cls: 'conflict-diff-pane-body' });

		// 오른쪽: 서버
		const serverPane = container.createDiv({ cls: 'conflict-diff-pane server' });
		serverPane.createDiv({ text: '서버 버전', cls: 'conflict-diff-pane-title' });
		const serverBody = serverPane.createDiv({ cls: 'conflict-diff-pane-body' });

		const diffs = diffLines(localContent, serverContent);
		for (const d of diffs) {
			if (d.type === 'equal') {
				localBody.createDiv({ text: d.text, cls: 'conflict-diff-line' });
				serverBody.createDiv({ text: d.text, cls: 'conflict-diff-line' });
			} else if (d.type === 'local-only') {
				localBody.createDiv({ text: d.text, cls: 'conflict-diff-line changed' });
				serverBody.createDiv({ text: '', cls: 'conflict-diff-line placeholder' });
			} else {
				localBody.createDiv({ text: '', cls: 'conflict-diff-line placeholder' });
				serverBody.createDiv({ text: d.text, cls: 'conflict-diff-line changed' });
			}
		}

		// 스크롤 동기화
		this._syncScroll(localBody, serverBody);
	}

	private _syncScroll(el1: HTMLElement, el2: HTMLElement): void {
		let syncing = false;
		el1.addEventListener('scroll', () => {
			if (syncing) return;
			syncing = true;
			el2.scrollTop = el1.scrollTop;
			syncing = false;
		});
		el2.addEventListener('scroll', () => {
			if (syncing) return;
			syncing = true;
			el1.scrollTop = el2.scrollTop;
			syncing = false;
		});
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

		const btnContainer = this.contentEl.createDiv({ cls: 'conflict-buttons' });
		this._buttons = [];
		for (const btn of buttons) {
			const buttonEl = btnContainer.createEl('button', {
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

	clickButton(choice: SimpleModalChoice): void {
		this.onChoose(choice);
		this.close();
	}

	getButtonCount(): number {
		return this._buttons.length;
	}
}
