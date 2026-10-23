import type { PoolClient } from 'pg';
import { pool, tx, type After } from '../db/pool.js';
import { bad, conflict, notFound } from '../lib/errors.js';
import { prorate } from '../lib/money.js';
import { getProvider } from '../payments/provider.js';
import { audit } from '../lib/auth.js';
import { notify } from './notify.js';
import { postRefund, type RefundAmounts } from './ledger.js';

export type RefundLine = { line_id: string; quantity: number };

/** Work out what a refund of these lines (and optionally the delivery fee) is worth, from the current state of the suborder. */
export async function computeRefund(c: PoolClient, suborderId: string, lines: RefundLine[], includeDelivery: boolean): Promise<RefundAmounts> {
  const sub = (await c.query('SELECT * FROM suborders WHERE id = $1', [suborderId])).rows[0];
  if (!sub) throw notFound('Suborder not found');
  const a: RefundAmounts = { merchandise: 0, discount: 0, tax: 0, delivery: 0, commission: 0, amount: 0 };
  for (const rl of lines) {
    const l = (await c.query('SELECT * FROM order_lines WHERE id = $1 AND suborder_id = $2', [rl.line_id, suborderId])).rows[0];
    if (!l) throw bad('line_not_found', 'That item is not part of this order.');
    const remaining = l.quantity - l.refunded_quantity;
    if (!Number.isInteger(rl.quantity) || rl.quantity < 1 || rl.quantity > remaining) throw bad('invalid_quantity', `Only ${remaining} unit(s) of ${l.product_name} can still be refunded.`);
    const prev = l.refunded_quantity, next = prev + rl.quantity;
    a.merchandise += prorate(l.line_total_cents, l.quantity, prev, next);
    a.discount += prorate(l.discount_cents, l.quantity, prev, next);
    a.tax += prorate(l.tax_cents, l.quantity, prev, next);
    a.commission += prorate(l.commission_cents, l.quantity, prev, next);
  }
  if (includeDelivery) {
    if (sub.delivery_refunded) throw conflict('delivery_already_refunded', 'The delivery fee was already refunded.');
    a.delivery = sub.delivery_cents;
    a.tax += sub.delivery_tax_cents;
  }
  a.amount = a.merchandise - a.discount + a.tax + a.delivery;
  if (a.amount <= 0) throw bad('nothing_to_refund', 'Nothing to refund.');
  return a;
}

type CreateArgs = { suborderId: string; lines: RefundLine[]; includeDelivery: boolean; reason: string; vendorFunded: boolean; requestedBy: string | null; ticketId?: string | null };

export async function createRefund(c: PoolClient, a: CreateArgs) {
  const sub = (await c.query('SELECT s.order_id, s.status FROM suborders s WHERE s.id = $1 FOR UPDATE', [a.suborderId])).rows[0];
  if (!sub) throw notFound('Suborder not found');
  const pay = (await c.query(`SELECT id FROM payments WHERE order_id = $1 AND status = 'succeeded'`, [sub.order_id])).rows[0];
  if (!pay) throw conflict('not_paid', 'This order has not been paid, so there is nothing to refund.');
  const amt = await computeRefund(c, a.suborderId, a.lines, a.includeDelivery);
  const r = await c.query(
    `INSERT INTO refunds(order_id, suborder_id, payment_id, reason, lines, include_delivery, merchandise_cents, discount_cents, tax_cents, delivery_cents, commission_cents, amount_cents,
                         vendor_funded, requested_by, ticket_id, idempotency_key)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15, gen_random_uuid()::text) RETURNING *`,
    [sub.order_id, a.suborderId, pay.id, a.reason, JSON.stringify(a.lines), a.includeDelivery, amt.merchandise, amt.discount, amt.tax, amt.delivery, amt.commission, amt.amount,
     a.vendorFunded, a.requestedBy, a.ticketId ?? null]);
  return r.rows[0];
}

/** Convenience: refund everything left on a suborder (rejections, cancellations, expiries). Processed after commit. */
export async function refundWholeSuborder(c: PoolClient, after: After, suborderId: string, reason: string, actor: string | null) {
  const lines = (await c.query(`SELECT id, quantity - refunded_quantity AS remaining FROM order_lines WHERE id IN (SELECT id FROM order_lines WHERE suborder_id = $1) AND quantity > refunded_quantity`, [suborderId])).rows;
  const sub = (await c.query('SELECT delivery_cents, delivery_refunded FROM suborders WHERE id = $1', [suborderId])).rows[0];
  const includeDelivery = sub.delivery_cents > 0 && !sub.delivery_refunded;
  if (!lines.length && !includeDelivery) return null;
  const r = await createRefund(c, { suborderId, lines: lines.map((l) => ({ line_id: l.id, quantity: l.remaining })), includeDelivery, reason, vendorFunded: true, requestedBy: actor });
  after.push(() => processRefund(r.id, actor));
  return r;
}

/**
 * Approve and execute a refund. Amounts are recomputed from live state; line counters are claimed inside the first transaction
 * (guarded against over-refunding), the provider is called outside any transaction, and the ledger is posted when it succeeds.
 */
