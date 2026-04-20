// 충돌 감지/해결 테스트
// REQ-P4-014: 충돌 감지 및 충돌 파일 생성
// REQ-P4-015: 양쪽 버전 보존
// REQ-P4-016: 무인 덮어쓰기 방지
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConflictResolver } from '../../src/conflict';
import { computeHash } from '../../src/utils/hash';

describe('ConflictResolver', () => {
	let resolver: ConflictResolver;
	const mockNotice = vi.fn();

	beforeEach(() => {
		vi.clearAllMocks();
		resolver = new ConflictResolver(mockNotice);
	});

	describe('detectConflict', () => {
		it('해시가 다르면 충돌을 감지해야 한다', async () => {
			const localContent = 'Version A';
			const localHash = await computeHash(localContent);
			const remoteHash = 'different-remote-hash';

			const hasConflict = await resolver.detectConflict(localContent, remoteHash);
			expect(hasConflict).toBe(true);
		});

		it('해시가 같으면 충돌이 아니어야 한다', async () => {
			const content = 'Same content';
			const hash = await computeHash(content);

			const hasConflict = await resolver.detectConflict(content, hash);
			expect(hasConflict).toBe(false);
		});

		it('로컬 내용이 null/undefined면 충돌이 아니어야 한다 (REQ-P4-016)', async () => {
			const hasConflict = await resolver.detectConflict(null, 'some-hash');
			expect(hasConflict).toBe(false);
		});

		it('빈 원격 해시면 충돌이 아니어야 한다', async () => {
			const hasConflict = await resolver.detectConflict('content', '');
			expect(hasConflict).toBe(false);
		});
	});

	describe('createConflictFile', () => {
		it('충돌 파일명이 올바른 형식이어야 한다', () => {
			const path = 'notes/shared.md';
			const timestamp = '20260417120000';

			const conflictPath = resolver.createConflictPath(path, timestamp);

			expect(conflictPath).toBe('notes/shared.sync-conflict-20260417120000.md');
		});

		it('루트 경로의 충돌 파일명도 올바르게 생성해야 한다', () => {
			const conflictPath = resolver.createConflictPath('test.md', '20260417120000');
			expect(conflictPath).toBe('test.sync-conflict-20260417120000.md');
		});

		it('깊은 경로의 충돌 파일명도 올바르게 생성해야 한다', () => {
			const conflictPath = resolver.createConflictPath('a/b/c/deep.md', '20260417120000');
			expect(conflictPath).toBe('a/b/c/deep.sync-conflict-20260417120000.md');
		});
	});

	describe('isConflictFile', () => {
		it('충돌 파일을 올바르게 식별해야 한다', () => {
			expect(resolver.isConflictFile('notes/test.sync-conflict-20260417120000.md')).toBe(true);
		});

		it('일반 파일은 충돌 파일이 아닌 것으로 식별해야 한다', () => {
			expect(resolver.isConflictFile('notes/test.md')).toBe(false);
		});
	});

	describe('handleConflict', () => {
		it('충돌 발생 시 Notice를 표시해야 한다', () => {
			resolver.handleConflict('notes/shared.md');
			expect(mockNotice).toHaveBeenCalledWith(
				expect.stringContaining('notes/shared.md')
			);
		});

		it('충돌 파일 경로를 반환해야 한다', () => {
			const result = resolver.handleConflict('notes/shared.md');
			expect(result).toContain('.sync-conflict-');
			expect(result.endsWith('.md')).toBe(true);
		});
	});
});
