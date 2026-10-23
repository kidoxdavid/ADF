import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { pool } from '../db/pool.js';
import { rl } from '../lib/ratelimit.js';
import { notFound } from '../lib/errors.js';

/** A campaign is live when approved, inside its dates, and has budget left (spend = clicks x CPC). */
export const LIVE_ADS = `
  SELECT c.*, COALESCE((SELECT count(*) FROM ad_events e WHERE e.campaign_id = c.id AND e.type = 'click'), 0)::int * c.cpc_cents AS spent_cents
    FROM ad_campaigns c WHERE c.status = 'approved' AND now() >= c.starts_at AND now() < c.ends_at`;

export const adRoutes: FastifyPluginAsync = async (app) => {
  app.get('/ads', async (req) => {
    const q = z.object({ placement: z.enum(['home_banner', 'region_banner', 'sponsored_store']), region: z.string().optional() }).parse(req.query);
    const { rows } = await pool.query(
      `SELECT * FROM (${LIVE_ADS}) a LEFT JOIN regions r ON r.id = a.region_id
        WHERE a.spent_cents < a.budget_cents AND a.placement = $1 AND ($2::text IS NULL OR a.region_id IS NULL OR r.slug = $2) ORDER BY random() LIMIT 3`, [q.placement, q.region ?? null]);
    const out = [];
    for (const a of rows) {
      const store = a.store_id ? (await pool.query('SELECT slug, name FROM storefronts WHERE id = $1 AND orderable', [a.store_id])).rows[0] : null;
      const product = a.product_id ? (await pool.query(`SELECT slug, name FROM products WHERE id = $1 AND status = 'published'`, [a.product_id])).rows[0] : null;
      if ((a.store_id && !store) || (a.product_id && !product)) continue;   // never advertise something unorderable
      out.push({ id: a.id, title: a.title, body: a.body, image_url: a.image_url, sponsored: true, store, product });
    }
    return out;
  });

  // Impressions and clicks. Clicks consume budget, so repeats from one client are throttled by the rate limit.
  app.post<{ Params: { id: string } }>('/ads/:id/event', rl(60, '1 minute'), async (req, reply) => {
    const id = z.string().uuid().parse(req.params.id);
    const { type } = z.object({ type: z.enum(['impression', 'click']) }).parse(req.body);
    const live = (await pool.query(`SELECT 1 FROM (${LIVE_ADS}) a WHERE a.id = $1 AND a.spent_cents < a.budget_cents`, [id])).rowCount;
    if (!live) throw notFound('Campaign not running');
    await pool.query('INSERT INTO ad_events(campaign_id, type) VALUES ($1,$2)', [id, type]);
    return reply.code(204).send();
  });
};
