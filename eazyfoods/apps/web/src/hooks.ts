import { useEffect, useState } from 'react';
import { api } from './api';

export function useApi<T>(path: string | null) {
  const [state, set] = useState<{ data?: T; error?: string; loading: boolean }>({ loading: !!path });
  useEffect(() => {
    if (!path) return;
    let live = true;
    set((s) => ({ ...s, loading: true, error: undefined }));
    api<T>(path).then((data) => live && set({ data, loading: false }), (e) => live && set({ error: e.message, loading: false }));
    return () => { live = false; };
  }, [path]);
  return state;
}

export type Me = { id: string; email: string; full_name: string } | null;
export function useMe() {
  const [me, setMe] = useState<Me>(null);
  const [ready, setReady] = useState(false);
  const load = () => api<Me>('/auth/me').then(setMe, () => setMe(null)).finally(() => setReady(true));
  useEffect(() => { load(); }, []);
  return { me, ready, reload: load };
}
