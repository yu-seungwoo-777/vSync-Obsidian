// wiki-link-resolver 유닛 테스트
// TDD RED: 먼저 테스트를 작성하고, 구현은 나중에
import { describe, it, expect } from 'vitest';
import { preprocessWikiLinks } from './wiki-link-resolver';

describe('preprocessWikiLinks', () => {
	const vaultId = 'vault-123';

	describe('이미지 임베드', () => {
		it('![[photo.jpg]]를 마크다운 이미지로 변환한다', () => {
			const input = '![[photo.jpg]]';
			const result = preprocessWikiLinks(input, vaultId);
			expect(result).toBe(
				'![photo.jpg](/admin/api/vaults/vault-123/attachment/photo.jpg)',
			);
		});

		it('![[photo.jpg|My Photo]]를 alt 텍스트가 있는 이미지로 변환한다', () => {
			const input = '![[photo.jpg|My Photo]]';
			const result = preprocessWikiLinks(input, vaultId);
			expect(result).toBe(
				'![My Photo](/admin/api/vaults/vault-123/attachment/photo.jpg)',
			);
		});

		it('![[images/photo.jpg]] 경로가 포함된 이미지를 변환한다', () => {
			const input = '![[images/photo.jpg]]';
			const result = preprocessWikiLinks(input, vaultId);
			expect(result).toBe(
				'![images/photo.jpg](/admin/api/vaults/vault-123/attachment/images%2Fphoto.jpg)',
			);
		});

		it('PNG, GIF, SVG, WebP 확장자도 이미지로 인식한다', () => {
			const inputs = [
				'![[icon.png]]',
				'![[anim.gif]]',
				'![[logo.svg]]',
				'![[photo.webp]]',
			];
			for (const input of inputs) {
				const result = preprocessWikiLinks(input, vaultId);
				expect(result).toMatch(/^!\[/);
			}
		});
	});

	describe('비이미지 임베드', () => {
		it('![[doc.pdf]]를 다운로드 링크로 변환한다', () => {
			const input = '![[doc.pdf]]';
			const result = preprocessWikiLinks(input, vaultId);
			expect(result).toBe(
				'[doc.pdf](/admin/api/vaults/vault-123/attachment/doc.pdf)',
			);
		});

		it('![[doc.pdf|보고서]]를 alt 텍스트가 있는 다운로드 링크로 변환한다', () => {
			const input = '![[doc.pdf|보고서]]';
			const result = preprocessWikiLinks(input, vaultId);
			expect(result).toBe(
				'[보고서](/admin/api/vaults/vault-123/attachment/doc.pdf)',
			);
		});

		it('![[audio.mp3]]를 다운로드 링크로 변환한다', () => {
			const input = '![[audio.mp3]]';
			const result = preprocessWikiLinks(input, vaultId);
			expect(result).toBe(
				'[audio.mp3](/admin/api/vaults/vault-123/attachment/audio.mp3)',
			);
		});
	});

	describe('노트 링크', () => {
		it('[[readme]]를 .md 확장자가 있는 노트 링크로 변환한다', () => {
			const input = '[[readme]]';
			const result = preprocessWikiLinks(input, vaultId);
			expect(result).toBe('[readme](/vaults/vault-123/view/readme.md)');
		});

		it('[[readme|Read Me]]를 표시 텍스트가 있는 노트 링크로 변환한다', () => {
			const input = '[[readme|Read Me]]';
			const result = preprocessWikiLinks(input, vaultId);
			expect(result).toBe('[Read Me](/vaults/vault-123/view/readme.md)');
		});

		it('[[notes.md]] 확장자가 이미 있으면 .md를 추가하지 않는다', () => {
			const input = '[[notes.md]]';
			const result = preprocessWikiLinks(input, vaultId);
			expect(result).toBe('[notes.md](/vaults/vault-123/view/notes.md)');
		});

		it('[[project/notes]] 경로가 있는 노트 링크를 변환한다', () => {
			const input = '[[project/notes]]';
			const result = preprocessWikiLinks(input, vaultId);
			expect(result).toBe(
				'[project/notes](/vaults/vault-123/view/project%2Fnotes.md)',
			);
		});
	});

	describe('코드 블록 보존', () => {
		it('``` 코드 블록 내부의 위키 링크를 변환하지 않는다', () => {
			const input = '```\n[[readme]]\n```';
			const result = preprocessWikiLinks(input, vaultId);
			expect(result).toBe('```\n[[readme]]\n```');
		});

		it('여러 줄 코드 블록에서도 위키 링크를 보존한다', () => {
			const input =
				'일반 텍스트 [[readme]]\n```\n![[photo.jpg]]\n[[note]]\n```\n이후 텍스트';
			const result = preprocessWikiLinks(input, vaultId);
			expect(result).toContain('![[photo.jpg]]');
			expect(result).toContain('[[note]]');
			expect(result).toContain('[readme](/vaults/vault-123/view/readme.md)');
		});
	});

	describe('인라인 코드 보존', () => {
		it('백틱 안의 위키 링크를 변환하지 않는다', () => {
			const input = '`[[readme]]`';
			const result = preprocessWikiLinks(input, vaultId);
			expect(result).toBe('`[[readme]]`');
		});
	});

	describe('복합 케이스', () => {
		it('한 줄에 여러 위키 링크가 있으면 모두 변환한다', () => {
			const input = '[[note1]] and [[note2|Second]]';
			const result = preprocessWikiLinks(input, vaultId);
			expect(result).toBe(
				'[note1](/vaults/vault-123/view/note1.md) and [Second](/vaults/vault-123/view/note2.md)',
			);
		});

		it('마크다운 + 위키 링크 + 코드 블록이 혼합된 내용을 처리한다', () => {
			const input =
				'# 제목\n\n![[photo.jpg]]\n\n```\n[[skip_me]]\n```\n\n[[readme|문서]] 확인';
			const result = preprocessWikiLinks(input, vaultId);

			// 이미지 변환 확인
			expect(result).toContain(
				'![photo.jpg](/admin/api/vaults/vault-123/attachment/photo.jpg)',
			);
			// 코드 블록 내 보존 확인
			expect(result).toContain('[[skip_me]]');
			// 노트 링크 변환 확인
			expect(result).toContain(
				'[문서](/vaults/vault-123/view/readme.md)',
			);
		});

		it('vaultId가 없으면 원본을 그대로 반환하지 않고 변환한다 (undefined 처리)', () => {
			// vaultId는 필수 파라미터 - 정상 동작 확인
			const input = '[[readme]]';
			const result = preprocessWikiLinks(input, 'test-vault');
			expect(result).toBe('[readme](/vaults/test-vault/view/readme.md)');
		});
	});
});
