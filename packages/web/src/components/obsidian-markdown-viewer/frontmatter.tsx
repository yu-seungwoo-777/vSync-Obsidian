/**
 * Frontmatter parsing utility for Obsidian Markdown Viewer
 * Parses YAML frontmatter from markdown content and renders property values
 */

// @MX:NOTE: YAML 파서 라이브러리 없이 순수 TypeScript로 구현
// 지원 타입: string, number, boolean, null, 1차원 배열
// 중첩 객체, 멀티라인 값(|, >)은 지원하지 않음

export interface ParsedFrontmatter {
	frontmatter: Record<string, unknown>;
	body: string;
}

/**
 * YAML frontmatter 블록을 파싱합니다
 * @param content - 마크다운 전체 내용
 * @returns frontmatter 객체와 본문 내용
 */
export function parseFrontmatter(content: string): ParsedFrontmatter {
	// @MX:ANCHOR: frontmatter 파싱 진입점 - 여러 곳에서 호출됨
	// 정규식으로 --- 구분자 감지
	// @MX:NOTE: 빈 YAML 블록 지원 - 별도 정규식으로 먼저 확인
	// 빈 frontmatter: ---\n---\n 또는 ---\r\n---\r\n
	const emptyMatch = content.match(/^---\r?\n---\r?\n/);
	if (emptyMatch) {
		return { frontmatter: {}, body: content.slice(emptyMatch[0]!.length) };
	}

	// 일반적인 frontmatter 패턴
	const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
	if (!match) {
		return { frontmatter: {}, body: content };
	}

	const yaml = match[1]!;
	const body = content.slice(match[0]!.length);
	const frontmatter: Record<string, unknown> = {};

	// 각 줄을 파싱
	for (const line of yaml.split('\n')) {
		const colonIdx = line.indexOf(':');
		if (colonIdx === -1) continue; // 콜론이 없는 줄은 무시

		const key = line.slice(0, colonIdx).trim();
		const raw = line.slice(colonIdx + 1).trim();
		if (!key) continue;

		// @MX:NOTE: 타입 추론 로직 - 순서가 중요함
		// 리터럴 null은 빈 문자열보다 먼저 확인해야 함
		if (raw === 'null') {
			frontmatter[key] = null;
		} else if (raw.startsWith('[') && raw.endsWith(']')) {
			// 배열 파싱
			frontmatter[key] = parseArray(raw);
		} else if (raw === 'true') {
			frontmatter[key] = true;
		} else if (raw === 'false') {
			frontmatter[key] = false;
		} else if (raw === '') {
			frontmatter[key] = null;
		} else if (/^\d+$/.test(raw)) {
			frontmatter[key] = parseInt(raw, 10);
		} else if (/^\d+\.\d+$/.test(raw)) {
			frontmatter[key] = parseFloat(raw);
		} else {
			// 문자열 - 따옴표 제거
			frontmatter[key] = stripQuotes(raw);
		}
	}

	return { frontmatter, body };
}

/**
 * 배열 값을 파싱하고 각 항목의 따옴표를 제거합니다
 */
function parseArray(raw: string): string[] {
	return raw
		.slice(1, -1) // [ ] 제거
		.split(',')
		.map((s) => s.trim())
		.map((s) => stripQuotes(s));
}

/**
 * 문자열 앞뒤의 인용 문자(" 또는 ')를 제거합니다
 * @param str - 처리할 문자열
 * @returns 인용 문자가 제거된 문자열
 */
function stripQuotes(str: string): string {
	if ((str.startsWith('"') && str.endsWith('"')) || (str.startsWith("'") && str.endsWith("'"))) {
		return str.slice(1, -1);
	}
	return str;
}

/**
 * 속성 값을 렌더링합니다 (URL을 링크로 변환)
 * @param value - 렌더링할 값
 * @returns React 노드 또는 문자열
 */
export function renderPropertyValue(value: unknown): React.ReactNode {
	if (value === null || value === undefined) return '';

	const text = Array.isArray(value) ? value.join(', ') : String(value);
	const urlPattern = /(https?:\/\/[^\s,]+)/g;
	const parts = text.split(urlPattern);

	// URL이 없으면 텍스트 그대로 반환
	if (parts.length <= 1) return text;

	// URL을 링크로 변환
	return parts.map((part, i) =>
		urlPattern.test(part) ? (
			<a key={i} href={part} target="_blank" rel="noopener noreferrer">
				{part}
			</a>
		) : (
			<span key={i}>{part}</span>
		)
	);
}
