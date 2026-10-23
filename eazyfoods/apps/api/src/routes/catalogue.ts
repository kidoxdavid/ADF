import type { FastifyPluginAsync } from 'fastify';
import { pool } from '../db/pool.js';
import { productCards } from '../lib/listing.js';
import { normalisePostal, isCanadianPostal } from '../services/pricing.js';

export const catalogueRoutes: FastifyPluginAsync = async (app) => {
  app.get('/regions', async () => {
    const { rows } = await pool.query(`
      SELECT r.id, r.slug, r.name, r.description,
             COALESCE(json_agg(json_build_object('slug', c.slug, 'name', c.name) ORDER BY c.name) FILTER (WHERE c.id IS NOT NULL), '[]') AS countries
        FROM regions r
        LEFT JOIN region_countries rc ON rc.region_id = r.id
        LEFT JOIN countries c ON c.id = rc.country_id AND c.is_active
       WHERE r.is_active GROUP BY r.id ORDER BY r.sort_order, r.name`);
    return rows;
  });

  app.get('/categories', async () => {
    const { rows } = await pool.query('SELECT id, parent_id, slug, name FROM categories ORDER BY sort_order, name');
    return rows;
  });

  app.get('/collections', async () => {
    const { rows } = await pool.query('SELECT slug, title, subtitle FROM collections WHERE is_active ORDER BY sort_order, title');
    return rows;
  });

  app.get<{ Params: { slug: string } }>('/collections/:slug', async (req, reply) => {
    const col = (await pool.query('SELECT * FROM collections WHERE slug = $1 AND is_active', [req.params.slug])).rows[0];
    if (!col) return reply.code(404).send({ error: 'not_found' });
    // Manual items win; otherwise fall back to region/category rules.
    const products = await productCards(
      `CASE WHEN EXISTS (SELECT 1 FROM collection_products cp WHERE cp.collection_id = $1)
            THEN p.id IN (SELECT product_id FROM collection_products WHERE collection_id = $1)
            ELSE ($2::uuid IS NULL OR EXISTS (SELECT 1 FROM product_countries pc JOIN region_countries rc ON rc.country_id = pc.country_id
                                               WHERE pc.product_id = p.id AND pc.kind = 'culinary' AND rc.region_id = $2))
             AND ($3::uuid IS NULL OR p.category_id = $3 OR p.category_id IN (SELECT id FROM categories WHERE parent_id = $3))
       END`, [col.id, col.region_id, col.category_id], 'p.name', 60);
    return { collection: { slug: col.slug, title: col.title, subtitle: col.subtitle }, products };
  });

  // Merchandising feeds for the home page.
  app.get('/deals', async () => productCards(
    `EXISTS (SELECT 1 FROM offers_live o JOIN storefronts s ON s.id = o.store_id AND s.orderable WHERE o.product_id = p.id AND o.is_active AND o.on_promotion AND o.stock_on_hand - o.stock_reserved > 0)`, [], 'p.name', 20));
  app.get('/new-arrivals', async () => productCards('true', [], 'p.created_at DESC, p.name', 20));
  app.get<{ Params: { slug: string } }>('/products/:slug/related', async (req) =>
    productCards(`p.slug <> $1 AND (p.category_id = (SELECT category_id FROM products WHERE slug = $1)
        OR EXISTS (SELECT 1 FROM product_countries a JOIN product_countries b2 ON b2.country_id = a.country_id AND b2.kind = 'culinary'
                    WHERE a.product_id = (SELECT id FROM products WHERE slug = $1) AND a.kind = 'culinary' AND b2.product_id = p.id))`, [req.params.slug], 'p.name', 12));

  // "Deliver to" check used by the header. Postal-code area only; the real check happens again at checkout.
  app.get('/service-area', async (req, reply) => {
    const raw = String((req.query as any).postal ?? '');
    if (!isCanadianPostal(raw.length === 3 ? raw + '0A0' : raw)) return reply.code(400).send({ error: 'invalid_postal', message: 'Enter a Canadian postal code, e.g. T2A 0A0.' });
    const fsa = normalisePostal(raw).slice(0, 3);
    const z = (await pool.query(`SELECT z.name, z.fee_cents, z.free_over_cents, z.eta_minutes FROM delivery_zone_fsas f JOIN delivery_zones z ON z.id = f.zone_id AND z.is_active WHERE f.fsa = $1`, [fsa])).rows[0];
    return z ? { serviceable: true, fsa, zone: z.name, fee_cents: z.fee_cents, free_over_cents: z.free_over_cents, eta_minutes: z.eta_minutes } : { serviceable: false, fsa };
  });

  app.get<{ Params: { slug: string } }>('/products/:slug', async (req, reply) => {
    const p = (await pool.query(
      `SELECT p.*, b.name AS brand, c.name AS category, c.slug AS category_slug
         FROM products p LEFT JOIN brands b ON b.id = p.brand_id LEFT JOIN categories c ON c.id = p.category_id
        WHERE p.slug = $1 AND p.status = 'published'`, [req.params.slug])).rows[0];
    if (!p) return reply.code(404).send({ error: 'not_found' });
    const [countries, aliases, images, offers] = await Promise.all([
      pool.query(`SELECT c.name, pc.kind FROM product_countries pc JOIN countries c ON c.id = pc.country_id WHERE pc.product_id = $1 ORDER BY pc.kind, c.name`, [p.id]),
      pool.query(`SELECT alias FROM product_aliases WHERE product_id = $1 AND verified ORDER BY alias`, [p.id]),
      pool.query(`SELECT url, alt FROM product_images WHERE product_id = $1 ORDER BY sort_order`, [p.id]),
      pool.query(
        `SELECT s.slug AS store_slug, s.name AS store_name, s.is_open, s.is_test_data, o.id AS offer_id, o.price_cents, o.compare_at_cents, o.on_promotion,
                (o.stock_on_hand - o.stock_reserved) > 0 AS in_stock, GREATEST(o.stock_on_hand - o.stock_reserved, 0) AS available
           FROM offers_live o JOIN storefronts s ON s.id = o.store_id AND s.orderable
          WHERE o.product_id = $1 AND o.is_active ORDER BY o.price_cents`, [p.id]),
    ]);
    const { id, name_norm, status, ...pub } = p;
    return { ...pub, countries: countries.rows, aliases: aliases.rows.map((r) => r.alias), images: images.rows, offers: offers.rows };
  });
};
