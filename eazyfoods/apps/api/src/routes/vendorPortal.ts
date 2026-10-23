import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { pool, tx } from '../db/pool.js';
import { audit, canManageStore } from '../lib/auth.js';
import { requireLogin } from '../lib/permissions.js';
import { bad, conflict, forbidden, notFound } from '../lib/errors.js';
import { getSetting } from '../lib/settings.js';
import { isOurImageUrl } from '../lib/storage.js';
import { parseCsv, toCsv } from '../lib/csv.js';
import { slugify, norm } from '../lib/norm.js';
import { vendorIdsOf } from './vendorOrders.js';
import { normalisePostal, isCanadianPostal } from '../services/pricing.js';

const uuid = z.string().uuid();
const img = z.string().refine(isOurImageUrl, 'Upload the image through EAZyfoods first.').nullable().optional();

export const vendorPortalRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireLogin);
  const vendorId = (req: any) => { const v = vendorIdsOf(req.user)[0]; if (!v) throw forbidden('This account is not linked to a store.'); return v as string; };
  const ownerOnly = (req: any) => { if (!req.user.roles.some((r: any) => r.role === 'vendor_owner')) throw forbidden('Only the store owner can do this.'); };
  const store = async (req: any) => { const id = uuid.parse(req.params.storeId); if (!(await canManageStore(req.user, id))) throw forbidden(); return id; };

  // ---------- Onboarding ----------
  app.post('/apply', async (req, reply) => {
    if (vendorIdsOf(req.user!).length) throw conflict('already_vendor', 'You already have a store application.');
    const b = z.object({
      business_name: z.string().min(2).max(120), legal_name: z.string().max(160).optional(), business_number: z.string().max(40).optional(),
      phone: z.string().min(7).max(25), contact_email: z.string().email().optional(),
      store_name: z.string().min(2).max(120), address_line: z.string().min(3).max(160), city: z.string().min(1).max(80).default('Calgary'),
      postal_code: z.string().refine(isCanadianPostal, 'Enter a valid Canadian postal code'), description: z.string().max(1000).optional(),
      regions: z.array(z.string()).default([]),
    }).parse(req.body);
    const out = await tx(async (c) => {
      const v = (await c.query(`INSERT INTO vendors(name, legal_name, business_number, phone, contact_email) VALUES ($1,$2,$3,$4,$5) RETURNING id`, [b.business_name, b.legal_name ?? null, b.business_number ?? null, b.phone, b.contact_email ?? req.user!.email])).rows[0];
      await c.query(`INSERT INTO user_roles(user_id, role, vendor_id) VALUES ($1,'vendor_owner',$2)`, [req.user!.id, v.id]);
      let slug = slugify(b.store_name), n = 1;
      while ((await c.query('SELECT 1 FROM stores WHERE slug = $1', [slug])).rowCount) slug = `${slugify(b.store_name)}-${++n}`;
      const s = (await c.query(`INSERT INTO stores(vendor_id, slug, name, description, address_line, city, postal_code, phone) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id, slug`,
        [v.id, slug, b.store_name, b.description ?? null, b.address_line, b.city, normalisePostal(b.postal_code), b.phone])).rows[0];
      if (b.regions.length) await c.query('INSERT INTO store_regions SELECT $1, id FROM regions WHERE slug = ANY($2::text[]) ON CONFLICT DO NOTHING', [s.id, b.regions]);
      await audit(req.user!.id, 'vendor.applied', 'vendor', v.id, {}, c);
      return { vendor_id: v.id, store_id: s.id, slug: s.slug };
    });
    return reply.code(201).send(out);
  });

  app.get('/onboarding', async (req) => onboardingStatus(vendorId(req)));

  app.get('/profile', async (req) => {
    const v = (await pool.query('SELECT name, legal_name, business_number, phone, contact_email, status, agreement_accepted_at, stripe_account_id IS NOT NULL AS payout_connected FROM vendors WHERE id = $1', [vendorId(req)])).rows[0];
    return v;
  });

  app.put('/profile', async (req) => {
    ownerOnly(req);
    const b = z.object({ name: z.string().min(2).max(120), legal_name: z.string().max(160).nullable().optional(), business_number: z.string().max(40).nullable().optional(), phone: z.string().max(25), contact_email: z.string().email() }).parse(req.body);
    await pool.query('UPDATE vendors SET name=$2, legal_name=$3, business_number=$4, phone=$5, contact_email=$6 WHERE id=$1', [vendorId(req), b.name, b.legal_name ?? null, b.business_number ?? null, b.phone, b.contact_email]);
    return { ok: true };
  });

  app.post('/agreement/accept', async (req) => {
    ownerOnly(req);
    const version = await getSetting<string>('vendor.agreement_version');
    await pool.query('UPDATE vendors SET agreement_version = $2, agreement_accepted_at = now() WHERE id = $1', [vendorId(req), version]);
    await audit(req.user!.id, 'vendor.agreement_accepted', 'vendor', vendorId(req), { version });
    return { ok: true, version };
  });

  app.post('/submit', async (req) => {
    ownerOnly(req);
    const vid = vendorId(req);
    const status = await onboardingStatus(vid);
    if (!status.can_submit) throw conflict('incomplete', 'Finish the required steps before submitting.', status.items.filter((i) => i.required && !i.done).map((i) => i.label));
    await tx(async (c) => {
      await c.query(`UPDATE vendors SET status='submitted', submitted_at=now() WHERE id=$1 AND status='draft'`, [vid]);
      await c.query(`UPDATE stores SET status='pending' WHERE vendor_id=$1 AND status='draft'`, [vid]);
      await audit(req.user!.id, 'vendor.submitted', 'vendor', vid, {}, c);
    });
    return { ok: true, status: 'submitted' };
  });

  // ---------- Store profile, hours ----------
  app.put<{ Params: { storeId: string } }>('/stores/:storeId/profile', async (req) => {
    const id = await store(req);
    const b = z.object({
      description: z.string().max(1500).nullable().optional(), address_line: z.string().min(3).max(160).optional(), city: z.string().max(80).optional(),
      postal_code: z.string().refine(isCanadianPostal).optional(), phone: z.string().max(25).optional(), policies: z.string().max(3000).nullable().optional(),
      offers_delivery: z.boolean().optional(), offers_pickup: z.boolean().optional(), ordering_paused: z.boolean().optional(),
      min_order_cents: z.number().int().min(0).max(100000).nullable().optional(), logo_url: img, cover_url: img, regions: z.array(z.string()).optional(),
    }).parse(req.body);
    await tx(async (c) => {
      const cur = (await c.query('SELECT * FROM stores WHERE id = $1 FOR UPDATE', [id])).rows[0];
      const m = { ...cur, ...Object.fromEntries(Object.entries(b).filter(([k, v]) => v !== undefined && k !== 'regions')) };
      if (b.postal_code) m.postal_code = normalisePostal(b.postal_code);
      await c.query(`UPDATE stores SET description=$2, address_line=$3, city=$4, postal_code=$5, phone=$6, policies=$7, offers_delivery=$8, offers_pickup=$9, ordering_paused=$10, min_order_cents=$11, logo_url=$12, cover_url=$13 WHERE id=$1`,
        [id, m.description, m.address_line, m.city, m.postal_code, m.phone, m.policies, m.offers_delivery, m.offers_pickup, m.ordering_paused, m.min_order_cents, m.logo_url, m.cover_url]);
      if (b.regions) { await c.query('DELETE FROM store_regions WHERE store_id = $1', [id]); await c.query('INSERT INTO store_regions SELECT $1, id FROM regions WHERE slug = ANY($2::text[])', [id, b.regions]); }
      await audit(req.user!.id, 'store.profile_updated', 'store', id, b, c);
    });
    return { ok: true };
  });

  app.put<{ Params: { storeId: string } }>('/stores/:storeId/hours', async (req) => {
    const id = await store(req);
    const { hours } = z.object({ hours: z.array(z.object({ dow: z.number().int().min(0).max(6), opens: z.string().regex(/^\d\d:\d\d$/), closes: z.string().regex(/^\d\d:\d\d$/) })).max(30) }).parse(req.body);
    if (hours.some((h) => h.closes <= h.opens)) throw bad('invalid_hours', 'Closing time must be after opening time.');
    await tx(async (c) => { await c.query('DELETE FROM store_hours WHERE store_id = $1', [id]); for (const h of hours) await c.query('INSERT INTO store_hours VALUES ($1,$2,$3,$4)', [id, h.dow, h.opens, h.closes]); });
    return { ok: true };
  });
  app.get<{ Params: { storeId: string } }>('/stores/:storeId/hours', async (req) => (await pool.query('SELECT dow, to_char(opens,\'HH24:MI\') AS opens, to_char(closes,\'HH24:MI\') AS closes FROM store_hours WHERE store_id = $1 ORDER BY dow, opens', [await store(req)])).rows);
  app.get<{ Params: { storeId: string } }>('/stores/:storeId/profile', async (req) => {
    const s = (await pool.query('SELECT id, slug, name, description, address_line, city, postal_code, phone, policies, offers_delivery, offers_pickup, ordering_paused, min_order_cents, logo_url, cover_url, status FROM stores WHERE id = $1', [await store(req)])).rows[0];
    const regions = (await pool.query('SELECT r.slug FROM store_regions sr JOIN regions r ON r.id = sr.region_id WHERE sr.store_id = $1', [s.id])).rows.map((r) => r.slug);
    return { ...s, regions };
  });

  // ---------- Catalogue: find shared products, suggest new ones ----------
  app.get('/catalogue/search', async (req) => {
    const { q, storeId } = z.object({ q: z.string().min(1).max(80), storeId: uuid.optional() }).parse(req.query);
    const t = norm(q);
    return (await pool.query(
      `SELECT p.id, p.slug, p.name, b.name AS brand, p.pack_size, p.pack_unit, p.barcode,
              EXISTS (SELECT 1 FROM store_offers o WHERE o.product_id = p.id AND o.store_id = $2) AS already_listed
         FROM products p LEFT JOIN brands b ON b.id = p.brand_id
        WHERE p.status = 'published' AND (p.name_norm LIKE '%'||$1||'%' OR similarity(p.name_norm, $1) > 0.3 OR p.barcode = $3 OR p.sku = $3
              OR EXISTS (SELECT 1 FROM product_aliases a WHERE a.product_id = p.id AND a.verified AND a.alias_norm LIKE '%'||$1||'%'))
        ORDER BY similarity(p.name_norm, $1) DESC LIMIT 20`, [t, storeId ?? null, q])).rows;
  });

  app.post('/products/suggest', async (req, reply) => {
    const vid = vendorId(req);
    const b = z.object({
      name: z.string().min(2).max(160), brand: z.string().max(80).optional(), category_slug: z.string().optional(), description: z.string().max(1500).optional(),
      pack_size: z.number().positive().optional(), pack_unit: z.string().max(20).optional(), barcode: z.string().max(32).optional(), ingredients: z.string().max(1000).optional(),
      sold_by: z.enum(['unit', 'weight']).default('unit'), country_slugs: z.array(z.string()).default([]), image_url: img,
    }).parse(req.body);
    const out = await tx(async (c) => {
      let slug = slugify(b.name), n = 1;
      while ((await c.query('SELECT 1 FROM products WHERE slug = $1', [slug])).rowCount) slug = `${slugify(b.name)}-${++n}`;
      let brandId: string | null = null;
      if (b.brand) brandId = (await c.query(`INSERT INTO brands(slug,name,name_norm) VALUES ($1,$2,$3) ON CONFLICT (slug) DO UPDATE SET name = brands.name RETURNING id`, [slugify(b.brand), b.brand, norm(b.brand)])).rows[0].id;
      const cat = b.category_slug ? (await c.query('SELECT id FROM categories WHERE slug = $1', [b.category_slug])).rows[0]?.id : null;
      const p = (await c.query(`INSERT INTO products(slug,name,name_norm,description,brand_id,category_id,pack_size,pack_unit,barcode,ingredients,sold_by,status,suggested_by_vendor_id)
                                VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'pending',$12) RETURNING id, slug, status`,
        [slug, b.name, norm(b.name), b.description ?? null, brandId, cat ?? null, b.pack_size ?? null, b.pack_unit ?? null, b.barcode ?? null, b.ingredients ?? null, b.sold_by, vid])).rows[0];
      if (b.country_slugs.length) await c.query(`INSERT INTO product_countries SELECT $1, id, 'culinary' FROM countries WHERE slug = ANY($2::text[]) ON CONFLICT DO NOTHING`, [p.id, b.country_slugs]);
      if (b.image_url) await c.query('INSERT INTO product_images(product_id, url, alt, uploaded_by) VALUES ($1,$2,$3,$4)', [p.id, b.image_url, b.name, req.user!.id]);
      return p;
    }).catch((e) => { if (e.code === '23505') throw conflict('duplicate_barcode', 'A product with that barcode already exists in the catalogue. Search for it and list it instead.'); throw e; });
    return reply.code(201).send(out);
  });

  // ---------- Promotions (scheduled sale prices) ----------
  app.get<{ Params: { storeId: string } }>('/stores/:storeId/promotions', async (req) => (await pool.query(
    `SELECT pr.id, p.name, o.price_cents AS regular_price_cents, pr.sale_price_cents, pr.starts_at, pr.ends_at, pr.cancelled_at,
            CASE WHEN pr.cancelled_at IS NOT NULL THEN 'cancelled' WHEN now() < pr.starts_at THEN 'scheduled' WHEN now() >= pr.ends_at THEN 'ended' ELSE 'active' END AS state
       FROM offer_promotions pr JOIN store_offers o ON o.id = pr.offer_id JOIN products p ON p.id = o.product_id WHERE o.store_id = $1 ORDER BY pr.starts_at DESC`, [await store(req)])).rows);

  app.post<{ Params: { storeId: string } }>('/stores/:storeId/promotions', async (req, reply) => {
    const sid = await store(req);
    const b = z.object({ product_id: uuid, sale_price_cents: z.number().int().positive(), starts_at: z.coerce.date(), ends_at: z.coerce.date() }).parse(req.body);
    if (b.ends_at <= b.starts_at) throw bad('invalid_dates', 'The end must be after the start.');
    const o = (await pool.query('SELECT id, price_cents FROM store_offers WHERE store_id = $1 AND product_id = $2', [sid, b.product_id])).rows[0];
    if (!o) throw notFound('List this product first.');
    if (b.sale_price_cents >= o.price_cents) throw bad('invalid_price', 'The sale price must be lower than the regular price.');
    const r = await pool.query('INSERT INTO offer_promotions(offer_id, sale_price_cents, starts_at, ends_at, created_by) VALUES ($1,$2,$3,$4,$5) RETURNING id', [o.id, b.sale_price_cents, b.starts_at, b.ends_at, req.user!.id]);
    return reply.code(201).send({ id: r.rows[0].id });
  });
  app.delete<{ Params: { storeId: string; id: string } }>('/stores/:storeId/promotions/:id', async (req) => {
    const sid = await store(req);
    const r = await pool.query(`UPDATE offer_promotions SET cancelled_at = now() WHERE id = $1 AND cancelled_at IS NULL AND offer_id IN (SELECT id FROM store_offers WHERE store_id = $2) RETURNING id`, [uuid.parse(req.params.id), sid]);
    if (!r.rowCount) throw notFound('Promotion not found');
    return { ok: true };
  });

  // ---------- CSV import ----------
  app.get('/import-template', async (_req, reply) => reply.header('content-type', 'text/csv').header('content-disposition', 'attachment; filename="eazyfoods-import-template.csv"')
    .send(toCsv([['barcode', 'sku', 'slug', 'price', 'stock', 'active'], ['', '', 'garri-white', '4.99', '25', 'yes'], ['0123456789012', '', '', '12.50', '8', 'yes']])));

  app.post<{ Params: { storeId: string } }>('/stores/:storeId/import', async (req, reply) => {
    const sid = await store(req);
    const { csv, dry_run } = z.object({ csv: z.string().min(1).max(1_000_000), dry_run: z.boolean().default(false) }).parse(req.body);
    const rows = parseCsv(csv);
    const header = (rows.shift() ?? []).map((h) => h.trim().toLowerCase());
    const col = (n: string) => header.indexOf(n);
    if (col('price') < 0 || col('stock') < 0 || (col('barcode') < 0 && col('sku') < 0 && col('slug') < 0)) throw bad('bad_header', 'The first row must include price, stock, and at least one of barcode, sku or slug.');
    if (rows.length > 2000) throw bad('too_many_rows', 'Import at most 2,000 rows at a time.');
    const errors: { row: number; message: string }[] = [];
    let ok = 0;
    await tx(async (c) => {
      for (const [i, r] of rows.entries()) {
        const rowNo = i + 2, get = (n: string) => (col(n) >= 0 ? (r[col(n)] ?? '').trim() : '');
        const priceStr = get('price'), stockStr = get('stock');
        if (!/^\d+(\.\d{1,2})?$/.test(priceStr) || Number(priceStr) <= 0) { errors.push({ row: rowNo, message: `Price "${priceStr}" is not a valid amount like 4.99.` }); continue; }
        if (!/^\d+$/.test(stockStr)) { errors.push({ row: rowNo, message: `Stock "${stockStr}" must be a whole number, 0 or more.` }); continue; }
        const barcode = get('barcode'), sku = get('sku'), slug = get('slug');
        const p = (await c.query(`SELECT id FROM products WHERE status = 'published' AND (($1 <> '' AND barcode = $1) OR ($2 <> '' AND sku = $2) OR ($3 <> '' AND slug = $3)) LIMIT 2`, [barcode, sku, slug])).rows;
        if (p.length !== 1) { errors.push({ row: rowNo, message: p.length ? 'More than one catalogue product matches.' : 'No published catalogue product matches. Suggest it as a new product first.' }); continue; }
        const price = Math.round(Number(priceStr) * 100), stock = Number(stockStr);
        const active = get('active') === '' ? true : !['no', 'false', '0'].includes(get('active').toLowerCase());
        const cur = (await c.query('SELECT id, stock_on_hand, stock_reserved FROM store_offers WHERE store_id = $1 AND product_id = $2 FOR UPDATE', [sid, p[0].id])).rows[0];
        if (cur && stock < cur.stock_reserved) { errors.push({ row: rowNo, message: `${cur.stock_reserved} units are reserved for open orders; stock cannot be below that.` }); continue; }
        ok++;
        if (dry_run) continue;
        const o = cur ? (await c.query('UPDATE store_offers SET price_cents=$2, is_active=$3, compare_at_cents = CASE WHEN compare_at_cents > $2 THEN compare_at_cents END, updated_at = now() WHERE id=$1 RETURNING id', [cur.id, price, active])).rows[0]
          : (await c.query('INSERT INTO store_offers(store_id, product_id, price_cents, is_active, stock_on_hand) VALUES ($1,$2,$3,$4,0) RETURNING id', [sid, p[0].id, price, active])).rows[0];
        const delta = stock - (cur?.stock_on_hand ?? 0);
        if (delta !== 0) {
          await c.query('UPDATE store_offers SET stock_on_hand = $2 WHERE id = $1', [o.id, stock]);
          await c.query(`INSERT INTO inventory_adjustments(offer_id, delta, reason, note, actor_user_id, resulting_on_hand) VALUES ($1,$2,$3,'CSV import',$4,$5)`, [o.id, delta, cur ? 'correction' : 'initial', req.user!.id, stock]);
        }
      }
      if (!dry_run) await c.query('INSERT INTO import_jobs(store_id, created_by, total_rows, succeeded, failed, errors) VALUES ($1,$2,$3,$4,$5,$6)', [sid, req.user!.id, rows.length, ok, errors.length, JSON.stringify(errors)]);
    });
    return reply.code(dry_run ? 200 : 201).send({ dry_run, total_rows: rows.length, succeeded: ok, failed: errors.length, errors });
  });
  app.get<{ Params: { storeId: string } }>('/stores/:storeId/imports', async (req) => (await pool.query('SELECT id, total_rows, succeeded, failed, errors, created_at FROM import_jobs WHERE store_id = $1 ORDER BY created_at DESC LIMIT 20', [await store(req)])).rows);

  // ---------- Dashboard & settlement ----------
  app.get('/dashboard', async (req) => {
    const vid = vendorId(req);
    const q = z.object({ store: uuid.optional() }).parse(req.query);
    const base = [vid, q.store ?? null];
    const paid = `s.vendor_id = $1 AND ($2::uuid IS NULL OR s.store_id = $2) AND s.status NOT IN ('awaiting_payment','expired')`;
    const accept = await getSetting<number>('vendor.accept_timeout_minutes');
    const [today, pending, trend, best, low, refunds, active, bal] = await Promise.all([
      pool.query(`SELECT count(*)::int AS orders, COALESCE(sum(s.subtotal_cents),0)::int AS gross_cents FROM suborders s JOIN orders o ON o.id = s.order_id WHERE ${paid} AND o.placed_at >= date_trunc('day', now() AT TIME ZONE 'America/Edmonton') AT TIME ZONE 'America/Edmonton'`, base),
      pool.query(`SELECT count(*)::int AS pending, count(*) FILTER (WHERE o.placed_at < now() - make_interval(mins => $3))::int AS needs_attention FROM suborders s JOIN orders o ON o.id = s.order_id WHERE s.vendor_id = $1 AND ($2::uuid IS NULL OR s.store_id = $2) AND s.status = 'placed'`, [...base, accept]),
      pool.query(`SELECT to_char(d, 'YYYY-MM-DD') AS day, COALESCE(x.orders,0)::int AS orders, COALESCE(x.gross,0)::int AS gross_cents FROM generate_series(current_date - 13, current_date, '1 day') d
                  LEFT JOIN (SELECT date_trunc('day', o.placed_at AT TIME ZONE 'America/Edmonton')::date AS day, count(*) AS orders, sum(s.subtotal_cents) AS gross FROM suborders s JOIN orders o ON o.id = s.order_id WHERE ${paid} GROUP BY 1) x ON x.day = d::date ORDER BY d`, base),
      pool.query(`SELECT l.product_name AS name, sum(l.quantity - l.refunded_quantity)::int AS units, sum(l.line_total_cents)::int AS gross_cents FROM order_lines l JOIN suborders s ON s.id = l.suborder_id JOIN orders o ON o.id = s.order_id
                   WHERE ${paid} AND o.placed_at > now() - interval '30 days' GROUP BY l.product_name ORDER BY gross_cents DESC LIMIT 5`, base),
      pool.query(`SELECT p.name, st.name AS store, (o.stock_on_hand - o.stock_reserved)::int AS available, o.low_stock_threshold FROM store_offers o JOIN products p ON p.id = o.product_id JOIN stores st ON st.id = o.store_id
                   WHERE st.vendor_id = $1 AND ($2::uuid IS NULL OR st.id = $2) AND o.is_active AND o.stock_on_hand - o.stock_reserved <= o.low_stock_threshold ORDER BY available, p.name LIMIT 50`, base),
      pool.query(`SELECT count(*) FILTER (WHERE s.status IN ('rejected','cancelled'))::int AS cancelled_30d, COALESCE((SELECT sum(r.amount_cents) FROM refunds r JOIN suborders s2 ON s2.id = r.suborder_id WHERE s2.vendor_id = $1 AND r.status = 'succeeded' AND r.created_at > now() - interval '30 days'),0)::int AS refunded_cents_30d,
                         count(*)::int AS orders_30d FROM suborders s JOIN orders o ON o.id = s.order_id WHERE ${paid} AND o.placed_at > now() - interval '30 days'`, base),
      pool.query(`SELECT count(*)::int AS n FROM offer_promotions pr JOIN store_offers o ON o.id = pr.offer_id JOIN stores st ON st.id = o.store_id WHERE st.vendor_id = $1 AND pr.cancelled_at IS NULL AND now() >= pr.starts_at AND now() < pr.ends_at`, [vid]),
      pool.query(`SELECT COALESCE(-sum(amount_cents) FILTER (WHERE account='vendor_payable'),0)::int AS owed_cents FROM ledger_entries WHERE vendor_id = $1`, [vid]),
    ]);
    const stats = await settlementTotals(vid, q.store ?? null, null, null);
    return {
      today: today.rows[0], pending: pending.rows[0], trend: trend.rows, best_sellers: best.rows,
      low_stock: low.rows.filter((r) => r.available > 0), out_of_stock: low.rows.filter((r) => r.available <= 0), cancellations: refunds.rows[0], active_promotions: active.rows[0].n,
      // Gross sales are NOT profit: money shown here is revenue before commission, refunds and the vendor's own costs.
      last_30_days: { ...stats, note: 'Gross sales are before commission and refunds. They are not profit.' }, balance: { owed_to_you_cents: bal.rows[0].owed_cents },
    };
  });

  app.get('/reports/settlement', async (req, reply) => {
    const vid = vendorId(req);
    const q = z.object({ from: z.string().optional(), to: z.string().optional(), format: z.enum(['json', 'csv']).default('json') }).parse(req.query);
    const rows = (await pool.query(
      `SELECT o.order_number, st.name AS store, o.placed_at, s.status, s.subtotal_cents AS gross_cents, s.discount_cents, s.tax_cents + s.delivery_tax_cents AS tax_collected_cents, s.commission_cents,
              COALESCE((SELECT sum(r.merchandise_cents - r.commission_cents) FROM refunds r WHERE r.suborder_id = s.id AND r.status = 'succeeded' AND r.vendor_funded),0)::int AS refunds_charged_cents,
              (CASE WHEN s.payout_id IS NULL THEN 'not yet paid out' ELSE 'paid out' END) AS payout_state
         FROM suborders s JOIN orders o ON o.id = s.order_id JOIN stores st ON st.id = s.store_id
        WHERE s.vendor_id = $1 AND s.status IN ('placed','accepted','preparing','ready','out_for_delivery','delivered','collected','rejected','cancelled') AND o.placed_at IS NOT NULL
          AND ($2::date IS NULL OR o.placed_at >= $2::date) AND ($3::date IS NULL OR o.placed_at < $3::date + 1) ORDER BY o.placed_at DESC LIMIT 2000`, [vid, q.from ?? null, q.to ?? null])).rows
      .map((r) => ({ ...r, net_settlement_cents: ['rejected', 'cancelled'].includes(r.status) ? 0 : r.gross_cents - r.commission_cents - r.refunds_charged_cents }));
    if (q.format === 'csv') {
      return reply.header('content-type', 'text/csv').header('content-disposition', 'attachment; filename="settlement.csv"').send(toCsv([
        ['order', 'store', 'placed_at', 'status', 'gross_sales', 'discounts_funded_by_eazyfoods', 'tax_collected', 'commission', 'refunds_charged', 'net_settlement', 'payout'],
        ...rows.map((r) => [r.order_number, r.store, new Date(r.placed_at).toISOString(), r.status, r.gross_cents / 100, r.discount_cents / 100, r.tax_collected_cents / 100, r.commission_cents / 100, r.refunds_charged_cents / 100, r.net_settlement_cents / 100, r.payout_state])]));
    }
    return { rows, totals: await settlementTotals(vid, null, q.from ?? null, q.to ?? null), definitions: DEFINITIONS };
  });

  // ---------- Advertising ----------
  app.get('/ads', async (req) => (await pool.query(
    `SELECT c.id, c.title, c.placement, c.status, c.review_note, c.cpc_cents, c.budget_cents, c.starts_at, c.ends_at,
            count(e.*) FILTER (WHERE e.type='impression')::int AS impressions, count(e.*) FILTER (WHERE e.type='click')::int AS clicks,
            (count(e.*) FILTER (WHERE e.type='click') * c.cpc_cents)::int AS spent_cents
       FROM ad_campaigns c LEFT JOIN ad_events e ON e.campaign_id = c.id WHERE c.vendor_id = $1 GROUP BY c.id ORDER BY c.created_at DESC`, [vendorId(req)])).rows);

  app.post('/ads', async (req, reply) => {
    const vid = vendorId(req); ownerOnly(req);
    const b = z.object({
      store_id: uuid, product_slug: z.string().optional(), placement: z.enum(['home_banner', 'region_banner', 'search_sponsored', 'sponsored_store']), region_slug: z.string().optional(),
      title: z.string().min(3).max(80), body: z.string().max(200).optional(), image_url: img, cpc_cents: z.number().int().positive(), budget_cents: z.number().int().positive(),
      starts_at: z.coerce.date(), ends_at: z.coerce.date(),
    }).parse(req.body);
    if (!(await canManageStore(req.user!, b.store_id))) throw forbidden();
    if (b.ends_at <= b.starts_at) throw bad('invalid_dates', 'The end must be after the start.');
    const [minCpc, minBudget] = await Promise.all([getSetting<number>('ads.min_cpc_cents'), getSetting<number>('ads.min_budget_cents')]);
    if (b.cpc_cents < minCpc) throw bad('cpc_too_low', `Minimum cost per click is $${(minCpc / 100).toFixed(2)}.`);
    if (b.budget_cents < minBudget) throw bad('budget_too_low', `Minimum budget is $${(minBudget / 100).toFixed(2)}.`);
    let productId: string | null = null;
    if (b.placement === 'search_sponsored') {
      if (!b.product_slug) throw bad('product_required', 'Choose the product to promote.');
      const p = (await pool.query(`SELECT p.id FROM products p JOIN store_offers o ON o.product_id = p.id AND o.store_id = $2 AND o.is_active WHERE p.slug = $1 AND p.status = 'published'`, [b.product_slug, b.store_id])).rows[0];
      if (!p) throw bad('product_not_listed', 'You can only promote a product that your store lists.');
      productId = p.id;
    }
    const regionId = b.region_slug ? (await pool.query('SELECT id FROM regions WHERE slug = $1', [b.region_slug])).rows[0]?.id ?? null : null;
    const r = await pool.query(`INSERT INTO ad_campaigns(vendor_id, store_id, product_id, placement, region_id, title, body, image_url, cpc_cents, budget_cents, starts_at, ends_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id, status`,
      [vid, b.store_id, productId, b.placement, regionId, b.title, b.body ?? null, b.image_url ?? null, b.cpc_cents, b.budget_cents, b.starts_at, b.ends_at]);
    return reply.code(201).send(r.rows[0]);   // starts as 'pending': an admin must approve the creative
  });
};

