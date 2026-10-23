import { pool, tx } from '../db/pool.js';
import { bad, conflict, HttpError } from '../lib/errors.js';
import { orderNumber } from '../lib/ids.js';
import { getSetting } from '../lib/settings.js';
import { getProvider } from '../payments/provider.js';
import { buildQuote, type Quote } from './pricing.js';
import { history } from './orders.js';

export type CheckoutInput = { addressId?: string | null; method: 'delivery' | 'pickup'; couponCode?: string | null; instructions?: string | null; idempotencyKey: string };

async function view(orderId: string) {
  const o = (await pool.query('SELECT * FROM orders WHERE id = $1', [orderId])).rows[0];
  const p = (await pool.query('SELECT provider, provider_payment_id, client_secret, status FROM payments WHERE order_id = $1 ORDER BY created_at DESC LIMIT 1', [orderId])).rows[0];
  return { order: { id: o.id, order_number: o.order_number, status: o.status, payment_status: o.payment_status, total_cents: o.total_cents }, payment: p ? { provider: p.provider, client_secret: p.client_secret, status: p.status } : null };
}

/**
 * Turn the basket into an order. Everything is re-priced and re-validated on the server inside a transaction that locks the offers,
 * stock is reserved (not yet deducted), and a payment is created for the exact server-computed total.
 * Calling again with the same idempotency key returns the same order.
 */
export async function placeOrder(user: { id: string; email: string; full_name: string }, input: CheckoutInput) {
  const existing = (await pool.query('SELECT id FROM orders WHERE user_id = $1 AND idempotency_key = $2', [user.id, input.idempotencyKey])).rows[0];
  if (existing) return view(existing.id);

  let orderId: string; let paymentAmount: number; let number: string;
  try {
    ({ orderId, paymentAmount, number } = await tx(async (c) => {
      // Lock the offers in a stable order so concurrent checkouts serialise instead of overselling.
      const offerIds = (await c.query(`SELECT ci.offer_id FROM cart_items ci JOIN carts ct ON ct.id = ci.cart_id WHERE ct.user_id = $1 ORDER BY ci.offer_id`, [user.id])).rows.map((r) => r.offer_id);
      if (offerIds.length) await c.query('SELECT id FROM store_offers WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE', [offerIds]);

      const q: Quote = await buildQuote(c, user.id, { addressId: input.addressId, method: input.method, couponCode: input.couponCode });
      if (!q.ok) throw new HttpError(409, 'checkout_blocked', 'Some things in your basket need attention before you can pay.', { issues: q.issues, coupon_error: q.coupon_error });

      const address = input.method === 'delivery' ? (await c.query('SELECT * FROM addresses WHERE id = $1 AND user_id = $2', [input.addressId, user.id])).rows[0] : null;
      const phone = address?.phone ?? (await c.query('SELECT phone FROM users WHERE id = $1', [user.id])).rows[0]?.phone ?? null;
      const num = orderNumber();
      const o = (await c.query(
        `INSERT INTO orders(order_number, user_id, fulfilment_method, address, customer_name, customer_phone, customer_email, delivery_instructions,
                            subtotal_cents, discount_cents, delivery_cents, tax_cents, total_cents, coupon_id, idempotency_key)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING id`,
        [num, user.id, input.method, address ? { line1: address.line1, line2: address.line2, city: address.city, province: address.province, postal_code: address.postal_code } : null,
         address?.recipient_name ?? user.full_name, phone, user.email, input.instructions ?? address?.instructions ?? null,
         q.subtotal_cents, q.discount_cents, q.delivery_cents, q.tax_cents, q.total_cents, q.coupon?.id ?? null, input.idempotencyKey])).rows[0];
      await history(c, o.id, null, null, 'pending_payment', user.id);

      const holdMinutes = await getSetting<number>('checkout.reservation_minutes', c);
      for (const s of q.suborders) {
        const sub = (await c.query(
          `INSERT INTO suborders(order_id, store_id, vendor_id, fulfilment_method, subtotal_cents, discount_cents, delivery_cents, delivery_tax_cents, tax_cents, total_cents,
                                 commission_bps, commission_cents, eta_minutes)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,
          [o.id, s.store_id, s.vendor_id, s.fulfilment_method, s.subtotal_cents, s.discount_cents, s.delivery_cents, s.delivery_tax_cents, s.tax_cents, s.total_cents, s.commission_bps, s.commission_cents, s.eta_minutes])).rows[0];
        for (const l of s.lines) {
          const line = (await c.query(
            `INSERT INTO order_lines(suborder_id, offer_id, product_id, product_name, brand, pack_label, sold_by, unit_price_cents, quantity, line_total_cents, discount_cents, tax_rate_bps, tax_cents, commission_cents)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id`,
            [sub.id, l.offer_id, l.product_id, l.name, l.brand, l.pack_label, l.sold_by, l.unit_price_cents, l.quantity, l.line_total_cents, l.discount_cents, l.tax_rate_bps, l.tax_cents, l.commission_cents])).rows[0];
          await c.query(`INSERT INTO inventory_reservations(order_line_id, offer_id, quantity, expires_at) VALUES ($1,$2,$3, now() + make_interval(mins => $4))`, [line.id, l.offer_id, l.quantity, holdMinutes]);
          await c.query('UPDATE store_offers SET stock_reserved = stock_reserved + $2 WHERE id = $1', [l.offer_id, l.quantity]);
        }
      }
      return { orderId: o.id as string, paymentAmount: q.total_cents, number: num };
    }));
  } catch (e: any) {
    // Two taps with the same key racing each other: the loser sees the unique violation and returns the winner's order.
    if (e.code === '23505' && /idempotency|orders_user_id/.test(e.constraint ?? e.detail ?? '')) {
      const r = (await pool.query('SELECT id FROM orders WHERE user_id = $1 AND idempotency_key = $2', [user.id, input.idempotencyKey])).rows[0];
      if (r) return view(r.id);
    }
    throw e;
  }

  // Create the payment for the exact amount we computed. If the provider is down, release the hold and say so.
  try {
    const provider = getProvider();
    const pay = await provider.createPayment({ amountCents: paymentAmount, currency: 'CAD', orderNumber: number, email: user.email, idempotencyKey: `pay:${orderId}` });
    await pool.query(`INSERT INTO payments(order_id, provider, provider_payment_id, amount_cents, client_secret, idempotency_key) VALUES ($1,$2,$3,$4,$5,$6)`,
      [orderId, provider.name, pay.providerPaymentId, paymentAmount, pay.clientSecret, `pay:${orderId}`]);
  } catch (e) {
    await tx(async (c) => {
      const held = (await c.query(`SELECT r.id, r.offer_id, r.quantity FROM inventory_reservations r JOIN order_lines l ON l.id=r.order_line_id JOIN suborders s ON s.id=l.suborder_id WHERE s.order_id=$1 AND r.status='held'`, [orderId])).rows;
      for (const r of held) {
        await c.query('UPDATE store_offers SET stock_reserved = stock_reserved - $2 WHERE id = $1', [r.offer_id, r.quantity]);
        await c.query(`UPDATE inventory_reservations SET status='released', resolved_at=now() WHERE id=$1`, [r.id]);
      }
      await c.query(`UPDATE orders SET status='payment_failed', payment_status='failed' WHERE id=$1`, [orderId]);
      await c.query(`UPDATE suborders SET status='cancelled' WHERE order_id=$1`, [orderId]);
    });
    console.error('payment provider error', e);
    throw new HttpError(502, 'payment_unavailable', 'We could not start your payment. You have not been charged. Please try again in a moment.');
  }
  return view(orderId);
}
