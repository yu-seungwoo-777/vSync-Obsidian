import { useEffect, useState, useCallback, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import { getVaultFiles, type VaultFile } from '../api/client';
import { EmptyState } from '../components/empty-state';

// @MX:NOTE 트리 노드 타입 정의 - 폴더/파일 구분을 위한 재귀 구조
interface TreeNode {
  name: string;
  isFolder: boolean;
  path: string;
  size?: number;
  updated_at?: string;
  file_type?: string;
  children: Map<string, TreeNode>;
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

// @MX:NOTE 파일 경로를 트리 구조로 변환하는 함수
// "notes/project/idea.md" -> { notes: { project: { idea.md: file } } }
function buildTree(files: VaultFile[]): TreeNode {
  const root: TreeNode = {
    name: '',
    isFolder: true,
    path: '',
    children: new Map(),
  };

  for (const file of files) {
    const parts = file.path.split('/');
    let current = root;

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (!part) continue;

      if (i === parts.length - 1) {
        // 파일 노드
        current.children.set(part, {
          name: part,
          isFolder: false,
          path: file.path,
          size: file.size,
          updated_at: file.updated_at,
          file_type: file.file_type,
          children: new Map(),
        });
      } else {
        // 폴더 노드
        if (!current.children.has(part)) {
          const folderPath = parts.slice(0, i + 1).join('/');
          current.children.set(part, {
            name: part,
            isFolder: true,
            path: folderPath,
            children: new Map(),
          });
        }
        current = current.children.get(part)!;
      }
    }
  }

  return root;
}

// 폴더 내 전체 파일 수 카운트
function countFiles(node: TreeNode): number {
  if (!node.isFolder) return 1;
  let count = 0;
  for (const child of node.children.values()) {
    count += countFiles(child);
  }
  return count;
}

// 정렬: 폴더 먼저, 그 다음 이름순
function getSortedChildren(node: TreeNode): TreeNode[] {
  return Array.from(node.children.values()).sort((a, b) => {
    if (a.isFolder !== b.isFolder) return a.isFolder ? -1 : 1;
    return a.name.localeCompare(b.name, 'ko');
  });
}

// 파일 타입에 따른 아이콘 반환
function getFileIcon(name: string, fileType?: string): string {
  if (fileType === 'attachment') {
    const lower = name.toLowerCase();
    if (/\.(png|jpe?g|gif|webp|svg)$/.test(lower)) return '🖼';
    if (lower.endsWith('.pdf')) return '📄';
    if (/\.(mp3|wav|ogg)$/.test(lower)) return '🎵';
    if (lower.endsWith('.mp4')) return '🎬';
    return '📎';
  }
  return '📝'; // 마크다운
}

// TreeRow 컴포넌트
function TreeRow({
  node,
  depth,
  vaultId,
  expandedFolders,
  toggleFolder,
}: {
  node: TreeNode;
  depth: number;
  vaultId: string;
  expandedFolders: Set<string>;
  toggleFolder: (path: string) => void;
}) {
  const isExpanded = expandedFolders.has(node.path);
  const sortedChildren = getSortedChildren(node);
  const fileCount = node.isFolder ? countFiles(node) : 0;

  if (node.isFolder) {
    return (
      <>
        <div
          className="tree-row tree-folder"
          style={{ paddingLeft: `${depth * 1.25 + 0.75}rem` }}
          onClick={() => toggleFolder(node.path)}
          role="button"
          tabIndex={0}
          aria-expanded={isExpanded}
          aria-label={`${node.name} 폴더${isExpanded ? ' 닫기' : ' 열기'}`}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              toggleFolder(node.path);
            }
          }}
        >
          <span className="tree-chevron">{isExpanded ? '\u25BC' : '\u25B6'}</span>
          <span className="tree-folder-name">{node.name}</span>
          <span className="tree-file-count">{fileCount}</span>
        </div>
        {isExpanded &&
          sortedChildren.map((child) => (
            <TreeRow
              key={child.path}
              node={child}
              depth={depth + 1}
              vaultId={vaultId}
              expandedFolders={expandedFolders}
              toggleFolder={toggleFolder}
            />
          ))}
      </>
    );
  }

  // 파일 노드
  const encodedPath = encodeURIComponent(node.path);

  return (
    <Link
      to={`/vaults/${vaultId}/view/${encodedPath}`}
      className="tree-row tree-file"
      style={{ paddingLeft: `${depth * 1.25 + 0.75}rem` }}
    >
      <span className="tree-file-icon" aria-hidden="true">{getFileIcon(node.name, node.file_type)}</span>
      <span className="tree-file-name">{node.name}</span>
      {node.size !== undefined && (
        <span className="tree-file-meta">{formatFileSize(node.size)}</span>
      )}
      {node.updated_at && (
        <span className="tree-file-meta tree-file-date">
          {formatDate(node.updated_at)}
        </span>
      )}
    </Link>
  );
}

export function VaultFilesPage() {
  const { id } = useParams<{ id: string }>();
  const [files, setFiles] = useState<VaultFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!id) return;

    let cancelled = false;

    getVaultFiles(id)
      .then((data) => {
        if (!cancelled) {
          setFiles(data);
          setError('');

          // 초기 상태: 루트 레벨 폴더만 펼치기
          const rootFolders = new Set<string>();
          for (const file of data) {
            const parts = file.path.split('/');
            if (parts.length >= 2 && parts[0]) {
              rootFolders.add(parts[0]);
            }
          }
          setExpandedFolders(rootFolders);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setError('파일 목록을 불러오지 못했습니다.');
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
  }, [id]);

  const toggleFolder = useCallback((path: string) => {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }, []);

  const tree = useMemo(() => buildTree(files), [files]);
  const sortedRoot = useMemo(() => getSortedChildren(tree), [tree]);

  return (
    <div className="page-container">
      <div className="page-header">
        <Link to="/vaults" className="back-link">
          &larr; 볼트 목록으로
        </Link>
        <h2>파일 목록</h2>
      </div>

      {error && <div className="form-error">{error}</div>}

      {loading ? (
        <p>불러오는 중...</p>
      ) : files.length === 0 ? (
        <EmptyState message="파일이 없습니다" />
      ) : (
        <div className="tree-container">
          {sortedRoot.map((node) => (
            <TreeRow
              key={node.path}
              node={node}
              depth={0}
              vaultId={id!}
              expandedFolders={expandedFolders}
              toggleFolder={toggleFolder}
            />
          ))}
        </div>
      )}
    </div>
  );
}