async function onboardingStatus(vid: string) {
  const v = (await pool.query('SELECT * FROM vendors WHERE id = $1', [vid])).rows[0];
  const st = (await pool.query('SELECT * FROM stores WHERE vendor_id = $1 ORDER BY created_at LIMIT 1', [vid])).rows[0];
  const [hours, regions, docs, offers, zones] = await Promise.all([
    pool.query('SELECT count(*)::int n FROM store_hours WHERE store_id = $1', [st.id]), pool.query('SELECT count(*)::int n FROM store_regions WHERE store_id = $1', [st.id]),
    pool.query('SELECT count(*)::int n FROM vendor_documents WHERE vendor_id = $1 AND status <> $2', [vid, 'rejected']),
    pool.query('SELECT count(*)::int n FROM store_offers WHERE store_id = $1 AND is_active', [st.id]),
    pool.query('SELECT count(*)::int n FROM store_delivery_zones WHERE store_id = $1', [st.id])]);
  const items = [
    { key: 'business_details', label: 'Business details', done: !!(v.name && v.phone && v.business_number), required: true, hint: 'Business name, phone and business/GST number.' },
    { key: 'store_location', label: 'Store location and contact', done: !!(st.address_line && st.postal_code && st.phone), required: true, hint: 'Street address, postal code and a phone number customers can reach.' },
    { key: 'hours', label: 'Opening hours', done: hours.rows[0].n > 0, required: true, hint: 'Set the hours you can take orders.' },
    { key: 'regions', label: 'Regional specialties', done: regions.rows[0].n > 0, required: true, hint: 'Pick the African regions your store specialises in.' },
    { key: 'fulfilment', label: 'Delivery or pickup', done: st.offers_delivery || st.offers_pickup, required: true, hint: 'Choose whether you offer delivery, pickup, or both.' },
    { key: 'documents', label: 'Business documents', done: docs.rows[0].n > 0, required: true, hint: 'Upload a business licence (and food premises permit if you have one).' },
    { key: 'agreement', label: 'Vendor agreement', done: !!v.agreement_accepted_at, required: true, hint: 'Read and accept the agreement and fees.' },
    { key: 'payout', label: 'Payout account', done: !!v.stripe_account_id, required: false, hint: 'Needed before we can pay you. We will help you connect it after approval.' },
    { key: 'products', label: 'Products listed', done: offers.rows[0].n >= 5, required: false, hint: 'List at least 5 products so customers have something to buy at launch.' },
    { key: 'delivery_zones', label: 'Delivery areas', done: zones.rows[0].n > 0 || !st.offers_delivery, required: false, hint: 'EAZyfoods assigns the delivery areas you serve when you are approved.' },
  ];
  return { vendor_status: v.status, store_status: st.status, store_id: st.id, store_slug: st.slug, items, can_submit: v.status === 'draft' && items.filter((i) => i.required).every((i) => i.done) };
  }

