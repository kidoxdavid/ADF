import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { fmtDate, money, packLabel, post } from '../api';
import { useAction, useApi } from '../hooks';
import { useCart } from '../cart';
import { useToast } from '../toast';
import { Badge, Button, Confirm, Empty, ErrorBox, Field, Loading, Modal, Notice, Select, StatusBadge, Textarea } from '../ui';
import { PaymentStep } from './Checkout';

export function OrdersPage() {
  const { data, loading, error, reload } = useApi<{ id: string; order_number: string; status: string; payment_status: string; total_cents: number; created_at: string; fulfilment_method: string; stores: { store: string; status: string }[] | null }[]>('/orders');
  if (loading) return <Loading />;
  if (error) return <ErrorBox message={error} retry={reload} />;
  return (
    <>
      <h1>Your orders</h1>
      {!data?.length && <Empty title="No orders yet"><Link to="/search" className="btn primary">Start shopping</Link></Empty>}
      {data?.map((o) => (
        <Link key={o.id} to={`/orders/${o.id}`} className="panel" style={{ display: 'block', textDecoration: 'none', color: 'inherit' }}>
          <div className="row between"><strong>{o.order_number}</strong><StatusBadge status={o.status === 'placed' ? (o.stores?.[0]?.status ?? 'placed') : o.status} /></div>
          <div className="muted small">{fmtDate(o.created_at)} · {o.fulfilment_method === 'pickup' ? 'Pickup' : 'Delivery'} · {money(o.total_cents)}</div>
          <div className="small">{o.stores?.map((s) => s.store).join(', ')}</div>
        </Link>
      ))}
    </>
  );
}

const STEPS_DELIVERY = ['placed', 'accepted', 'preparing', 'ready', 'out_for_delivery', 'delivered'];
const STEPS_PICKUP = ['placed', 'accepted', 'preparing', 'ready', 'collected'];
const LABEL: Record<string, string> = { placed: 'Order placed', accepted: 'Store accepted', preparing: 'Preparing', ready: 'Ready', out_for_delivery: 'Out for delivery', delivered: 'Delivered', collected: 'Collected', rejected: 'Rejected by the store', cancelled: 'Cancelled', substitution_proposed: 'Replacement suggested', substitution_approved: 'Replacement accepted', substitution_declined: 'Replacement declined', item_unavailable: 'Item unavailable' };

type Sub = {
  id: string; store_name: string; store_slug: string; store_phone: string | null; status: string; fulfilment_method: string; subtotal_cents: number; discount_cents: number; delivery_cents: number; tax_cents: number; total_cents: number;
  promised_at: string | null; reject_reason: string | null; handover_code?: string; pickup_address?: string; reviewed_store: boolean;
  lines: { id: string; product_id: string; product_slug: string; name: string; brand: string | null; pack_label: string | null; quantity: number; unit_price_cents: number; line_total_cents: number; refunded_quantity: number; substitution_status: string; substitute_name: string | null; reviewed: boolean }[];
  timeline: { status: string; note: string | null; at: string }[]; refunds: { status: string; amount_cents: number; reason: string }[];
};
type Order = { id: string; order_number: string; status: string; payment_status: string; fulfilment_method: string; address: any; subtotal_cents: number; discount_cents: number; delivery_cents: number; tax_cents: number; total_cents: number; placed_at: string | null; created_at: string; suborders: Sub[] };

