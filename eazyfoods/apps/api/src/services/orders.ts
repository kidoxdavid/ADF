import type { PoolClient } from 'pg';
import { pool, type After } from '../db/pool.js';
import { bad, conflict, forbidden, notFound } from '../lib/errors.js';
import { notify } from './notify.js';
import { createDelivery } from './delivery.js';
import { refundWholeSuborder } from './refunds.js';

export const TERMINAL = ['delivered', 'collected', 'rejected', 'cancelled', 'expired'];
const TRANSITIONS: Record<string, string[]> = {
  placed: ['accepted', 'rejected', 'cancelled'],
  accepted: ['preparing', 'ready', 'cancelled'],
  preparing: ['ready', 'cancelled'],
  ready: ['out_for_delivery', 'collected', 'cancelled'],
  out_for_delivery: ['delivered', 'cancelled'],
};
const CUSTOMER_NOTIFY: Record<string, string> = {
  accepted: 'accepted by the store', ready: 'ready', out_for_delivery: 'out for delivery', delivered: 'delivered', collected: 'collected', rejected: 'rejected by the store', cancelled: 'cancelled',
};

export async function history(c: PoolClient, orderId: string, suborderId: string | null, from: string | null, to: string, actor: string | null, note?: string | null) {
  await c.query('INSERT INTO order_status_history(order_id, suborder_id, from_status, to_status, actor_user_id, note) VALUES ($1,$2,$3,$4,$5,$6)', [orderId, suborderId, from, to, actor, note ?? null]);
}

/** Return units that were deducted at payment back to the shelf (used when nothing had been prepared yet). */
export async function restockSuborder(c: PoolClient, suborderId: string, actor: string | null) {
  const lines = (await c.query(`SELECT offer_id, quantity - refunded_quantity AS qty FROM order_lines WHERE suborder_id = $1 AND status = 'active'`, [suborderId])).rows;
  for (const l of lines) {
    if (l.qty <= 0) continue;
    const r = await c.query('UPDATE store_offers SET stock_on_hand = stock_on_hand + $2, updated_at = now() WHERE id = $1 RETURNING stock_on_hand', [l.offer_id, l.qty]);
    await c.query(`INSERT INTO inventory_adjustments(offer_id, delta, reason, note, actor_user_id, resulting_on_hand) VALUES ($1,$2,'return','order cancelled before preparation',$3,$4)`, [l.offer_id, l.qty, actor, r.rows[0].stock_on_hand]);
  }
}

export type Actor = { userId: string | null; kind: 'vendor' | 'customer' | 'driver' | 'staff' | 'system' };

/** The only place suborder status changes. Validates the transition, records history, and runs side effects. */
export async function moveSuborder(c: PoolClient, after: After, suborderId: string, to: string, actor: Actor, note?: string | null) {
  const s = (await c.query(
    `SELECT s.*, o.user_id, o.customer_email, o.order_number, o.id AS oid FROM suborders s JOIN orders o ON o.id = s.order_id WHERE s.id = $1 FOR UPDATE OF s`, [suborderId])).rows[0];
  if (!s) throw notFound('Order not found');
  if (!TRANSITIONS[s.status]?.includes(to)) throw conflict('invalid_transition', `A ${s.status.replace(/_/g, ' ')} order cannot become ${to.replace(/_/g, ' ')}.`);
  if (to === 'collected' && s.fulfilment_method !== 'pickup') throw conflict('invalid_transition', 'Only pickup orders can be collected.');
  if (to === 'out_for_delivery' && s.fulfilment_method !== 'delivery') throw conflict('invalid_transition', 'Only delivery orders go out for delivery.');
  if (to === 'ready') {
    const pending = (await c.query(`SELECT 1 FROM order_lines WHERE suborder_id = $1 AND substitution_status = 'proposed'`, [suborderId])).rowCount;
    if (pending) throw conflict('substitution_pending', 'A substitution is waiting for the customer to respond.');
  }
  if ((to === 'rejected' || to === 'cancelled') && !note) throw bad('reason_required', 'Please give a reason.');

  const stamps: Record<string, string> = { accepted: 'accepted_at = now()', ready: 'ready_at = now()', delivered: 'completed_at = now()', collected: 'completed_at = now()' };
  await c.query(`UPDATE suborders SET status = $2, reject_reason = CASE WHEN $2 IN ('rejected','cancelled') THEN $3 ELSE reject_reason END ${stamps[to] ? ', ' + stamps[to] : ''} WHERE id = $1`, [suborderId, to, note ?? null]);
  await history(c, s.oid, suborderId, s.status, to, actor.userId, note);

  if (to === 'ready' && s.fulfilment_method === 'delivery') await createDelivery(c, suborderId);
  if (to === 'rejected' || to === 'cancelled') {
    if (s.status === 'placed' && actor.kind !== 'vendor') await restockSuborder(c, suborderId, actor.userId);
    await refundWholeSuborder(c, after, suborderId, note!, actor.userId);
  }

  // Roll the order up once every suborder is finished.
  const subs = (await c.query('SELECT status FROM suborders WHERE order_id = $1', [s.oid])).rows.map((r) => r.status);
  if (subs.every((x) => TERMINAL.includes(x))) {
    const done = subs.some((x) => x === 'delivered' || x === 'collected');
    await c.query('UPDATE orders SET status = $2 WHERE id = $1', [s.oid, done ? 'completed' : 'cancelled']);
    await history(c, s.oid, null, 'placed', done ? 'completed' : 'cancelled', actor.userId);
  }
  if (CUSTOMER_NOTIFY[to])
    after.push(() => notify(pool, { userId: s.user_id, email: s.customer_email, template: 'order_status', transactional: false, vars: { order_number: s.order_number, status: CUSTOMER_NOTIFY[to], note: note ?? '' } }));
  return { id: suborderId, status: to };
}

/** Is this user allowed to act on the suborder as a vendor member? */
export async function assertVendorOwnsSuborder(userVendorIds: (string | null)[], suborderId: string) {
  const r = await pool.query('SELECT vendor_id FROM suborders WHERE id = $1', [suborderId]);
  if (!r.rows[0]) throw notFound('Order not found');
  if (!userVendorIds.includes(r.rows[0].vendor_id)) throw forbidden();
}
