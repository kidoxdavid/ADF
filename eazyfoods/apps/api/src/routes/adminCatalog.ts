import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { pool, tx } from '../db/pool.js';
import { audit } from '../lib/auth.js';
import { requirePerm } from '../lib/permissions.js';
import { bad, conflict, notFound } from '../lib/errors.js';
import { norm, slugify } from '../lib/norm.js';
import { isOurImageUrl } from '../lib/storage.js';

const uuid = z.string().uuid();
const slugs = z.array(z.string().max(80)).max(60);
const productBody = z.object({
  name: z.string().min(2).max(160), description: z.string().max(3000).nullable().optional(), brand: z.string().max(80).nullable().optional(), category_slug: z.string().nullable().optional(),
  sku: z.string().max(40).nullable().optional(), barcode: z.string().max(32).nullable().optional(), sold_by: z.enum(['unit', 'weight']).optional(),
  pack_size: z.number().positive().nullable().optional(), pack_unit: z.string().max(20).nullable().optional(), ingredients: z.string().max(2000).nullable().optional(),
  allergens: z.array(z.string().max(40)).max(20).nullable().optional(), storage_info: z.string().max(500).nullable().optional(), manufacturer: z.string().max(120).nullable().optional(),
  tax_class: z.enum(['zero_rated', 'standard']).optional(), status: z.enum(['draft', 'pending', 'published', 'archived']).optional(),
  seo_title: z.string().max(120).nullable().optional(), seo_description: z.string().max(300).nullable().optional(),
});

