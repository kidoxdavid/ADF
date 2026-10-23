import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { pool, tx } from '../db/pool.js';
import { audit, canManageStore, requireUser } from '../lib/auth.js';

const ids = z.object({ storeId: z.string().uuid(), productId: z.string().uuid() });

export const vendorRoutes: FastifyPluginAsync = async (app) => {
  // Every vendor route requires a signed-in user; per-store ownership is checked in each handler.
  app.addHook('preHandler', async (req, reply) => { if (!requireUser(req, reply)) return reply; });

  app.get('/stores', async (req) => {
    const vendorIds = req.user!.roles.filter((r) => r.vendor_id).map((r) => r.vendor_id);
    const { rows } = await pool.query(
      `SELECT id, slug, name, status, orderable, is_open FROM storefronts WHERE vendor_id = ANY($1::uuid[]) ORDER BY name`, [vendorIds]);
    return rows;
  });

  app.get<{ Params: { storeId: string } }>('/stores/:storeId/offers', async (req, reply) => {
    const { storeId } = z.object({ storeId: z.string().uuid() }).parse(req.params);
    if (!(await canManageStore(req.user!, storeId))) return reply.code(403).send({ error: 'forbidden' });
    const { rows } = await pool.query(
      `SELECT o.product_id, p.name, p.slug, o.price_cents, o.compare_at_cents, o.is_active, o.stock_on_hand, o.stock_reserved,
              (o.stock_on_hand - o.stock_reserved) AS available, (o.stock_on_hand - o.stock_reserved) <= o.low_stock_threshold AS low_stock
         FROM store_offers o JOIN products p ON p.id = o.product_id WHERE o.store_id = $1 ORDER BY p.name`, [storeId]);
    return rows;
  });

  app.put('/stores/:storeId/offers/:productId', async (req, reply) => {
    const { storeId, productId } = ids.parse(req.params);
    if (!(await canManageStore(req.user!, storeId))) return reply.code(403).send({ error: 'forbidden' });
    const b = z.object({
      price_cents: z.number().int().positive().max(1_000_000),
      compare_at_cents: z.number().int().positive().nullable().optional(),
      is_active: z.boolean().default(true),
    }).refine((v) => v.compare_at_cents == null || v.compare_at_cents > v.price_cents, { message: 'compare_at must exceed price' }).parse(req.body);
    const prod = await pool.query(`SELECT 1 FROM products WHERE id = $1 AND status = 'published'`, [productId]);
    if (!prod.rowCount) return reply.code(404).send({ error: 'product_not_found', message: 'Pick a published catalogue product, or suggest a new one.' });
    const { rows } = await pool.query(
      `INSERT INTO store_offers(store_id, product_id, price_cents, compare_at_cents, is_active) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (store_id, product_id) DO UPDATE SET price_cents = $3, compare_at_cents = $4, is_active = $5, updated_at = now()
       RETURNING id, price_cents, compare_at_cents, is_active, stock_on_hand`,
      [storeId, productId, b.price_cents, b.compare_at_cents ?? null, b.is_active]);
    await audit(req.user!.id, 'offer.upsert', 'store_offer', rows[0].id, b);
    return rows[0];
  });

  app.post('/stores/:storeId/offers/:productId/stock', async (req, reply) => {
    const { storeId, productId } = ids.parse(req.params);
    if (!(await canManageStore(req.user!, storeId))) return reply.code(403).send({ error: 'forbidden' });
    const b = z.object({
      delta: z.number().int().refine((n) => n !== 0, 'delta cannot be zero').refine((n) => Math.abs(n) <= 100000),
      reason: z.enum(['receive', 'correction', 'damage', 'expired', 'return']),
      note: z.string().max(300).optional(),
    }).parse(req.body);

    const result = await tx(async (c) => {
      const o = (await c.query('SELECT id, stock_on_hand, stock_reserved FROM store_offers WHERE store_id = $1 AND product_id = $2 FOR UPDATE', [storeId, productId])).rows[0];
      if (!o) return { status: 404 as const };
      const next = o.stock_on_hand + b.delta;
      if (next < o.stock_reserved) return { status: 409 as const, reserved: o.stock_reserved };
      await c.query('UPDATE store_offers SET stock_on_hand = $2, updated_at = now() WHERE id = $1', [o.id, next]);
      await c.query('INSERT INTO inventory_adjustments(offer_id, delta, reason, note, actor_user_id, resulting_on_hand) VALUES ($1,$2,$3,$4,$5,$6)',
        [o.id, b.delta, b.reason, b.note ?? null, req.user!.id, next]);
      return { status: 200 as const, stock_on_hand: next };
    });
    if (result.status === 404) return reply.code(404).send({ error: 'offer_not_found' });
    if (result.status === 409) return reply.code(409).send({ error: 'below_reserved', message: `${result.reserved} units are reserved for open orders; stock cannot go below that.` });
    return result;
  });

  app.get('/stores/:storeId/offers/:productId/adjustments', async (req, reply) => {
    const { storeId, productId } = ids.parse(req.params);
    if (!(await canManageStore(req.user!, storeId))) return reply.code(403).send({ error: 'forbidden' });
    const { rows } = await pool.query(
      `SELECT a.delta, a.reason, a.note, a.resulting_on_hand, a.created_at, u.full_name AS actor
         FROM inventory_adjustments a JOIN store_offers o ON o.id = a.offer_id LEFT JOIN users u ON u.id = a.actor_user_id
        WHERE o.store_id = $1 AND o.product_id = $2 ORDER BY a.id DESC LIMIT 100`, [storeId, productId]);
    return rows;
  });
};
