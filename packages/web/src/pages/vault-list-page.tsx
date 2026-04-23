import { useEffect, useState, useRef, useCallback, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import {
  getVaults,
  createVault,
  deleteVault,
  type Vault,
} from '../api/client';

function CopyableCell({ value, masked, short, onCopied }: { value: string; masked?: boolean; short?: boolean; onCopied?: () => void }) {
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const handleClick = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = value;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    onCopied?.();
  }, [value, onCopied]);

  useEffect(() => () => clearTimeout(timerRef.current!), []);

  const display = short
    ? value.slice(0, 8) + '\u2026'
    : masked
      ? '\u2022'.repeat(8)
      : value;

  return (
    <code
      className="copyable"
      onClick={handleClick}
      title={value}
    >
      {display}
    </code>
  );
}

export function VaultListPage() {
  const [vaults, setVaults] = useState<Vault[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [toast, setToast] = useState(false);

  const showToast = useCallback(() => {
    setToast(true);
    setTimeout(() => setToast(false), 1500);
  }, []);

  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newVaultName, setNewVaultName] = useState('');
  const [creating, setCreating] = useState(false);

  const [deletingId, setDeletingId] = useState<string | null>(null);

  const fetchVaults = async () => {
    try {
      setLoading(true);
      const data = await getVaults();
      setVaults(data);
      setError('');
    } catch {
      setError('볼트 목록을 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchVaults();
  }, []);

  const handleCreate = async (e: FormEvent) => {
    e.preventDefault();
    if (!newVaultName.trim()) return;

    setCreating(true);
    try {
      await createVault({ name: newVaultName.trim() });
      setNewVaultName('');
      setShowCreateForm(false);
      await fetchVaults();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : '볼트 생성에 실패했습니다.',
      );
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (vaultId: string, name: string) => {
    if (!confirm(`"${name}" 볼트를 삭제하시겠습니까?`)) return;
    setDeletingId(vaultId);
    try {
      await deleteVault(vaultId);
      await fetchVaults();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : '볼트 삭제에 실패했습니다.',
      );
    } finally {
      setDeletingId(null);
    }
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString('ko-KR', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <div className="page-container">
      <div className="page-header">
        <h2>볼트 목록</h2>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => setShowCreateForm(!showCreateForm)}
        >
          볼트 생성
        </button>
      </div>

      {error && <div className="form-error">{error}</div>}

      {showCreateForm && (
        <form className="inline-form" onSubmit={handleCreate}>
          <div className="form-group">
            <input
              type="text"
              placeholder="볼트 이름"
              value={newVaultName}
              onChange={(e) => setNewVaultName(e.target.value)}
              required
              autoFocus
            />
          </div>
          <button
            type="submit"
            className="btn btn-primary"
            disabled={creating}
          >
            {creating ? '생성 중...' : '생성'}
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => {
              setShowCreateForm(false);
              setNewVaultName('');
            }}
          >
            취소
          </button>
        </form>
      )}

      {loading ? (
        <p>불러오는 중...</p>
      ) : vaults.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">📦</div>
          <p>볼트가 없습니다. "볼트 생성" 버튼으로 새 볼트를 만드세요.</p>
        </div>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>볼트 이름</th>
              <th>UUID</th>
              <th>생성자</th>
              <th>생성일</th>
              <th>작업</th>
            </tr>
          </thead>
          <tbody>
            {vaults.map((vault) => (
              <tr key={vault.id}>
                <td>
                  <Link to={`/vaults/${vault.id}/files`}>{vault.name}</Link>
                </td>
                <td>
                  <CopyableCell value={vault.id} short onCopied={showToast} />
                </td>
                <td>{vault.created_by ?? '-'}</td>
                <td>{formatDate(vault.created_at)}</td>
                <td className="cell-actions">
                  <button
                    type="button"
                    className="btn btn-danger btn-sm"
                    disabled={!!deletingId}
                    onClick={() => handleDelete(vault.id, vault.name)}
                  >
                    삭제
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {toast && <div className="toast">복사되었습니다</div>}
    </div>
  );
}
