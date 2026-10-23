export class ApiError extends Error {
  constructor(public status: number, message: string, public code?: string, public details?: any) { super(message); }
}

type Init = Omit<RequestInit, 'body'> & { json?: unknown; body?: BodyInit; headers?: Record<string, string> };

export async function api<T = any>(path: string, init: Init = {}): Promise<T> {
  const { json, headers, ...rest } = init;
  const res = await fetch(`/api${path}`, {
    credentials: 'include', ...rest,
    headers: { ...(json !== undefined ? { 'content-type': 'application/json' } : {}), ...headers },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  if (res.status === 204) return undefined as T;
  const ct = res.headers.get('content-type') ?? '';
  const data = ct.includes('json') ? await res.json().catch(() => ({})) : await res.text();
  if (!res.ok) throw new ApiError(res.status, (data as any)?.message ?? (data as any)?.error ?? 'Request failed', (data as any)?.error, (data as any)?.details);
  return data as T;
}
export const post = <T = any>(p: string, json?: unknown, headers?: Record<string, string>) => api<T>(p, { method: 'POST', json: json ?? {}, headers });
export const put = <T = any>(p: string, json?: unknown) => api<T>(p, { method: 'PUT', json: json ?? {} });
export const patch = <T = any>(p: string, json?: unknown) => api<T>(p, { method: 'PATCH', json: json ?? {} });
export const del = <T = any>(p: string) => api<T>(p, { method: 'DELETE' });

export async function upload(path: string, file: File): Promise<any> {
  const fd = new FormData(); fd.append('file', file);
  const res = await fetch(`/api${path}`, { method: 'POST', body: fd, credentials: 'include' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.message ?? 'Upload failed', data.error);
  return data;
}

export const money = (cents: number | null | undefined) =>
  cents == null ? '' : new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format(cents / 100);
export const dollarsToCents = (s: string) => Math.round(Number(s) * 100);
export const centsToDollars = (c: number) => (c / 100).toFixed(2);
export const packLabel = (p: { pack_size?: string | number | null; pack_unit?: string | null }) =>
  p.pack_size ? `${Number(p.pack_size)} ${p.pack_unit ?? ''}`.trim() : p.pack_unit ? `per ${p.pack_unit}` : '';
export const fmtDate = (s: string | Date | null | undefined, opts: Intl.DateTimeFormatOptions = { dateStyle: 'medium', timeStyle: 'short' }) =>
  s ? new Intl.DateTimeFormat('en-CA', { ...opts, timeZone: 'America/Edmonton' }).format(new Date(s)) : '';

export type Region = { slug: string; name: string; description?: string; countries: { slug: string; name: string }[] };
export type ProductCard = {
  slug: string; name: string; brand: string | null; pack_size: string | null; pack_unit: string | null; min_price: number; in_stock: boolean;
  store_count?: number; matched_alias?: string | null; category?: string; image_url?: string | null; sponsored_campaign_id?: string | null;
};
export type StoreCard = { slug: string; name: string; description: string; city: string; is_open: boolean; min_order_cents: number | null; is_test_data: boolean; regions: { slug: string; name: string }[]; logo_url?: string | null };
