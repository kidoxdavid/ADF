import { useState } from 'react';
import { post, money, fmtDate } from '../../api';
import { useApi, useAction } from '../../hooks';
import { useToast } from '../../toast';
import { Button, Confirm, DataTable, Empty, Field, Loading, Modal, Notice, PageHeader, StatusBadge, Tabs, Textarea, Card } from '../../ui';
import { StoreSelect, useVendor, type VOrder } from './Shared';

const TABS: { id: string; label: string; statuses: string[] }[] = [
  { id: 'new', label: 'New', statuses: ['placed'] }, { id: 'progress', label: 'In progress', statuses: ['accepted', 'preparing'] },
  { id: 'ready', label: 'Ready', statuses: ['ready', 'out_for_delivery'] }, { id: 'done', label: 'Completed', statuses: ['delivered', 'collected', 'rejected', 'cancelled'] },
];

export default function Orders() {
  const { orders, reloadOrders, ordersLoading, storeId } = useVendor();
  const [tab, setTab] = useState('new');
  const [printing, setPrinting] = useState<string | null>(null);
  const list = orders.filter((o) => o.store_id === storeId && TABS.find((t) => t.id === tab)!.statuses.includes(o.status));
  const counts = (id: string) => orders.filter((o) => o.store_id === storeId && TABS.find((t) => t.id === id)!.statuses.includes(o.status)).length;
  const print = (o: VOrder) => { setPrinting(o.id); setTimeout(() => { window.print(); setPrinting(null); }, 50); };
  return (
    <>
      <PageHeader title="Orders" sub="New orders refresh automatically every 30 seconds." actions={<Button variant="secondary" size="sm" onClick={reloadOrders}>Refresh now</Button>} />
      <StoreSelect />
      <Tabs value={tab} onChange={setTab} tabs={TABS.map((t) => ({ id: t.id, label: t.label, badge: t.id === 'new' ? counts('new') : undefined }))} />
      {ordersLoading && <Loading />}
      {!ordersLoading && !list.length && <Empty title={tab === 'new' ? 'No new orders right now' : 'Nothing here'}>{tab === 'new' ? 'When a customer pays, the order appears here.' : null}</Empty>}
      <div className="stack">{list.map((o) => <OrderCard key={o.id} o={o} onChanged={reloadOrders} onPrint={() => print(o)} />)}</div>
      {orders.filter((o) => o.id === printing).map((o) => (
        <div key={o.id} className="slip printing"><h2>Order {o.order_number}</h2><p>{o.fulfilment_method === 'pickup' ? 'PICKUP' : 'DELIVERY'} · {o.customer_first_name}</p>
          {o.delivery_instructions && <p>Note: {o.delivery_instructions}</p>}<ul>{o.lines?.map((l) => <li key={l.id}>{l.quantity} × {l.name} {l.pack_label ?? ''}</li>)}</ul><p>Placed {fmtDate(o.placed_at)}</p></div>
      ))}
    </>
  );
}

