import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { fmtDate } from '../../api';
import { useAction } from '../../hooks';
import { useToast } from '../../toast';
import { Badge, Button, Card, Field, Input, Modal, Notice, PageHeader, StatusBadge, Textarea } from '../../ui';
import { DataTable, Fetch, Need, cents, post, useCan } from './common';

export function Orders() {
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [applied, setApplied] = useState({ q: '', status: '' });
  const path = `/admin/orders?${new URLSearchParams({ ...(applied.q ? { q: applied.q } : {}), ...(applied.status ? { status: applied.status } : {}) })}`;
  return (
    <Need perm={['orders.view']} what="viewing orders">
      <PageHeader title="Orders" sub="Search by order number or customer email." />
      <form className="filters-row" onSubmit={(e) => { e.preventDefault(); setApplied({ q, status }); }}>
        <Field label="Order number or email"><Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="EZ-… or name@email" /></Field>
        <Field label="Status"><select className="input" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All</option>{['pending_payment', 'placed', 'completed', 'cancelled', 'payment_failed', 'expired'].map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}</select></Field>
        <Button type="submit">Search</Button>
      </form>
      <Fetch path={path}>{(rows: any[]) => (
        <DataTable rows={rows} rowKey={(r) => r.id} onRowClick={(r) => nav(`/admin/orders/${r.id}`)} empty="No orders match."
          columns={[
            { key: 'n', header: 'Order', render: (r) => <strong>{r.order_number}</strong> }, { key: 'at', header: 'Created', render: (r) => fmtDate(r.created_at) },
            { key: 'c', header: 'Customer', render: (r) => r.customer_email }, { key: 's', header: 'Status', render: (r) => <StatusBadge status={r.status} /> },
            { key: 'p', header: 'Payment', render: (r) => <StatusBadge status={r.payment_status} /> }, { key: 't', header: 'Total', render: (r) => cents(r.total_cents) }, { key: 'st', header: 'Stores', render: (r) => <span className="small">{r.stores}</span> },
          ]} />
      )}</Fetch>
    </Need>
  );
}