export function OrderPage() {
  const { id } = useParams();
  const { data: o, loading, error, reload } = useApi<Order>(`/orders/${id}`);
  const pay = useApi<{ payable: boolean; client_secret: string | null }>(o?.status === 'pending_payment' ? `/orders/${id}/payment` : null);
  const cfg = useApi<{ payment_provider: 'mock' | 'stripe'; stripe_publishable_key: string | null; test_mode: boolean }>('/config');
  const { refresh } = useCart();
  const nav = useNavigate();
  const toast = useToast();
  const [report, setReport] = useState<Sub | null>(null);
  const [review, setReview] = useState<{ sub: Sub; product?: Sub['lines'][0] } | null>(null);

  // Keep the page live while the order is moving: faster while we wait for the payment webhook.
  const active = o && !['completed', 'cancelled', 'payment_failed', 'expired'].includes(o.status);
  useEffect(() => { if (!active) return; const t = setInterval(reload, o!.status === 'pending_payment' ? 4000 : 15000); return () => clearInterval(t); }, [active, o?.status, reload]);

  const reorder = useAction(async () => { const r = await post<{ skipped: string[] }>(`/orders/${id}/reorder`); await refresh(); toast(r.skipped.length ? `Added what’s available. Not available now: ${r.skipped.join(', ')}` : 'Added to your basket'); nav('/cart'); });
  const answer = useAction(async (lineId: string, accept: boolean) => { await post(`/orders/${id}/lines/${lineId}/substitution`, { accept }); reload(); });
  const cancel = async (sid: string) => { await post(`/orders/${id}/suborders/${sid}/cancel`); toast('Order cancelled. Your refund is on its way.'); reload(); };

  if (loading && !o) return <Loading />;
  if (error) return <ErrorBox message={error} retry={reload} />;
  if (!o) return null;
  const paidWaiting = o.status === 'pending_payment';
  return (
    <>
      <div className="row between wrap"><h1 style={{ marginBottom: 0 }}>Order {o.order_number}</h1><StatusBadge status={o.status} /></div>
      <p className="muted">Placed {fmtDate(o.placed_at ?? o.created_at)} · {o.fulfilment_method === 'pickup' ? 'Pickup' : `Delivery to ${o.address?.line1 ?? ''}, ${o.address?.postal_code ?? ''}`}</p>

      {paidWaiting && (
        <section className="panel">
          <h2>Waiting for payment</h2>
          <p>We only confirm your order once your payment is confirmed. If you just paid, this page updates in a moment.</p>
          {pay.data?.payable && cfg.data ? <PaymentStep order={{ id: o.id, order_number: o.order_number, total_cents: o.total_cents, client_secret: pay.data.client_secret }} cfg={cfg.data} onPaid={reload} /> : <Loading label="Checking payment" />}
        </section>
      )}
      {o.status === 'payment_failed' && <Notice tone="error"><strong>Your payment did not go through.</strong> You were not charged. <Link to="/cart">Go back to your basket</Link> to try again.</Notice>}
      {o.status === 'expired' && <Notice tone="warn">This order expired because payment was not completed in time. You were not charged. <Link to="/cart">Go back to your basket</Link>.</Notice>}
      {o.suborders.length > 1 && <Notice>Your order has {o.suborders.length} parts. Each store prepares and delivers its own, so they will arrive separately.</Notice>}

      {o.suborders.map((s) => {
        const steps = s.fulfilment_method === 'pickup' ? STEPS_PICKUP : STEPS_DELIVERY;
        const reached = new Set(s.timeline.map((t) => t.status));
        const done = s.status === 'delivered' || s.status === 'collected';
        const failed = ['rejected', 'cancelled', 'expired'].includes(s.status);
        const proposals = s.lines.filter((l) => l.substitution_status === 'proposed');
        return (
          <section key={s.id} className="panel" aria-label={s.store_name}>
            <div className="row between wrap"><h2 style={{ margin: 0, fontSize: '1.25rem' }}><Link to={`/s/${s.store_slug}`} style={{ color: 'inherit' }}>{s.store_name}</Link></h2><StatusBadge status={s.status} /></div>
            {s.promised_at && !done && !failed && <p className="muted small">Estimated arrival around {fmtDate(s.promised_at, { timeStyle: 'short' })}. This is an estimate, not a guarantee.</p>}
            {failed && <Notice tone="error">{LABEL[s.status]}{s.reject_reason ? `: ${s.reject_reason}` : ''}. {o.payment_status === 'refunded' || s.refunds.length ? 'You have been refunded.' : ''}</Notice>}
            {s.pickup_address && !failed && <p>Collect from: <strong>{s.pickup_address}</strong>{s.store_phone ? ` · ${s.store_phone}` : ''}</p>}

            {!failed && s.status !== 'awaiting_payment' && (
              <ol className="timeline" aria-label="Progress">
                {steps.map((st) => <li key={st} className={reached.has(st) ? '' : 'pending'}><strong>{LABEL[st]}</strong>{reached.has(st) && <span className="muted small"> · {fmtDate(s.timeline.find((t) => t.status === st)?.at, { timeStyle: 'short', dateStyle: undefined })}</span>}</li>)}
              </ol>
            )}

            {s.handover_code && <div className="notice ok"><strong>Give this code to the driver when they arrive:</strong><br /><span className="code-box" aria-label={`Handover code ${s.handover_code.split('').join(' ')}`}>{s.handover_code}</span></div>}

            {proposals.map((l) => (
              <div key={l.id} className="notice warn" role="group" aria-label="Replacement suggestion">
                <strong>{s.store_name} cannot supply {l.name}.</strong> They suggest <strong>{l.substitute_name}</strong> instead, <u>at no extra charge</u>. If you decline, this item is refunded.
                <div className="row" style={{ marginTop: 8 }}><Button size="sm" busy={answer.busy} onClick={() => answer.run(l.id, true)}>Accept replacement</Button><Button size="sm" variant="secondary" busy={answer.busy} onClick={() => answer.run(l.id, false)}>Decline and refund</Button></div>
              </div>
            ))}

            {s.lines.map((l) => (
              <div key={l.id} className="summary-row">
                <span>{l.quantity} × {l.name} <span className="muted small">{l.pack_label}</span>
                  {l.substitution_status === 'approved' && <Badge tone="info">Replaced with {l.substitute_name}</Badge>}
                  {l.refunded_quantity > 0 && <Badge tone="warn">{l.refunded_quantity === l.quantity ? 'Refunded' : `${l.refunded_quantity} refunded`}</Badge>}
                  {done && !l.reviewed && l.refunded_quantity < l.quantity && <button className="link" onClick={() => setReview({ sub: s, product: l })}>Review</button>}</span>
                <span>{money(l.line_total_cents)}</span>
              </div>
            ))}
            {s.delivery_cents > 0 && <div className="summary-row small"><span>Delivery</span><span>{money(s.delivery_cents)}</span></div>}
            <div className="summary-row total"><span>Store total</span><span>{money(s.total_cents)}</span></div>
            {s.refunds.length > 0 && <p className="small muted">Refunds: {s.refunds.map((r) => `${money(r.amount_cents)} (${r.status})`).join(', ')}</p>}

            <div className="row wrap" style={{ marginTop: 10 }}>
              {s.status === 'placed' && <Confirm size="sm" variant="secondary" onConfirm={() => cancel(s.id)} message="Cancel this part of your order? You will be refunded in full.">Cancel</Confirm>}
              {!['awaiting_payment', 'expired'].includes(s.status) && <Button size="sm" variant="secondary" onClick={() => setReport(s)}>Report a problem</Button>}
              {done && !s.reviewed_store && <Button size="sm" onClick={() => setReview({ sub: s })}>Rate this store</Button>}
            </div>
          </section>
        );
      })}

      <section className="panel">
        <div className="summary-row"><span>Items</span><span>{money(o.subtotal_cents)}</span></div>
        {o.discount_cents > 0 && <div className="summary-row okc"><span>Discount</span><span>−{money(o.discount_cents)}</span></div>}
        {o.delivery_cents > 0 && <div className="summary-row"><span>Delivery (incl. tax)</span><span>{money(o.delivery_cents)}</span></div>}
        <div className="summary-row"><span>GST on items</span><span>{money(o.tax_cents)}</span></div>
        <div className="summary-row total"><span>Total</span><span>{money(o.total_cents)}</span></div>
        <p className="small muted">Payment: <StatusBadge status={o.payment_status} /></p>
        {!paidWaiting && <Button variant="secondary" busy={reorder.busy} onClick={() => reorder.run()}>Order these again</Button>}
        {reorder.error && <ErrorBox message={reorder.error} />}
      </section>

      {report && <ReportModal order={o} sub={report} onClose={() => setReport(null)} />}
      {review && <ReviewModal orderId={o.id} sub={review.sub} line={review.product} onClose={() => { setReview(null); reload(); }} />}
    </>
  );
}

