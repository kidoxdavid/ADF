import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { pool, tx } from '../db/pool.js';
import { requireLogin } from '../lib/permissions.js';
import { conflict, notFound } from '../lib/errors.js';

const ITEMS_SQL = `
  SELECT ci.offer_id, ci.quantity, ci.added_price_cents, o.price_cents, o.compare_at_cents, o.is_active, GREATEST(o.stock_on_hand - o.stock_reserved, 0) AS available,
         p.slug, p.name, p.status AS pstatus, p.sold_by, p.pack_size, p.pack_unit, b.name AS brand,
         s.slug AS store_slug, s.name AS store_name, s.orderable, s.is_open, s.min_order_cents, s.is_test_data
    FROM cart_items ci JOIN carts ct ON ct.id = ci.cart_id
    JOIN offers_live o ON o.id = ci.offer_id JOIN products p ON p.id = o.product_id JOIN storefronts s ON s.id = o.store_id
    LEFT JOIN brands b ON b.id = p.brand_id
   WHERE ct.user_id = $1 ORDER BY s.name, p.name`;

export async function cartView(userId: string) {
  const rows = (await pool.query(ITEMS_SQL, [userId])).rows;
  const stores = new Map<string, any>();
  for (const r of rows) {
    const st = stores.get(r.store_slug) ?? stores.set(r.store_slug, { slug: r.store_slug, name: r.store_name, is_open: r.is_open, is_test_data: r.is_test_data, min_order_cents: r.min_order_cents, orderable: r.orderable, subtotal_cents: 0, items: [] }).get(r.store_slug);
    const unavailable = !r.is_active || r.pstatus !== 'published' || !r.orderable || r.available < 1;
    st.items.push({
      offer_id: r.offer_id, slug: r.slug, name: r.name, brand: r.brand, pack_size: r.pack_size, pack_unit: r.pack_unit, sold_by: r.sold_by,
      quantity: r.quantity, unit_price_cents: r.price_cents, compare_at_cents: r.compare_at_cents, available: r.available,
      unavailable, short: !unavailable && r.available < r.quantity, price_changed: r.added_price_cents !== r.price_cents, previous_price_cents: r.added_price_cents,
    });
    if (!unavailable) st.subtotal_cents += r.price_cents * r.quantity;
  }
  const list = [...stores.values()];
  return { stores: list, item_count: rows.reduce((a, r) => a + r.quantity, 0), subtotal_cents: list.reduce((a, s) => a + s.subtotal_cents, 0), separate_deliveries: list.length > 1 };
}

async function cartId(c: { query: typeof pool.query }, userId: string): Promise<string> {
  const r = await c.query('INSERT INTO carts(user_id) VALUES ($1) ON CONFLICT (user_id) DO UPDATE SET updated_at = now() RETURNING id', [userId]);
  return r.rows[0].id;
}

export const cartRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireLogin);

  app.get('/cart', async (req) => cartView(req.user!.id));

  app.put<{ Params: { offerId: string } }>('/cart/items/:offerId', async (req) => {
    const offerId = z.string().uuid().parse(req.params.offerId);
    const { quantity } = z.object({ quantity: z.number().int().min(0).max(99) }).parse(req.body);
    await tx(async (c) => {
      const cid = await cartId(c, req.user!.id);
      if (quantity === 0) { await c.query('DELETE FROM cart_items WHERE cart_id = $1 AND offer_id = $2', [cid, offerId]); return; }
      const o = (await c.query(
        `SELECT o.price_cents, o.is_active, o.stock_on_hand - o.stock_reserved AS available, s.orderable FROM offers_live o JOIN storefronts s ON s.id = o.store_id WHERE o.id = $1`, [offerId])).rows[0];
      if (!o || !o.is_active || !o.orderable) throw notFound('That product is not available from this store.');
      if (quantity > o.available) throw conflict('insufficient_stock', o.available > 0 ? `Only ${o.available} available.` : 'Out of stock.', { available: Math.max(0, o.available) });
      await c.query(
        `INSERT INTO cart_items(cart_id, offer_id, quantity, added_price_cents) VALUES ($1,$2,$3,$4)
         ON CONFLICT (cart_id, offer_id) DO UPDATE SET quantity = $3, added_price_cents = CASE WHEN cart_items.quantity = $3 THEN cart_items.added_price_cents ELSE $4 END`,
        [cid, offerId, quantity, o.price_cents]);
      await c.query(`INSERT INTO analytics_events(type, user_id, store_id) SELECT 'add_to_cart', $1, store_id FROM store_offers WHERE id = $2`, [req.user!.id, offerId]);
    });
    return cartView(req.user!.id);
  });

  // Accept the new prices shown in the basket (clears "price changed" flags).
  app.post('/cart/acknowledge-prices', async (req) => {
    await pool.query(`UPDATE cart_items ci SET added_price_cents = o.price_cents FROM offers_live o, carts ct WHERE o.id = ci.offer_id AND ct.id = ci.cart_id AND ct.user_id = $1`, [req.user!.id]);
    return cartView(req.user!.id);
  });

  app.delete('/cart', async (req) => {
    await pool.query('DELETE FROM cart_items WHERE cart_id IN (SELECT id FROM carts WHERE user_id = $1)', [req.user!.id]);
    return cartView(req.user!.id);
  });

  // Merge a basket built while signed out. Invalid or sold-out lines are skipped and reported.
  app.post('/cart/merge', async (req) => {
    const { items } = z.object({ items: z.array(z.object({ offer_id: z.string().uuid(), quantity: z.number().int().min(1).max(99) })).max(100) }).parse(req.body);
    const skipped: string[] = [];
    await tx(async (c) => {
      const cid = await cartId(c, req.user!.id);
      for (const it of items) {
        const o = (await c.query(`SELECT o.price_cents, o.is_active, o.stock_on_hand - o.stock_reserved AS available, s.orderable FROM offers_live o JOIN storefronts s ON s.id = o.store_id WHERE o.id = $1`, [it.offer_id])).rows[0];
        if (!o || !o.is_active || !o.orderable || o.available < 1) { skipped.push(it.offer_id); continue; }
        await c.query(
          `INSERT INTO cart_items(cart_id, offer_id, quantity, added_price_cents) VALUES ($1,$2,LEAST($3,$5),$4)
           ON CONFLICT (cart_id, offer_id) DO UPDATE SET quantity = LEAST(cart_items.quantity + $3, $5, 99)`, [cid, it.offer_id, it.quantity, o.price_cents, o.available]);
      }
    });
    return { ...(await cartView(req.user!.id)), skipped };
  });
};
