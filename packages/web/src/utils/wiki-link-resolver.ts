// @MX:ANCHOR: [AUTO] Obsidian 위키 링크 전처리기 - 마크다운 렌더링 전 변환 수행
// @MX:REASON: ObsidianMarkdownViewer와 VaultFileViewPage에서 사용, fan_in >= 2

// 이미지 파일 확장자 집합
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp']);

// 파일이 이미지인지 확인
function isImageFile(filePath: string): boolean {
	const dotIndex = filePath.lastIndexOf('.');
	if (dotIndex === -1) return false;
	return IMAGE_EXTENSIONS.has(filePath.slice(dotIndex).toLowerCase());
}

/**
 * Obsidian 위키 링크를 표준 마크다운으로 변환한다.
 *
 * 변환 규칙:
 * - ![[photo.jpg]] → ![photo.jpg](attachment URL)
 * - ![[photo.jpg|Alt]] → ![Alt](attachment URL)
 * - ![[doc.pdf]] → [doc.pdf](attachment URL) (비이미지 다운로드 링크)
 * - [[note]] → [note](view URL with .md)
 * - [[note|Text]] → [Text](view URL with .md)
 * - ``` 코드 블록 내부는 변환하지 않음
 */
export function preprocessWikiLinks(markdown: string, vaultId: string): string {
	// 코드 블록 기준으로 분리 (```...```)
	const parts = markdown.split(/(```[\s\S]*?```)/);

	return parts
		.map((part, i) => {
			// 홀수 인덱스 = 코드 블록 → 변환 건너뜀
			if (i % 2 === 1) return part;

			// 인라인 코드 보호: `...` 내부의 위키 링크 보존
			const inlineCodeChunks: string[] = [];
			part = part.replace(/(`[^`\n]+`)/g, (match) => {
				inlineCodeChunks.push(match);
				return `\x00INLINE_CODE_${inlineCodeChunks.length - 1}\x00`;
			});

			// 임베드 변환: ![[path]] 또는 ![[path|alt]]
			part = part.replace(
				/!\[\[([^\]|]+?)(?:\|([^\]]+?))?\]\]/g,
				(_, path: string, alt: string | undefined) => {
					const trimmedPath = path.trim();
					const displayText = alt?.trim() ?? trimmedPath;
					const encodedPath = encodeURIComponent(trimmedPath);
					const attachmentUrl = `/admin/api/vaults/${vaultId}/attachment/${encodedPath}`;

					if (isImageFile(trimmedPath)) {
						return `![${displayText}](${attachmentUrl})`;
					}
					// 비이미지: 다운로드 링크
					return `[${displayText}](${attachmentUrl})`;
				},
			);

			// 노트 링크 변환: [[path]] 또는 [[path|display]]
			part = part.replace(
				/\[\[([^\]|]+?)(?:\|([^\]]+?))?\]\]/g,
				(_, path: string, alt: string | undefined) => {
					const trimmedPath = path.trim();
					const displayText = alt?.trim() ?? trimmedPath;
					// 확장자가 없으면 .md 추가
					const viewPath = trimmedPath.includes('.')
						? trimmedPath
						: `${trimmedPath}.md`;
					const encodedPath = encodeURIComponent(viewPath);
					return `[${displayText}](/vaults/${vaultId}/view/${encodedPath})`;
				},
			);

			// 인라인 코드 복원
			part = part.replace(
				/\x00INLINE_CODE_(\d+)\x00/g,
				(_, idx: string) => inlineCodeChunks[Number(idx)] ?? '',
			);

			return part;
		})
		.join('');
}