function ReportModal({ order, sub, onClose }: { order: Order; sub: Sub; onClose: () => void }) {
  const toast = useToast();
  const [lines, setLines] = useState<string[]>([]);
  const send = useAction(async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
    await post(`/orders/${order.id}/issues`, { suborder_id: sub.id, category: f.category, message: f.message, line_ids: lines });
    toast('Thanks. Our team will review this and get back to you.'); onClose();
  });
  return (
    <Modal open onClose={onClose} title={`Report a problem: ${sub.store_name}`}>
      <form onSubmit={send.run}>
        {send.error && <ErrorBox message={send.error} />}
        <Field label="What happened?"><Select name="category" required defaultValue="missing_item"><option value="missing_item">An item was missing</option><option value="incorrect_item">I received the wrong item</option><option value="damaged_item">An item was damaged</option><option value="substituted_item">An item was replaced without my approval</option><option value="late_order">My order was late</option><option value="payment">A payment problem</option><option value="other">Something else</option></Select></Field>
        <fieldset style={{ border: 0, padding: 0, margin: '0 0 14px' }}><legend className="label" style={{ fontWeight: 600, fontSize: '.9rem' }}>Which items? (optional)</legend>
          {sub.lines.map((l) => <label key={l.id} className="check"><input type="checkbox" checked={lines.includes(l.id)} onChange={(e) => setLines(e.target.checked ? [...lines, l.id] : lines.filter((x) => x !== l.id))} /> {l.name}</label>)}</fieldset>
        <Field label="Tell us more"><Textarea name="message" required minLength={5} rows={4} /></Field>
        <p className="small muted">Please report within 48 hours of delivery. We review every report. <Link to="/pages/refund-policy">Refund policy</Link></p>
        <div className="row end"><Button type="button" variant="ghost" onClick={onClose}>Cancel</Button><Button type="submit" busy={send.busy}>Send report</Button></div>
      </form>
    </Modal>
  );
}

