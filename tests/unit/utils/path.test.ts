// 경로 유틸리티 테스트
// REQ-P4-013: .obsidian 디렉토리 동기화 방지
// REQ-P6-001: 허용 확장자 기반 동기화 대상 판별
// REQ-P6-002: 파일 타입 자동 분류
import { describe, it, expect } from 'vitest';
import {
	shouldSyncPath,
	normalizePath,
	isObsidianPath,
	isConflictFile,
	isTrashPath,
	isBinaryPath,
	ALLOWED_EXTENSIONS,
} from '../../../src/utils/path';

describe('shouldSyncPath', () => {
	it('.md 파일은 동기화 대상이어야 한다', () => {
		expect(shouldSyncPath('notes/test.md')).toBe(true);
		expect(shouldSyncPath('journal/2026-04-17.md')).toBe(true);
		expect(shouldSyncPath('root.md')).toBe(true);
	});

	it('.obsidian/ 경로는 제외해야 한다', () => {
		expect(shouldSyncPath('.obsidian/app.json')).toBe(false);
		expect(shouldSyncPath('.obsidian/plugins/test/main.js')).toBe(false);
		expect(shouldSyncPath('.obsidian/workspace.json')).toBe(false);
	});

	it('미지원 확장자는 제외해야 한다', () => {
		expect(shouldSyncPath('program.exe')).toBe(false);
		expect(shouldSyncPath('archive.zip')).toBe(false);
		expect(shouldSyncPath('notes/data.json')).toBe(false);
		expect(shouldSyncPath('script.js')).toBe(false);
	});

	it('충돌 파일은 제외해야 한다', () => {
		expect(shouldSyncPath('notes/test.sync-conflict-20260417120000.md')).toBe(false);
	});

	it('빈 경로는 제외해야 한다', () => {
		expect(shouldSyncPath('')).toBe(false);
	});

	it('대문자 확장자 .MD도 처리해야 한다', () => {
		// Obsidian은 기본적으로 소문자 .md만 사용하지만 방어적으로 처리
		expect(shouldSyncPath('notes/test.MD')).toBe(true);
	});
});

// ============================================================
// REQ-P6-001: 허용 확장자 기반 동기화 대상 판별
// ============================================================

describe('ALLOWED_EXTENSIONS', () => {
	it('필수 확장자가 모두 포함되어야 한다', () => {
		const required = ['.md', '.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.pdf', '.mp3', '.mp4', '.wav', '.ogg'];
		for (const ext of required) {
			expect(ALLOWED_EXTENSIONS.has(ext)).toBe(true);
		}
	});

	it('모든 확장자가 소문자여야 한다', () => {
		for (const ext of ALLOWED_EXTENSIONS) {
			expect(ext).toBe(ext.toLowerCase());
		}
	});
});

describe('shouldSyncPath (바이너리 확장자)', () => {
	it('바이너리 이미지 파일은 동기화 대상이어야 한다', () => {
		expect(shouldSyncPath('images/photo.png')).toBe(true);
		expect(shouldSyncPath('photos/img.jpg')).toBe(true);
		expect(shouldSyncPath('photos/img.jpeg')).toBe(true);
		expect(shouldSyncPath('animated.gif')).toBe(true);
		expect(shouldSyncPath('icons/logo.svg')).toBe(true);
		expect(shouldSyncPath('photos/pic.webp')).toBe(true);
	});

	it('PDF 파일은 동기화 대상이어야 한다', () => {
		expect(shouldSyncPath('docs/report.pdf')).toBe(true);
	});

	it('오디오/비디오 파일은 동기화 대상이어야 한다', () => {
		expect(shouldSyncPath('audio/podcast.mp3')).toBe(true);
		expect(shouldSyncPath('video/clip.mp4')).toBe(true);
		expect(shouldSyncPath('audio/note.wav')).toBe(true);
		expect(shouldSyncPath('audio/sound.ogg')).toBe(true);
	});

	it('미지원 확장자는 거부해야 한다', () => {
		expect(shouldSyncPath('program.exe')).toBe(false);
		expect(shouldSyncPath('archive.zip')).toBe(false);
		expect(shouldSyncPath('movie.avi')).toBe(false);
	});

	it('.trash/ 경로의 파일은 거부해야 한다', () => {
		expect(shouldSyncPath('.trash/image.png')).toBe(false);
		expect(shouldSyncPath('.trash/sub/note.md')).toBe(false);
	});

	it('대소문자 구분 없이 확장자를 매칭해야 한다', () => {
		expect(shouldSyncPath('photo.PNG')).toBe(true);
		expect(shouldSyncPath('photo.Jpg')).toBe(true);
		expect(shouldSyncPath('photo.JPEG')).toBe(true);
		expect(shouldSyncPath('doc.PDF')).toBe(true);
	});
});

