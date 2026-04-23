import type { ReactNode } from 'react';
import { useAuth } from '../hooks/use-auth';

interface LayoutProps {
  children: ReactNode;
}

export function Layout({ children }: LayoutProps) {
  const { username, logout } = useAuth();

  return (
    <div className="app-layout">
      <header className="app-header">
        <h1 className="app-title">Vector 관리</h1>
        {username && (
          <div className="header-actions">
            <span className="header-user">{username}</span>
            <button type="button" className="btn btn-secondary" onClick={logout}>
              로그아웃
            </button>
          </div>
        )}
      </header>
      <main className="app-main">{children}</main>
    </div>
  );
}