function ReviewModal({ orderId, sub, line, onClose }: { orderId: string; sub: Sub; line?: Sub['lines'][0]; onClose: () => void }) {
  const toast = useToast();
  const [rating, setRating] = useState(5);
  const send = useAction(async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
    await post(`/orders/${orderId}/reviews`, { suborder_id: sub.id, product_id: line?.product_id, rating, body: f.body || undefined });
    toast('Thanks for your review'); onClose();
  });
  return (
    <Modal open onClose={onClose} title={line ? `Review ${line.name}` : `Rate ${sub.store_name}`}>
      <form onSubmit={send.run}>
        {send.error && <ErrorBox message={send.error} />}
        <div role="radiogroup" aria-label="Rating" className="row" style={{ marginBottom: 12 }}>
          {[1, 2, 3, 4, 5].map((n) => <button type="button" key={n} role="radio" aria-checked={rating === n} aria-label={`${n} star${n > 1 ? 's' : ''}`} className="icon-btn" style={{ fontSize: 30, color: n <= rating ? 'var(--ochre)' : 'var(--line-2)' }} onClick={() => setRating(n)}>★</button>)}
        </div>
        <Field label="Comment (optional)"><Textarea name="body" rows={3} maxLength={1000} /></Field>
        <p className="small muted">Your review is marked as a verified purchase.</p>
        <div className="row end"><Button type="button" variant="ghost" onClick={onClose}>Cancel</Button><Button type="submit" busy={send.busy}>Submit</Button></div>
      </form>
    </Modal>
  );
}