export function OrderDetail() {
  const { id } = useParams();
  const can = useCan();
  const toast = useToast();
  const [cancelSub, setCancelSub] = useState<any | null>(null);
  const [reason, setReason] = useState('');
  const [refundSub, setRefundSub] = useState<any | null>(null);
  const [qtys, setQtys] = useState<Record<string, number>>({});
  const [withDelivery, setWithDelivery] = useState(false);
  const [vendorFunded, setVendorFunded] = useState(true);
  const [rReason, setRReason] = useState('');
  const [result, setResult] = useState<string>();

  const cancel = useAction(async (reload: () => void) => { await post(`/admin/suborders/${cancelSub.id}/cancel`, { reason }); toast('Suborder cancelled. A full refund is on its way.'); setCancelSub(null); reload(); });
  const refund = useAction(async (reload: () => void) => {
    const lines = Object.entries(qtys).filter(([, q]) => q > 0).map(([line_id, quantity]) => ({ line_id, quantity }));
    const r = await post(`/admin/suborders/${refundSub.id}/refunds`, { lines, include_delivery: withDelivery, reason: rReason, vendor_funded: vendorFunded });
    setResult(`Refund of $${(r.amount_cents / 100).toFixed(2)} requested. ${can('refunds.approve') ? 'Approve it in Refunds.' : 'A finance user must approve it.'}`);
    setRefundSub(null);
    reload();
  });

  return (
    <Need perm={['orders.view']} what="viewing orders">
      <Fetch path={`/admin/orders/${id}`}>{(o: any, reload) => (
        <>
          <PageHeader title={o.order_number} sub={<><StatusBadge status={o.status} /> <StatusBadge status={o.payment_status} /> · <Link to="/admin/orders">All orders</Link></>} />
          {result && <Notice tone="ok">{result}</Notice>}
          <div className="grid cols-2">
            <Card><h3>Customer</h3><dl className="kv"><dt>Name</dt><dd>{o.customer_name}</dd><dt>Email</dt><dd>{o.customer_email?.customer_email}</dd><dt>Phone</dt><dd>{o.customer_email?.customer_phone ?? '—'}</dd>
              <dt>Method</dt><dd>{o.fulfilment_method}</dd><dt>Address</dt><dd>{o.address ? `${o.address.line1}${o.address.line2 ? ', ' + o.address.line2 : ''}, ${o.address.city} ${o.address.postal_code}` : '—'}</dd>
              <dt>Instructions</dt><dd>{o.delivery_instructions || '—'}</dd></dl></Card>
            <Card><h3>Money</h3><dl className="kv"><dt>Subtotal</dt><dd>{cents(o.subtotal_cents)}</dd><dt>Discount</dt><dd>{cents(o.discount_cents)}</dd><dt>Delivery</dt><dd>{cents(o.delivery_cents)}</dd><dt>Tax</dt><dd>{cents(o.tax_cents)}</dd><dt>Total</dt><dd><strong>{cents(o.total_cents)}</strong></dd></dl>
              <h3 style={{ marginTop: 12 }}>Payments</h3>
              {o.payments.map((p: any, i: number) => <div key={i} className="small"><StatusBadge status={p.status} /> {cents(p.amount_cents)} · {p.provider} · <code>{p.provider_payment_id}</code>{p.failure_message ? ` · ${p.failure_message}` : ''}</div>)}
              {!o.payments.length && <p className="muted small">No payment recorded.</p>}
            </Card>
          </div>
          {o.suborders.map((s: any) => (
            <Card key={s.id}>
              <div className="row between wrap"><h3 style={{ margin: 0 }}>{s.store_name} <StatusBadge status={s.status} /></h3><span className="small muted">{s.fulfilment_method}{s.delivery_status ? ` · delivery ${s.delivery_status.replace(/_/g, ' ')}` : ''}{s.promised_at ? ` · promised ${fmtDate(s.promised_at)}` : ''}</span></div>
              {s.reject_reason && <Notice tone="warn">Reason: {s.reject_reason}</Notice>}
              <DataTable rows={s.lines} rowKey={(l: any) => l.id} columns={[
                { key: 'n', header: 'Item', render: (l: any) => <>{l.name}{l.brand ? ` · ${l.brand}` : ''}{l.substitution_status !== 'none' && <> <Badge tone="info">sub {l.substitution_status}{l.substitute_name ? `: ${l.substitute_name}` : ''}</Badge></>}</> },
                { key: 'q', header: 'Qty', render: (l: any) => `${l.quantity}${l.refunded_quantity ? ` (${l.refunded_quantity} refunded)` : ''}` }, { key: 'u', header: 'Unit', render: (l: any) => cents(l.unit_price_cents) }, { key: 't', header: 'Line', render: (l: any) => cents(l.line_total_cents) }]} />
              <p className="small">Subtotal {cents(s.subtotal_cents)} · discount {cents(s.discount_cents)} · delivery {cents(s.delivery_cents)} · tax {cents(s.tax_cents)} · <strong>total {cents(s.total_cents)}</strong></p>
              <h3 style={{ fontSize: '.95rem' }}>Timeline</h3>
              <ul className="timeline">{s.timeline.map((t: any, i: number) => <li key={i}><strong>{t.status.replace(/_/g, ' ')}</strong> <span className="small muted">{fmtDate(t.at)}{t.note ? ` · ${t.note}` : ''}</span></li>)}</ul>
              {s.refunds.length > 0 && <><h3 style={{ fontSize: '.95rem' }}>Refunds</h3>{s.refunds.map((r: any, i: number) => <div key={i} className="small"><StatusBadge status={r.status} /> {cents(r.amount_cents)} · {r.reason}</div>)}</>}
              <div className="row wrap" style={{ marginTop: 10 }}>
                {can('refunds.request') && ['placed', 'accepted', 'preparing', 'ready', 'out_for_delivery', 'delivered', 'collected'].includes(s.status) && <Button variant="secondary" size="sm" onClick={() => { setRefundSub(s); setQtys({}); setWithDelivery(false); setVendorFunded(true); setRReason(''); setResult(undefined); }}>Raise a refund</Button>}
                {can('orders.manage') && ['placed', 'accepted', 'preparing', 'ready', 'out_for_delivery'].includes(s.status) && <Button variant="danger" size="sm" onClick={() => { setCancelSub(s); setReason(''); }}>Cancel with full refund</Button>}
              </div>
            </Card>
          ))}
          <Card><h3>Order history</h3><ul className="timeline">{o.timeline.map((t: any, i: number) => <li key={i}><strong>{t.status.replace(/_/g, ' ')}</strong> <span className="small muted">{fmtDate(t.at)}{t.note ? ` · ${t.note}` : ''}</span></li>)}</ul></Card>

          <Modal open={!!cancelSub} onClose={() => setCancelSub(null)} title={`Cancel ${cancelSub?.store_name ?? ''}`}>
            <Notice tone="warn">This cancels the store’s part of the order and refunds everything the customer paid for it, including delivery. It cannot be undone.</Notice>
            {cancel.error && <Notice tone="error">{cancel.error}</Notice>}
            <Field label="Reason (recorded and shown to the customer)"><Textarea value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
            <div className="row end"><Button variant="ghost" onClick={() => setCancelSub(null)}>Keep order</Button><Button variant="danger" busy={cancel.busy} disabled={reason.length < 3} onClick={() => cancel.run(reload)}>Cancel and refund</Button></div>
          </Modal>
          <Modal open={!!refundSub} onClose={() => setRefundSub(null)} title={`Refund: ${refundSub?.store_name ?? ''}`}>
            {refund.error && <Notice tone="error">{refund.error}</Notice>}
            <p className="small muted">Pick what to refund. The system works out the exact amount (including tax and any discount share) and returns it for finance to approve.</p>
            {refundSub?.lines.map((l: any) => { const max = l.quantity - l.refunded_quantity; return (
              <div key={l.id} className="row between" style={{ marginBottom: 8 }}><span>{l.name} <span className="small muted">({max} refundable)</span></span>
                <Input style={{ width: 80 }} type="number" min={0} max={max} disabled={max <= 0} value={qtys[l.id] ?? 0} onChange={(e) => setQtys((s) => ({ ...s, [l.id]: Math.max(0, Math.min(max, Number(e.target.value))) }))} aria-label={`Quantity of ${l.name} to refund`} /></div>); })}
            {refundSub?.delivery_cents > 0 && <label className="check"><input type="checkbox" checked={withDelivery} onChange={(e) => setWithDelivery(e.target.checked)} />Also refund the delivery fee</label>}
            <label className="check"><input type="checkbox" checked={vendorFunded} onChange={(e) => setVendorFunded(e.target.checked)} />The store pays for this (untick if our fault, e.g. late delivery: the store keeps its earnings)</label>
            <Field label="Reason"><Textarea value={rReason} onChange={(e) => setRReason(e.target.value)} /></Field>
            <div className="row end"><Button variant="ghost" onClick={() => setRefundSub(null)}>Close</Button>
              <Button busy={refund.busy} disabled={rReason.length < 3 || (!withDelivery && !Object.values(qtys).some((q) => q > 0))} onClick={() => refund.run(reload)}>Request refund</Button></div>
          </Modal>
        </>
      )}</Fetch>
    </Need>
  );
}
