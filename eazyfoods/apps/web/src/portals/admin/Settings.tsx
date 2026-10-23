import { useState } from 'react';
import { fmtDate } from '../../api';
import { useAction } from '../../hooks';
import { useAuth } from '../../auth';
import { useToast } from '../../toast';
import { Badge, Button, Card, Field, Input, Modal, Notice, PageHeader, Select, Tabs } from '../../ui';
import { DataTable, Fetch, Need, del, patch, post, put, useCan } from './common';

type Meta = { label: string; kind: 'percent_bps' | 'dollars' | 'int' | 'bool' | 'text' | 'tax' | 'fixed'; unit?: string; help: string; range?: [number, number] };
const META: Record<string, Meta> = {
  'currency': { label: 'Currency', kind: 'fixed', help: 'All prices are in Canadian dollars.' },
  'tax.rates_bps': { label: 'Tax rates', kind: 'tax', help: 'GST rate for zero-rated and standard-rated products. Delivery fees use the standard rate. Confirm treatment with an accountant.', range: [0, 30] },
  'commission.default_bps': { label: 'Default commission', kind: 'percent_bps', help: 'Marketplace commission on merchandise value. A vendor can have its own override. Applies to new orders only.', range: [0, 50] },
  'checkout.reservation_minutes': { label: 'Stock hold at checkout', kind: 'int', unit: 'minutes', help: 'How long items are held while the customer pays.', range: [5, 60] },
  'vendor.accept_timeout_minutes': { label: 'Store accept warning', kind: 'int', unit: 'minutes', help: 'Orders not accepted by this time show as needing attention.', range: [1, 240] },
  'vendor.auto_reject_minutes': { label: 'Auto-reject unanswered orders', kind: 'int', unit: 'minutes', help: 'After this the order is rejected and the customer fully refunded.', range: [5, 720] },
  'vendor.require_verified_docs': { label: 'Require verified documents to approve a vendor', kind: 'bool', help: 'Turn off only for controlled pilots.' },
  'ordering.require_open': { label: 'Only allow orders while the store is open', kind: 'bool', help: 'Scheduled orders are not supported, so keep this on.' },
  'driver.pay_per_delivery_cents': { label: 'Driver pay per delivery', kind: 'dollars', help: 'Recorded as a cost when a delivery completes.', range: [0, 100] },
  'payout.hold_days': { label: 'Payout hold after delivery', kind: 'int', unit: 'days', help: 'Vendor earnings become payable this long after delivery.', range: [0, 30] },
  'ads.min_cpc_cents': { label: 'Minimum cost per click (ads)', kind: 'dollars', help: 'Advertisers cannot bid below this.', range: [0.01, 50] },
  'ads.min_budget_cents': { label: 'Minimum campaign budget (ads)', kind: 'dollars', help: 'Smallest budget a vendor can set.', range: [1, 10000] },
  'vendor.agreement_version': { label: 'Vendor agreement version', kind: 'text', help: 'Changing this does not re-ask existing vendors automatically.' },
};

function show(key: string, v: any) {
  const m = META[key]; if (!m) return JSON.stringify(v);
  switch (m.kind) {
    case 'percent_bps': return `${v / 100}%`;
    case 'dollars': return `$${(v / 100).toFixed(2)}`;
    case 'int': return `${v} ${m.unit}`;
    case 'bool': return v ? 'On' : 'Off';
    case 'tax': return `Zero-rated ${v.zero_rated / 100}% · Standard ${v.standard / 100}%`;
    default: return String(v);
  }
}

