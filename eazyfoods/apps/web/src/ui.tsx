import { cloneElement, isValidElement, useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type ReactElement, type ReactNode, type InputHTMLAttributes, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { NavLink, Link } from 'react-router-dom';
import { money, upload } from './api';
import { IconClose, IconMinus, IconPlus } from './icons';
import { useToast } from './toast';

// ---------- Basics ----------
export function Button({ variant = 'primary', size, busy, children, className = '', ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost' | 'danger'; size?: 'sm' | 'lg'; busy?: boolean }) {
  return <button {...p} disabled={p.disabled || busy} className={`btn ${variant} ${size ?? ''} ${className}`}>{busy ? 'Please wait…' : children}</button>;
}

/** Associates the label with its single control through id/htmlFor (and links hint/error via aria-describedby). */
export function Field({ label, hint, error, children, className = '' }: { label: string; hint?: string; error?: string; children: ReactNode; className?: string }) {
  const id = useId();
  const note = hint || error ? `${id}-note` : undefined;
  const control = isValidElement(children)
    ? cloneElement(children as ReactElement<any>, { id: (children.props as any).id ?? id, 'aria-describedby': note, 'aria-invalid': error ? true : undefined })
    : children;
  return (
    <div className={`field ${className}`}>
      <label className="label" htmlFor={isValidElement(children) ? (children.props as any).id ?? id : undefined}>{label}</label>
      {control}
      {hint && !error && <span id={note} className="hint">{hint}</span>}
      {error && <span id={note} className="error-text" role="alert">{error}</span>}
    </div>
  );
}
export const Input = (p: InputHTMLAttributes<HTMLInputElement>) => <input {...p} className={`input ${p.className ?? ''}`} />;
export const Select = (p: SelectHTMLAttributes<HTMLSelectElement>) => <select {...p} className={`input ${p.className ?? ''}`} />;
export const Textarea = (p: TextareaHTMLAttributes<HTMLTextAreaElement>) => <textarea {...p} className={`input ${p.className ?? ''}`} />;

export function Badge({ tone = 'neutral', children }: { tone?: 'neutral' | 'ok' | 'warn' | 'danger' | 'info' | 'demo'; children: ReactNode }) {
  return <span className={`badge ${tone}`}>{children}</span>;
}

const STATUS: Record<string, [string, 'neutral' | 'ok' | 'warn' | 'danger' | 'info']> = {
  awaiting_payment: ['Awaiting payment', 'warn'], pending_payment: ['Awaiting payment', 'warn'], placed: ['Waiting for store', 'warn'], accepted: ['Accepted', 'info'], preparing: ['Preparing', 'info'],
  ready: ['Ready', 'info'], out_for_delivery: ['Out for delivery', 'info'], delivered: ['Delivered', 'ok'], collected: ['Collected', 'ok'], completed: ['Completed', 'ok'],
  rejected: ['Rejected by store', 'danger'], cancelled: ['Cancelled', 'danger'], expired: ['Expired', 'neutral'], payment_failed: ['Payment failed', 'danger'],
  paid: ['Paid', 'ok'], pending: ['Pending', 'warn'], failed: ['Failed', 'danger'], partially_refunded: ['Partly refunded', 'warn'], refunded: ['Refunded', 'neutral'],
  unassigned: ['Unassigned', 'warn'], assigned: ['Assigned', 'info'], picked_up: ['Picked up', 'info'], requested: ['Requested', 'warn'], approved: ['Approved', 'ok'], succeeded: ['Done', 'ok'],
  draft: ['Draft', 'neutral'], submitted: ['Submitted', 'warn'], published: ['Published', 'ok'], suspended: ['Suspended', 'danger'], open: ['Open', 'warn'], resolved: ['Resolved', 'ok'], closed: ['Closed', 'neutral'],
  applied: ['Applied', 'warn'], verified: ['Verified', 'ok'], active: ['Active', 'ok'], scheduled: ['Scheduled', 'info'], ended: ['Ended', 'neutral'], archived: ['Archived', 'neutral'],
};
export function StatusBadge({ status }: { status: string }) {
  const [label, tone] = STATUS[status] ?? [status.replace(/_/g, ' '), 'neutral' as const];
  return <Badge tone={tone}>{label}</Badge>;
}

export const Notice = ({ tone = 'info', children }: { tone?: 'info' | 'warn' | 'error' | 'ok'; children: ReactNode }) => <div className={`notice ${tone}`} role={tone === 'error' ? 'alert' : undefined}>{children}</div>;
export const Loading = ({ label = 'Loading' }: { label?: string }) => <div className="loading" role="status" aria-live="polite"><span className="spinner" aria-hidden="true" />{label}…</div>;
export const ErrorBox = ({ message, retry }: { message: string; retry?: () => void }) => (
  <div className="notice error" role="alert"><strong>Something went wrong.</strong> {message} {retry && <button className="link" onClick={retry}>Try again</button>}</div>
);
export function Empty({ title, children }: { title: string; children?: ReactNode }) { return <div className="empty"><h3>{title}</h3>{children}</div>; }
export const Card = ({ children, className = '' }: { children: ReactNode; className?: string }) => <section className={`panel ${className}`}>{children}</section>;
export function PageHeader({ title, sub, actions }: { title: string; sub?: ReactNode; actions?: ReactNode }) {
  return <div className="page-header"><div><h1>{title}</h1>{sub && <p className="muted">{sub}</p>}</div>{actions && <div className="row wrap">{actions}</div>}</div>;
}
export const Stat = ({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) => <div className="stat"><span className="stat-label">{label}</span><strong className="stat-value">{value}</strong>{sub && <span className="muted small">{sub}</span>}</div>;
export const Money = ({ cents }: { cents: number | null | undefined }) => <>{money(cents)}</>;

// ---------- Quantity stepper (44px targets) ----------
export function Stepper({ value, onChange, max = 99, label }: { value: number; onChange: (n: number) => void; max?: number; label: string }) {
  return (
    <div className="stepper" role="group" aria-label={`Quantity of ${label}`}>
      <button type="button" aria-label={`Remove one ${label}`} onClick={() => onChange(value - 1)}><IconMinus width={18} height={18} /></button>
      <span aria-live="polite">{value}</span>
      <button type="button" aria-label={`Add one ${label}`} disabled={value >= max} onClick={() => onChange(value + 1)}><IconPlus width={18} height={18} /></button>
    </div>
  );
}

// ---------- Product art: real photo when we have one, otherwise an honest tile ----------
export function Thumb({ name, url, className = '' }: { name: string; url?: string | null; className?: string }) {
  if (url) return <img className={`thumb ${className}`} src={url} alt="" loading="lazy" />;
  const hue = [...name].reduce((a, c) => a + c.charCodeAt(0), 0) % 360;
  const initials = name.split(/\s+/).filter((w) => /^[A-Za-z]/.test(w)).slice(0, 2).map((w) => w[0]).join('');
  return <div className={`thumb tile ${className}`} style={{ background: `hsl(${hue} 32% 88%)`, color: `hsl(${hue} 42% 24%)` }} aria-hidden="true">{initials}</div>;
}

// ---------- Responsive data table: a table on desktop, stacked cards on phones ----------
export type Column<T> = { key: string; header: string; render?: (row: T) => ReactNode; className?: string };
export function DataTable<T>({ columns, rows, rowKey, empty = 'Nothing here yet.', onRowClick }: { columns: Column<T>[]; rows: T[]; rowKey: (r: T) => string; empty?: ReactNode; onRowClick?: (r: T) => void }) {
  if (!rows.length) return <Empty title={typeof empty === 'string' ? empty : 'Nothing here'}>{typeof empty === 'string' ? null : empty}</Empty>;
  return (
    <div className="table-wrap">
      <table className="table">
        <thead><tr>{columns.map((c) => <th key={c.key} scope="col">{c.header}</th>)}</tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={rowKey(r)} onClick={onRowClick ? () => onRowClick(r) : undefined} className={onRowClick ? 'clickable' : ''}>
              {columns.map((c) => <td key={c.key} data-label={c.header} className={c.className}>{c.render ? c.render(r) : String((r as any)[c.key] ?? '')}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------- Modal (bottom sheet on phones) ----------
export function Modal({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', k);
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', k); document.body.style.overflow = ''; prev?.focus(); };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} ref={ref}>
        <div className="row between"><h2>{title}</h2><button className="icon-btn" onClick={onClose} aria-label="Close"><IconClose /></button></div>
        {children}
      </div>
    </div>
  );
}

export function Confirm({ children, onConfirm, message, variant = 'danger', size }: { children: ReactNode; onConfirm: () => void | Promise<void>; message: string; variant?: 'primary' | 'danger' | 'secondary'; size?: 'sm' | 'lg' }) {
  const [open, setOpen] = useState(false); const [busy, setBusy] = useState(false);
  return (<>
    <Button variant={variant} size={size} onClick={() => setOpen(true)}>{children}</Button>
    <Modal open={open} onClose={() => setOpen(false)} title="Are you sure?">
      <p>{message}</p>
      <div className="row end"><Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button><Button variant={variant} busy={busy} onClick={async () => { setBusy(true); try { await onConfirm(); setOpen(false); } finally { setBusy(false); } }}>Yes, continue</Button></div>
    </Modal>
  </>);
}

export function Tabs({ tabs, value, onChange }: { tabs: { id: string; label: string; badge?: number }[]; value: string; onChange: (id: string) => void }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((t) => <button key={t.id} role="tab" aria-selected={value === t.id} className={value === t.id ? 'active' : ''} onClick={() => onChange(t.id)}>{t.label}{t.badge ? <span className="count">{t.badge}</span> : null}</button>)}
    </div>
  );
}

// ---------- Image upload (only EAZyfoods-issued URLs are accepted by the API) ----------
export function ImageUpload({ value, onChange, label = 'Image' }: { value?: string | null; onChange: (url: string | null) => void; label?: string }) {
  const [busy, setBusy] = useState(false); const toast = useToast();
  return (
    <div className="image-upload">
      {value ? <img src={value} alt="" /> : <div className="image-empty">No image</div>}
      <div className="stack">
        <label className="btn secondary sm">{busy ? 'Uploading…' : value ? `Change ${label.toLowerCase()}` : `Upload ${label.toLowerCase()}`}
          <input type="file" accept="image/jpeg,image/png,image/webp" hidden disabled={busy} onChange={async (e) => {
            const f = e.target.files?.[0]; if (!f) return; setBusy(true);
            try { onChange((await upload('/uploads/image', f)).url); } catch (err: any) { toast(err.message, 'error'); } finally { setBusy(false); e.target.value = ''; }
          }} />
        </label>
        {value && <button type="button" className="link" onClick={() => onChange(null)}>Remove</button>}
        <span className="hint">JPG, PNG or WebP, up to 5 MB.</span>
      </div>
    </div>
  );
}

// ---------- Portal shell (sidebar on desktop, scrolling tab strip on phones) ----------
export type NavItem = { to: string; label: string; end?: boolean; badge?: number };
export function PortalLayout({ title, subtitle, nav, children }: { title: string; subtitle?: string; nav: NavItem[]; children: ReactNode }) {
  return (
    <div className="portal">
      <aside className="portal-nav" aria-label={`${title} navigation`}>
        <div className="portal-title"><Link to="/" aria-label="Back to the shop">← Shop</Link><strong>{title}</strong>{subtitle && <span className="muted small">{subtitle}</span>}</div>
        <nav>{nav.map((n) => <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => (isActive ? 'active' : '')}>{n.label}{n.badge ? <span className="count">{n.badge}</span> : null}</NavLink>)}</nav>
      </aside>
      <div className="portal-main">{children}</div>
    </div>
  );
}

export const formValues = (e: React.FormEvent<HTMLFormElement>) => { e.preventDefault(); return Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>; };
