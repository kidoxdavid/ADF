import type { FastifyPluginAsync } from 'fastify';
import { pool } from '../db/pool.js';

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
    const { rows } = await pool.query(
      `SELECT p.id, p.slug, p.name, p.pack_size, p.pack_unit, b.name AS brand, off.min_price, off.in_stock
         FROM products p
         LEFT JOIN brands b ON b.id = p.brand_id
         JOIN LATERAL (
           SELECT COALESCE(min(o.price_cents) FILTER (WHERE o.stock_on_hand - o.stock_reserved > 0), min(o.price_cents)) AS min_price,
                  COALESCE(bool_or(o.stock_on_hand - o.stock_reserved > 0), false) AS in_stock, count(*) AS n
             FROM store_offers o JOIN storefronts s ON s.id = o.store_id AND s.orderable
            WHERE o.product_id = p.id AND o.is_active) off ON off.n > 0
        WHERE p.status = 'published' AND (
          CASE WHEN EXISTS (SELECT 1 FROM collection_products cp WHERE cp.collection_id = $1)
               THEN p.id IN (SELECT product_id FROM collection_products WHERE collection_id = $1)
               ELSE ($2::uuid IS NULL OR EXISTS (SELECT 1 FROM product_countries pc JOIN region_countries rc ON rc.country_id = pc.country_id
                                                  WHERE pc.product_id = p.id AND pc.kind = 'culinary' AND rc.region_id = $2))
                AND ($3::uuid IS NULL OR p.category_id = $3 OR p.category_id IN (SELECT id FROM categories WHERE parent_id = $3))
          END)
        ORDER BY p.name LIMIT 60`,
      [col.id, col.region_id, col.category_id],
    );
    return { collection: { slug: col.slug, title: col.title, subtitle: col.subtitle }, products: rows };
  });

  app.get<{ Params: { slug: string } }>('/products/:slug', async (req, reply) => {
    const p = (await pool.query(
      `SELECT p.*, b.name AS brand, c.name AS category
         FROM products p LEFT JOIN brands b ON b.id = p.brand_id LEFT JOIN categories c ON c.id = p.category_id
        WHERE p.slug = $1 AND p.status = 'published'`, [req.params.slug])).rows[0];
    if (!p) return reply.code(404).send({ error: 'not_found' });
    const [countries, aliases, images, offers] = await Promise.all([
      pool.query(`SELECT c.name, pc.kind FROM product_countries pc JOIN countries c ON c.id = pc.country_id WHERE pc.product_id = $1 ORDER BY pc.kind, c.name`, [p.id]),
      pool.query(`SELECT alias FROM product_aliases WHERE product_id = $1 AND verified ORDER BY alias`, [p.id]),
      pool.query(`SELECT url, alt FROM product_images WHERE product_id = $1 ORDER BY sort_order`, [p.id]),
      pool.query(
        `SELECT s.slug AS store_slug, s.name AS store_name, s.is_open, s.is_test_data, o.price_cents, o.compare_at_cents,
                (o.stock_on_hand - o.stock_reserved) > 0 AS in_stock
           FROM store_offers o JOIN storefronts s ON s.id = o.store_id AND s.orderable
          WHERE o.product_id = $1 AND o.is_active ORDER BY o.price_cents`, [p.id]),
    ]);
    const { id, name_norm, status, ...pub } = p;
    return { ...pub, countries: countries.rows, aliases: aliases.rows.map((r) => r.alias), images: images.rows, offers: offers.rows };
  });
};