describe('isTrashPath', () => {
	it('.trash/ 경로는 true를 반환해야 한다', () => {
		expect(isTrashPath('.trash/image.png')).toBe(true);
		expect(isTrashPath('.trash/sub/note.md')).toBe(true);
	});

	it('.trash/가 아닌 경로는 false를 반환해야 한다', () => {
		expect(isTrashPath('notes/test.md')).toBe(false);
		expect(isTrashPath('image.png')).toBe(false);
	});
});

// ============================================================
// REQ-P6-002: 파일 타입 자동 분류
// ============================================================

describe('isBinaryPath', () => {
	it('.md 파일은 텍스트 파일이어야 한다', () => {
		expect(isBinaryPath('notes/test.md')).toBe(false);
	});

	it('.MD 확장자도 텍스트로 인식해야 한다', () => {
		expect(isBinaryPath('notes/test.MD')).toBe(false);
	});

	it('이미지 파일은 바이너리로 분류해야 한다', () => {
		expect(isBinaryPath('photo.png')).toBe(true);
		expect(isBinaryPath('photo.jpg')).toBe(true);
		expect(isBinaryPath('photo.jpeg')).toBe(true);
		expect(isBinaryPath('photo.gif')).toBe(true);
		expect(isBinaryPath('photo.svg')).toBe(true);
		expect(isBinaryPath('photo.webp')).toBe(true);
	});

	it('PDF 파일은 바이너리로 분류해야 한다', () => {
		expect(isBinaryPath('doc.pdf')).toBe(true);
	});

	it('오디오/비디오 파일은 바이너리로 분류해야 한다', () => {
		expect(isBinaryPath('audio.mp3')).toBe(true);
		expect(isBinaryPath('video.mp4')).toBe(true);
		expect(isBinaryPath('audio.wav')).toBe(true);
		expect(isBinaryPath('audio.ogg')).toBe(true);
	});

	it('미지원 확장자는 false를 반환해야 한다', () => {
		expect(isBinaryPath('program.exe')).toBe(false);
		expect(isBinaryPath('archive.zip')).toBe(false);
	});

	it('대소문자 구분 없이 분류해야 한다', () => {
		expect(isBinaryPath('photo.PNG')).toBe(true);
		expect(isBinaryPath('photo.Jpg')).toBe(true);
	});
});

describe('isObsidianPath', () => {
	it('.obsidian/으로 시작하면 true를 반환해야 한다', () => {
		expect(isObsidianPath('.obsidian/config')).toBe(true);
		expect(isObsidianPath('.obsidian/plugins/test/main.js')).toBe(true);
	});

	it('.obsidian/으로 시작하지 않으면 false를 반환해야 한다', () => {
		expect(isObsidianPath('notes/test.md')).toBe(false);
		expect(isObsidianPath('my.obsidian/test.md')).toBe(false);
	});
});

describe('isConflictFile', () => {
	it('충돌 파일 패턴을 올바르게 감지해야 한다', () => {
		expect(isConflictFile('notes/test.sync-conflict-20260417120000.md')).toBe(true);
		expect(isConflictFile('test.sync-conflict-20260417093000.md')).toBe(true);
	});

	it('일반 파일은 충돌 파일이 아닌 것으로 판별해야 한다', () => {
		expect(isConflictFile('notes/test.md')).toBe(false);
		expect(isConflictFile('test.md')).toBe(false);
	});
});

describe('normalizePath', () => {
	it('역슬래시를 슬래시로 변환해야 한다', () => {
		expect(normalizePath('notes\\test.md')).toBe('notes/test.md');
	});

	it('연속 슬래시를 단일 슬래시로 정규화해야 한다', () => {
		expect(normalizePath('notes//test.md')).toBe('notes/test.md');
	});

	it('선행 슬래시를 제거해야 한다', () => {
		expect(normalizePath('/notes/test.md')).toBe('notes/test.md');
	});

	it('빈 문자열은 그대로 반환해야 한다', () => {
		expect(normalizePath('')).toBe('');
	});

	it('이미 정규화된 경로는 변경하지 않아야 한다', () => {
		expect(normalizePath('notes/test.md')).toBe('notes/test.md');
	});
});
