import { useEffect, useState, useCallback } from 'react';
import { getMe, logout as apiLogout } from '../api/client';

interface AuthState {
  username: string | null;
  loading: boolean;
}

export function useAuth() {
  const [auth, setAuth] = useState<AuthState>({
    username: null,
    loading: true,
  });

  useEffect(() => {
    let cancelled = false;

    getMe()
      .then((data) => {
        if (!cancelled) {
          setAuth({ username: data.username, loading: false });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setAuth({ username: null, loading: false });
          window.location.href = '/login';
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const logout = useCallback(async () => {
    try {
      await apiLogout();
    } finally {
      window.location.href = '/login';
    }
  }, []);

  return {
    username: auth.username,
    loading: auth.loading,
    isAuthenticated: auth.username !== null,
    logout,
  };
}
