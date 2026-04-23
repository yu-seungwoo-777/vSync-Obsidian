import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ObsidianMarkdownViewer } from '../components/obsidian-markdown-viewer';
import {
	getVaultFileContent,
	getVaultAttachmentUrl,
	type VaultFileContent,
} from '../api/client';

// 바이너리 파일 분류용 확장자 상수
const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'];
const PDF_EXTENSIONS = ['.pdf'];
const AUDIO_EXTENSIONS = ['.mp3', '.wav', '.ogg'];
const VIDEO_EXTENSIONS = ['.mp4'];

type FileCategory = 'image' | 'pdf' | 'audio' | 'video' | 'other';

// 파일 확장자로 카테고리 분류
function getFileCategory(filePath: string): FileCategory {
	const lower = filePath.toLowerCase();
	if (IMAGE_EXTENSIONS.some((ext) => lower.endsWith(ext))) return 'image';
	if (PDF_EXTENSIONS.some((ext) => lower.endsWith(ext))) return 'pdf';
	if (AUDIO_EXTENSIONS.some((ext) => lower.endsWith(ext))) return 'audio';
	if (VIDEO_EXTENSIONS.some((ext) => lower.endsWith(ext))) return 'video';
	return 'other';
}

function formatFileSize(bytes: number): string {
	if (bytes === 0) return '0 B';
	const units = ['B', 'KB', 'MB', 'GB'];
	const i = Math.floor(Math.log(bytes) / Math.log(1024));
	const size = bytes / Math.pow(1024, i);
	return `${size.toFixed(i === 0 ? 0 : 1)} ${units[i] ?? 'B'}`;
}

function formatDate(dateStr: string): string {
	const date = new Date(dateStr);
	return date.toLocaleDateString('ko-KR', {
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		hour: '2-digit',
		minute: '2-digit',
	});
}

export function VaultFileViewPage() {
	const { id, '*': filePathEncoded } = useParams<{
		id: string;
		'*': string;
	}>();
	const filePath = filePathEncoded ? decodeURIComponent(filePathEncoded) : '';

	const [fileData, setFileData] = useState<VaultFileContent | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState('');

	useEffect(() => {
		if (!id || !filePath) return;

		let cancelled = false;
		setLoading(true);
		setError('');

		getVaultFileContent(id, filePath)
			.then((data) => {
				if (!cancelled) {
					setFileData(data);
				}
			})
			.catch(() => {
				if (!cancelled) {
					setError('파일을 불러오지 못했습니다.');
				}
			})
			.finally(() => {
				if (!cancelled) {
					setLoading(false);
				}
			});

		return () => {
			cancelled = true;
		};
	}, [id, filePath]);

	const content = fileData?.content ?? '';

	// 바이너리 파일 렌더링
	function renderBinaryPreview() {
		if (!id || !fileData) return null;

		const category = getFileCategory(filePath);
		const attachmentUrl = getVaultAttachmentUrl(id, filePath);

		if (category === 'image') {
			return (
				<div className="binary-preview image-preview">
					<img src={attachmentUrl} alt={filePath} />
				</div>
			);
		}

		if (category === 'pdf') {
			return (
				<div className="binary-preview pdf-preview">
					<embed
						src={attachmentUrl}
						type="application/pdf"
						width="100%"
						height="800px"
					/>
				</div>
			);
		}

		// audio, video, other - 파일 정보 + 다운로드
		return (
			<div className="binary-preview unsupported-preview">
				<div className="file-info-card">
					<div className="file-info-icon">📎</div>
					<div className="file-info-name">
						{filePath.split('/').pop()}
					</div>
					<div className="file-info-size">
						{formatFileSize(fileData.size)}
					</div>
					<a
						href={attachmentUrl}
						download
						className="download-button"
					>
						다운로드
					</a>
				</div>
			</div>
		);
	}

	return (
		<div className="page-container">
			<div className="file-view-header">
				<Link to={`/vaults/${id}/files`} className="back-link">
					&larr; 파일 목록으로
				</Link>
				<div className="file-view-breadcrumb">{filePath}</div>
				{fileData && (
					<div className="file-view-meta">
						<span>{formatFileSize(fileData.size)}</span>
						<span className="file-view-meta-sep">&middot;</span>
						<span>{formatDate(fileData.updated_at)}</span>
					</div>
				)}
			</div>

			{error && <div className="form-error">{error}</div>}

			{loading ? (
				<p>불러오는 중...</p>
			) : fileData === null ? (
				<div className="empty-state">
					<p>파일을 찾을 수 없습니다.</p>
				</div>
			) : fileData.file_type === 'attachment' ? (
				renderBinaryPreview()
			) : !content || content.trim() === '' ? (
				<div className="empty-state">
					<p>빈 파일입니다.</p>
				</div>
			) : (
				<ObsidianMarkdownViewer
					content={content}
					theme="light"
					vaultId={id}
				/>
			)}
		</div>
	);
}
