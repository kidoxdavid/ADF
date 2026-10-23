import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { useApi } from '../../hooks';
import { Loading, ErrorBox, Select, Field, Empty } from '../../ui';

export type VStore = { id: string; slug: string; name: string; status: string; orderable: boolean; is_open: boolean };
export type VOrder = {
  id: string; status: string; fulfilment_method: string; subtotal_cents: number; discount_cents: number; total_cents: number; commission_cents: number; placed_at: string | null; promised_at: string | null;
  store_name: string; store_id: string; order_number: string; customer_first_name: string; delivery_instructions: string | null; needs_attention: boolean;
  lines: { id: string; name: string; brand: string | null; pack_label: string | null; quantity: number; unit_price_cents: number; status: string; substitution_status: string; substitute_name: string | null; sold_by: string; refunded_quantity: number }[] | null;
};
type Ctx = { stores: VStore[]; storeId: string; setStoreId: (id: string) => void; store: VStore; orders: VOrder[]; reloadOrders: () => void; ordersLoading: boolean; pending: number };
const C = createContext<Ctx>(null as any);
export const useVendor = () => useContext(C);

/** Loads the vendor's stores and (polled) orders once, shared by every screen. */
export function VendorProvider({ children }: { children: ReactNode }) {
  const stores = useApi<VStore[]>('/vendor/stores');
  const orders = useApi<VOrder[]>('/vendor/orders');
  const [storeId, setStoreId] = useState('');
  useEffect(() => { if (stores.data?.length && !stores.data.find((s) => s.id === storeId)) setStoreId(stores.data[0].id); }, [stores.data, storeId]);
  useEffect(() => { const t = setInterval(orders.reload, 30000); return () => clearInterval(t); }, [orders.reload]);
  if (stores.loading) return <Loading />;
  if (stores.error) return <ErrorBox message={stores.error} retry={stores.reload} />;
  if (!stores.data?.length) return <Empty title="No store found for this account" />;
  const store = stores.data.find((s) => s.id === storeId) ?? stores.data[0];
  const all = orders.data ?? [];
  return <C.Provider value={{ stores: stores.data, storeId: store.id, setStoreId, store, orders: all, reloadOrders: orders.reload, ordersLoading: orders.loading && !orders.data, pending: all.filter((o) => o.status === 'placed').length }}>{children}</C.Provider>;
}

export function StoreSelect() {
  const { stores, storeId, setStoreId } = useVendor();
  if (stores.length < 2) return null;
  return <Field label="Store"><Select value={storeId} onChange={(e) => setStoreId(e.target.value)}>{stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></Field>;
}
