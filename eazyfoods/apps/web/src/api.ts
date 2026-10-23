export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export async function api<T>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const res = await fetch(`/api${path}`, {
    credentials: 'include',
    ...init,
    headers: init?.json ? { 'content-type': 'application/json' } : undefined,
    body: init?.json ? JSON.stringify(init.json) : init?.body,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.message ?? data.error ?? 'Request failed');
  return data as T;
}

export const money = (cents: number) => new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format(cents / 100);
export const packLabel = (p: { pack_size: string | number | null; pack_unit: string | null }) =>
  p.pack_size ? `${Number(p.pack_size)} ${p.pack_unit ?? ''}`.trim() : p.pack_unit ? `per ${p.pack_unit}` : '';

export type Region = { slug: string; name: string; description?: string; countries: { slug: string; name: string }[] };
export type ProductCard = { slug: string; name: string; brand: string | null; pack_size: string | null; pack_unit: string | null; min_price: number; in_stock: boolean; store_count?: number; matched_alias?: string | null; category?: string };
export type StoreCard = { slug: string; name: string; description: string; city: string; is_open: boolean; min_order_cents: number | null; is_test_data: boolean; regions: { slug: string; name: string }[] };
