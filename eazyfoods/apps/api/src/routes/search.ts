import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { pool } from '../db/pool.js';
import { norm } from '../lib/norm.js';
import { LIVE_ADS } from './ads.js';

const query = z.object({
  q: z.string().max(100).default(''),
  region: z.string().optional(),
  country: z.string().optional(),
  category: z.string().optional(),
  store: z.string().optional(),
  in_stock: z.enum(['1']).optional(),
  min_price: z.coerce.number().int().min(0).optional(),
  max_price: z.coerce.number().int().min(0).optional(),
  sort: z.enum(['relevance', 'price_asc', 'price_desc', 'name']).default('relevance'),
  page: z.coerce.number().int().min(1).default(1),
});
const PAGE = 24;
const MIN_SCORE = 0.4;

export const searchRoutes: FastifyPluginAsync = async (app) => {
  app.get('/search', async (req) => {
    const a = query.parse(req.query);
    const t = norm(a.q);
    const offset = (a.page - 1) * PAGE;

    const sql = `
      WITH scored AS (
        SELECT p.id,
               GREATEST(
                 CASE WHEN $1 = '' THEN 0 ELSE GREATEST(similarity(p.name_norm, $1), word_similarity($1, p.name_norm)) END,
                 CASE WHEN $1 <> '' AND p.name_norm LIKE '%' || $1 || '%' THEN 1 ELSE 0 END) AS s_name,
               (SELECT COALESCE(max(CASE WHEN $1 <> '' THEN GREATEST(similarity(b.name_norm, $1), word_similarity($1, b.name_norm)) END) * 0.8, 0)
                  FROM brands b WHERE b.id = p.brand_id) AS s_brand,
               al.alias AS alias, COALESCE(al.s, 0) AS s_alias
          FROM products p
          LEFT JOIN LATERAL (
            SELECT a.alias, GREATEST(similarity(a.alias_norm, $1), word_similarity($1, a.alias_norm)) AS s
              FROM product_aliases a
             WHERE a.product_id = p.id AND a.verified AND $1 <> ''
             ORDER BY 2 DESC LIMIT 1) al ON true
         WHERE p.status = 'published'
      ), ranked AS (
        SELECT id, alias, GREATEST(s_name, s_brand, s_alias) AS score,
               CASE WHEN s_alias > s_name AND s_alias >= $2 THEN alias END AS matched_alias
          FROM scored
         WHERE $1 = '' OR GREATEST(s_name, s_brand, s_alias) >= $2
      ), listing AS (
        SELECT p.slug, p.name, p.pack_size, p.pack_unit, b.name AS brand, c.name AS category,
               (SELECT url FROM product_images WHERE product_id = p.id ORDER BY sort_order LIMIT 1) AS image_url, p.id AS product_id,
               r.score, r.matched_alias, off.min_price, off.was_price, off.on_sale, off.store_count, off.in_stock, off.offer_id, off.store_name, off.store_slug, off.available, c.slug AS category_slug,
               (SELECT CASE WHEN count(*) >= 3 THEN round(avg(rv.rating)::numeric, 1)::float END FROM reviews rv WHERE rv.product_id = p.id AND NOT rv.is_hidden) AS rating_avg,
               (SELECT count(*)::int FROM reviews rv WHERE rv.product_id = p.id AND NOT rv.is_hidden) AS rating_count, p.category_id
          FROM ranked r
          JOIN products p ON p.id = r.id
          LEFT JOIN brands b ON b.id = p.brand_id
          LEFT JOIN categories c ON c.id = p.category_id
          JOIN LATERAL (
            SELECT COALESCE(min(o.price_cents) FILTER (WHERE o.stock_on_hand - o.stock_reserved > 0), min(o.price_cents)) AS min_price,
                   count(DISTINCT o.store_id) AS store_count,
                   COALESCE(bool_or(o.stock_on_hand - o.stock_reserved > 0), false) AS in_stock,
                   COALESCE(bool_or(o.on_promotion), false) AS on_sale, max(o.compare_at_cents) AS was_price,
                   (array_agg(o.id ORDER BY o.price_cents) FILTER (WHERE o.stock_on_hand - o.stock_reserved > 0))[1] AS offer_id,
                   (array_agg(s.name ORDER BY o.price_cents) FILTER (WHERE o.stock_on_hand - o.stock_reserved > 0))[1] AS store_name,
                   (array_agg(s.slug ORDER BY o.price_cents) FILTER (WHERE o.stock_on_hand - o.stock_reserved > 0))[1] AS store_slug,
                   (array_agg(o.stock_on_hand - o.stock_reserved ORDER BY o.price_cents) FILTER (WHERE o.stock_on_hand - o.stock_reserved > 0))[1] AS available
              FROM offers_live o JOIN storefronts s ON s.id = o.store_id AND s.orderable
             WHERE o.product_id = p.id AND o.is_active
               AND ($6::text IS NULL OR s.slug = $6)
               AND ($7::boolean IS NOT TRUE OR o.stock_on_hand - o.stock_reserved > 0)
          ) off ON off.store_count > 0
         WHERE ($3::text IS NULL OR EXISTS (
                  SELECT 1 FROM product_countries pc JOIN region_countries rc ON rc.country_id = pc.country_id JOIN regions rg ON rg.id = rc.region_id
                   WHERE pc.product_id = p.id AND pc.kind = 'culinary' AND rg.slug = $3))
           AND ($4::text IS NULL OR EXISTS (
                  SELECT 1 FROM product_countries pc JOIN countries cn ON cn.id = pc.country_id
                   WHERE pc.product_id = p.id AND pc.kind = 'culinary' AND cn.slug = $4))
           AND ($5::text IS NULL OR c.slug = $5 OR c.parent_id = (SELECT id FROM categories WHERE slug = $5))
           AND ($8::int IS NULL OR off.min_price >= $8) AND ($9::int IS NULL OR off.min_price <= $9)
      )
      SELECT *, count(*) OVER () AS total FROM listing
       ORDER BY CASE WHEN $10 = 'price_asc' THEN min_price END ASC,
                CASE WHEN $10 = 'price_desc' THEN min_price END DESC,
                CASE WHEN $10 = 'relevance' THEN score END DESC,
                name
       LIMIT 500`;
    const { rows } = await pool.query(sql, [
      t, MIN_SCORE, a.region ?? null, a.country ?? null, a.category ?? null, a.store ?? null,
      a.in_stock ? true : null, a.min_price ?? null, a.max_price ?? null, a.sort,
    ]);
    const total = rows[0] ? Number(rows[0].total) : 0;
    const all = rows;
    const pageRows = rows.slice(offset, offset + PAGE);

    if (t && a.page === 1) {
      pool.query('INSERT INTO search_events(query, result_count, user_id) VALUES ($1,$2,$3)', [t, total, req.user?.id ?? null]).catch((e) => req.log.warn(e));
    }

    let suggestions: unknown = undefined;
    if (total === 0) {
      suggestions = {
        message: t ? `We couldn't find "${a.q}". Try a different spelling, or browse by region.` : 'No products match these filters.',
        regions: (await pool.query('SELECT slug, name FROM regions WHERE is_active ORDER BY sort_order')).rows,
      };
    }
    // Sponsored placements: only products that already match the search or filters, clearly labelled, shown first.
    let sponsored: { slug: string; campaign_id: string }[] = [];
    if (a.page === 1 && total > 0) {
      const ids = pageRows.map((r) => r.product_id);
      sponsored = (await pool.query(
        `SELECT p.slug, a.id AS campaign_id FROM (${LIVE_ADS}) a JOIN products p ON p.id = a.product_id
          WHERE a.placement = 'search_sponsored' AND a.spent_cents < a.budget_cents AND a.product_id = ANY($1::uuid[]) LIMIT 2`, [ids])).rows;
    }
    const spMap = new Map(sponsored.map((s) => [s.slug, s.campaign_id]));
    const results = pageRows.map(({ total: _t, product_id: _p, category_id: _cid, ...r }) => ({ ...r, store_count: Number(r.store_count), sponsored_campaign_id: spMap.get(r.slug) ?? null }));
    results.sort((x, y) => Number(!!y.sponsored_campaign_id) - Number(!!x.sponsored_campaign_id));
    // Facet counts over the whole result set (not just this page) so people can narrow down, as on large retail sites.
    let facets: unknown = undefined;
    if (total > 0) {
      const ids = all.map((r) => r.product_id);
      const [cats, regs, stores, price] = await Promise.all([
        pool.query(`SELECT c.slug, c.name, count(*)::int AS n FROM products p JOIN categories c ON c.id = p.category_id WHERE p.id = ANY($1::uuid[]) GROUP BY c.slug, c.name ORDER BY n DESC, c.name`, [ids]),
        pool.query(`SELECT r.slug, r.name, count(DISTINCT pc.product_id)::int AS n FROM product_countries pc JOIN region_countries rc ON rc.country_id = pc.country_id JOIN regions r ON r.id = rc.region_id AND r.is_active
                     WHERE pc.kind = 'culinary' AND pc.product_id = ANY($1::uuid[]) GROUP BY r.slug, r.name, r.sort_order ORDER BY r.sort_order`, [ids]),
        pool.query(`SELECT s.slug, s.name, count(DISTINCT o.product_id)::int AS n FROM offers_live o JOIN storefronts s ON s.id = o.store_id AND s.orderable WHERE o.is_active AND o.product_id = ANY($1::uuid[]) GROUP BY s.slug, s.name ORDER BY n DESC`, [ids]),
        Promise.resolve({ rows: [{ min: Math.min(...all.map((r) => r.min_price)), max: Math.max(...all.map((r) => r.min_price)) }] }),
      ]);
      facets = { categories: cats.rows, regions: regs.rows, stores: stores.rows, price: price.rows[0] };
    }
    return { query: a.q, total, page: a.page, page_size: PAGE, results, suggestions, facets };
  });

  app.get('/search/suggest', async (req) => {
    const t = norm(z.object({ q: z.string().max(100) }).parse(req.query).q);
    if (t.length < 2) return [];
    const { rows } = await pool.query(
      `(SELECT 'product' AS type, p.name AS label, p.slug, NULL AS via
          FROM products p WHERE p.status = 'published' AND (p.name_norm LIKE $1 || '%' OR p.name_norm LIKE '% ' || $1 || '%')
          AND EXISTS (SELECT 1 FROM offers_live o JOIN storefronts s ON s.id = o.store_id AND s.orderable WHERE o.product_id = p.id AND o.is_active)
          ORDER BY p.name LIMIT 5)
       UNION ALL
       (SELECT 'product', p.name, p.slug, a.alias
          FROM product_aliases a JOIN products p ON p.id = a.product_id AND p.status = 'published'
         WHERE a.verified AND a.alias_norm LIKE $1 || '%' AND p.name_norm NOT LIKE $1 || '%' LIMIT 3)
       UNION ALL
       (SELECT 'store', s.name, s.slug, NULL FROM storefronts s WHERE s.orderable AND lower(s.name) LIKE '%' || $1 || '%' LIMIT 3)`,
      [t],
    );
    return rows;
  });
};
