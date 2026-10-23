import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { pool, tx } from '../db/pool.js';
import { requireLogin } from '../lib/permissions.js';
import { bad, conflict, notFound } from '../lib/errors.js';
import { buildQuote } from '../services/pricing.js';
import { placeOrder } from '../services/checkout.js';
import { moveSuborder } from '../services/orders.js';
import { refundWholeSuborder, createRefund, processRefund } from '../services/refunds.js';
import { history } from '../services/orders.js';
import { notifyVendorOwners } from '../services/notify.js';
import { rl } from '../lib/ratelimit.js';
import { cartView } from './cart.js';

const checkoutBody = z.object({
  address_id: z.string().uuid().nullish(), method: z.enum(['delivery', 'pickup']).default('delivery'),
  coupon_code: z.string().max(40).nullish(), instructions: z.string().max(300).nullish(),
});

export async function loadOrder(orderId: string, userId: string | null) {
  const o = (await pool.query(`SELECT * FROM orders WHERE id = $1 ${userId ? 'AND user_id = $2' : ''}`, userId ? [orderId, userId] : [orderId])).rows[0];
  if (!o) throw notFound('Order not found');
  const subs = (await pool.query(
    `SELECT s.*, st.name AS store_name, st.slug AS store_slug, st.phone AS store_phone, st.address_line AS store_address, st.city AS store_city,
            d.status AS delivery_status, d.handover_code, d.driver_id
       FROM suborders s JOIN stores st ON st.id = s.store_id LEFT JOIN deliveries d ON d.suborder_id = s.id WHERE s.order_id = $1 ORDER BY st.name`, [orderId])).rows;
  const lines = (await pool.query(
    `SELECT l.* , p.slug AS product_slug FROM order_lines l JOIN products p ON p.id = l.product_id WHERE l.suborder_id = ANY($1::uuid[]) ORDER BY l.product_name`, [subs.map((s) => s.id)])).rows;
  const hist = (await pool.query('SELECT suborder_id, from_status, to_status, note, created_at FROM order_status_history WHERE order_id = $1 ORDER BY id', [orderId])).rows;
  const reviewed = (await pool.query('SELECT suborder_id, product_id FROM reviews WHERE suborder_id = ANY($1::uuid[])', [subs.map((s) => s.id)])).rows;
  const refunds = (await pool.query(`SELECT suborder_id, status, amount_cents, reason, created_at FROM refunds WHERE order_id = $1 ORDER BY created_at`, [orderId])).rows;
  return {
    id: o.id, order_number: o.order_number, status: o.status, payment_status: o.payment_status, fulfilment_method: o.fulfilment_method, address: o.address,
    customer_name: o.customer_name, delivery_instructions: o.delivery_instructions,
    subtotal_cents: o.subtotal_cents, discount_cents: o.discount_cents, delivery_cents: o.delivery_cents, tax_cents: o.tax_cents, total_cents: o.total_cents,
    placed_at: o.placed_at, created_at: o.created_at,
    suborders: subs.map((s) => ({
      id: s.id, store_name: s.store_name, store_slug: s.store_slug, store_phone: s.store_phone, status: s.status, fulfilment_method: s.fulfilment_method,
      subtotal_cents: s.subtotal_cents, discount_cents: s.discount_cents, delivery_cents: s.delivery_cents + s.delivery_tax_cents, tax_cents: s.tax_cents, total_cents: s.total_cents,
      promised_at: s.promised_at, reject_reason: s.reject_reason, delivery_status: s.delivery_status,
      // The handover code is shown to the customer only while a delivery is on its way.
      handover_code: ['ready', 'out_for_delivery'].includes(s.status) && s.fulfilment_method === 'delivery' ? s.handover_code : undefined,
      pickup_address: s.fulfilment_method === 'pickup' ? `${s.store_address ?? ''}, ${s.store_city}` : undefined,
      lines: lines.filter((l) => l.suborder_id === s.id).map((l) => ({
        id: l.id, product_slug: l.product_slug, product_id: l.product_id, name: l.product_name, brand: l.brand, pack_label: l.pack_label, quantity: l.quantity, unit_price_cents: l.unit_price_cents,
        line_total_cents: l.line_total_cents, refunded_quantity: l.refunded_quantity, substitution_status: l.substitution_status, substitute_name: l.substitute_name,
        reviewed: reviewed.some((r) => r.suborder_id === s.id && r.product_id === l.product_id),
      })),
      reviewed_store: reviewed.some((r) => r.suborder_id === s.id && !r.product_id),
      timeline: hist.filter((h) => h.suborder_id === s.id).map((h) => ({ status: h.to_status, note: h.note, at: h.created_at })),
      refunds: refunds.filter((r) => r.suborder_id === s.id),
    })),
    timeline: hist.filter((h) => !h.suborder_id).map((h) => ({ status: h.to_status, note: h.note, at: h.created_at })),
  };
}

