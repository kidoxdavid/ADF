import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { pool } from '../db/pool.js';
import { requireLogin } from '../lib/permissions.js';
import { conflict, notFound } from '../lib/errors.js';
import { rl } from '../lib/ratelimit.js';

/** Ratings are only shown once there are at least this many genuine reviews. */
export const MIN_REVIEWS_TO_SHOW = 3;

export const engagementRoutes: FastifyPluginAsync = async (app) => {
  // ---- Reviews: only the buyer of a delivered/collected order may review it, once per store/product per order ----
  app.post<{ Params: { id: string } }>('/orders/:id/reviews', { preHandler: requireLogin }, async (req, reply) => {
    const id = z.string().uuid().parse(req.params.id);
    const b = z.object({ suborder_id: z.string().uuid(), product_id: z.string().uuid().optional(), rating: z.number().int().min(1).max(5), body: z.string().max(1000).optional() }).parse(req.body);
    const s = (await pool.query(
      `SELECT s.id, s.store_id FROM suborders s JOIN orders o ON o.id = s.order_id WHERE s.id = $1 AND o.id = $2 AND o.user_id = $3 AND s.status IN ('delivered','collected')`, [b.suborder_id, id, req.user!.id])).rows[0];
    if (!s) throw notFound('You can review an order after it has been delivered.');
    if (b.product_id) {
      const has = (await pool.query(`SELECT 1 FROM order_lines WHERE suborder_id = $1 AND product_id = $2 AND status = 'active' AND quantity > refunded_quantity`, [b.suborder_id, b.product_id])).rowCount;
      if (!has) throw notFound('That product was not part of this delivered order.');
    }
    try {
      const r = await pool.query('INSERT INTO reviews(user_id, suborder_id, store_id, product_id, rating, body) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id', [req.user!.id, b.suborder_id, s.store_id, b.product_id ?? null, b.rating, b.body ?? null]);
      return reply.code(201).send({ id: r.rows[0].id });
    } catch (e: any) {
      if (e.code === '23505') throw conflict('already_reviewed', 'You have already reviewed this.');
      throw e;
    }
  });

  // ---- Favourites ----
  app.get('/favourites', { preHandler: requireLogin }, async (req) =>
    (await pool.query(
      `SELECT p.slug, p.name, b.name AS brand, p.pack_size, p.pack_unit, off.min_price, COALESCE(off.in_stock, false) AS in_stock
         FROM favourites f JOIN products p ON p.id = f.product_id AND p.status = 'published' LEFT JOIN brands b ON b.id = p.brand_id
         LEFT JOIN LATERAL (SELECT COALESCE(min(o.price_cents) FILTER (WHERE o.stock_on_hand - o.stock_reserved > 0), min(o.price_cents)) AS min_price,
                                   bool_or(o.stock_on_hand - o.stock_reserved > 0) AS in_stock
                              FROM offers_live o JOIN storefronts s ON s.id = o.store_id AND s.orderable WHERE o.product_id = p.id AND o.is_active) off ON true
        WHERE f.user_id = $1 ORDER BY f.created_at DESC`, [req.user!.id])).rows);

  app.put<{ Params: { slug: string } }>('/favourites/:slug', { preHandler: requireLogin }, async (req) => {
    const p = (await pool.query(`SELECT id FROM products WHERE slug = $1 AND status = 'published'`, [req.params.slug])).rows[0];
    if (!p) throw notFound('Product not found');
    await pool.query('INSERT INTO favourites(user_id, product_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [req.user!.id, p.id]);
    return { favourite: true };
  });
  app.delete<{ Params: { slug: string } }>('/favourites/:slug', { preHandler: requireLogin }, async (req) => {
    await pool.query('DELETE FROM favourites WHERE user_id = $1 AND product_id = (SELECT id FROM products WHERE slug = $2)', [req.user!.id, req.params.slug]);
    return { favourite: false };
  });
  app.get<{ Params: { slug: string } }>('/favourites/:slug', { preHandler: requireLogin }, async (req) => ({
    favourite: !!(await pool.query('SELECT 1 FROM favourites f JOIN products p ON p.id = f.product_id WHERE f.user_id = $1 AND p.slug = $2', [req.user!.id, req.params.slug])).rowCount,
  }));

  // ---- Public review display ----
  app.get<{ Params: { slug: string } }>('/stores/:slug/reviews', async (req) => reviewList('store', req.params.slug));
  app.get<{ Params: { slug: string } }>('/products/:slug/reviews', async (req) => reviewList('product', req.params.slug));

  // ---- First-party analytics (no third-party trackers). Only what the funnel needs. ----
  app.post('/events', rl(120, '1 minute'), async (req, reply) => {
    const b = z.object({ type: z.literal('product_view'), product_slug: z.string().max(200), session_id: z.string().max(64).optional(), utm_source: z.string().max(60).optional(), utm_campaign: z.string().max(80).optional() }).parse(req.body);
    await pool.query(`INSERT INTO analytics_events(type, user_id, session_id, product_id, utm_source, utm_campaign) VALUES ('product_view',$1,$2,(SELECT id FROM products WHERE slug = $3),$4,$5)`,
      [req.user?.id ?? null, b.session_id ?? null, b.product_slug, b.utm_source ?? null, b.utm_campaign ?? null]);
    return reply.code(204).send();
  });
};

async function reviewList(kind: 'store' | 'product', slug: string) {
  const col = kind === 'store' ? `r.store_id = (SELECT id FROM stores WHERE slug = $1) AND r.product_id IS NULL` : `r.product_id = (SELECT id FROM products WHERE slug = $1)`;
  const agg = (await pool.query(`SELECT count(*)::int AS count, round(avg(r.rating)::numeric, 1)::float AS average FROM reviews r WHERE ${col} AND NOT r.is_hidden`, [slug])).rows[0];
  const show = agg.count >= MIN_REVIEWS_TO_SHOW;
  const reviews = (await pool.query(
    `SELECT r.rating, r.body, r.created_at, split_part(u.full_name, ' ', 1) AS first_name FROM reviews r JOIN users u ON u.id = r.user_id WHERE ${col} AND NOT r.is_hidden ORDER BY r.created_at DESC LIMIT 20`, [slug])).rows;
  // Below the threshold we show neither an average nor individual scores, so one rating cannot mislead.
  return { count: agg.count, average: show ? agg.average : null, reviews: show ? reviews.map((r) => ({ ...r, verified_purchase: true })) : [] };
}
