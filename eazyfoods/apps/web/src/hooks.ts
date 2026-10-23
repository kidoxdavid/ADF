import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api';

export function useApi<T = any>(path: string | null) {
  const [state, set] = useState<{ data?: T; error?: string; loading: boolean }>({ loading: !!path });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!path) { set({ loading: false }); return; }
    let live = true;
    set((s) => ({ ...s, loading: true, error: undefined }));
    api<T>(path).then((data) => live && set({ data, loading: false }), (e) => live && set({ error: e.message, loading: false }));
    return () => { live = false; };
  }, [path, tick]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { ...state, reload };
}

/** Wrap an async action with busy/error state, for buttons and forms. */
export function useAction<A extends unknown[], R>(fn: (...a: A) => Promise<R>) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const alive = useRef(true);
  // StrictMode mounts, unmounts and re-mounts: the flag must be set back to true on every mount.
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const run = useCallback(async (...a: A) => {
    setBusy(true); setError(undefined);
    try { return await fn(...a); }
    catch (e: any) { if (alive.current) setError(e.message ?? 'Something went wrong'); return undefined; }
    finally { if (alive.current) setBusy(false); }
  }, [fn]);
  return { run, busy, error, clear: () => setError(undefined) };
}

export function useDebounced<T>(value: T, ms = 250) {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}
