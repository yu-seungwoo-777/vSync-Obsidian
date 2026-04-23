// 충돌 감지 및 해결

import { computeHash } from './utils/hash';
import { isConflictFile as checkIsConflictFile } from './utils/path';
import type { App } from 'obsidian';
// @MX:NOTE types.ts에서 타입 import 후 재-export (REQ-003 타입 통합)
import type { ConflictQueueItem, DiffOperation } from './types';
export type { ConflictQueueItem, DiffOperation };

// @MX:NOTE 사용자 선택 결과 타입
export type ModalChoice = 'local' | 'remote' | 'both' | 'later';

// @MX:NOTE 3-way merge 충돌 정보
export type MergeConflictInfo = {
	file_path: string;
	conflict_path: string;
	diff: DiffOperation[] | null;
	conflict_id: string | null;
	server_content: string;
	local_content: string;
	base_hash?: string;
};

// @MX:NOTE 모달 인스턴스 타입 (동적 import 시점에 해결)
type ModalInstance = {
	open(): void;
	close(): void;
	clickButton(choice: ModalChoice): void;
};

// @MX:NOTE 인메모리 충돌 큐 - 발생한 충돌을 순차적으로 관리 (REQ-UX-003)
export class ConflictQueue {
	private _items: ConflictQueueItem[] = [];
	private _onUpdate: ((items: ConflictQueueItem[]) => void) | null = null;

	/** 충돌 항목을 큐에 추가 */
	enqueue(item: ConflictQueueItem): void {
		this._items.push(item);
		this._notify();
	}

	/** FIFO 순서로 첫 항목을 꺼냄 */
	dequeue(): ConflictQueueItem | undefined {
		const item = this._items.shift();
		if (item) this._notify();
		return item;
	}

	/** 첫 항목을 제거하지 않고 조회 */
	peek(): ConflictQueueItem | undefined {
		return this._items[0];
	}

	/** 지정된 ID의 항목을 큐에서 제거 (해결 완료) */
	resolve(itemId: string): void {
		const idx = this._items.findIndex((item) => item.id === itemId);
		if (idx !== -1) {
			this._items.splice(idx, 1);
			this._notify();
		}
	}

	/** 모든 항목의 복사본을 반환 */
	getAll(): ConflictQueueItem[] {
		return [...this._items];
	}

	/** 현재 큐 크기 반환 */
	size(): number {
		return this._items.length;
	}

	/** 모든 항목 제거 */
	clear(): void {
		this._items = [];
		this._notify();
	}

	/** 큐 변경 시 콜백 등록 (상태 표시줄 배지 업데이트용) */
	onUpdate(callback: (items: ConflictQueueItem[]) => void): void {
		this._onUpdate = callback;
	}

	/** 콜백 호출 */
	private _notify(): void {
		if (this._onUpdate) {
			this._onUpdate([...this._items]);
		}
	}
}

/** 충돌 해결기 - 로컬 파일과 원격 파일의 해시를 비교하여 충돌을 감지 */
export class ConflictResolver {
	private _noticeFn: (msg: string) => void;
	private _openModalFn: ((modal: ModalInstance) => void) | null = null;

	constructor(noticeFn: (msg: string) => void) {
		this._noticeFn = noticeFn;
	}

	/**
	 * 로컬 파일과 원격 파일의 충돌 여부를 감지
	 * @param localContent 로컬 파일 내용 (null이면 파일이 없는 것)
	 * @param remoteHash 서버의 파일 해시
	 * @returns 충돌 여부
	 */
	async detectConflict(localContent: string | null | undefined, remoteHash: string): Promise<boolean> {
		// 로컬 파일이 없으면 충돌이 아님 (단순 다운로드)
		if (localContent === null || localContent === undefined) return false;
		// 원격 해시가 없으면 비교 불가
		if (!remoteHash) return false;

		const localHash = await computeHash(localContent);
		return localHash !== remoteHash;
	}

