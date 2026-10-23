import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../auth';
import { useApi } from '../../hooks';
import { DataTable as BaseTable, ErrorBox, Loading, Notice, type Column } from '../../ui';
import { canDo } from './perms';

export const useCan = () => {
  const { me } = useAuth();
  return (...need: string[]) => canDo(me?.roles ?? [], ...need);
};

/** Shown when the signed-in role lacks a permission. */
export const NoAccess = ({ what }: { what?: string }) => (
  <Notice tone="warn">Your role does not allow {what ?? 'this'}. Ask an owner if you need access.</Notice>
);

/** Renders children only when the role has one of the permissions. */
export function Need({ perm, children, what }: { perm: string[]; children: ReactNode; what?: string }) {
  const can = useCan();
  return can(...perm) ? <>{children}</> : <NoAccess what={what} />;
}

/** Loads a path and renders children with the data. 403s become a plain notice, never a crash. */
export function Fetch<T = any>({ path, children, empty }: { path: string | null; children: (d: T, reload: () => void) => ReactNode; empty?: ReactNode }) {
  const { data, error, loading, reload } = useApi<T>(path);
  if (loading && !data) return <Loading />;
  if (error) return /allow|forbidden|permission/i.test(error) ? <NoAccess /> : <ErrorBox message={error} retry={reload} />;
  if (data === undefined) return <>{empty ?? null}</>;
  return <>{children(data, reload)}</>;
}

export function useForm<T extends Record<string, any>>(initial: T) {
  const [v, setV] = useState<T>(initial);
  const set = <K extends keyof T>(k: K) => (e: any) => setV((s) => ({ ...s, [k]: e?.target ? (e.target.type === 'checkbox' ? e.target.checked : e.target.value) : e }));
  return { v, set, setV };
}

export const orderLink = (id: string, label: string) => <Link to={`/admin/orders/${id}`}>{label}</Link>;
export const cents = (c: number | null | undefined) => (c == null ? '' : `$${(c / 100).toFixed(2)}`);
export const lines = (s: string) => s.split(/[\n,]+/).map((x) => x.trim()).filter(Boolean);
export const toggle = (arr: string[], v: string) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);

/** Small "what does this mean" disclosure used next to KPIs and settings. */
export function Why({ children }: { children: ReactNode }) {
  return <details className="why"><summary>What is this?</summary><p className="small muted">{children}</p></details>;
}

export function CheckList({ options, value, onChange }: { options: { value: string; label: string }[]; value: string[]; onChange: (v: string[]) => void }) {
  return (
    <div className="check-list">
      {options.map((o) => (
        <label key={o.value} className="check"><input type="checkbox" checked={value.includes(o.value)} onChange={() => onChange(toggle(value, o.value))} />{o.label}</label>
      ))}
    </div>
  );
}

// ---- Mutations that turn the API's validation issues into a readable message ----
import { ApiError } from '../../api';
async function call<T = any>(method: string, path: string, json?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, { method, credentials: 'include', headers: json !== undefined ? { 'content-type': 'application/json' } : undefined, body: json !== undefined ? JSON.stringify(json) : undefined });
  const data: any = await res.json().catch(() => ({}));
  if (!res.ok) {
    const issues = Array.isArray(data.issues) ? data.issues.map((i: any) => `${(i.path ?? []).join('.') || 'value'}: ${i.message}`).join('; ') : null;
    throw new ApiError(res.status, data.message ?? issues ?? data.error ?? 'Request failed', data.error, data.details);
  }
  return data as T;
}
export const post = <T = any>(p: string, json: unknown = {}) => call<T>('POST', p, json);
export const put = <T = any>(p: string, json: unknown = {}) => call<T>('PUT', p, json);
export const patch = <T = any>(p: string, json: unknown = {}) => call<T>('PATCH', p, json);
export const del = <T = any>(p: string) => call<T>('DELETE', p);

/** DataTable that keeps each cell's content together (on phones the shared table lays cells out as flex rows). */
export function DataTable<T>(props: { columns: Column<T>[]; rows: T[]; rowKey: (r: T) => string; empty?: ReactNode; onRowClick?: (r: T) => void }) {
  const columns = props.columns.map((c) => ({ ...c, render: (r: T) => <div className="cell">{c.render ? c.render(r) : String((r as any)[c.key] ?? '')}</div> }));
  return <BaseTable {...props} columns={columns} />;
}
