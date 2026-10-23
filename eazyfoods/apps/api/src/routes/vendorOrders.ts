import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { pool, tx } from '../db/pool.js';
import { requireLogin } from '../lib/permissions.js';
import { bad, conflict, forbidden, notFound } from '../lib/errors.js';
import { assertVendorOwnsSuborder, history, moveSuborder } from '../services/orders.js';
import { createRefund, processRefund } from '../services/refunds.js';
import { notify } from '../services/notify.js';
import { getSetting } from '../lib/settings.js';

export const vendorIdsOf = (u: { roles: { vendor_id: string | null }[] }) => u.roles.map((r) => r.vendor_id).filter((x): x is string => !!x);

export const vendorOrderRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireLogin);
  const guard = (req: any, sid: string) => assertVendorOwnsSuborder(vendorIdsOf(req.user), sid);
  const sidOf = (req: any) => z.string().uuid().parse(req.params.sid);

  app.get('/orders', async (req) => {
    const status = z.object({ status: z.string().optional(), store: z.string().uuid().optional() }).parse(req.query);
    const vids = vendorIdsOf(req.user!);
    const acceptTimeout = await getSetting<number>('vendor.accept_timeout_minutes');
    const { rows } = await pool.query(
      `SELECT s.id, s.status, s.fulfilment_method, s.subtotal_cents, s.discount_cents, s.total_cents, s.commission_cents, s.created_at, s.promised_at, st.name AS store_name, st.id AS store_id,
              o.order_number, split_part(o.customer_name,' ',1) AS customer_first_name, o.delivery_instructions, o.placed_at,
              (s.status = 'placed' AND o.placed_at < now() - make_interval(mins => $3)) AS needs_attention,
              (SELECT json_agg(json_build_object('id', l.id, 'name', l.product_name, 'brand', l.brand, 'pack_label', l.pack_label, 'quantity', l.quantity, 'unit_price_cents', l.unit_price_cents,
                 'status', l.status, 'substitution_status', l.substitution_status, 'substitute_name', l.substitute_name, 'sold_by', l.sold_by, 'refunded_quantity', l.refunded_quantity) ORDER BY l.product_name)
                 FROM order_lines l WHERE l.suborder_id = s.id) AS lines
         FROM suborders s JOIN orders o ON o.id = s.order_id JOIN stores st ON st.id = s.store_id
        WHERE s.vendor_id = ANY($1::uuid[]) AND s.status <> 'awaiting_payment' AND s.status <> 'expired'
          AND ($2::text IS NULL OR s.status = $2) AND ($4::uuid IS NULL OR s.store_id = $4)
        ORDER BY (s.status = 'placed') DESC, o.placed_at DESC NULLS LAST LIMIT 200`, [vids, status.status ?? null, acceptTimeout, status.store ?? null]);
    return rows;
  });

  const move = (path: string, to: string, kind = 'vendor' as const) =>
    app.post(`/suborders/:sid/${path}`, async (req) => { const sid = sidOf(req); await guard(req, sid); return tx((c, after) => moveSuborder(c, after, sid, to, { userId: req.user!.id, kind }, null)); });
  move('accept', 'accepted'); move('preparing', 'preparing'); move('ready', 'ready'); move('collected', 'collected');

  app.post('/suborders/:sid/reject', async (req) => {
    const sid = sidOf(req); await guard(req, sid);
    const { reason } = z.object({ reason: z.string().min(3).max(300) }).parse(req.body);
    return tx((c, after) => moveSuborder(c, after, sid, 'rejected', { userId: req.user!.id, kind: 'vendor' }, reason));
  });

  // Item cannot be supplied: the customer is refunded for it (never silently dropped or swapped).
  app.post<{ Params: { sid: string; lineId: string } }>('/suborders/:sid/lines/:lineId/unavailable', async (req) => {
    const sid = sidOf(req); await guard(req, sid);
    const lineId = z.string().uuid().parse(req.params.lineId);
    return tx(async (c, after) => {
      const s = (await c.query('SELECT status, order_id FROM suborders WHERE id = $1 FOR UPDATE', [sid])).rows[0];
      if (!['accepted', 'preparing'].includes(s.status)) throw conflict('invalid_state', 'Accept the order before marking items unavailable.');
      const l = (await c.query('SELECT * FROM order_lines WHERE id = $1 AND suborder_id = $2 FOR UPDATE', [lineId, sid])).rows[0];
      if (!l) throw notFound('Item not found');
      if (l.quantity - l.refunded_quantity <= 0) throw conflict('already_refunded', 'That item was already refunded.');
      await c.query(`UPDATE order_lines SET status='unavailable' WHERE id=$1`, [lineId]);
      const r = await createRefund(c, { suborderId: sid, lines: [{ line_id: lineId, quantity: l.quantity - l.refunded_quantity }], includeDelivery: false, reason: `${l.product_name} unavailable`, vendorFunded: true, requestedBy: req.user!.id });
      await history(c, s.order_id, sid, null, 'item_unavailable', req.user!.id, l.product_name);
      after.push(() => processRefund(r.id, req.user!.id));
      return { ok: true, refund_id: r.id };
    });
  });

  // Propose a replacement from the same store, at no extra charge to the customer. The customer must accept.
  app.post<{ Params: { sid: string; lineId: string } }>('/suborders/:sid/lines/:lineId/substitute', async (req) => {
    const sid = sidOf(req); await guard(req, sid);
    const lineId = z.string().uuid().parse(req.params.lineId);
    const { offer_id } = z.object({ offer_id: z.string().uuid() }).parse(req.body);
    return tx(async (c, after) => {
      const s = (await c.query('SELECT s.status, s.store_id, s.order_id, o.user_id, o.customer_email, o.order_number FROM suborders s JOIN orders o ON o.id = s.order_id WHERE s.id = $1 FOR UPDATE OF s', [sid])).rows[0];
      if (!['accepted', 'preparing'].includes(s.status)) throw conflict('invalid_state', 'Accept the order before proposing a substitution.');
      const l = (await c.query('SELECT * FROM order_lines WHERE id = $1 AND suborder_id = $2 FOR UPDATE', [lineId, sid])).rows[0];
      if (!l || l.substitution_status !== 'none' || l.refunded_quantity > 0) throw conflict('not_substitutable', 'This item cannot be substituted.');
      const sub = (await c.query(`SELECT o.id, p.name, o.price_cents, o.stock_on_hand - o.stock_reserved AS available FROM offers_live o JOIN products p ON p.id = o.product_id
                                   WHERE o.id = $1 AND o.store_id = $2 AND o.is_active AND p.status = 'published'`, [offer_id, s.store_id])).rows[0];
      if (!sub || sub.available < l.quantity) throw bad('invalid_substitute', 'That replacement is not available in enough quantity.');
      if (offer_id === l.offer_id) throw bad('invalid_substitute', 'Pick a different product.');
      await c.query(`UPDATE order_lines SET substitution_status='proposed', substitute_offer_id=$2, substitute_name=$3, substitute_unit_price_cents=$4 WHERE id=$1`, [lineId, offer_id, sub.name, sub.price_cents]);
      await history(c, s.order_id, sid, null, 'substitution_proposed', req.user!.id, `${l.product_name} -> ${sub.name}`);
      after.push(() => notify(pool, { userId: s.user_id, email: s.customer_email, template: 'substitution_proposed', vars: { order_number: s.order_number } }));
      return { ok: true };
    });
  });
};
