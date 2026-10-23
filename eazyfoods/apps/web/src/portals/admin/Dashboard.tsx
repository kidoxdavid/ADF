import { Link } from 'react-router-dom';
import { Card, Notice, PageHeader, Stat } from '../../ui';
import { cents, Fetch, useCan, Why } from './common';
import { fmtDate } from '../../api';

function Queue({ title, count, to, children }: { title: string; count: number; to?: string; children?: React.ReactNode }) {
  return (
    <Card>
      <div className="row between"><h3 style={{ margin: 0 }}>{title}</h3><span className={`badge ${count ? 'warn' : 'ok'}`}>{count}</span></div>
      {count === 0 ? <p className="muted small">Nothing waiting.</p> : <div className="stack" style={{ marginTop: 8 }}>{children}</div>}
      {to && count > 0 && <p style={{ marginBottom: 0 }}><Link to={to}>Open</Link></p>}
    </Card>
  );
}

export function Dashboard() {
  const can = useCan();
  return (
    <>
      <PageHeader title="Operations" sub="What needs attention right now." />
      {can('orders.view', 'dispatch.manage', 'support.manage') && (
        <Fetch path="/admin/exceptions">{(e: any) => (
          <div className="grid cols-2">
            <Queue title="Orders the store has not accepted" count={e.unaccepted_orders.length} to="/admin/orders">
              {e.unaccepted_orders.slice(0, 5).map((o: any) => <div key={o.id} className="small"><strong>{o.order_number}</strong> · {o.store_name} · {fmtDate(o.placed_at)}</div>)}
            </Queue>
            <Queue title="Deliveries without a driver" count={e.unassigned_deliveries.length} to="/admin/dispatch">
              {e.unassigned_deliveries.slice(0, 5).map((d: any) => <div key={d.id} className="small"><strong>{d.order_number}</strong> · waiting since {fmtDate(d.created_at)}</div>)}
            </Queue>
            <Queue title="Failed deliveries" count={e.failed_deliveries.length} to="/admin/dispatch">
              {e.failed_deliveries.slice(0, 5).map((d: any) => <div key={d.id} className="small"><strong>{d.order_number}</strong> · {d.completion_note}</div>)}
            </Queue>
            <Queue title="Open support tickets" count={e.open_tickets.length} to="/admin/support">
              {e.open_tickets.slice(0, 5).map((t: any) => <div key={t.id} className="small"><Link to={`/admin/support/${t.id}`}>{t.subject}</Link></div>)}
            </Queue>
            <Queue title="Refunds waiting or failed" count={e.refunds_waiting.length} to="/admin/refunds">
              {e.refunds_waiting.slice(0, 5).map((r: any) => <div key={r.id} className="small"><strong>{r.order_number}</strong> · {cents(r.amount_cents)} · {r.reason}</div>)}
            </Queue>
            <Queue title="Payment anomalies" count={e.payment_anomalies.length} to="/admin/system">
              {e.payment_anomalies.slice(0, 5).map((p: any, i: number) => <div key={i} className="small">{p.outcome.replace(/_/g, ' ')} · {fmtDate(p.received_at)}</div>)}
            </Queue>
          </div>
        )}</Fetch>
      )}
      {can('reports.view') && (
        <>
          <h2>Last 30 days</h2>
          <Fetch path="/admin/reports/kpis">{(k: any) => (
            <>
              <div className="grid cols-4">
                <Stat label="Paid orders" value={k.marketplace.orders} />
                <Stat label="GMV" value={cents(k.marketplace.gmv_cents)} sub="merchandise, before refunds" />
                <Stat label="Avg order value" value={k.marketplace.aov_cents != null ? cents(k.marketplace.aov_cents) : '—'} />
                <Stat label="Gross marketplace revenue" value={cents(k.marketplace.gross_marketplace_revenue_cents)} sub="before costs" />
              </div>
              <Notice tone="warn">{k.data_caveat} <Link to="/admin/reports">Definitions and more</Link></Notice>
              <Why>{k.definitions.gross_marketplace_revenue}</Why>
            </>
          )}</Fetch>
        </>
      )}
      {!can('orders.view', 'dispatch.manage', 'support.manage', 'reports.view') && (
        <Card><p>Use the menu to open the areas your role can manage.</p></Card>
      )}
    </>
  );
}
