import type { FastifyPluginAsync } from 'fastify';
import { pool } from '../db/pool.js';

export const storeRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Querystring: { region?: string } }>('/stores', async (req) => {
    const { rows } = await pool.query(
      `SELECT s.slug, s.name, s.description, s.city, s.is_open, s.min_order_cents, s.is_test_data,
              COALESCE(json_agg(DISTINCT jsonb_build_object('slug', r.slug, 'name', r.name)) FILTER (WHERE r.id IS NOT NULL), '[]') AS regions
         FROM storefronts s
         LEFT JOIN store_regions sr ON sr.store_id = s.id LEFT JOIN regions r ON r.id = sr.region_id
        WHERE s.orderable AND ($1::text IS NULL OR EXISTS (SELECT 1 FROM store_regions x JOIN regions rr ON rr.id = x.region_id WHERE x.store_id = s.id AND rr.slug = $1))
        GROUP BY s.id, s.slug, s.name, s.description, s.city, s.is_open, s.min_order_cents, s.is_test_data ORDER BY s.name`,
      [req.query.region ?? null],
    );
    return rows;
  });

  app.get<{ Params: { slug: string } }>('/stores/:slug', async (req, reply) => {
    const s = (await pool.query(`SELECT * FROM storefronts WHERE slug = $1 AND orderable`, [req.params.slug])).rows[0];
    if (!s) return reply.code(404).send({ error: 'not_found' });
    const [hours, regions, products] = await Promise.all([
      pool.query('SELECT dow, opens, closes FROM store_hours WHERE store_id = $1 ORDER BY dow, opens', [s.id]),
      pool.query('SELECT r.slug, r.name FROM store_regions sr JOIN regions r ON r.id = sr.region_id WHERE sr.store_id = $1', [s.id]),
      pool.query(
        `SELECT p.slug, p.name, p.pack_size, p.pack_unit, b.name AS brand, c.name AS category, c.slug AS category_slug, o.id AS offer_id, o.price_cents, o.compare_at_cents, o.on_promotion,
                (SELECT url FROM product_images WHERE product_id = p.id ORDER BY sort_order LIMIT 1) AS image_url,
                (o.stock_on_hand - o.stock_reserved) > 0 AS in_stock, GREATEST(o.stock_on_hand - o.stock_reserved, 0) AS available
           FROM offers_live o JOIN products p ON p.id = o.product_id AND p.status = 'published'
           LEFT JOIN brands b ON b.id = p.brand_id LEFT JOIN categories c ON c.id = p.category_id
          WHERE o.store_id = $1 AND o.is_active ORDER BY p.name`, [s.id]),
    ]);
    return {
      slug: s.slug, name: s.name, description: s.description, address_line: s.address_line, city: s.city, province: s.province,
      postal_code: s.postal_code, phone: s.phone, is_open: s.is_open, min_order_cents: s.min_order_cents, is_test_data: s.is_test_data,
      logo_url: s.logo_url, cover_url: s.cover_url, policies: s.policies, offers_delivery: s.offers_delivery, offers_pickup: s.offers_pickup, ordering_paused: s.ordering_paused,
      hours: hours.rows, regions: regions.rows, products: products.rows,
    };
  });
};
