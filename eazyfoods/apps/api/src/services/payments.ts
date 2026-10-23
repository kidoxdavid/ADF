import type { PoolClient } from 'pg';
import { pool, tx, type After } from '../db/pool.js';
import { HttpError } from '../lib/errors.js';
import { getProvider } from '../payments/provider.js';
import { postPaymentCaptured } from './ledger.js';
import { history } from './orders.js';
import { refundWholeSuborder } from './refunds.js';
import { notify, notifyVendorOwners } from './notify.js';

async function releaseReservations(c: PoolClient, orderId: string) {
  const held = (await c.query(
    `SELECT r.id, r.offer_id, r.quantity FROM inventory_reservations r JOIN order_lines l ON l.id = r.order_line_id JOIN suborders s ON s.id = l.suborder_id
      WHERE s.order_id = $1 AND r.status = 'held' FOR UPDATE OF r`, [orderId])).rows;
  for (const r of held) {
    await c.query('UPDATE store_offers SET stock_reserved = stock_reserved - $2 WHERE id = $1', [r.offer_id, r.quantity]);
    await c.query(`UPDATE inventory_reservations SET status='released', resolved_at=now() WHERE id=$1`, [r.id]);
  }
}

/** A verified, matching payment: commit stock, place the order, book the ledger. Idempotent. */
async function onPaymentSucceeded(c: PoolClient, after: After, payment: any) {
  const order = (await c.query('SELECT * FROM orders WHERE id = $1 FOR UPDATE', [payment.order_id])).rows[0];
  if (order.payment_status === 'paid' || order.payment_status.includes('refunded')) return 'already_paid';
  await c.query(`UPDATE payments SET status='succeeded' WHERE id=$1`, [payment.id]);

  const subs = (await c.query('SELECT * FROM suborders WHERE order_id = $1 ORDER BY id', [order.id])).rows;
  const short = new Set<string>();
  const reservations = (await c.query(
    `SELECT r.*, l.suborder_id, l.product_name FROM inventory_reservations r JOIN order_lines l ON l.id = r.order_line_id JOIN suborders s ON s.id = l.suborder_id
      WHERE s.order_id = $1 ORDER BY r.offer_id FOR UPDATE OF r`, [order.id])).rows;
  for (const r of reservations) {
    const o = (await c.query('SELECT stock_on_hand, stock_reserved FROM store_offers WHERE id = $1 FOR UPDATE', [r.offer_id])).rows[0];
    if (r.status === 'held') {
      await c.query('UPDATE store_offers SET stock_on_hand = stock_on_hand - $2, stock_reserved = stock_reserved - $2, updated_at = now() WHERE id = $1', [r.offer_id, r.quantity]);
    } else if (o.stock_on_hand - o.stock_reserved >= r.quantity) {
      // Payment arrived after our hold expired, but the stock is still free: re-claim it.
      await c.query('UPDATE store_offers SET stock_on_hand = stock_on_hand - $2, updated_at = now() WHERE id = $1', [r.offer_id, r.quantity]);
    } else { short.add(r.suborder_id); continue; }
    const after_ = (await c.query('SELECT stock_on_hand FROM store_offers WHERE id = $1', [r.offer_id])).rows[0].stock_on_hand;
    await c.query(`INSERT INTO inventory_adjustments(offer_id, delta, reason, note, resulting_on_hand) VALUES ($1,$2,'sale',$3,$4)`, [r.offer_id, -r.quantity, `order ${order.order_number}`, after_]);
    await c.query(`UPDATE inventory_reservations SET status='committed', resolved_at=now() WHERE id=$1`, [r.id]);
  }
  // A shortfall cancels that whole suborder (handled below); other suborders proceed.

  await c.query(`UPDATE orders SET status='placed', payment_status='paid', placed_at=now() WHERE id=$1`, [order.id]);
  await history(c, order.id, null, order.status, 'placed', null, 'Payment confirmed');
  await postPaymentCaptured(c, order, subs, payment.id);

  for (const s of subs) {
    if (short.has(s.id)) {
      await c.query(`UPDATE suborders SET status='cancelled', reject_reason='Stock could not be held' WHERE id=$1`, [s.id]);
      await history(c, order.id, s.id, s.status, 'cancelled', null, 'Stock could not be held after payment');
      // Units committed for other lines of this suborder go back to the shelf.
      await restockCommitted(c, s.id, reservations);
      await refundWholeSuborder(c, after, s.id, 'Items were no longer available', null);
      continue;
    }
    await c.query(`UPDATE suborders SET status='placed', promised_at = CASE WHEN eta_minutes IS NULL THEN NULL ELSE now() + make_interval(mins => eta_minutes) END WHERE id=$1`, [s.id]);
    await history(c, order.id, s.id, s.status, 'placed', null);
    after.push(() => notifyVendorOwners(pool, s.vendor_id, 'vendor_new_order', { order_number: order.order_number }));
  }
  if (subs.every((s) => short.has(s.id))) await c.query(`UPDATE orders SET status='cancelled' WHERE id=$1`, [order.id]);

  // Order is placed: empty the purchased items from the basket and record the conversion.
  await c.query(`DELETE FROM cart_items WHERE cart_id IN (SELECT id FROM carts WHERE user_id = $1) AND offer_id IN
    (SELECT l.offer_id FROM order_lines l JOIN suborders s ON s.id = l.suborder_id WHERE s.order_id = $2)`, [order.user_id, order.id]);
  await c.query(`INSERT INTO analytics_events(type, user_id, order_id) VALUES ('order_paid',$1,$2)`, [order.user_id, order.id]);
  after.push(() => notify(pool, { userId: order.user_id, email: order.customer_email, template: 'order_confirmed', vars: { order_number: order.order_number, total: (order.total_cents / 100).toFixed(2) } }));
  return 'processed';
}

