import { useState } from 'react';
import { Card, Field, Input, Notice, PageHeader, Stat, Tabs } from '../../ui';
import { DataTable, Fetch, Need, Why, cents } from './common';

const pct = (v: number | null | undefined) => (v == null ? '—' : `${v}%`);

function Range({ from, to, set }: { from: string; to: string; set: (f: string, t: string) => void }) {
  return (
    <div className="filters-row"><Field label="From"><Input type="date" value={from} onChange={(e) => set(e.target.value, to)} /></Field><Field label="To"><Input type="date" value={to} onChange={(e) => set(from, e.target.value)} /></Field></div>
  );
}

export function Reports() {
  const [tab, setTab] = useState('kpis');
  const [r, setR] = useState({ from: '', to: '' });
  const qs = new URLSearchParams({ ...(r.from ? { from: r.from } : {}), ...(r.to ? { to: r.to } : {}) }).toString();
  return (
    <Need perm={['reports.view']} what="reports">
      <PageHeader title="Reports" sub="Every number comes from real orders and events in this database. Definitions are shown next to each figure." />
      <Tabs value={tab} onChange={setTab} tabs={[{ id: 'kpis', label: 'Marketplace KPIs' }, { id: 'sales', label: 'Sales breakdown' }, { id: 'search', label: 'Search demand' }]} />
      <Range from={r.from} to={r.to} set={(from, to) => setR({ from, to })} />
      {tab === 'kpis' && (
        <Fetch path={`/admin/reports/kpis?${qs}`}>{(k: any) => {
          const d = k.definitions; const m = k.marketplace;
          const K = ({ label, value, def, sub }: { label: string; value: string | number; def: string; sub?: string }) => <div className="kpi"><Stat label={label} value={value} sub={sub} /><Why>{def}</Why></div>;
          return (
            <>
              <Notice tone="warn">{k.data_caveat} Period: {k.period.from} to {k.period.to}.</Notice>
              <h2>Marketplace</h2>
              <div className="grid cols-4">
                <K label="Paid orders" value={m.orders} def={d.orders} /><K label="GMV" value={cents(m.gmv_cents)} def={d.gmv} /><K label="Net GMV" value={cents(m.net_gmv_cents)} def={d.net_gmv} />
                <K label="Average order value" value={m.aov_cents == null ? '—' : cents(m.aov_cents)} def={d.aov} />
                <K label="Gross marketplace revenue" value={cents(m.gross_marketplace_revenue_cents)} def={d.gross_marketplace_revenue} />
                <K label="Net marketplace revenue" value={cents(m.net_marketplace_revenue_cents)} def={d.net_marketplace_revenue} sub="before payment-processing fees" />
                <K label="Refund rate" value={pct(m.refund_rate_pct)} def={d.refund_rate} /><K label="Cancellation rate" value={pct(m.cancellation_rate_pct)} def={d.cancellation_rate} />
                <K label="Avg fulfilment time" value={m.avg_fulfilment_minutes == null ? '—' : `${m.avg_fulfilment_minutes} min`} def={d.avg_fulfilment_minutes} />
                <K label="On-time delivery" value={pct(m.on_time_delivery_rate_pct)} def={d.on_time_delivery_rate} /><K label="Out-of-stock rate" value={pct(m.out_of_stock_rate_pct)} def={d.out_of_stock_rate} />
              </div>
              <h2>Customers and vendors</h2>
              <div className="grid cols-4">
                <K label="Repeat purchase rate" value={pct(k.customers.repeat_purchase_rate_pct)} def={d.repeat_purchase_rate} sub={`${k.customers.customers_in_period} customers in period`} />
                <K label="30-day customer retention" value={pct(k.customers.retention_30d_pct)} def={d.retention_30d} />
                <K label="Vendor activation" value={pct(k.vendors.activation_rate_pct)} def={d.vendor_activation_rate} sub={`${k.vendors.approved} approved vendors`} /><K label="30-day vendor retention" value={pct(k.vendors.retention_30d_pct)} def={d.vendor_retention_30d} />
              </div>
              <h2>Funnel</h2>
              <p className="small muted">{d.funnel}</p>
              <div className="grid cols-4">
                <Stat label="Viewed a product" value={k.funnel.viewed} /><Stat label="Added to basket" value={k.funnel.added} sub={`${pct(k.funnel.view_to_cart_pct)} of viewers`} />
                <Stat label="Started checkout" value={k.funnel.checkout} sub={`${pct(k.funnel.cart_to_checkout_pct)} of adders`} /><Stat label="Paid" value={k.funnel.paid} sub={`${pct(k.funnel.checkout_to_paid_pct)} of checkouts`} />
                <Stat label="Overall conversion" value={pct(k.funnel.overall_conversion_pct)} sub="paid ÷ viewers" />
              </div>
            </>
          );
        }}</Fetch>
      )}
      {tab === 'sales' && (
        <Fetch path={`/admin/reports/sales?${qs}`}>{(s: any) => (
          <>
            <div className="grid cols-3"><Stat label="Orders per active store" value={s.orders_per_active_store ?? '—'} />
              <Stat label="Pipeline → launched" value={pct(s.vendor_pipeline.prospect_to_launch_pct)} sub={`${s.vendor_pipeline.total} prospects`} /><Stat label="Avg days first contact → launch" value={s.vendor_pipeline.avg_days_first_contact_to_launch ?? '—'} /></div>
            <div className="grid cols-2">
              <Card><h3>By region (culinary tradition)</h3><DataTable rows={s.by_region} rowKey={(r: any) => r.region} empty="No sales in this period." columns={[{ key: 'region', header: 'Region' }, { key: 'g', header: 'GMV', render: (r: any) => cents(r.gmv_cents) }]} /></Card>
              <Card><h3>By category</h3><DataTable rows={s.by_category} rowKey={(r: any) => r.category} empty="No sales in this period." columns={[{ key: 'category', header: 'Category' }, { key: 'g', header: 'GMV', render: (r: any) => cents(r.gmv_cents) }]} /></Card>
            </div>
            <Card><h3>By store</h3><DataTable rows={s.by_store} rowKey={(r: any) => r.store} empty="No sales in this period." columns={[{ key: 'store', header: 'Store' }, { key: 'orders', header: 'Orders' }, { key: 'g', header: 'GMV', render: (r: any) => cents(r.gmv_cents) }]} /></Card>
            <Card><h3>Coupons</h3><DataTable rows={s.promotions} rowKey={(r: any) => r.code} empty="No coupons." columns={[{ key: 'code', header: 'Code' }, { key: 'orders', header: 'Orders' }, { key: 'd', header: 'Discount cost', render: (r: any) => cents(r.discount_cost_cents) }, { key: 'm', header: 'Merchandise on those orders', render: (r: any) => cents(r.merchandise_cents) }]} /></Card>
            <Card><h3>Sponsored placements (measured)</h3><p>{s.sponsored.impressions} impressions · {s.sponsored.clicks} clicks · click-through {pct(s.sponsored.ctr_pct)}</p><p className="small muted">We only report what we counted. We do not attribute sales to advertising.</p></Card>
            <Card><h3>Vendor pipeline by stage</h3><div className="row wrap">{Object.entries(s.vendor_pipeline.by_stage).map(([k, v]) => <span key={k} className="badge info">{k}: {String(v)}</span>)}</div></Card>
          </>
        )}</Fetch>
      )}
      {tab === 'search' && (
        <Fetch path={`/admin/reports/search-demand?${qs}`}>{(s: any) => (
          <>
            <div className="grid cols-3"><Stat label="Searches" value={s.searches} /><Stat label="With no results" value={s.zero_result_searches} /><Stat label="No-result rate" value={pct(s.zero_result_rate_pct)} /></div>
            <h2>What shoppers wanted but could not find</h2>
            <p className="small muted">Top queries with zero results. Use them to add products, spellings and verified aliases.</p>
            <DataTable rows={s.unmet_queries} rowKey={(q: any) => q.query} empty="No unmet searches in this period." columns={[{ key: 'query', header: 'Search', render: (q: any) => <strong>{q.query}</strong> }, { key: 'searches', header: 'Times searched' }]} />
          </>
        )}</Fetch>
      )}
    </Need>
  );
}