export const adminCatalogRoutes: FastifyPluginAsync = async (app) => {
  const cat = requirePerm('catalog.manage');

  // ---------- Products ----------
  app.get('/products', { preHandler: cat }, async (req) => {
    const q = z.object({ status: z.string().optional(), q: z.string().max(80).optional() }).parse(req.query);
    return (await pool.query(
      `SELECT p.id, p.slug, p.name, p.status, b.name AS brand, c.name AS category, v.name AS suggested_by,
              (SELECT count(*)::int FROM store_offers o WHERE o.product_id = p.id) AS offers, (SELECT count(*)::int FROM product_images i WHERE i.product_id = p.id) AS images
         FROM products p LEFT JOIN brands b ON b.id = p.brand_id LEFT JOIN categories c ON c.id = p.category_id LEFT JOIN vendors v ON v.id = p.suggested_by_vendor_id
        WHERE ($1::text IS NULL OR p.status = $1) AND ($2::text IS NULL OR p.name_norm LIKE '%'||$2||'%') ORDER BY (p.status = 'pending') DESC, p.created_at DESC LIMIT 200`, [q.status ?? null, q.q ? norm(q.q) : null])).rows;
  });

  app.get<{ Params: { id: string } }>('/products/:id', { preHandler: cat }, async (req) => {
    const id = uuid.parse(req.params.id);
    const p = (await pool.query(`SELECT p.*, b.name AS brand, c.slug AS category_slug FROM products p LEFT JOIN brands b ON b.id = p.brand_id LEFT JOIN categories c ON c.id = p.category_id WHERE p.id = $1`, [id])).rows[0];
    if (!p) throw notFound('Product not found');
    const [countries, aliases, images] = await Promise.all([
      pool.query(`SELECT cn.slug, cn.name, pc.kind FROM product_countries pc JOIN countries cn ON cn.id = pc.country_id WHERE pc.product_id = $1`, [id]),
      pool.query('SELECT id, alias, verified, note FROM product_aliases WHERE product_id = $1 ORDER BY alias', [id]),
      pool.query('SELECT id, url, alt, sort_order FROM product_images WHERE product_id = $1 ORDER BY sort_order', [id])]);
    return { ...p, countries: countries.rows, aliases: aliases.rows, images: images.rows };
  });

  async function upsertBrand(c: any, name: string | null | undefined) {
    if (!name) return null;
    return (await c.query(`INSERT INTO brands(slug,name,name_norm) VALUES ($1,$2,$3) ON CONFLICT (slug) DO UPDATE SET name = brands.name RETURNING id`, [slugify(name), name, norm(name)])).rows[0].id;
  }

  app.post('/products', { preHandler: cat }, async (req, reply) => {
    const b = productBody.parse(req.body);
    const out = await tx(async (c) => {
      let slug = slugify(b.name), n = 1;
      while ((await c.query('SELECT 1 FROM products WHERE slug = $1', [slug])).rowCount) slug = `${slugify(b.name)}-${++n}`;
      const brandId = await upsertBrand(c, b.brand);
      const catId = b.category_slug ? (await c.query('SELECT id FROM categories WHERE slug = $1', [b.category_slug])).rows[0]?.id : null;
      const p = (await c.query(
        `INSERT INTO products(slug,name,name_norm,description,brand_id,category_id,sku,barcode,sold_by,pack_size,pack_unit,ingredients,allergens,storage_info,manufacturer,tax_class,status,seo_title,seo_description,reviewed_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20) RETURNING id, slug`,
        [slug, b.name, norm(b.name), b.description ?? null, brandId, catId ?? null, b.sku ?? null, b.barcode ?? null, b.sold_by ?? 'unit', b.pack_size ?? null, b.pack_unit ?? null, b.ingredients ?? null,
         b.allergens ?? null, b.storage_info ?? null, b.manufacturer ?? null, b.tax_class ?? 'zero_rated', b.status ?? 'draft', b.seo_title ?? null, b.seo_description ?? null, req.user!.id])).rows[0];
      await audit(req.user!.id, 'product.created', 'product', p.id, { name: b.name }, c);
      return p;
    }).catch((e) => { if (e.code === '23505') throw conflict('duplicate', 'A product with that barcode already exists.'); throw e; });
    return reply.code(201).send(out);
  });

  app.patch<{ Params: { id: string } }>('/products/:id', { preHandler: cat }, async (req) => {
    const id = uuid.parse(req.params.id);
    const b = productBody.partial().parse(req.body);
    return tx(async (c) => {
      const cur = (await c.query('SELECT * FROM products WHERE id = $1 FOR UPDATE', [id])).rows[0];
      if (!cur) throw notFound('Product not found');
      const set: Record<string, unknown> = {};
      for (const k of ['description', 'sku', 'barcode', 'sold_by', 'pack_size', 'pack_unit', 'ingredients', 'allergens', 'storage_info', 'manufacturer', 'tax_class', 'status', 'seo_title', 'seo_description'] as const)
        if (b[k] !== undefined) set[k] = b[k];
      if (b.name) { set.name = b.name; set.name_norm = norm(b.name); }
      if (b.brand !== undefined) set.brand_id = await upsertBrand(c, b.brand);
      if (b.category_slug !== undefined) set.category_id = b.category_slug ? (await c.query('SELECT id FROM categories WHERE slug = $1', [b.category_slug])).rows[0]?.id ?? null : null;
      if (b.status === 'published' && cur.status !== 'published') set.reviewed_by = req.user!.id;
      const keys = Object.keys(set);
      if (!keys.length) return { id };
      await c.query(`UPDATE products SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')} WHERE id = $1`, [id, ...keys.map((k) => set[k])]);
      await audit(req.user!.id, b.status && b.status !== cur.status ? `product.${b.status}` : 'product.updated', 'product', id, b, c);
      return { id };
    });
  });

  app.put<{ Params: { id: string } }>('/products/:id/countries', { preHandler: cat }, async (req) => {
    const id = uuid.parse(req.params.id);
    const { culinary, manufacturing } = z.object({ culinary: slugs, manufacturing: slugs.default([]) }).parse(req.body);
    await tx(async (c) => {
      await c.query('DELETE FROM product_countries WHERE product_id = $1', [id]);
      await c.query(`INSERT INTO product_countries SELECT $1, id, 'culinary' FROM countries WHERE slug = ANY($2::text[])`, [id, culinary]);
      await c.query(`INSERT INTO product_countries SELECT $1, id, 'manufacturing' FROM countries WHERE slug = ANY($2::text[])`, [id, manufacturing]);
    });
    return { ok: true };
  });

  // Aliases are only searchable once a human marks them verified.
  app.post<{ Params: { id: string } }>('/products/:id/aliases', { preHandler: cat }, async (req, reply) => {
    const id = uuid.parse(req.params.id);
    const b = z.object({ alias: z.string().min(2).max(80), verified: z.boolean().default(false), note: z.string().max(200).optional() }).parse(req.body);
    const r = await pool.query(`INSERT INTO product_aliases(product_id, alias, alias_norm, verified, note) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (product_id, alias_norm) DO UPDATE SET verified = $4, alias = $2 RETURNING id`, [id, b.alias, norm(b.alias), b.verified, b.note ?? null]);
    await audit(req.user!.id, 'alias.saved', 'product', id, b);
    return reply.code(201).send({ id: r.rows[0].id });
  });
  app.patch<{ Params: { id: string } }>('/aliases/:id', { preHandler: cat }, async (req) => {
    const { verified } = z.object({ verified: z.boolean() }).parse(req.body);
    const r = await pool.query('UPDATE product_aliases SET verified = $2 WHERE id = $1 RETURNING product_id', [uuid.parse(req.params.id), verified]);
    if (!r.rowCount) throw notFound('Alias not found');
    await audit(req.user!.id, verified ? 'alias.verified' : 'alias.unverified', 'product', r.rows[0].product_id, { alias_id: req.params.id });
    return { ok: true };
  });
  app.delete<{ Params: { id: string } }>('/aliases/:id', { preHandler: cat }, async (req) => { await pool.query('DELETE FROM product_aliases WHERE id = $1', [uuid.parse(req.params.id)]); return { ok: true }; });

  app.post<{ Params: { id: string } }>('/products/:id/images', { preHandler: cat }, async (req, reply) => {
    const id = uuid.parse(req.params.id);
    const b = z.object({ url: z.string().refine(isOurImageUrl, 'Upload the image first'), alt: z.string().min(2).max(200) }).parse(req.body);
    const r = await pool.query('INSERT INTO product_images(product_id, url, alt, sort_order, uploaded_by) VALUES ($1,$2,$3,(SELECT COALESCE(max(sort_order)+1,0) FROM product_images WHERE product_id=$1),$4) RETURNING id', [id, b.url, b.alt, req.user!.id]);
    return reply.code(201).send({ id: r.rows[0].id });
  });
  app.delete<{ Params: { id: string } }>('/product-images/:id', { preHandler: cat }, async (req) => { await pool.query('DELETE FROM product_images WHERE id = $1', [uuid.parse(req.params.id)]); return { ok: true }; });

  // ---------- Taxonomy: regions, countries, categories, collections ----------
  app.get('/taxonomy', { preHandler: cat }, async () => ({
    regions: (await pool.query(`SELECT r.id, r.slug, r.name, r.description, r.sort_order, r.is_active, COALESCE(array_agg(c.slug ORDER BY c.name) FILTER (WHERE c.id IS NOT NULL), '{}') AS countries FROM regions r LEFT JOIN region_countries rc ON rc.region_id = r.id LEFT JOIN countries c ON c.id = rc.country_id GROUP BY r.id ORDER BY r.sort_order`)).rows,
    countries: (await pool.query('SELECT id, iso2, slug, name, is_active FROM countries ORDER BY name')).rows,
    categories: (await pool.query('SELECT id, parent_id, slug, name, sort_order FROM categories ORDER BY sort_order, name')).rows,
    collections: (await pool.query(`SELECT c.id, c.slug, c.title, c.subtitle, c.sort_order, c.is_active, r.slug AS region_slug, ct.slug AS category_slug,
        COALESCE((SELECT array_agg(p.slug ORDER BY cp.position) FROM collection_products cp JOIN products p ON p.id = cp.product_id WHERE cp.collection_id = c.id), '{}') AS manual_products
        FROM collections c LEFT JOIN regions r ON r.id = c.region_id LEFT JOIN categories ct ON ct.id = c.category_id ORDER BY c.sort_order`)).rows,
  }));

  app.post('/regions', { preHandler: cat }, async (req, reply) => {
    const b = z.object({ name: z.string().min(2).max(80), description: z.string().max(400).optional(), countries: slugs.default([]), sort_order: z.number().int().default(100) }).parse(req.body);
    const id = await tx(async (c) => {
      const r = (await c.query('INSERT INTO regions(slug, name, description, sort_order) VALUES ($1,$2,$3,$4) RETURNING id', [slugify(b.name), b.name, b.description ?? null, b.sort_order])).rows[0].id;
      await c.query('INSERT INTO region_countries SELECT $1, id FROM countries WHERE slug = ANY($2::text[])', [r, b.countries]);
      await audit(req.user!.id, 'region.created', 'region', r, b, c);
      return r;
    }).catch((e) => { if (e.code === '23505') throw conflict('duplicate', 'That region already exists.'); throw e; });
    return reply.code(201).send({ id });
  });
  app.patch<{ Params: { id: string } }>('/regions/:id', { preHandler: cat }, async (req) => {
    const id = uuid.parse(req.params.id);
    const b = z.object({ name: z.string().min(2).max(80).optional(), description: z.string().max(400).nullable().optional(), is_active: z.boolean().optional(), sort_order: z.number().int().optional(), countries: slugs.optional() }).parse(req.body);
    await tx(async (c) => {
      await c.query('UPDATE regions SET name = COALESCE($2,name), description = COALESCE($3,description), is_active = COALESCE($4,is_active), sort_order = COALESCE($5,sort_order) WHERE id = $1', [id, b.name ?? null, b.description ?? null, b.is_active ?? null, b.sort_order ?? null]);
      if (b.countries) { await c.query('DELETE FROM region_countries WHERE region_id = $1', [id]); await c.query('INSERT INTO region_countries SELECT $1, id FROM countries WHERE slug = ANY($2::text[])', [id, b.countries]); }
      await audit(req.user!.id, 'region.updated', 'region', id, b, c);
    });
    return { ok: true };
  });
  app.post('/countries', { preHandler: cat }, async (req, reply) => {
    const b = z.object({ name: z.string().min(2).max(80), iso2: z.string().length(2).optional() }).parse(req.body);
    const r = await pool.query('INSERT INTO countries(slug, name, iso2) VALUES ($1,$2,$3) ON CONFLICT (slug) DO NOTHING RETURNING id', [slugify(b.name), b.name, b.iso2?.toUpperCase() ?? null]);
    if (!r.rowCount) throw conflict('duplicate', 'That country already exists.');
    return reply.code(201).send({ id: r.rows[0].id });
  });
  app.post('/categories', { preHandler: cat }, async (req, reply) => {
    const b = z.object({ name: z.string().min(2).max(80), parent_slug: z.string().optional(), sort_order: z.number().int().default(100) }).parse(req.body);
    const parent = b.parent_slug ? (await pool.query('SELECT id FROM categories WHERE slug = $1', [b.parent_slug])).rows[0]?.id : null;
    const r = await pool.query('INSERT INTO categories(slug, name, parent_id, sort_order) VALUES ($1,$2,$3,$4) ON CONFLICT (slug) DO NOTHING RETURNING id', [slugify(b.name), b.name, parent ?? null, b.sort_order]);
    if (!r.rowCount) throw conflict('duplicate', 'That category already exists.');
    return reply.code(201).send({ id: r.rows[0].id });
  });

  const colBody = z.object({ title: z.string().min(2).max(100), subtitle: z.string().max(200).nullable().optional(), region_slug: z.string().nullable().optional(), category_slug: z.string().nullable().optional(),
    product_slugs: slugs.default([]), sort_order: z.number().int().default(100), is_active: z.boolean().default(true) });
  const saveCollection = async (c: any, id: string, b: z.infer<typeof colBody>) => {
    const region = b.region_slug ? (await c.query('SELECT id FROM regions WHERE slug = $1', [b.region_slug])).rows[0]?.id : null;
    const category = b.category_slug ? (await c.query('SELECT id FROM categories WHERE slug = $1', [b.category_slug])).rows[0]?.id : null;
    await c.query('UPDATE collections SET title=$2, subtitle=$3, region_id=$4, category_id=$5, sort_order=$6, is_active=$7 WHERE id=$1', [id, b.title, b.subtitle ?? null, region ?? null, category ?? null, b.sort_order, b.is_active]);
    await c.query('DELETE FROM collection_products WHERE collection_id = $1', [id]);
    for (const [i, s] of b.product_slugs.entries()) await c.query('INSERT INTO collection_products SELECT $1, id, $3 FROM products WHERE slug = $2', [id, s, i]);
  };
  app.post('/collections', { preHandler: requirePerm('content.manage', 'catalog.manage') }, async (req, reply) => {
    const b = colBody.parse(req.body);
    const id = await tx(async (c) => {
      const row = (await c.query('INSERT INTO collections(slug, title) VALUES ($1,$2) RETURNING id', [slugify(b.title), b.title])).rows[0].id;
      await saveCollection(c, row, b); await audit(req.user!.id, 'collection.created', 'collection', row, b, c); return row;
    }).catch((e) => { if (e.code === '23505') throw conflict('duplicate', 'A collection with that title already exists.'); throw e; });
    return reply.code(201).send({ id });
  });
  app.put<{ Params: { id: string } }>('/collections/:id', { preHandler: requirePerm('content.manage', 'catalog.manage') }, async (req) => {
    const id = uuid.parse(req.params.id); const b = colBody.parse(req.body);
    await tx(async (c) => { await saveCollection(c, id, b); await audit(req.user!.id, 'collection.updated', 'collection', id, b, c); });
    return { ok: true };
  });

  // ---------- Delivery zones (data, not code) ----------
  const zoneBody = z.object({ name: z.string().min(2).max(80), fee_cents: z.number().int().min(0).max(5000), free_over_cents: z.number().int().positive().nullable().optional(), eta_minutes: z.number().int().min(15).max(600), is_active: z.boolean().default(true),
    fsas: z.array(z.string().regex(/^[A-Za-z]\d[A-Za-z]$/)).max(500), store_ids: z.array(uuid).default([]) });
  app.get('/zones', { preHandler: requirePerm('stores.manage') }, async () => (await pool.query(
    `SELECT z.id, z.name, z.fee_cents, z.free_over_cents, z.eta_minutes, z.is_active,
            COALESCE((SELECT array_agg(f.fsa ORDER BY f.fsa) FROM delivery_zone_fsas f WHERE f.zone_id = z.id), '{}') AS fsas,
            COALESCE((SELECT array_agg(s.store_id) FROM store_delivery_zones s WHERE s.zone_id = z.id), '{}') AS store_ids FROM delivery_zones z ORDER BY z.name`)).rows);
  const saveZone = async (c: any, id: string, b: z.infer<typeof zoneBody>) => {
    await c.query('UPDATE delivery_zones SET name=$2, fee_cents=$3, free_over_cents=$4, eta_minutes=$5, is_active=$6 WHERE id=$1', [id, b.name, b.fee_cents, b.free_over_cents ?? null, b.eta_minutes, b.is_active]);
    await c.query('DELETE FROM delivery_zone_fsas WHERE zone_id = $1', [id]);
    for (const f of b.fsas.map((x) => x.toUpperCase())) {
      // An area belongs to exactly one zone; never move it silently.
      try { await c.query('INSERT INTO delivery_zone_fsas VALUES ($1,$2)', [f, id]); }
      catch (e: any) { if (e.code === '23505') throw bad('fsa_conflict', `${f} is already in another zone. Remove it there first.`); throw e; }
    }
    await c.query('DELETE FROM store_delivery_zones WHERE zone_id = $1', [id]);
    for (const s of b.store_ids) await c.query('INSERT INTO store_delivery_zones VALUES ($1,$2) ON CONFLICT DO NOTHING', [s, id]);
  };
  app.post('/zones', { preHandler: requirePerm('stores.manage') }, async (req, reply) => {
    const b = zoneBody.parse(req.body);
    const id = await tx(async (c) => { const z = (await c.query('INSERT INTO delivery_zones(name, fee_cents, eta_minutes) VALUES ($1,0,90) RETURNING id', [b.name])).rows[0].id; await saveZone(c, z, b); await audit(req.user!.id, 'zone.created', 'zone', z, b, c); return z; });
    return reply.code(201).send({ id });
  });
  app.put<{ Params: { id: string } }>('/zones/:id', { preHandler: requirePerm('stores.manage') }, async (req) => {
    const id = uuid.parse(req.params.id); const b = zoneBody.parse(req.body);
    await tx(async (c) => { await saveZone(c, id, b); await audit(req.user!.id, 'zone.updated', 'zone', id, b, c); });
    return { ok: true };
  });

  // ---------- Coupons ----------
  const promo = requirePerm('promotions.manage');
  const couponBody = z.object({ code: z.string().min(3).max(30).regex(/^[A-Za-z0-9_-]+$/), description: z.string().max(200).optional(), kind: z.enum(['percent', 'fixed']), value: z.number().int().positive(),
    min_subtotal_cents: z.number().int().min(0).default(0), max_discount_cents: z.number().int().positive().nullable().optional(), first_order_only: z.boolean().default(false),
    starts_at: z.coerce.date().nullable().optional(), ends_at: z.coerce.date().nullable().optional(), max_redemptions: z.number().int().positive().nullable().optional(), per_user_limit: z.number().int().positive().default(1), is_active: z.boolean().default(true) })
    .refine((v) => v.kind !== 'percent' || v.value <= 100, 'Percent must be 100 or less');
  app.get('/coupons', { preHandler: promo }, async () => (await pool.query(`SELECT c.*, (SELECT count(*)::int FROM orders o WHERE o.coupon_id = c.id AND o.status IN ('placed','completed')) AS redemptions FROM coupons c ORDER BY c.created_at DESC`)).rows);
  app.post('/coupons', { preHandler: promo }, async (req, reply) => {
    const b = couponBody.parse(req.body);
    const r = await pool.query(`INSERT INTO coupons(code, description, kind, value, min_subtotal_cents, max_discount_cents, first_order_only, starts_at, ends_at, max_redemptions, per_user_limit, is_active) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
      [b.code, b.description ?? null, b.kind, b.value, b.min_subtotal_cents, b.max_discount_cents ?? null, b.first_order_only, b.starts_at ?? null, b.ends_at ?? null, b.max_redemptions ?? null, b.per_user_limit, b.is_active]).catch((e) => { if (e.code === '23505') throw conflict('duplicate', 'That code already exists.'); throw e; });
    await audit(req.user!.id, 'coupon.created', 'coupon', r.rows[0].id, b);
    return reply.code(201).send({ id: r.rows[0].id });
  });
  app.patch<{ Params: { id: string } }>('/coupons/:id', { preHandler: promo }, async (req) => {
    const b = z.object({ is_active: z.boolean() }).parse(req.body);
    await pool.query('UPDATE coupons SET is_active = $2 WHERE id = $1', [uuid.parse(req.params.id), b.is_active]);
    await audit(req.user!.id, b.is_active ? 'coupon.enabled' : 'coupon.disabled', 'coupon', req.params.id);
    return { ok: true };
  });

  // ---------- Content ----------
  const content = requirePerm('content.manage');
  app.put<{ Params: { key: string } }>('/content/:key', { preHandler: content }, async (req) => {
    const key = z.enum(['home_hero', 'announcement']).parse(req.params.key);
    const value = key === 'home_hero' ? z.object({ title: z.string().min(2).max(120), subtitle: z.string().max(300) }).parse(req.body) : z.object({ text: z.string().max(200), active: z.boolean() }).parse(req.body);
    await pool.query('INSERT INTO content_blocks(key, value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = now()', [key, value]);
    await audit(req.user!.id, 'content.updated', 'content', key, value);
    return { ok: true };
  });
  app.get('/pages', { preHandler: content }, async () => (await pool.query('SELECT slug, title, status, needs_legal_review, updated_at FROM pages ORDER BY title')).rows);
  app.get<{ Params: { slug: string } }>('/pages/:slug', { preHandler: content }, async (req) => {
    const p = (await pool.query('SELECT * FROM pages WHERE slug = $1', [req.params.slug])).rows[0];
    if (!p) throw notFound('Page not found');
    return p;
  });
  app.put<{ Params: { slug: string } }>('/pages/:slug', { preHandler: content }, async (req) => {
    const b = z.object({ title: z.string().min(2).max(120), body: z.string().min(1).max(20000), status: z.enum(['draft', 'published']), needs_legal_review: z.boolean().default(false) }).parse(req.body);
    const slug = z.string().regex(/^[a-z0-9-]+$/).parse(req.params.slug);
    await pool.query('INSERT INTO pages(slug, title, body, status, needs_legal_review) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (slug) DO UPDATE SET title=$2, body=$3, status=$4, needs_legal_review=$5, updated_at=now()', [slug, b.title, b.body, b.status, b.needs_legal_review]);
    await audit(req.user!.id, 'page.updated', 'page', slug, { title: b.title, status: b.status });
    return { ok: true };
  });
  app.get('/templates', { preHandler: content }, async () => (await pool.query('SELECT key, subject, body, updated_at FROM notification_templates ORDER BY key')).rows);
  app.put<{ Params: { key: string } }>('/templates/:key', { preHandler: content }, async (req) => {
    const b = z.object({ subject: z.string().min(2).max(200), body: z.string().min(2).max(5000) }).parse(req.body);
    const r = await pool.query('UPDATE notification_templates SET subject=$2, body=$3, updated_at=now() WHERE key=$1 RETURNING key', [req.params.key, b.subject, b.body]);
    if (!r.rowCount) throw notFound('Template not found');
    await audit(req.user!.id, 'template.updated', 'template', req.params.key);
    return { ok: true };
  });

  // ---------- Advertising review ----------
  const ads = requirePerm('ads.manage');
  app.get('/ads', { preHandler: ads }, async () => (await pool.query(
    `SELECT c.id, c.title, c.body, c.image_url, c.placement, c.status, c.cpc_cents, c.budget_cents, c.starts_at, c.ends_at, v.name AS vendor_name, p.name AS product_name,
            count(e.*) FILTER (WHERE e.type='impression')::int AS impressions, count(e.*) FILTER (WHERE e.type='click')::int AS clicks, (count(e.*) FILTER (WHERE e.type='click') * c.cpc_cents)::int AS spent_cents
       FROM ad_campaigns c JOIN vendors v ON v.id = c.vendor_id LEFT JOIN products p ON p.id = c.product_id LEFT JOIN ad_events e ON e.campaign_id = c.id GROUP BY c.id, v.name, p.name ORDER BY (c.status='pending') DESC, c.created_at DESC`)).rows);
  app.patch<{ Params: { id: string } }>('/ads/:id', { preHandler: ads }, async (req) => {
    const b = z.object({ status: z.enum(['approved', 'rejected', 'paused']), note: z.string().max(300).optional() }).parse(req.body);
    if (b.status === 'rejected' && !b.note) throw bad('note_required', 'Tell the vendor why the creative was rejected.');
    const r = await pool.query('UPDATE ad_campaigns SET status=$2, review_note=$3, reviewed_by=$4 WHERE id=$1 RETURNING id', [uuid.parse(req.params.id), b.status, b.note ?? null, req.user!.id]);
    if (!r.rowCount) throw notFound('Campaign not found');
    await audit(req.user!.id, `ad.${b.status}`, 'ad_campaign', req.params.id, b);
    return { ok: true };
  });

  // ---------- Recipes ----------
  const recBody = z.object({ title: z.string().min(2).max(120), summary: z.string().max(500).optional(), region_slug: z.string().optional(), country_slug: z.string().optional(), servings: z.number().int().positive(),
    prep_minutes: z.number().int().min(0).optional(), cook_minutes: z.number().int().min(0).optional(), steps: z.array(z.string().min(2).max(600)).min(1).max(40), food_safety_note: z.string().max(500).optional(),
    reviewed: z.boolean().default(false), status: z.enum(['draft', 'published']).default('draft'),
    ingredients: z.array(z.object({ label: z.string().min(1).max(120), quantity_text: z.string().max(60).optional(), product_slug: z.string().optional(), optional: z.boolean().default(false), alternative_slugs: z.array(z.string()).default([]) })).min(1).max(60) });
  const saveRecipe = async (c: any, id: string, b: z.infer<typeof recBody>) => {
    const region = b.region_slug ? (await c.query('SELECT id FROM regions WHERE slug = $1', [b.region_slug])).rows[0]?.id : null;
    const country = b.country_slug ? (await c.query('SELECT id FROM countries WHERE slug = $1', [b.country_slug])).rows[0]?.id : null;
    await c.query('UPDATE recipes SET title=$2, summary=$3, region_id=$4, country_id=$5, servings=$6, prep_minutes=$7, cook_minutes=$8, steps=$9, food_safety_note=$10, reviewed=$11, status=$12 WHERE id=$1',
      [id, b.title, b.summary ?? null, region ?? null, country ?? null, b.servings, b.prep_minutes ?? null, b.cook_minutes ?? null, JSON.stringify(b.steps), b.food_safety_note ?? null, b.reviewed, b.status]);
    await c.query('DELETE FROM recipe_ingredients WHERE recipe_id = $1', [id]);
    for (const [i, ing] of b.ingredients.entries()) {
      const pid = ing.product_slug ? (await c.query('SELECT id FROM products WHERE slug = $1', [ing.product_slug])).rows[0]?.id : null;
      const row = (await c.query('INSERT INTO recipe_ingredients(recipe_id, position, label, quantity_text, product_id, optional) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id', [id, i, ing.label, ing.quantity_text ?? null, pid ?? null, ing.optional])).rows[0].id;
      for (const a of ing.alternative_slugs) await c.query('INSERT INTO recipe_ingredient_alternatives SELECT $1, id, NULL FROM products WHERE slug = $2 ON CONFLICT DO NOTHING', [row, a]);
    }
  };
  app.post('/recipes', { preHandler: content }, async (req, reply) => {
    const b = recBody.parse(req.body);
    const id = await tx(async (c) => { const r = (await c.query('INSERT INTO recipes(slug, title, servings) VALUES ($1,$2,$3) RETURNING id', [slugify(b.title), b.title, b.servings])).rows[0].id; await saveRecipe(c, r, b); await audit(req.user!.id, 'recipe.created', 'recipe', r, { title: b.title }, c); return r; })
      .catch((e) => { if (e.code === '23505') throw conflict('duplicate', 'A recipe with that title exists.'); throw e; });
    return reply.code(201).send({ id });
  });
  app.put<{ Params: { id: string } }>('/recipes/:id', { preHandler: content }, async (req) => {
    const id = uuid.parse(req.params.id); const b = recBody.parse(req.body);
    await tx(async (c) => { await saveRecipe(c, id, b); await audit(req.user!.id, 'recipe.updated', 'recipe', id, { title: b.title }, c); });
    return { ok: true };
  });
  app.get('/recipes', { preHandler: content }, async () => (await pool.query('SELECT id, slug, title, status, reviewed, ai_generated FROM recipes ORDER BY title')).rows);
};
