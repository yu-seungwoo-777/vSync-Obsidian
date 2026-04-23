import React, { useRef, useState, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import rehypeRaw from 'rehype-raw';
import { parseFrontmatter, renderPropertyValue } from './frontmatter';
import { preprocessWikiLinks } from '../../utils/wiki-link-resolver';
import './obsidian-markdown.css';

export interface ObsidianMarkdownViewerProps {
	content: string;
	theme?: 'light' | 'dark';
	className?: string;
	showFrontmatter?: boolean;
	vaultId?: string;
}

export function ObsidianMarkdownViewer({
	content,
	theme = 'light',
	className = '',
	showFrontmatter = true,
	vaultId,
}: ObsidianMarkdownViewerProps) {
	const [isFrontmatterOpen, setIsFrontmatterOpen] = useState(true);
	const { frontmatter, body } = parseFrontmatter(content);

	// 위키 링크 전처리: vaultId가 있으면 Obsidian 위키 링크를 마크다운으로 변환
	const processedBody = vaultId ? preprocessWikiLinks(body, vaultId) : body;

	if (!content || content.trim() === '') {
		return <div className={`obsidian-document theme-${theme} ${className}`.trim()} />;
	}

	const frontmatterEntries = Object.entries(frontmatter).filter(([key]) => key !== 'title');

	return (
		<div className={`obsidian-document theme-${theme} ${className}`.trim()}>
			<div className="markdown-preview-sizer">
				{showFrontmatter && frontmatterEntries.length > 0 && (
					<details open={isFrontmatterOpen} className="frontmatter-panel">
						<summary
							className="frontmatter-toggle"
							onClick={(e) => {
								e.preventDefault();
								setIsFrontmatterOpen(!isFrontmatterOpen);
							}}
						>
							<span className={`frontmatter-chevron ${isFrontmatterOpen ? 'open' : ''}`}>▶</span>
							속성
						</summary>
						<table className="frontmatter-table">
							<tbody>
								{frontmatterEntries.map(([key, value]) => (
									<tr key={key}>
										<th>{key}</th>
										<td>{renderPropertyValue(value)}</td>
									</tr>
								))}
							</tbody>
						</table>
					</details>
				)}

				{processedBody.trim() !== '' && (
					<ReactMarkdown
						remarkPlugins={[remarkGfm]}
						rehypePlugins={[rehypeRaw, rehypeHighlight]}
						components={{
							pre: CodeBlock,
							table: TableWrapper,
							a: ExternalLink,
							li: TaskListItem,
						}}
					>
						{processedBody}
					</ReactMarkdown>
				)}
			</div>
		</div>
	);
}

function CodeBlock({ children, ...props }: React.HTMLAttributes<HTMLPreElement>) {
	const preRef = useRef<HTMLPreElement>(null);
	const [copied, setCopied] = useState(false);

	const codeChild = React.Children.toArray(children).find(
		(child): child is React.ReactElement =>
			React.isValidElement(child) && (child as React.ReactElement).type === 'code',
	) as React.ReactElement<{ className?: string }> | undefined;

	const language =
		codeChild?.props.className
			?.split(' ')
			.find((c) => c.startsWith('language-'))
			?.replace('language-', '') ?? '';

	const handleCopy = useCallback(async () => {
		const text = preRef.current?.querySelector('code')?.innerText?.trim() ?? '';
		if (!text) return;
		try {
			await navigator.clipboard.writeText(text);
			setCopied(true);
			setTimeout(() => setCopied(false), 1500);
		} catch {
			// clipboard API 실패 시 무시
		}
	}, []);

	return (
		<div className="code-block-wrapper">
			<div className="code-block-header">
				<span className="code-block-language">{language}</span>
				<button
					className="code-block-copy-btn"
					onClick={handleCopy}
					type="button"
					aria-label={copied ? '복사됨' : '코드 복사'}
				>
					{copied ? '복사됨' : '복사'}
				</button>
			</div>
			<pre ref={preRef} {...props}>
				{children}
			</pre>
		</div>
	);
}

function TableWrapper({ children, ...props }: React.HTMLAttributes<HTMLTableElement>) {
	return (
		<div className="table-wrapper">
			<table {...props}>{children}</table>
		</div>
	);
}

function ExternalLink({
	href,
	children,
	...props
}: React.AnchorHTMLAttributes<HTMLAnchorElement>) {
	const isExternal = href?.startsWith('http') || href?.startsWith('//');
	return (
		<a
			href={href}
			className={isExternal ? 'external-link' : undefined}
			rel={isExternal ? 'noopener nofollow' : undefined}
			{...props}
		>
			{children}
		</a>
	);
}

function TaskListItem({ children, className, ...props }: React.LiHTMLAttributes<HTMLLIElement>) {
	const childArray = React.Children.toArray(children);
	const checkboxChild = childArray.find(
		(child): child is React.ReactElement<{ type?: string; checked?: boolean }> =>
			React.isValidElement(child) &&
			(child as React.ReactElement<{ type?: string }>).props.type === 'checkbox',
	);

	const isTaskItem = Boolean(checkboxChild);
	const isChecked = isTaskItem && checkboxChild?.props.checked === true;

	const classes = [
		className,
		isTaskItem ? 'task-list-item' : undefined,
		isChecked ? 'is-checked' : undefined,
	]
		.filter(Boolean)
		.join(' ');

	return (
		<li className={classes || undefined} {...props}>
			{children}
		</li>
	);
}