function Commercial() {
  const can = useCan();
  const toast = useToast();
  const [edit, setEdit] = useState<{ key: string; value: any } | null>(null);
  const [text, setText] = useState('');
  const [text2, setText2] = useState('');
  const open = (r: any) => {
    const m = META[r.key]; setEdit(r);
    if (m.kind === 'percent_bps') setText(String(r.value / 100)); else if (m.kind === 'dollars') setText((r.value / 100).toFixed(2)); else if (m.kind === 'tax') { setText(String(r.value.zero_rated / 100)); setText2(String(r.value.standard / 100)); } else setText(String(r.value));
  };
  const save = useAction(async (reload: () => void) => {
    const m = META[edit!.key]; let value: any;
    const nums = m.kind === 'tax' ? [Number(text), Number(text2)] : [Number(text)];
    if (m.range && (nums.some((n) => Number.isNaN(n)) || nums.some((n) => n < m.range![0] || n > m.range![1]))) throw new Error(`Enter a number between ${m.range[0]} and ${m.range[1]}${m.kind === 'percent_bps' || m.kind === 'tax' ? ' (%)' : m.kind === 'dollars' ? ' ($)' : m.unit ? ` ${m.unit}` : ''}.`);
    if (m.kind === 'percent_bps') value = Math.round(Number(text) * 100); else if (m.kind === 'dollars') value = Math.round(Number(text) * 100); else if (m.kind === 'int') value = Number(text);
    else if (m.kind === 'bool') value = text === 'true'; else if (m.kind === 'tax') value = { zero_rated: Math.round(Number(text) * 100), standard: Math.round(Number(text2) * 100) }; else value = text;
    await put(`/admin/settings/${edit!.key}`, { value });
    toast('Setting saved and recorded in the audit log'); setEdit(null); reload();
  });
  return (
    <Fetch path="/admin/settings">{(rows: any[], reload) => (
      <>
        {!can('settings.manage') && <Notice tone="info">You can view these settings. Only an owner can change them.</Notice>}
        <DataTable rows={rows} rowKey={(r) => r.key} empty="No settings."
          columns={[{ key: 'l', header: 'Setting', render: (r) => <><strong>{META[r.key]?.label ?? r.key}</strong><div className="small muted">{META[r.key]?.help}</div></> }, { key: 'v', header: 'Value', render: (r) => <strong>{show(r.key, r.value)}</strong> },
            { key: 'u', header: 'Changed', render: (r) => fmtDate(r.updated_at) },
            { key: 'a', header: '', render: (r) => (can('settings.manage') && META[r.key]?.kind !== 'fixed' ? <Button size="sm" variant="secondary" onClick={() => open(r)}>Change</Button> : null) }]} />
        <Modal open={!!edit} onClose={() => setEdit(null)} title={edit ? META[edit.key]?.label ?? edit.key : ''}>
          {edit && <>
            <p className="small muted">{META[edit.key]?.help}</p>
            {save.error && <Notice tone="error">{save.error}</Notice>}
            {META[edit.key].kind === 'bool' ? <Field label="Value"><Select value={text} onChange={(e) => setText(e.target.value)}><option value="true">On</option><option value="false">Off</option></Select></Field>
              : META[edit.key].kind === 'tax' ? <div className="form-grid"><Field label="Zero-rated (%)"><Input inputMode="decimal" value={text} onChange={(e) => setText(e.target.value)} /></Field><Field label="Standard (%)"><Input inputMode="decimal" value={text2} onChange={(e) => setText2(e.target.value)} /></Field></div>
              : <Field label={`Value${META[edit.key].kind === 'percent_bps' ? ' (%)' : META[edit.key].kind === 'dollars' ? ' ($)' : META[edit.key].unit ? ` (${META[edit.key].unit})` : ''}`}><Input inputMode={META[edit.key].kind === 'text' ? 'text' : 'decimal'} value={text} onChange={(e) => setText(e.target.value)} /></Field>}
            <div className="row end"><Button variant="ghost" onClick={() => setEdit(null)}>Cancel</Button><Button busy={save.busy} onClick={() => save.run(reload)}>Save</Button></div>
          </>}
        </Modal>
      </>
    )}</Fetch>
  );
}