	/**
	 * 충돌 파일 경로 생성
	 * 형식: {original-path}.sync-conflict-{YYYYMMDDHHmmss}.md
	 */
	/** 충돌 파일 경로 생성 (static, 외부 사용용) */
	static createConflictPathStatic(originalPath: string, timestamp: string): string {
		const lastDot = originalPath.lastIndexOf('.');
		if (lastDot === -1) {
			return `${originalPath}.sync-conflict-${timestamp}.md`;
		}
		const baseName = originalPath.substring(0, lastDot);
		return `${baseName}.sync-conflict-${timestamp}.md`;
	}

	createConflictPath(originalPath: string, timestamp: string): string {
		const lastDot = originalPath.lastIndexOf('.');
		if (lastDot === -1) {
			return `${originalPath}.sync-conflict-${timestamp}.md`;
		}
		const baseName = originalPath.substring(0, lastDot);
		return `${baseName}.sync-conflict-${timestamp}.md`;
	}

	/** 충돌 파일인지 확인 (path.ts에 위임) */
	isConflictFile(path: string): boolean {
		return checkIsConflictFile(path);
	}

	/**
	 * 충돌 처리 - 알림 표시 및 충돌 파일 경로 반환
	 * REQ-P4-015: 로컬 원본을 유지하고 원격 버전을 충돌 파일로 저장
	 */
	handleConflict(filePath: string): string {
		const timestamp = this._formatTimestamp(new Date());
		const conflictPath = this.createConflictPath(filePath, timestamp);

		this._noticeFn(`Conflict detected: ${filePath}`);
		return conflictPath;
	}

	// @MX:NOTE 모달 열기 함수 설정 (테스트용 + DI)
	setOpenModal(fn: (modal: ModalInstance) => void): void {
		this._openModalFn = fn;
	}

	/**
	 * 3-way merge 충돌 처리 (SPEC-P5-3WAY-001)
	 * diff 데이터가 있으면 모달을 띄워 사용자 선택을 받음
	 * diff 데이터가 없으면 기존 동작 유지 (하위 호환)
	 */
	// @MX:WARN [SPEC-PLUGIN-BUGFIX-001] null App 안전 처리 — _openModalFn 없으면 프로그래매틱 해결
	async handleMergeConflict(info: MergeConflictInfo): Promise<string | ModalChoice> {
		// diff 데이터가 없으면 기존 동작
		if (!info.diff || !info.conflict_id) {
			return this.handleConflict(info.file_path);
		}

		// 모달 함수가 없으면 프로그래매틱 해결 (서버 우선)
		if (!this._openModalFn) {
			this._noticeFn(`Conflict auto-resolved (server): ${info.file_path}`);
			return 'remote';
		}

		// 동적 import로 순환 의존 방지
		const { ConflictResolveModal: conflictResolveModal } = await import('./ui/conflict-resolve-modal.js');

		// diff 데이터가 있으면 모달 띄우기
		return new Promise<ModalChoice>((resolve) => {
			const modal = new conflictResolveModal(
				null as unknown as App, // 테스트/비UI 컨텍스트용 app placeholder
				info.file_path,
				info.diff as DiffOperation[],
				(choice: ModalChoice) => {
					if (choice === 'later') {
						this._noticeFn(`Conflict deferred: ${info.file_path}`);
						resolve('later');
						return;
					}
					resolve(choice);
				},
			);

			if (this._openModalFn) {
				this._openModalFn(modal);
			} else {
				modal.open();
			}
		});
	}

	/** 현재 시간을 YYYYMMDDHHmmss 형식으로 포맷 */
	private _formatTimestamp(date: Date): string {
		const y = date.getFullYear().toString();
		const mo = (date.getMonth() + 1).toString().padStart(2, '0');
		const d = date.getDate().toString().padStart(2, '0');
		const h = date.getHours().toString().padStart(2, '0');
		const mi = date.getMinutes().toString().padStart(2, '0');
		const s = date.getSeconds().toString().padStart(2, '0');
		return `${y}${mo}${d}${h}${mi}${s}`;
	}
}