async function restockCommitted(c: PoolClient, suborderId: string, reservations: any[]) {
  for (const r of reservations.filter((x) => x.suborder_id === suborderId)) {
    const res = (await c.query('SELECT status FROM inventory_reservations WHERE id = $1', [r.id])).rows[0];
    if (res.status !== 'committed') continue;
    const u = await c.query('UPDATE store_offers SET stock_on_hand = stock_on_hand + $2 WHERE id = $1 RETURNING stock_on_hand', [r.offer_id, r.quantity]);
    await c.query(`INSERT INTO inventory_adjustments(offer_id, delta, reason, note, resulting_on_hand) VALUES ($1,$2,'return','order cancelled: partial stock',$3)`, [r.offer_id, r.quantity, u.rows[0].stock_on_hand]);
  }
}

async function onPaymentFailed(c: PoolClient, payment: any, message?: string) {
  const order = (await c.query('SELECT * FROM orders WHERE id = $1 FOR UPDATE', [payment.order_id])).rows[0];
  if (order.payment_status === 'paid' || order.payment_status.includes('refunded')) return 'ignored_already_paid';
  await c.query(`UPDATE payments SET status='failed', failure_message=$2 WHERE id=$1`, [payment.id, message ?? null]);
  await releaseReservations(c, order.id);
  await c.query(`UPDATE orders SET status='payment_failed', payment_status='failed' WHERE id=$1`, [order.id]);
  await c.query(`UPDATE suborders SET status='cancelled' WHERE order_id=$1 AND status='awaiting_payment'`, [order.id]);
  await history(c, order.id, null, order.status, 'payment_failed', null, message ?? 'Payment failed');
  return 'processed';
}

/** Entry point for provider webhooks. Signature-verified, recorded exactly once, applied in one transaction. */
export async function handleWebhook(raw: Buffer, headers: Record<string, string | string[] | undefined>) {
  const provider = getProvider();
  let evt;
  try { evt = provider.parseWebhook(raw, headers); } catch { throw new HttpError(400, 'invalid_signature', 'Webhook signature verification failed.'); }

  return tx(async (c, after) => {
    const ins = await c.query(`INSERT INTO payment_events(provider, event_id, type, payload) VALUES ($1,$2,$3,$4) ON CONFLICT (provider, event_id) DO NOTHING RETURNING id`,
      [provider.name, evt.id, evt.type, JSON.stringify(evt.raw)]);
    if (!ins.rowCount) return { duplicate: true };
    let outcome = 'ignored';
    const payment = evt.providerPaymentId
      ? (await c.query('SELECT * FROM payments WHERE provider = $1 AND provider_payment_id = $2 FOR UPDATE', [provider.name, evt.providerPaymentId])).rows[0] : null;
    if (evt.type === 'payment_succeeded') {
      if (!payment) outcome = 'unknown_payment';
      else if (evt.amountCents !== undefined && evt.amountCents !== payment.amount_cents) {
        outcome = 'amount_mismatch';
        await c.query(`INSERT INTO support_tickets(kind, category, subject) VALUES ('customer','payment',$1)`, [`Payment amount mismatch on ${payment.provider_payment_id}: expected ${payment.amount_cents}, got ${evt.amountCents}`]);
      } else outcome = await onPaymentSucceeded(c, after, payment);
    } else if (evt.type === 'payment_failed') {
      outcome = payment ? await onPaymentFailed(c, payment, evt.failureMessage) : 'unknown_payment';
    } else if (evt.type === 'dispute_opened' && payment) {
      outcome = 'dispute_logged';
      await c.query(`INSERT INTO support_tickets(kind, category, subject) VALUES ('customer','payment',$1)`, [`Chargeback/dispute opened on ${payment.provider_payment_id}. Respond to the provider before the deadline.`]);
    }
    await c.query('UPDATE payment_events SET outcome = $2 WHERE id = $1', [ins.rows[0].id, outcome]);
    return { duplicate: false, outcome };
  });
}

/** Free stock held by unpaid orders whose hold has expired. Safe to run repeatedly and concurrently. */
export async function releaseExpiredReservations() {
  const ids = (await pool.query(
    `SELECT DISTINCT s.order_id FROM inventory_reservations r JOIN order_lines l ON l.id = r.order_line_id JOIN suborders s ON s.id = l.suborder_id JOIN orders o ON o.id = s.order_id
      WHERE r.status = 'held' AND r.expires_at < now() AND o.status = 'pending_payment'`)).rows.map((r) => r.order_id);
  let n = 0;
  for (const id of ids) {
    const cancelled = await tx(async (c) => {
      const o = (await c.query('SELECT * FROM orders WHERE id = $1 AND status = $2 FOR UPDATE', [id, 'pending_payment'])).rows[0];
      if (!o) return null;
      await releaseReservations(c, id);
      await c.query(`UPDATE orders SET status='expired', payment_status='failed' WHERE id=$1`, [id]);
      await c.query(`UPDATE suborders SET status='expired' WHERE order_id=$1 AND status='awaiting_payment'`, [id]);
      await history(c, id, null, 'pending_payment', 'expired', null, 'Payment not completed in time');
      const p = (await c.query(`UPDATE payments SET status='canceled' WHERE order_id=$1 AND status='requires_payment' RETURNING provider_payment_id`, [id])).rows[0];
      return p?.provider_payment_id ?? '';
    });
    if (cancelled !== null) { n++; if (cancelled) await getProvider().cancelPayment(cancelled).catch(() => {}); }
  }
  return n;
}