const ROLES = ['owner', 'admin', 'support', 'finance', 'dispatcher', 'catalog'];
function Users() {
  const { me } = useAuth();
  const can = useCan();
  const toast = useToast();
  const [q, setQ] = useState('');
  const [applied, setApplied] = useState('');
  const [grant, setGrant] = useState<Record<string, string>>({});
  const act = useAction(async (fn: () => Promise<any>, ok: string, reload: () => void) => { await fn(); toast(ok); reload(); });
  return (
    <Need perm={['users.view']} what="viewing users">
      <form className="filters-row" onSubmit={(e) => { e.preventDefault(); setApplied(q.trim()); }}><Field label="Name or email"><Input value={q} onChange={(e) => setQ(e.target.value)} /></Field><Button type="submit">Search</Button></form>
      {act.error && <Notice tone="error">{act.error}</Notice>}
      <Fetch path={`/admin/users${applied ? `?q=${encodeURIComponent(applied)}` : ''}`}>{(rows: any[], reload) => (
        <DataTable rows={rows} rowKey={(u) => u.id} empty="No users match."
          columns={[
            { key: 'n', header: 'Person', render: (u) => <><strong>{u.full_name}</strong>{u.disabled && <> <Badge tone="danger">Disabled</Badge></>}<div className="small muted">{u.email}</div></> },
            { key: 'r', header: 'Roles', render: (u) => <div className="row wrap">{u.roles.map((r: string) => (
              <Badge key={r} tone={ROLES.includes(r) ? 'info' : 'neutral'}>{r.replace('_', ' ')}{can('settings.manage') && ROLES.includes(r) && <button className="link" aria-label={`Remove ${r} role`} style={{ marginLeft: 4, minHeight: 0 }} onClick={() => act.run(() => del(`/admin/users/${u.id}/roles/${r}`), 'Role removed', reload)}>×</button>}</Badge>))}</div> },
            { key: 'g', header: 'Staff access', render: (u) => (can('settings.manage') ? (
              <div className="row wrap"><Select aria-label="Role to grant" style={{ minWidth: 120 }} value={grant[u.id] ?? ''} onChange={(e) => setGrant((s) => ({ ...s, [u.id]: e.target.value }))}><option value="">Add role…</option>{ROLES.filter((r) => !u.roles.includes(r)).map((r) => <option key={r} value={r}>{r}</option>)}</Select>
                <Button size="sm" disabled={!grant[u.id]} onClick={() => act.run(() => post(`/admin/users/${u.id}/roles`, { role: grant[u.id] }), 'Role granted', reload)}>Grant</Button></div>) : null) },
            { key: 'd', header: '', render: (u) => (can('settings.manage') && u.id !== me?.id ? <Button size="sm" variant={u.disabled ? 'secondary' : 'danger'} onClick={() => act.run(() => patch(`/admin/users/${u.id}/disabled`, { disabled: !u.disabled }), u.disabled ? 'User enabled' : 'User disabled and signed out', reload)}>{u.disabled ? 'Enable' : 'Disable'}</Button> : null) },
          ]} />
      )}</Fetch>
    </Need>
  );
}

function RolesRef() {
  return (
    <Need perm={['users.view']} what="viewing roles">
      <Fetch path="/admin/roles">{(r: Record<string, string[]>) => (
        <div className="grid cols-2">{Object.entries(r).map(([role, perms]) => (
          <Card key={role}><h3>{role}</h3>{perms.includes('*') ? <p><Badge tone="warn">Everything</Badge> The only wildcard role. Keep owners few.</p> : <div className="row wrap">{perms.map((p) => <span key={p} className="badge">{p}</span>)}</div>}</Card>))}</div>
      )}</Fetch>
    </Need>
  );
}

export function Settings() {
  const can = useCan();
  const [tab, setTab] = useState(can('settings.view') ? 'settings' : 'users');

  return (
    <>
      <PageHeader title="Settings & access" sub="Commercial rules and who can do what. Every change is recorded in the audit log." />
      <Tabs value={tab} onChange={setTab} tabs={[...(can('settings.view') ? [{ id: 'settings', label: 'Commercial settings' }] : []), { id: 'users', label: 'Users & roles' }, { id: 'roles', label: 'Role reference' }]} />
      {tab === 'settings' ? <Need perm={['settings.view']}><Commercial /></Need> : tab === 'users' ? <Users /> : <RolesRef />}
    </>
  );
}
