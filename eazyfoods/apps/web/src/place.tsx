import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api } from './api';

export type Place = { postal: string; fsa: string; serviceable: boolean; zone?: string; fee_cents?: number; free_over_cents?: number | null; eta_minutes?: number } | null;
type Ctx = { place: Place; check: (postal: string) => Promise<Place>; clear: () => void; open: boolean; setOpen: (b: boolean) => void };
const C = createContext<Ctx>(null as any);
export const usePlace = () => useContext(C);
const KEY = 'ez_place_v1';

/** The "Deliver to" location shown in the header. It only informs browsing; checkout re-checks the real address on the server. */
export function PlaceProvider({ children }: { children: ReactNode }) {
  const [place, setPlace] = useState<Place>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => { try { const v = JSON.parse(localStorage.getItem(KEY) ?? 'null'); if (v?.fsa) setPlace(v); } catch { /* ignore */ } }, []);
  const check = useCallback(async (postal: string) => {
    const r = await api<any>(`/service-area?postal=${encodeURIComponent(postal)}`);
    const p: Place = { postal: postal.toUpperCase().replace(/\s+/g, ''), ...r };
    setPlace(p); try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* ignore */ }
    return p;
  }, []);
  const clear = useCallback(() => { setPlace(null); try { localStorage.removeItem(KEY); } catch { /* ignore */ } }, []);
  const value = useMemo(() => ({ place, check, clear, open, setOpen }), [place, check, clear, open]);
  return <C.Provider value={value}>{children}</C.Provider>;
}
