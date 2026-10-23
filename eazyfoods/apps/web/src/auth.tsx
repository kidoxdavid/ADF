import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, post } from './api';

export type Role = { role: string; vendor_id: string | null };
export type Me = { id: string; email: string; full_name: string; roles: Role[] } | null;
type Ctx = { me: Me; ready: boolean; reload: () => Promise<void>; logout: () => Promise<void>; has: (role: string) => boolean; isStaff: boolean; isVendor: boolean };

const STAFF = ['owner', 'admin', 'support', 'finance', 'dispatcher', 'catalog'];
const C = createContext<Ctx>(null as any);
export const useAuth = () => useContext(C);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me>(null);
  const [ready, setReady] = useState(false);
  const reload = useCallback(async () => {
    try { setMe(await api<Me>('/auth/me')); } catch { setMe(null); } finally { setReady(true); }
  }, []);
  useEffect(() => { reload(); }, [reload]);
  const value = useMemo<Ctx>(() => ({
    me, ready, reload,
    logout: async () => { await post('/auth/logout'); setMe(null); },
    has: (r) => !!me?.roles.some((x) => x.role === r),
    isStaff: !!me?.roles.some((x) => STAFF.includes(x.role)),
    isVendor: !!me?.roles.some((x) => x.role.startsWith('vendor_')),
  }), [me, ready, reload]);
  return <C.Provider value={value}>{children}</C.Provider>;
}