export async function processRefund(refundId: string, decidedBy: string | null) {
  const claimed = await tx(async (c) => {
    const r = (await c.query('SELECT * FROM refunds WHERE id = $1 FOR UPDATE', [refundId])).rows[0];
    if (!r) throw notFound('Refund not found');
    if (!['requested', 'failed'].includes(r.status)) throw conflict('already_processed', `Refund is ${r.status}.`);
    const lines: RefundLine[] = r.lines;
    // Claim line quantities atomically.
    for (const l of lines) {
      const u = await c.query('UPDATE order_lines SET refunded_quantity = refunded_quantity + $2 WHERE id = $1 AND quantity - refunded_quantity >= $2', [l.line_id, l.quantity]);
      if (!u.rowCount) throw conflict('over_refund', 'One of those items has already been refunded.');
    }
    if (r.include_delivery) {
      const u = await c.query('UPDATE suborders SET delivery_refunded = true WHERE id = $1 AND NOT delivery_refunded', [r.suborder_id]);
      if (!u.rowCount) throw conflict('delivery_already_refunded', 'The delivery fee was already refunded.');
    }
    // Recompute amounts as they were before our claim so they reflect refunds that landed since the request.
    const prevCounts = new Map<string, number>();
    for (const l of lines) prevCounts.set(l.line_id, (await c.query('SELECT refunded_quantity FROM order_lines WHERE id = $1', [l.line_id])).rows[0].refunded_quantity - l.quantity);
    const a: RefundAmounts = { merchandise: 0, discount: 0, tax: 0, delivery: 0, commission: 0, amount: 0 };
    for (const l of lines) {
      const ol = (await c.query('SELECT * FROM order_lines WHERE id = $1', [l.line_id])).rows[0];
      const prev = prevCounts.get(l.line_id)!, next = prev + l.quantity;
      a.merchandise += prorate(ol.line_total_cents, ol.quantity, prev, next);
      a.discount += prorate(ol.discount_cents, ol.quantity, prev, next);
      a.tax += prorate(ol.tax_cents, ol.quantity, prev, next);
      a.commission += prorate(ol.commission_cents, ol.quantity, prev, next);
    }
    const sub = (await c.query('SELECT * FROM suborders WHERE id = $1', [r.suborder_id])).rows[0];
    if (r.include_delivery) { a.delivery = sub.delivery_cents; a.tax += sub.delivery_tax_cents; }
    a.amount = a.merchandise - a.discount + a.tax + a.delivery;
    await c.query(`UPDATE refunds SET status='approved', decided_by=$2, decided_at=now(), merchandise_cents=$3, discount_cents=$4, tax_cents=$5, delivery_cents=$6, commission_cents=$7, amount_cents=$8 WHERE id=$1`,
      [refundId, decidedBy, a.merchandise, a.discount, a.tax, a.delivery, a.commission, a.amount]);
    const pay = (await c.query('SELECT provider_payment_id FROM payments WHERE id = $1', [r.payment_id])).rows[0];
    return { refund: { ...r, ...{ amount_cents: a.amount } }, providerPaymentId: pay.provider_payment_id as string, amounts: a, lines };
  });

  let providerRefundId: string | null = null;
  let failure: string | null = null;
  try {
    providerRefundId = (await getProvider().refund({ providerPaymentId: claimed.providerPaymentId, amountCents: claimed.refund.amount_cents, idempotencyKey: claimed.refund.idempotency_key })).providerRefundId;
  } catch (e: any) { failure = String(e.message ?? e); }

  return tx(async (c, after) => {
    const r = claimed.refund;
    if (failure) {
      for (const l of claimed.lines) await c.query('UPDATE order_lines SET refunded_quantity = refunded_quantity - $2 WHERE id = $1', [l.line_id, l.quantity]);
      if (r.include_delivery) await c.query('UPDATE suborders SET delivery_refunded = false WHERE id = $1', [r.suborder_id]);
      await c.query(`UPDATE refunds SET status='failed', decision_note=$2 WHERE id=$1`, [r.id, failure]);
      await audit(decidedBy, 'refund.failed', 'refund', r.id, { failure }, c);
      return { id: r.id, status: 'failed' as const, error: failure };
    }
    const sub = (await c.query('SELECT vendor_id FROM suborders WHERE id = $1', [r.suborder_id])).rows[0];
    await c.query(`UPDATE refunds SET status='succeeded', provider_refund_id=$2 WHERE id=$1`, [r.id, providerRefundId]);
    await postRefund(c, { id: r.id, order_id: r.order_id, suborder_id: r.suborder_id, vendor_id: sub.vendor_id, vendor_funded: r.vendor_funded, ...claimed.amounts });
    const o = (await c.query('SELECT id, total_cents, user_id, customer_email, order_number FROM orders WHERE id = $1 FOR UPDATE', [r.order_id])).rows[0];
    const refunded = (await c.query(`SELECT COALESCE(sum(amount_cents),0)::int AS s FROM refunds WHERE order_id = $1 AND status = 'succeeded'`, [r.order_id])).rows[0].s;
    await c.query('UPDATE orders SET payment_status = $2 WHERE id = $1', [r.order_id, refunded >= o.total_cents ? 'refunded' : 'partially_refunded']);
    await audit(decidedBy, 'refund.succeeded', 'refund', r.id, { amount_cents: r.amount_cents }, c);
    after.push(() => notify(pool, { userId: o.user_id, email: o.customer_email, template: 'refund_processed', vars: { order_number: o.order_number, amount: (r.amount_cents / 100).toFixed(2) } }));
    return { id: r.id, status: 'succeeded' as const };
  });
}

export async function rejectRefund(refundId: string, decidedBy: string, note: string) {
  const r = await pool.query(`UPDATE refunds SET status='rejected', decided_by=$2, decided_at=now(), decision_note=$3 WHERE id=$1 AND status='requested' RETURNING id`, [refundId, decidedBy, note]);
  if (!r.rowCount) throw conflict('not_pending', 'Only pending refund requests can be rejected.');
  await audit(decidedBy, 'refund.rejected', 'refund', refundId, { note });
}
