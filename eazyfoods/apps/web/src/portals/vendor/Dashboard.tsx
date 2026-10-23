import { Fragment } from 'react';
import { Link } from 'react-router-dom';
import { money } from '../../api';
import { useApi } from '../../hooks';
import { DataTable, ErrorBox, Loading, Notice, PageHeader, Stat, Card } from '../../ui';
import { StoreSelect, useVendor } from './Shared';

type D = {
  today: { orders: number; gross_cents: number }; pending: { pending: number; needs_attention: number }; trend: { day: string; orders: number; gross_cents: number }[];
  best_sellers: { name: string; units: number; gross_cents: number }[]; low_stock: { name: string; store: string; available: number; low_stock_threshold: number }[]; out_of_stock: { name: string; store: string }[];
  cancellations: { cancelled_30d: number; refunded_cents_30d: number; orders_30d: number }; active_promotions: number; balance: { owed_to_you_cents: number };
  last_30_days: { gross_cents: number; discounts_cents: number; tax_collected_cents: number; commission_cents: number; refunds_charged_cents: number; orders: number; net_settlement_cents: number; note: string; definitions: Record<string, string> };
};

export default function Dashboard() {
  const { storeId } = useVendor();
  const { data: d, loading, error, reload } = useApi<D>(`/vendor/dashboard?store=${storeId}`);
  if (loading && !d) return <Loading />;
  if (error) return <ErrorBox message={error} retry={reload} />;
  if (!d) return null;
  const max = Math.max(1, ...d.trend.map((t) => t.gross_cents));
  const s = d.last_30_days;
  return (
    <>
      <PageHeader title="Dashboard" sub="How your store is doing" />
      <StoreSelect />
      {d.pending.needs_attention > 0 && <Notice tone="error"><strong>{d.pending.needs_attention} order{d.pending.needs_attention > 1 ? 's are' : ' is'} waiting too long.</strong> Accept or reject {d.pending.needs_attention > 1 ? 'them' : 'it'} now, or the customer may be refunded automatically. <Link to="orders">Open orders</Link></Notice>}
      <div className="grid cols-4">
        <Stat label="Orders today" value={d.today.orders} sub={`${money(d.today.gross_cents)} gross sales`} />
        <Stat label="New orders to answer" value={d.pending.pending} sub={d.pending.needs_attention ? `${d.pending.needs_attention} needing attention` : 'None overdue'} />
        <Stat label="Owed to you" value={money(d.balance.owed_to_you_cents)} sub="Earnings not yet paid out" />
        <Stat label="Active promotions" value={d.active_promotions} />
      </div>
      <Card>
        <h2>Last 14 days: gross sales</h2>
        <div className="bars" role="img" aria-label="Gross sales per day for the last 14 days">
          {d.trend.map((t) => <div key={t.day} className="bar-col" title={`${t.day}: ${money(t.gross_cents)}, ${t.orders} order(s)`}><div className={`bar-fill ${t.gross_cents ? '' : 'zero'}`} style={{ height: `${Math.max(2, (t.gross_cents / max) * 100)}%` }} /></div>)}
        </div>
        <div className="bars-labels" aria-hidden="true">{d.trend.map((t) => <span key={t.day}>{t.day.slice(8)}</span>)}</div>
        <p className="muted small">Gross sales are the item value of orders before commission and refunds.</p>
      </Card>
      <Card>
        <h2>Last 30 days: from gross sales to net</h2>
        <Notice tone="warn">{s.note}</Notice>
        <div className="grid cols-3">
          <Stat label="Gross sales" value={money(s.gross_cents)} sub={`${s.orders} orders`} />
          <Stat label="Commission" value={`− ${money(s.commission_cents)}`} sub="Charged by EAZyfoods" />
          <Stat label="Refunds charged to you" value={`− ${money(s.refunds_charged_cents)}`} />
          <Stat label="Net settlement" value={money(s.net_settlement_cents)} sub="Gross − commission − refunds" />
          <Stat label="Discounts (paid by EAZyfoods)" value={money(s.discounts_cents)} sub="Do not reduce your earnings" />
          <Stat label="GST collected" value={money(s.tax_collected_cents)} sub="Collected from customers; not income" />
        </div>
        <details style={{ marginTop: 10 }}><summary>What do these mean?</summary><dl className="facts" style={{ marginTop: 8 }}>{Object.entries(s.definitions).map(([k, v]) => <Fragment key={k}><dt>{k.replace(/_/g, ' ')}</dt><dd>{v}</dd></Fragment>)}</dl></details>
      </Card>
      <div className="grid cols-2">
        <Card><h2>Best sellers (30 days)</h2>
          <DataTable rows={d.best_sellers} rowKey={(r) => r.name} empty="No sales yet." columns={[{ key: 'name', header: 'Product' }, { key: 'units', header: 'Units' }, { key: 'g', header: 'Gross', render: (r) => money(r.gross_cents) }]} /></Card>
        <Card><h2>Cancellations and refunds (30 days)</h2>
          <div className="grid cols-2"><Stat label="Rejected / cancelled" value={d.cancellations.cancelled_30d} sub={`of ${d.cancellations.orders_30d} orders`} /><Stat label="Refunded to customers" value={money(d.cancellations.refunded_cents_30d)} /></div></Card>
        <Card><h2>Low stock</h2>
          <DataTable rows={d.low_stock} rowKey={(r) => r.name + r.store} empty="Nothing is running low." columns={[{ key: 'name', header: 'Product' }, { key: 'available', header: 'Available' }, { key: 'low_stock_threshold', header: 'Alert at' }]} /></Card>
        <Card><h2>Out of stock</h2>
          <DataTable rows={d.out_of_stock} rowKey={(r) => r.name + r.store} empty="Nothing is out of stock." columns={[{ key: 'name', header: 'Product' }, { key: 'store', header: 'Store' }]} />
          <Link to="inventory">Manage inventory</Link></Card>
      </div>
    </>
  );
}
