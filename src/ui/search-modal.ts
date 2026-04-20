// SearchModal - 서버 파일 검색 결과 표시 모달 (SPEC-P8-PLUGIN-API-001)
import { Modal, Notice, type App } from 'obsidian';
import type { SearchResultItem } from '../types';

/** 검색 결과 클릭 콜백 타입 */
export type OnSearchResultClick = (filePath: string) => void;

/** 검색 결과 표시 모달 */
export class SearchModal extends Modal {
	private _results: SearchResultItem[];
	private _total: number;
	private _query: string;
	private _onResultClick: OnSearchResultClick;

	constructor(
		app: App,
		query: string,
		results: SearchResultItem[],
		total: number,
		onResultClick: OnSearchResultClick,
	) {
		super(app);
		this._query = query;
		this._results = results;
		this._total = total;
		this._onResultClick = onResultClick;
	}

	onOpen(): void {
		this.titleEl.setText(`검색 결과: "${this._query}"`);

		// 결과 개수 표시
		const countEl = this.contentEl.createDiv({
			text: `${this._total}개의 결과를 찾았습니다.`,
		});
		countEl.style.marginBottom = '12px';
		countEl.style.color = 'var(--text-muted)';

		// 결과가 없는 경우
		if (this._results.length === 0) {
			const emptyEl = this.contentEl.createDiv({
				text: '검색 결과가 없습니다.',
			});
			emptyEl.style.padding = '20px';
			emptyEl.style.textAlign = 'center';
			emptyEl.style.color = 'var(--text-faint)';
			return;
		}

		// 결과 목록 생성
		for (const result of this._results) {
			this._renderResultItem(result);
		}
	}

	/** 개별 검색 결과 렌더링 */
	private _renderResultItem(result: SearchResultItem): void {
		const itemEl = this.contentEl.createDiv();
		itemEl.addClass('search-result-item');
		itemEl.style.padding = '8px 12px';
		itemEl.style.marginBottom = '4px';
		itemEl.style.borderRadius = '4px';
		itemEl.style.cursor = 'pointer';
		itemEl.style.border = '1px solid var(--background-modifier-border)';

		// 호버 효과
		itemEl.addEventListener('mouseenter', () => {
			itemEl.style.backgroundColor = 'var(--background-modifier-hover)';
		});
		itemEl.addEventListener('mouseleave', () => {
			itemEl.style.backgroundColor = '';
		});

		// 파일 경로
		const pathEl = itemEl.createDiv({
			text: result.path,
		});
		pathEl.style.fontWeight = 'bold';
		pathEl.style.fontSize = '14px';
		pathEl.style.color = 'var(--text-normal)';

		// 스니펫
		if (result.snippet) {
			const snippetEl = itemEl.createDiv({
				text: result.snippet,
			});
			snippetEl.style.fontSize = '12px';
			snippetEl.style.color = 'var(--text-muted)';
			snippetEl.style.marginTop = '4px';
			snippetEl.style.overflow = 'hidden';
			snippetEl.style.textOverflow = 'ellipsis';
			snippetEl.style.whiteSpace = 'nowrap';
		}

		// 점수 표시
		const scoreEl = itemEl.createDiv({
			text: `관련도: ${(result.score * 100).toFixed(0)}%`,
		});
		scoreEl.style.fontSize = '11px';
		scoreEl.style.color = 'var(--text-faint)';
		scoreEl.style.marginTop = '2px';

		// 클릭 시 파일 열기
		itemEl.addEventListener('click', () => {
			this._onResultClick(result.path);
			this.close();
		});
	}
}

/** 검색 입력 모달 - 검색어 입력 후 결과 모달 표시 */
export class SearchInputModal extends Modal {
	private _onSearch: (query: string) => Promise<void>;

	constructor(app: App, onSearch: (query: string) => Promise<void>) {
		super(app);
		this._onSearch = onSearch;
	}

	onOpen(): void {
		this.titleEl.setText('서버 파일 검색');

		// 검색 안내
		const descEl = this.contentEl.createDiv({
			text: '서버에 저장된 파일을 검색합니다.',
		});
		descEl.style.marginBottom = '12px';
		descEl.style.color = 'var(--text-muted)';

		// 입력 필드 컨테이너
		const inputContainer = this.contentEl.createDiv();
		inputContainer.style.display = 'flex';
		inputContainer.style.gap = '8px';

		// 검색어 입력
		const inputEl = inputContainer.createEl('input', {
			type: 'text',
			placeholder: '검색어를 입력하세요...',
		});
		inputEl.style.flex = '1';
		inputEl.style.padding = '6px 10px';
		inputEl.style.borderRadius = '4px';
		inputEl.style.border = '1px solid var(--background-modifier-border)';
		inputEl.style.backgroundColor = 'var(--background-modifier-form-field)';
		inputEl.style.color = 'var(--text-normal)';
		inputEl.style.fontSize = '14px';

		// 검색 버튼
		const searchBtn = inputContainer.createEl('button', {
			text: '검색',
		});
		searchBtn.style.padding = '6px 16px';

		// 검색 실행
		const doSearch = async () => {
			const query = inputEl.value.trim();
			if (!query) {
				new Notice('검색어를 입력하세요');
				return;
			}
			this.close();
			await this._onSearch(query);
		};

		searchBtn.addEventListener('click', doSearch);

		// Enter 키 검색
		inputEl.addEventListener('keydown', (e: KeyboardEvent) => {
			if (e.key === 'Enter') {
				doSearch();
			}
		});

		// 자동 포커스
		setTimeout(() => inputEl.focus(), 100);
	}
}
