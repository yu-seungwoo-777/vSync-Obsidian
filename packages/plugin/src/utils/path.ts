// 경로 유틸리티

// REQ-PLG-001: Obsidian 내장 normalizePath를 사용
import { normalizePath as _obsidianNormalizePath } from 'obsidian';

/** 동기화 허용 확장자 집합 (소문자) */
export const ALLOWED_EXTENSIONS = new Set([
	'.md', '.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp',
	'.pdf', '.mp3', '.mp4', '.wav', '.ogg',
]);

/** .obsidian/ 경로인지 확인 */
export function isObsidianPath(path: string): boolean {
	return path.startsWith('.obsidian/') || path.startsWith('.obsidian\\');
}

/** .trash/ 경로인지 확인 */
export function isTrashPath(path: string): boolean {
	return path.startsWith('.trash/') || path.startsWith('.trash\\');
}

/** 충돌 파일 패턴인지 확인 */
export function isConflictFile(path: string): boolean {
	return path.includes('.sync-conflict-');
}

/** 파일 확장자 추출 (소문자, 점 포함) */
export function getExtension(path: string): string {
	const lastDot = path.lastIndexOf('.');
	if (lastDot === -1) return '';
	return path.slice(lastDot).toLowerCase();
}

/** 경로가 바이너리 파일인지 확인 (.md가 아닌 허용 확장자) */
export function isBinaryPath(path: string): boolean {
	const ext = getExtension(path);
	// .md는 텍스트, 나머지 허용 확장자는 바이너리
	return ALLOWED_EXTENSIONS.has(ext) && ext !== '.md';
}

/** 경로가 동기화 대상인지 확인 */
export function shouldSyncPath(path: string): boolean {
	if (!path) return false;
	if (isObsidianPath(path)) return false;
	if (isTrashPath(path)) return false;
	if (isConflictFile(path)) return false;
	// 허용 확장자 집합에서 조회 (대소문자 무시)
	const ext = getExtension(path);
	return ALLOWED_EXTENSIONS.has(ext);
}

/** 경로 정규화: Obsidian 내장 normalizePath를 위임 (REQ-PLG-001) */
export const normalizePath = _obsidianNormalizePath;

/**
 * Vault 경로 보안 검증 (REQ-R5-006)
 * 경로 순회, null byte, 빈 경로 등을 차단하고 정규화된 경로를 반환
 * @param path 검증할 경로
 * @returns 정규화된 안전한 경로
 * @throws {Error} 유효하지 않은 경로
 */
export function validateVaultPath(path: string): string {
	// AC-006.3: null byte 거부
	if (path.includes('\0')) {
		throw new Error(`Invalid path: null byte detected in "${path.replace(/\0/g, '\\0')}"`);
	}

	// AC-006.4: 빈 문자열 거부
	if (!path || !path.trim()) {
		throw new Error('Invalid path: path cannot be empty');
	}

	// AC-006.2: .. 세그먼트 거부 (경로 순회 공격 방지)
	const segments = path.replace(/\\/g, '/').split('/');
	if (segments.some(s => s === '..')) {
		throw new Error(`Invalid path: path traversal detected (".." in "${path}")`);
	}

	// 정규화 (Obsidian 내장 함수 사용)
	const normalized = _obsidianNormalizePath(path);

	// AC-006.5: 정규화 후 빈 문자열 거부
	if (!normalized) {
		throw new Error('Invalid path: path becomes empty after normalization');
	}

	return normalized;
}