export const DEFINITIONS = {
  gross_sales: 'Merchandise value of orders (before discounts, tax, commission and refunds). Not profit.',
  discounts: 'Coupon discounts. Funded by EAZyfoods; they do not reduce your earnings.',
  tax_collected: 'GST collected from customers on goods and delivery. Not your income.',
  commission: 'EAZyfoods marketplace commission on gross sales.',
  refunds_charged: 'Your share of refunds for items you could not supply or supplied incorrectly (merchandise less the commission we return).',
  net_settlement: 'Gross sales minus commission minus refunds charged to you. Payment-processing fees are paid by EAZyfoods.',
};

async function settlementTotals(vid: string, store: string | null, from: string | null, to: string | null) {
  const r = (await pool.query(
    `SELECT COALESCE(sum(s.subtotal_cents) FILTER (WHERE s.status NOT IN ('rejected','cancelled')),0)::int AS gross_cents,
            COALESCE(sum(s.discount_cents) FILTER (WHERE s.status NOT IN ('rejected','cancelled')),0)::int AS discounts_cents,
            COALESCE(sum(s.tax_cents + s.delivery_tax_cents) FILTER (WHERE s.status NOT IN ('rejected','cancelled')),0)::int AS tax_collected_cents,
            COALESCE(sum(s.commission_cents) FILTER (WHERE s.status NOT IN ('rejected','cancelled')),0)::int AS commission_cents,
            COALESCE(sum((SELECT sum(r.merchandise_cents - r.commission_cents) FROM refunds r WHERE r.suborder_id = s.id AND r.status='succeeded' AND r.vendor_funded)) FILTER (WHERE s.status NOT IN ('rejected','cancelled')),0)::int AS refunds_charged_cents,
            count(*) FILTER (WHERE s.status NOT IN ('rejected','cancelled'))::int AS orders
       FROM suborders s JOIN orders o ON o.id = s.order_id
      WHERE s.vendor_id = $1 AND ($2::uuid IS NULL OR s.store_id = $2) AND o.placed_at IS NOT NULL
        AND (($3::date IS NULL AND $4::date IS NULL AND o.placed_at > now() - interval '30 days') OR (($3::date IS NULL OR o.placed_at >= $3::date) AND ($4::date IS NULL OR o.placed_at < $4::date + 1) AND ($3::date IS NOT NULL OR $4::date IS NOT NULL)))`,
    [vid, store, from, to])).rows[0];
  return { ...r, net_settlement_cents: r.gross_cents - r.commission_cents - r.refunds_charged_cents, definitions: DEFINITIONS };
}
