import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { SetupPage } from './pages/setup-page';
import { LoginPage } from './pages/login-page';
import { VaultListPage } from './pages/vault-list-page';
import { VaultFilesPage } from './pages/vault-files-page';
import { VaultFileViewPage } from './pages/vault-file-view-page';
import { Layout } from './components/layout';
import { useAuth } from './hooks/use-auth';
import './App.css';

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { loading, isAuthenticated } = useAuth();

  if (loading) {
    return <div className="loading">로딩 중...</div>;
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return <Layout>{children}</Layout>;
}

function PublicRoute({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route
          path="/setup"
          element={
            <PublicRoute>
              <SetupPage />
            </PublicRoute>
          }
        />
        <Route
          path="/login"
          element={
            <PublicRoute>
              <LoginPage />
            </PublicRoute>
          }
        />
        <Route
          path="/vaults"
          element={
            <ProtectedRoute>
              <VaultListPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/vaults/:id/files"
          element={
            <ProtectedRoute>
              <VaultFilesPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/vaults/:id/view/*"
          element={
            <ProtectedRoute>
              <VaultFileViewPage />
            </ProtectedRoute>
          }
        />
        <Route path="/" element={<Navigate to="/vaults" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
