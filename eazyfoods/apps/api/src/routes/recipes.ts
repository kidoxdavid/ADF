import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { pool, tx } from '../db/pool.js';
import { requireLogin } from '../lib/permissions.js';
import { notFound } from '../lib/errors.js';
import { cartView } from './cart.js';

const BEST_OFFER = `
  SELECT o.id AS offer_id, o.price_cents, s.name AS store_name, s.slug AS store_slug, (o.stock_on_hand - o.stock_reserved) AS available
    FROM offers_live o JOIN storefronts s ON s.id = o.store_id AND s.orderable
   WHERE o.product_id = $1 AND o.is_active AND o.stock_on_hand - o.stock_reserved > 0 AND ($2::text IS NULL OR s.slug = $2)
   ORDER BY o.price_cents LIMIT 1`;

export const recipeRoutes: FastifyPluginAsync = async (app) => {
  app.get('/recipes', async (req) => {
    const { region } = z.object({ region: z.string().optional() }).parse(req.query);
    return (await pool.query(
      `SELECT r.slug, r.title, r.summary, r.servings, r.prep_minutes, r.cook_minutes, rg.name AS region, cn.name AS country
         FROM recipes r LEFT JOIN regions rg ON rg.id = r.region_id LEFT JOIN countries cn ON cn.id = r.country_id
        WHERE r.status = 'published' AND ($1::text IS NULL OR rg.slug = $1) ORDER BY r.title`, [region ?? null])).rows;
  });

  app.get<{ Params: { slug: string } }>('/recipes/:slug', async (req) => {
    const r = (await pool.query(`SELECT r.*, rg.name AS region, cn.name AS country FROM recipes r LEFT JOIN regions rg ON rg.id = r.region_id LEFT JOIN countries cn ON cn.id = r.country_id WHERE r.slug = $1 AND r.status = 'published'`, [req.params.slug])).rows[0];
    if (!r) throw notFound('Recipe not found');
    const ings = (await pool.query(`SELECT i.id, i.label, i.quantity_text, i.optional, i.product_id, p.slug AS product_slug, p.name AS product_name FROM recipe_ingredients i LEFT JOIN products p ON p.id = i.product_id WHERE i.recipe_id = $1 ORDER BY i.position`, [r.id])).rows;
    const out = [];
    for (const i of ings) {
      let best = null, alternatives: any[] = [];
      if (i.product_id) {
        best = (await pool.query(BEST_OFFER, [i.product_id, null])).rows[0] ?? null;
        if (!best) alternatives = (await pool.query(
          `SELECT p.slug, p.name, a.note FROM recipe_ingredient_alternatives a JOIN products p ON p.id = a.product_id AND p.status = 'published'
            WHERE a.recipe_ingredient_id = $1 AND EXISTS (SELECT 1 FROM offers_live o JOIN storefronts s ON s.id = o.store_id AND s.orderable WHERE o.product_id = p.id AND o.is_active AND o.stock_on_hand - o.stock_reserved > 0)`, [i.id])).rows;
      }
      out.push({ label: i.label, quantity_text: i.quantity_text, optional: i.optional, product_slug: i.product_slug, product_name: i.product_name, available_from: best, alternatives });
    }
    return {
      slug: r.slug, title: r.title, summary: r.summary, region: r.region, country: r.country, servings: r.servings, prep_minutes: r.prep_minutes, cook_minutes: r.cook_minutes,
      steps: r.steps, food_safety_note: r.food_safety_note, reviewed: r.reviewed, ai_generated: r.ai_generated, ingredients: out,
    };
  });

  // Adds one pack of each linked, in-stock ingredient (cheapest store, or a chosen store). Never guesses substitutes.
  app.post<{ Params: { slug: string } }>('/recipes/:slug/to-cart', { preHandler: requireLogin }, async (req) => {
    const { store_slug, include_optional } = z.object({ store_slug: z.string().optional(), include_optional: z.boolean().default(false) }).parse(req.body ?? {});
    const r = (await pool.query(`SELECT id FROM recipes WHERE slug = $1 AND status = 'published'`, [req.params.slug])).rows[0];
    if (!r) throw notFound('Recipe not found');
    const ings = (await pool.query('SELECT label, optional, product_id FROM recipe_ingredients WHERE recipe_id = $1 AND product_id IS NOT NULL', [r.id])).rows;
    const added: string[] = [], missing: string[] = [];
    await tx(async (c) => {
      const cid = (await c.query('INSERT INTO carts(user_id) VALUES ($1) ON CONFLICT (user_id) DO UPDATE SET updated_at = now() RETURNING id', [req.user!.id])).rows[0].id;
      for (const i of ings) {
        if (i.optional && !include_optional) continue;
        const o = (await c.query(BEST_OFFER, [i.product_id, store_slug ?? null])).rows[0];
        if (!o) { missing.push(i.label); continue; }
        await c.query(`INSERT INTO cart_items(cart_id, offer_id, quantity, added_price_cents) VALUES ($1,$2,1,$3) ON CONFLICT (cart_id, offer_id) DO NOTHING`, [cid, o.offer_id, o.price_cents]);
        added.push(i.label);
      }
    });
    return { added, missing, cart: await cartView(req.user!.id) };
  });
};