function OrderCard({ o, onChanged, onPrint }: { o: VOrder; onChanged: () => void; onPrint: () => void }) {
  const toast = useToast();
  const [reject, setReject] = useState(false); const [reason, setReason] = useState('');
  const [subLine, setSubLine] = useState<string | null>(null);
  const step = useAction(async (path: string, msg: string) => { await post(`/vendor/suborders/${o.id}/${path}`); toast(msg); onChanged(); });
  const rej = useAction(async () => { await post(`/vendor/suborders/${o.id}/reject`, { reason }); toast('Order rejected. The customer has been refunded.'); setReject(false); setReason(''); onChanged(); });
  const lines = o.lines ?? [];
  const pendingSub = lines.some((l) => l.substitution_status === 'proposed');
  const editable = ['accepted', 'preparing'].includes(o.status);
  return (
    <Card className={`order-card ${o.needs_attention ? 'attention' : ''}`}>
      <div className="row between wrap"><div><strong className="display">#{o.order_number}</strong> <StatusBadge status={o.status} /> <span className="badge neutral">{o.fulfilment_method === 'pickup' ? 'Pickup' : 'Delivery'}</span>{o.needs_attention && <span className="badge danger" style={{ marginLeft: 6 }}>Waiting too long</span>}</div>
        <span className="muted small">Placed {fmtDate(o.placed_at)}{o.promised_at ? ` · promised by ${fmtDate(o.promised_at, { timeStyle: 'short' })}` : ''}</span></div>
      <p className="small"><strong>{o.customer_first_name}</strong>{o.delivery_instructions ? ` — “${o.delivery_instructions}”` : ''}</p>
      <ul className="order-lines">{lines.map((l) => (
        <li key={l.id}><div><strong>{l.quantity} × {l.name}</strong> <span className="muted small">{l.brand ?? ''} {l.pack_label ?? ''}</span>
          {l.sold_by === 'weight' && <div className="small muted">Sold by weight: customer is charged the listed price.</div>}
          {l.refunded_quantity > 0 && <div className="small warnc">{l.refunded_quantity} refunded</div>}
          {l.substitution_status === 'proposed' && <div className="small">Replacement “{l.substitute_name}” — waiting for customer</div>}
          {l.substitution_status === 'approved' && <div className="small okc">Customer accepted “{l.substitute_name}”</div>}
          {l.substitution_status === 'declined' && <div className="small warnc">Customer declined the replacement (refunded)</div>}</div>
          <div className="row wrap"><span>{money(l.unit_price_cents * l.quantity)}</span>
            {editable && l.refunded_quantity < l.quantity && l.substitution_status === 'none' && <>
              <Confirm size="sm" variant="secondary" message={`Mark “${l.name}” unavailable? The customer will be refunded for it automatically.`} onConfirm={async () => { await post(`/vendor/suborders/${o.id}/lines/${l.id}/unavailable`).then(() => { toast('Item refunded to the customer.'); onChanged(); }, (e) => toast(e.message, 'error')); }}>Unavailable</Confirm>
              <Button size="sm" variant="ghost" onClick={() => setSubLine(l.id)}>Suggest replacement</Button></>}</div></li>))}</ul>
      <div className="summary-row"><span>Item total (before discounts)</span><strong>{money(o.subtotal_cents)}</strong></div>
      <div className="summary-row muted small"><span>Commission</span><span>− {money(o.commission_cents)}</span></div>
      {step.error && <Notice tone="error">{step.error}</Notice>}
      {pendingSub && <Notice tone="warn">A replacement is waiting for the customer’s answer. You can mark the order ready once they respond.</Notice>}
      <div className="row wrap" style={{ marginTop: 10 }}>
        {o.status === 'placed' && <><Button busy={step.busy} onClick={() => step.run('accept', 'Order accepted.')}>Accept</Button><Button variant="danger" onClick={() => setReject(true)}>Reject</Button></>}
        {o.status === 'accepted' && <Button busy={step.busy} onClick={() => step.run('preparing', 'Marked as preparing.')}>Start preparing</Button>}
        {editable && <Button busy={step.busy} variant={o.status === 'accepted' ? 'secondary' : 'primary'} disabled={pendingSub} onClick={() => step.run('ready', 'Marked ready.')}>Mark ready</Button>}
        {o.status === 'ready' && o.fulfilment_method === 'pickup' && <Button busy={step.busy} onClick={() => step.run('collected', 'Marked collected.')}>Mark collected</Button>}
        {o.status === 'ready' && o.fulfilment_method === 'delivery' && <span className="muted small">Waiting for a driver to collect it.</span>}
        <Button variant="ghost" onClick={onPrint}>Print slip</Button></div>
      <Modal open={reject} onClose={() => setReject(false)} title={`Reject order #${o.order_number}`}>
        <p>The customer is refunded in full automatically. Please tell them why.</p>
        {rej.error && <Notice tone="error">{rej.error}</Notice>}
        <Field label="Reason (required)"><Textarea value={reason} onChange={(e) => setReason(e.target.value)} minLength={3} maxLength={300} /></Field>
        <div className="row end"><Button variant="ghost" onClick={() => setReject(false)}>Cancel</Button><Button variant="danger" busy={rej.busy} disabled={reason.trim().length < 3} onClick={() => rej.run()}>Reject order</Button></div>
      </Modal>
      {subLine && <SubstituteModal orderId={o.id} lineId={subLine} onClose={() => setSubLine(null)} onDone={() => { setSubLine(null); onChanged(); }} />}
    </Card>
  );
}

type VendorOffer = { offer_id: string; name: string; available: number; price_cents: number; is_active: boolean };

function SubstituteModal({ orderId, lineId, onClose, onDone }: { orderId: string; lineId: string; onClose: () => void; onDone: () => void }) {
  const { store } = useVendor(); const toast = useToast();
  const offers = useApi<VendorOffer[]>(`/vendor/stores/${store.id}/offers`);
  const act = useAction(async (offerId: string) => { await post(`/vendor/suborders/${orderId}/lines/${lineId}/substitute`, { offer_id: offerId }); toast('Replacement sent to the customer.'); onDone(); });
  const list = (offers.data ?? []).filter((x) => x.is_active && x.available > 0);
  return (
    <Modal open onClose={onClose} title="Suggest a replacement">
      <Notice>The customer pays no extra, and must accept before it counts. If they decline, that item is refunded.</Notice>
      {act.error && <Notice tone="error">{act.error}</Notice>}
      {offers.loading ? <Loading /> : offers.error ? <Notice tone="error">{offers.error}</Notice> : !list.length ? <Empty title="No in-stock products to offer" /> :
        <DataTable rows={list} rowKey={(r) => r.offer_id} columns={[{ key: 'name', header: 'Product' }, { key: 'available', header: 'Available' }, { key: 'p', header: 'Price', render: (r) => money(r.price_cents) }, { key: 'a', header: '', render: (r) => <Button size="sm" busy={act.busy} onClick={() => act.run(r.offer_id)}>Suggest</Button> }]} />}
    </Modal>
  );
}
