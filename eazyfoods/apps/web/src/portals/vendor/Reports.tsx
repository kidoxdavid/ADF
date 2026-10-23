import { Fragment } from 'react';
import { useState } from 'react';
import { fmtDate, money } from '../../api';
import { useApi } from '../../hooks';
import { Button, Card, DataTable, ErrorBox, Field, Input, Loading, Notice, PageHeader, Stat, StatusBadge } from '../../ui';

type Row = { order_number: string; store: string; placed_at: string; status: string; gross_cents: number; discount_cents: number; tax_collected_cents: number; commission_cents: number; refunds_charged_cents: number; net_settlement_cents: number; payout_state: string };
type R = { rows: Row[]; totals: { gross_cents: number; discounts_cents: number; tax_collected_cents: number; commission_cents: number; refunds_charged_cents: number; net_settlement_cents: number; orders: number }; definitions: Record<string, string> };

export default function Reports() {
  const [from, setFrom] = useState(''); const [to, setTo] = useState('');
  const qs = new URLSearchParams(); if (from) qs.set('from', from); if (to) qs.set('to', to);
  const { data, loading, error, reload } = useApi<R>(`/vendor/reports/settlement?${qs}`);
  const csv = `/api/vendor/reports/settlement?format=csv&${qs}`;
  return (<>
    <PageHeader title="Settlement report" sub="Every order, from gross sales to what you earn." actions={<a className="btn secondary sm" href={csv}>Download CSV</a>} />
    <Notice tone="warn">Gross sales are not profit. Your costs (stock, rent, wages) are not included here.</Notice>
    <Card><div className="form-grid"><Field label="From"><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field><Field label="To"><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field></div>
      <div className="row"><Button variant="ghost" size="sm" onClick={() => { setFrom(''); setTo(''); }}>Last 30 days</Button></div></Card>
    {loading && !data ? <Loading /> : error ? <ErrorBox message={error} retry={reload} /> : data && <>
      <div className="grid cols-3">
        <Stat label="Gross sales" value={money(data.totals.gross_cents)} sub={`${data.totals.orders} orders`} /><Stat label="Commission" value={`− ${money(data.totals.commission_cents)}`} />
        <Stat label="Refunds charged to you" value={`− ${money(data.totals.refunds_charged_cents)}`} /><Stat label="Net settlement" value={money(data.totals.net_settlement_cents)} />
        <Stat label="Discounts (paid by EAZyfoods)" value={money(data.totals.discounts_cents)} /><Stat label="GST collected" value={money(data.totals.tax_collected_cents)} /></div>
      <details style={{ margin: '12px 0' }}><summary>Definitions</summary><dl className="facts" style={{ marginTop: 8 }}>{Object.entries(data.definitions).map(([k, v]) => <Fragment key={k}><dt>{k.replace(/_/g, ' ')}</dt><dd>{v}</dd></Fragment>)}</dl></details>
      <DataTable rows={data.rows} rowKey={(r) => r.order_number} empty="No orders in this period." columns={[
        { key: 'o', header: 'Order', render: (r) => <strong>#{r.order_number}</strong> }, { key: 'w', header: 'Placed', render: (r) => fmtDate(r.placed_at) }, { key: 's', header: 'Status', render: (r) => <StatusBadge status={r.status} /> },
        { key: 'g', header: 'Gross', render: (r) => money(r.gross_cents) }, { key: 'c', header: 'Commission', render: (r) => money(r.commission_cents) }, { key: 'r', header: 'Refunds', render: (r) => money(r.refunds_charged_cents) },
        { key: 'n', header: 'Net', render: (r) => <strong>{money(r.net_settlement_cents)}</strong> }, { key: 'p', header: 'Payout', render: (r) => r.payout_state }]} /></>}
  </>);
}
