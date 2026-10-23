import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, put, post, del } from './api';
import { useAuth } from './auth';
import { useToast } from './toast';

export type CartItem = {
  offer_id: string; slug: string; name: string; brand: string | null; pack_size: string | null; pack_unit: string | null; sold_by: string;
  quantity: number; unit_price_cents: number; compare_at_cents: number | null; available: number; unavailable: boolean; short: boolean; price_changed: boolean; previous_price_cents: number;
};
export type CartStore = { slug: string; name: string; is_open: boolean; is_test_data: boolean; min_order_cents: number | null; orderable: boolean; subtotal_cents: number; items: CartItem[] };
export type Cart = { stores: CartStore[]; item_count: number; subtotal_cents: number; separate_deliveries: boolean };
type GuestItem = { offer_id: string; quantity: number; slug: string; name: string; unit_price_cents: number; store_name: string; store_slug: string; pack: string };

const KEY = 'ez_guest_cart_v1';
const readGuest = (): GuestItem[] => { try { return JSON.parse(localStorage.getItem(KEY) ?? '[]'); } catch { return []; } };
const writeGuest = (g: GuestItem[]) => { try { localStorage.setItem(KEY, JSON.stringify(g)); } catch { /* storage unavailable */ } };

type Ctx = {
  cart: Cart | null; count: number; guest: GuestItem[]; loading: boolean;
  qtyOf: (offerId: string) => number;
  setQty: (offer: { offer_id: string; slug: string; name: string; unit_price_cents: number; store_name: string; store_slug: string; pack: string }, qty: number) => Promise<void>;
  refresh: () => Promise<void>; replace: (c: Cart) => void;
};
const C = createContext<Ctx>(null as any);
export const useCart = () => useContext(C);

export function CartProvider({ children }: { children: ReactNode }) {
  const { me, ready } = useAuth();
  const toast = useToast();
  const [cart, setCart] = useState<Cart | null>(null);
  const [guest, setGuest] = useState<GuestItem[]>(readGuest);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!me) { setCart(null); return; }
    setLoading(true);
    try { setCart(await api<Cart>('/cart')); } catch { /* keep previous */ } finally { setLoading(false); }
  }, [me]);

  // On sign-in, fold the signed-out basket into the account basket, then clear it.
  useEffect(() => {
    if (!ready) return;
    (async () => {
      if (me) {
        const g = readGuest();
        if (g.length) {
          try {
            const r = await post<Cart & { skipped: string[] }>('/cart/merge', { items: g.map((x) => ({ offer_id: x.offer_id, quantity: x.quantity })) });
            if (r.skipped.length) toast(`${r.skipped.length} item(s) from your earlier basket are no longer available.`, 'error');
            writeGuest([]); setGuest([]); setCart(r); return;
          } catch { /* fall through to a plain refresh */ }
        }
        await refresh();
      } else setCart(null);
    })();
  }, [me?.id, ready]); // eslint-disable-line react-hooks/exhaustive-deps

  const setQty: Ctx['setQty'] = useCallback(async (offer, qty) => {
    if (me) {
      try { setCart(await put<Cart>(`/cart/items/${offer.offer_id}`, { quantity: qty })); }
      catch (e: any) { toast(e.message, 'error'); await refresh(); }
      return;
    }
    const g = readGuest().filter((x) => x.offer_id !== offer.offer_id);
    if (qty > 0) g.push({ offer_id: offer.offer_id, quantity: qty, slug: offer.slug, name: offer.name, unit_price_cents: offer.unit_price_cents, store_name: offer.store_name, store_slug: offer.store_slug, pack: offer.pack });
    writeGuest(g); setGuest(g);
  }, [me, toast, refresh]);

  const qtyOf = useCallback((id: string) => (me ? cart?.stores.flatMap((s) => s.items).find((i) => i.offer_id === id)?.quantity ?? 0 : guest.find((g) => g.offer_id === id)?.quantity ?? 0), [me, cart, guest]);
  const count = me ? cart?.item_count ?? 0 : guest.reduce((a, g) => a + g.quantity, 0);
  const value = useMemo<Ctx>(() => ({ cart, count, guest, loading, qtyOf, setQty, refresh, replace: setCart }), [cart, count, guest, loading, qtyOf, setQty, refresh]);
  return <C.Provider value={value}>{children}</C.Provider>;
}

export { del };
