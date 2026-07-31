import { createContext, useContext, useState, useEffect, ReactNode, useCallback } from 'react';
import { authApi } from '../api/client';

export interface AuthUser {
  username: string;
  role: string;
  permissions: string[];
}

interface AuthCtx {
  user: AuthUser | null;
  loading: boolean;
  can: (permission: string) => boolean;
  refresh: () => Promise<void>;
}

const Ctx = createContext<AuthCtx>({
  user: null,
  loading: true,
  can: () => false,
  refresh: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const me = await authApi.me();
      if (me.authenticated && me.username && me.role) {
        setUser({
          username: me.username,
          role: me.role,
          permissions: (me.permissions as string[] | undefined) ?? [],
        });
      } else {
        setUser(null);
      }
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const can = useCallback((permission: string) =>
    user?.permissions.includes(permission) ?? false,
  [user]);

  return (
    <Ctx.Provider value={{ user, loading, can, refresh }}>
      {children}
    </Ctx.Provider>
  );
}

export function useAuth() {
  return useContext(Ctx);
}
