import { useState } from 'react';
import { fmtDate } from '../../api';
import { Badge, Card, Field, Input, Notice, PageHeader, Select, Tabs } from '../../ui';
import { DataTable, Fetch, Need } from './common';

export function System() {
  const [tab, setTab] = useState('health');
  return (
    <>
      <PageHeader title="System" sub="Health checks, integrations, errors and the audit trail." />
      <Tabs value={tab} onChange={setTab} tabs={[{ id: 'health', label: 'Health & integrations' }, { id: 'audit', label: 'Audit log' }]} />
      {tab === 'health' ? <Health /> : <Audit />}
    </>
  );
}

function Health() {
  return (
    <Need perm={['settings.view', 'orders.view']} what="system health">
      <Fetch path="/admin/system">{(s: any) => {
        const mock = s.integrations.find((i: any) => i.name === 'Payments' && /MOCK/i.test(i.note));
        return (
          <>
            {mock && <div className="test-only" role="alert">TEST MODE ONLY. Payments are using the development mock provider: no real money can be taken and no real refunds are sent. Do not launch like this.</div>}
            <Card><h3>Health checks</h3>
              {s.checks.map((c: any) => <div key={c.name} className="row" style={{ marginBottom: 6 }}><span className={c.ok ? 'ok-dot' : 'bad-dot'} aria-hidden="true" /><strong>{c.name}</strong><span className="muted small">{c.ok ? 'OK' : 'Needs attention'} · {c.detail}</span></div>)}
              <p className="small muted">Database time: {fmtDate(s.database.time)}{s.last_payment_event_at ? ` · last payment event ${fmtDate(s.last_payment_event_at)}` : ''}</p>
            </Card>
            <Card><h3>Integrations</h3>
              <DataTable rows={s.integrations} rowKey={(i: any) => i.name} columns={[{ key: 'n', header: 'Integration', render: (i: any) => <strong>{i.name}</strong> }, { key: 'c', header: 'State', render: (i: any) => (i.configured ? <Badge tone="ok">Configured</Badge> : <Badge tone="warn">Not configured</Badge>) }, { key: 'note', header: 'Note' }]} />
            </Card>
            <Card><h3>Recent server errors ({s.errors_24h} in the last 24 hours)</h3>
              <DataTable rows={s.recent_errors} rowKey={(e: any) => String(e.id)} empty="No errors logged." columns={[{ key: 'at', header: 'When', render: (e: any) => fmtDate(e.created_at) }, { key: 'm', header: 'Request', render: (e: any) => `${e.method} ${e.url}` }, { key: 'msg', header: 'Message', render: (e: any) => <span className="small">{e.message}</span> }]} />
            </Card>
          </>
        );
      }}</Fetch>
    </Need>
  );
}

function Audit() {
  const [type, setType] = useState('');
  const [action, setAction] = useState('');
  const qs = new URLSearchParams({ ...(type ? { entity_type: type } : {}), ...(action ? { action } : {}) }).toString();
  return (
    <Need perm={['audit.view']} what="the audit log">
      <div className="filters-row">
        <Field label="Entity"><Select value={type} onChange={(e) => setType(e.target.value)}><option value="">All</option>{['vendor', 'store', 'product', 'refund', 'payout', 'setting', 'user', 'coupon', 'ad_campaign', 'driver', 'delivery', 'zone', 'region', 'collection', 'page', 'template', 'recipe', 'ticket', 'content'].map((t) => <option key={t} value={t}>{t}</option>)}</Select></Field>
        <Field label="Action starts with"><Input value={action} onChange={(e) => setAction(e.target.value)} placeholder="e.g. setting" /></Field>
      </div>
      <Notice tone="info">The audit log is append-only. It records who did what and when for every consequential action.</Notice>
      <Fetch path={`/admin/audit${qs ? `?${qs}` : ''}`}>{(rows: any[]) => (
        <DataTable rows={rows} rowKey={(r) => String(r.id)} empty="Nothing recorded for this filter."
          columns={[{ key: 'at', header: 'When', render: (r) => fmtDate(r.created_at) }, { key: 'who', header: 'Who', render: (r) => r.actor ?? 'System' }, { key: 'a', header: 'Action', render: (r) => <strong>{r.action}</strong> },
            { key: 'e', header: 'Entity', render: (r) => <span className="small">{r.entity_type} {String(r.entity_id).slice(0, 8)}</span> }, { key: 'd', header: 'Detail', render: (r) => (Object.keys(r.detail ?? {}).length ? <div className="json">{JSON.stringify(r.detail)}</div> : '') }]} />
      )}</Fetch>
    </Need>
  );
}