export const orderRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireLogin);

  app.post('/checkout/quote', async (req) => {
    const b = checkoutBody.parse(req.body);
    const q = await buildQuote(pool, req.user!.id, { addressId: b.address_id, method: b.method, couponCode: b.coupon_code });
    await pool.query(`INSERT INTO analytics_events(type, user_id) VALUES ('checkout_started', $1)`, [req.user!.id]).catch(() => {});
    return q;
  });

  app.post('/checkout', rl(20, '1 minute'), async (req, reply) => {
    const key = String(req.headers['idempotency-key'] ?? '');
    if (key.length < 8 || key.length > 100) throw bad('idempotency_key_required', 'Missing Idempotency-Key header.');
    const b = checkoutBody.parse(req.body);
    const r = await placeOrder(req.user!, { addressId: b.address_id, method: b.method, couponCode: b.coupon_code, instructions: b.instructions, idempotencyKey: key });
    return reply.code(201).send(r);
  });

  app.get('/orders', async (req) => {
    const { rows } = await pool.query(
      `SELECT o.id, o.order_number, o.status, o.payment_status, o.total_cents, o.created_at, o.fulfilment_method,
              (SELECT json_agg(json_build_object('store', st.name, 'status', s.status)) FROM suborders s JOIN stores st ON st.id = s.store_id WHERE s.order_id = o.id) AS stores
         FROM orders o WHERE o.user_id = $1 ORDER BY o.created_at DESC LIMIT 50`, [req.user!.id]);
    return rows;
  });

  app.get<{ Params: { id: string } }>('/orders/:id', async (req) => loadOrder(z.string().uuid().parse(req.params.id), req.user!.id));

  // Customer may cancel until the store accepts. Refund is automatic.
  app.post<{ Params: { id: string; sid: string } }>('/orders/:id/suborders/:sid/cancel', async (req) => {
    const { id, sid } = z.object({ id: z.string().uuid(), sid: z.string().uuid() }).parse(req.params);
    const own = (await pool.query('SELECT 1 FROM suborders s JOIN orders o ON o.id = s.order_id WHERE s.id = $1 AND o.id = $2 AND o.user_id = $3', [sid, id, req.user!.id])).rowCount;
    if (!own) throw notFound('Order not found');
    return tx((c, after) => moveSuborder(c, after, sid, 'cancelled', { userId: req.user!.id, kind: 'customer' }, 'Cancelled by customer'));
  });

  // Customer answers a substitution proposal. Declining refunds that item.
  app.post<{ Params: { id: string; lineId: string } }>('/orders/:id/lines/:lineId/substitution', async (req) => {
    const { id, lineId } = z.object({ id: z.string().uuid(), lineId: z.string().uuid() }).parse(req.params);
    const { accept } = z.object({ accept: z.boolean() }).parse(req.body);
    return tx(async (c, after) => {
      const l = (await c.query(
        `SELECT l.*, s.vendor_id, s.id AS sid FROM order_lines l JOIN suborders s ON s.id = l.suborder_id JOIN orders o ON o.id = s.order_id WHERE l.id = $1 AND o.id = $2 AND o.user_id = $3 FOR UPDATE OF l`, [lineId, id, req.user!.id])).rows[0];
      if (!l) throw notFound('Item not found');
      if (l.substitution_status !== 'proposed') throw conflict('no_proposal', 'There is no substitution waiting for your answer.');
      if (accept) {
        const o = (await c.query('SELECT stock_on_hand - stock_reserved AS available FROM store_offers WHERE id = $1 FOR UPDATE', [l.substitute_offer_id])).rows[0];
        if (!o || o.available < l.quantity) throw conflict('substitute_unavailable', 'Sorry, that replacement is no longer available.');
        const u = await c.query('UPDATE store_offers SET stock_on_hand = stock_on_hand - $2, updated_at = now() WHERE id = $1 RETURNING stock_on_hand', [l.substitute_offer_id, l.quantity]);
        await c.query(`INSERT INTO inventory_adjustments(offer_id, delta, reason, note, resulting_on_hand) VALUES ($1,$2,'sale','substitution',$3)`, [l.substitute_offer_id, -l.quantity, u.rows[0].stock_on_hand]);
        await c.query(`UPDATE order_lines SET substitution_status='approved' WHERE id=$1`, [lineId]);
        await history(c, id, l.sid, null, 'substitution_approved', req.user!.id, `${l.product_name} replaced with ${l.substitute_name} at no extra charge`);
      } else {
        await c.query(`UPDATE order_lines SET substitution_status='declined' WHERE id=$1`, [lineId]);
        await history(c, id, l.sid, null, 'substitution_declined', req.user!.id, l.product_name);
        const r = await createRefund(c, { suborderId: l.sid, lines: [{ line_id: lineId, quantity: l.quantity - l.refunded_quantity }], includeDelivery: false, reason: 'Substitution declined', vendorFunded: true, requestedBy: req.user!.id });
        after.push(() => processRefund(r.id, req.user!.id));
      }
      return { ok: true, status: accept ? 'approved' : 'declined' };
    });
  });

  // Reorder: put what is still available back in the basket, and say what was not.
  app.post<{ Params: { id: string } }>('/orders/:id/reorder', async (req) => {
    const id = z.string().uuid().parse(req.params.id);
    const own = (await pool.query('SELECT 1 FROM orders WHERE id = $1 AND user_id = $2', [id, req.user!.id])).rowCount;
    if (!own) throw notFound('Order not found');
    const lines = (await pool.query(`SELECT l.offer_id, l.quantity, l.product_name FROM order_lines l JOIN suborders s ON s.id = l.suborder_id WHERE s.order_id = $1`, [id])).rows;
    const skipped: string[] = [];
    await tx(async (c) => {
      const cid = (await c.query('INSERT INTO carts(user_id) VALUES ($1) ON CONFLICT (user_id) DO UPDATE SET updated_at = now() RETURNING id', [req.user!.id])).rows[0].id;
      for (const l of lines) {
        const o = (await c.query(`SELECT o.price_cents, o.is_active, o.stock_on_hand - o.stock_reserved AS available, s.orderable FROM offers_live o JOIN storefronts s ON s.id = o.store_id WHERE o.id = $1`, [l.offer_id])).rows[0];
        if (!o || !o.is_active || !o.orderable || o.available < 1) { skipped.push(l.product_name); continue; }
        await c.query(
          `INSERT INTO cart_items(cart_id, offer_id, quantity, added_price_cents) VALUES ($1,$2,LEAST($3,$5),$4)
           ON CONFLICT (cart_id, offer_id) DO UPDATE SET quantity = LEAST(cart_items.quantity + $3, $5, 99)`, [cid, l.offer_id, l.quantity, o.price_cents, o.available]);
      }
    });
    return { ...(await cartView(req.user!.id)), skipped };
  });
};
