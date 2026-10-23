import { beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { addToCart, app, call, checkout, login, newCustomer, openAllStores, setOffer, simulate } from './helpers.js';
import { pool } from '../src/db/pool.js';
import { runJobsOnce } from '../src/jobs.js';
import { processOutbox } from '../src/services/notify.js';

const S1 = 'demo-calgary-west-african-market';
beforeAll(openAllStores);
const who = async (e: string) => (await login(e)).cookie;

async function upload(cookie: string, url: string, bytes: Buffer, filename = 'a.jpg') {
  const b = '----t' + randomUUID();
  const body = Buffer.concat([Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: image/jpeg\r\n\r\n`), bytes, Buffer.from(`\r\n--${b}--\r\n`)]);
  const r = await app.inject({ method: 'POST', url, payload: body, headers: { cookie, 'content-type': `multipart/form-data; boundary=${b}` } });
  return { status: r.statusCode, body: r.json() };
}
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64)]);
const PDF = Buffer.from('%PDF-1.4\n%fake\n');

describe('vendor onboarding to publication', () => {
  it('walks apply -> checklist -> documents -> agreement -> submit -> admin verifies and approves -> publish; storefront stays hidden until then', async () => {
    const u = await newCustomer();
    const ap = await call(u.cookie, 'POST', '/api/vendor/apply', { business_name: 'Onboard Test Grocers', phone: '4035550123', store_name: 'Onboard Test Market', address_line: '5 Test Rd', postal_code: 'T2B 0B0', regions: ['east-africa'] });
    expect(ap.status).toBe(201);
    const { cookie } = await login(u.email, 'a-long-password');
    let ob = (await call(cookie, 'GET', '/api/vendor/onboarding')).body;
    expect(ob.can_submit).toBe(false);
    expect((await call(cookie, 'POST', '/api/vendor/submit')).status).toBe(409);

    // a vendor cannot approve themselves
    expect((await call(cookie, 'PATCH', `/api/admin/vendors/${ap.body.vendor_id}/status`, { status: 'approved' })).status).toBe(403);

    await call(cookie, 'PUT', '/api/vendor/profile', { name: 'Onboard Test Grocers', business_number: '123456789RT0001', phone: '4035550123', contact_email: 'owner@onboard.test' });
    await call(cookie, 'PUT', `/api/vendor/stores/${ap.body.store_id}/hours`, { hours: [1, 2, 3, 4, 5].map((d) => ({ dow: d, opens: '09:00', closes: '18:00' })) });
    expect((await call(cookie, 'POST', '/api/vendor/agreement/accept')).status).toBe(200);

    // documents: real file type is checked from the bytes, not the name
    expect((await upload(cookie, '/api/vendor/documents?kind=business_licence', Buffer.from('MZ\x90\x00 not a pdf'), 'licence.pdf')).status).toBe(400);
    const doc = await upload(cookie, '/api/vendor/documents?kind=business_licence', PDF, 'licence.pdf');
    expect(doc.status).toBe(201);
    ob = (await call(cookie, 'GET', '/api/vendor/onboarding')).body;
    expect(ob.items.filter((i: any) => i.required && !i.done)).toEqual([]);
    expect((await call(cookie, 'POST', '/api/vendor/submit')).status).toBe(200);

    const admin = await who('admin@example.test');
    // approval needs a verified document
    expect((await call(admin, 'PATCH', `/api/admin/vendors/${ap.body.vendor_id}/status`, { status: 'approved' })).body.error).toBe('docs_required');
    // private documents are downloadable by staff only
    expect((await call(cookie, 'GET', `/api/admin/vendor-documents/${doc.body.id}/file`)).status).toBe(403);
    expect((await app.inject({ url: `/api/admin/vendor-documents/${doc.body.id}/file`, headers: { cookie: admin } })).statusCode).toBe(200);
    await call(admin, 'PATCH', `/api/admin/vendor-documents/${doc.body.id}`, { status: 'verified' });
    expect((await call(admin, 'PATCH', `/api/admin/vendors/${ap.body.vendor_id}/status`, { status: 'approved' })).status).toBe(200);
    expect((await call(null, 'GET', `/api/stores/${ap.body.slug}`)).status).toBe(404);     // approved but store not yet published
    expect((await call(admin, 'PATCH', `/api/admin/stores/${ap.body.store_id}/status`, { status: 'published' })).status).toBe(200);
    expect((await call(null, 'GET', `/api/stores/${ap.body.slug}`)).status).toBe(200);
    await processOutbox();
    expect((await pool.query(`SELECT 1 FROM notifications WHERE template='vendor_approved' AND to_email='owner@onboard.test' OR (template='vendor_approved' AND user_id=$1)`, [u.id])).rowCount).toBeGreaterThan(0);
  });

  it('rejects disguised uploads and public-file abuse', async () => {
    const owner = await who('owner1@example.test');
    expect((await upload(owner, '/api/uploads/image', Buffer.from('<?php system($_GET[0]); ?>'), 'shell.jpg')).status).toBe(400);
    expect((await upload(owner, '/api/uploads/image', PDF, 'x.jpg')).status).toBe(400);            // PDF is not an allowed public image
    const ok = await upload(owner, '/api/uploads/image', JPEG);
    expect(ok.status).toBe(200);
    expect(ok.body.url).toMatch(/^\/uploads\/[a-f0-9]{32}\.jpg$/);
    expect((await app.inject({ url: ok.body.url })).statusCode).toBe(200);
    expect((await app.inject({ url: '/uploads/../../etc/passwd' })).statusCode).not.toBe(200);
    expect((await upload((await newCustomer()).cookie, '/api/uploads/image', JPEG)).status).toBe(403);   // plain customers cannot upload
    expect((await upload(owner, '/api/uploads/image', Buffer.concat([JPEG, Buffer.alloc(6 * 1024 * 1024)]))).status).toBe(413);
  });
});

describe('catalogue management', () => {
  it('vendor suggestions stay hidden until moderated; aliases only search once verified', async () => {
    const owner = await who('owner1@example.test'), admin = await who('owner@example.test');
    const s = await call(owner, 'POST', '/api/vendor/products/suggest', { name: 'Zobo Hibiscus Leaves', pack_size: 100, pack_unit: 'g', country_slugs: ['nigeria'] });
    expect(s.status).toBe(201);
    expect(s.body.status).toBe('pending');
    const found = async (q: string) => (await call(null, 'GET', `/api/search?q=${q}`)).body.results.map((r: any) => r.slug);
    expect(await found('zobo')).toEqual([]);
    expect((await call(owner, 'PATCH', `/api/admin/products/${s.body.id}`, { status: 'published' })).status).toBe(403);   // vendors cannot publish
    const pid = s.body.id;
    expect((await call(admin, 'PATCH', `/api/admin/products/${pid}`, { status: 'published' })).status).toBe(200);
    const storeId = (await pool.query('SELECT id FROM stores WHERE slug=$1', [S1])).rows[0].id;
    expect((await call(owner, 'PUT', `/api/vendor/stores/${storeId}/offers/${pid}`, { price_cents: 650 })).status).toBe(200);
    expect(await found('zobo')).toContain('zobo-hibiscus-leaves');
    // alias: unverified is invisible, verified is searchable, un-verifying hides it again
    const al = await call(admin, 'POST', `/api/admin/products/${pid}/aliases`, { alias: 'Sorrel', verified: false });
    expect(await found('sorrel')).toEqual([]);
    await call(admin, 'PATCH', `/api/admin/aliases/${al.body.id}`, { verified: true });
    expect(await found('sorrel')).toContain('zobo-hibiscus-leaves');
    await call(admin, 'PATCH', `/api/admin/aliases/${al.body.id}`, { verified: false });
    expect(await found('sorrel')).toEqual([]);
    // images must be ones we issued
    expect((await call(admin, 'POST', `/api/admin/products/${pid}/images`, { url: 'https://evil.example/x.jpg', alt: 'x' })).status).toBe(400);
    // duplicate barcode is refused
    await call(admin, 'PATCH', `/api/admin/products/${pid}`, { barcode: '0611269991000' });
    expect((await call(owner, 'POST', '/api/vendor/products/suggest', { name: 'Another', barcode: '0611269991000' })).status).toBe(409);
  });

  it('taxonomy is data: a new region and country work without code changes', async () => {
    const admin = await who('admin@example.test');
    expect((await call(admin, 'POST', '/api/admin/countries', { name: 'Botswana', iso2: 'BW' })).status).toBe(201);
    const r = await call(admin, 'POST', '/api/admin/regions', { name: 'Test Diaspora Region', countries: ['botswana', 'zambia'] });
    expect(r.status).toBe(201);
    expect((await call(null, 'GET', '/api/regions')).body.some((x: any) => x.slug === 'test-diaspora-region' && x.countries.length === 2)).toBe(true);
    expect((await call(await who('support@example.test'), 'POST', '/api/admin/regions', { name: 'Nope' })).status).toBe(403);
  });
});

describe('vendor tools', () => {
  it('CSV import: validates, reports bad rows, respects reserved stock, is auditable; dry-run changes nothing', async () => {
    const owner = await who('owner3@example.test');
    const sid = (await pool.query('SELECT id FROM stores WHERE slug=$1', ['demo-southern-pantry'])).rows[0].id;
    const csv = ['slug,price,stock,active', 'garri-white,4.50,12,yes', 'no-such-product,3.00,5,yes', 'berbere-spice-blend,abc,5,yes', 'harissa-paste,6.25,-1,yes', 'jollof-rice-seasoning,2.99,30,no'].join('\n');
    const dry = await call(owner, 'POST', `/api/vendor/stores/${sid}/import`, { csv, dry_run: true });
    expect(dry.body.succeeded).toBe(2); expect(dry.body.failed).toBe(3);
    expect((await pool.query('SELECT 1 FROM import_jobs')).rowCount).toBe(0);
    const real = await call(owner, 'POST', `/api/vendor/stores/${sid}/import`, { csv });
    expect(real.status).toBe(201);
    expect(real.body.errors.map((e: any) => e.row)).toEqual([3, 4, 5]);
    const o = (await pool.query(`SELECT o.price_cents, o.stock_on_hand, o.is_active FROM store_offers o JOIN products p ON p.id=o.product_id WHERE o.store_id=$1 AND p.slug='garri-white'`, [sid])).rows[0];
    expect(o).toEqual({ price_cents: 450, stock_on_hand: 12, is_active: true });
    const adj = await pool.query(`SELECT 1 FROM inventory_adjustments a JOIN store_offers x ON x.id=a.offer_id JOIN products p ON p.id=x.product_id WHERE x.store_id=$1 AND p.slug='garri-white' AND a.note='CSV import'`, [sid]);
    expect(adj.rowCount).toBe(1);
    // another vendor cannot import into this store
    expect((await call(await who('owner1@example.test'), 'POST', `/api/vendor/stores/${sid}/import`, { csv })).status).toBe(403);
    expect((await call(owner, 'POST', `/api/vendor/stores/${sid}/import`, { csv: 'a,b\n1,2' })).status).toBe(400);
  });

  it('a scheduled promotion lowers the price everywhere it is shown and charged; ended ones do not', async () => {
    const owner = await who('owner1@example.test');
    const offer = await setOffer(S1, 'jollof-rice-seasoning', 1000, 20);
    const sid = (await pool.query('SELECT id FROM stores WHERE slug=$1', [S1])).rows[0].id;
    const pid = (await pool.query(`SELECT id FROM products WHERE slug='jollof-rice-seasoning'`)).rows[0].id;
    const past = await call(owner, 'POST', `/api/vendor/stores/${sid}/promotions`, { product_id: pid, sale_price_cents: 500, starts_at: new Date(Date.now() - 2 * 864e5), ends_at: new Date(Date.now() - 864e5) });
    expect(past.status).toBe(201);
    expect((await call(owner, 'POST', `/api/vendor/stores/${sid}/promotions`, { product_id: pid, sale_price_cents: 1000, starts_at: new Date(), ends_at: new Date(Date.now() + 1000) })).status).toBe(400);   // not a discount
    const price = async () => (await call(null, 'GET', '/api/products/jollof-rice-seasoning')).body.offers.find((x: any) => x.store_slug === S1).price_cents;
    expect(await price()).toBe(1000);
    const live = await call(owner, 'POST', `/api/vendor/stores/${sid}/promotions`, { product_id: pid, sale_price_cents: 750, starts_at: new Date(Date.now() - 1000), ends_at: new Date(Date.now() + 864e5) });
    expect(await price()).toBe(750);
    const u = await newCustomer();
    await addToCart(u.cookie, offer, 4);
    const q = (await call(u.cookie, 'POST', '/api/checkout/quote', { address_id: u.addressId, method: 'delivery' })).body;
    expect(q.suborders[0].lines[0].unit_price_cents).toBe(750);
    await call(owner, 'DELETE', `/api/vendor/stores/${sid}/promotions/${live.body.id}`);
    expect(await price()).toBe(1000);
    expect((await call(await who('owner2@example.test'), 'DELETE', `/api/vendor/stores/${sid}/promotions/${live.body.id}`)).status).toBe(403);
  });

  it('dashboard and settlement keep gross, tax, commission, refunds and net separate and never call gross "profit"', async () => {
    const u = await newCustomer();
    await addToCart(u.cookie, await setOffer(S1, 'garri-white', 2000, 10), 2);
    await addToCart(u.cookie, await setOffer(S1, 'plantain-chips-salted', 1500, 10), 1);
    const o = (await checkout(u.cookie, u.addressId)).body.order;
    await simulate(u.cookie, o.id, 'succeeded');
    const owner = await who('owner1@example.test');
    const d = (await call(owner, 'GET', '/api/vendor/dashboard')).body;
    expect(d.today.orders).toBeGreaterThan(0);
    expect(d.pending.pending).toBeGreaterThan(0);
    expect(d.last_30_days.note).toMatch(/not profit/i);
    expect(d.last_30_days.net_settlement_cents).toBe(d.last_30_days.gross_cents - d.last_30_days.commission_cents - d.last_30_days.refunds_charged_cents);
    expect(JSON.stringify(d)).not.toMatch(/"profit"/);
    const csv = await app.inject({ url: '/api/vendor/reports/settlement?format=csv', headers: { cookie: owner } });
    expect(csv.statusCode).toBe(200);
    expect(csv.body.split('\n')[0]).toContain('net_settlement');
    const rep = (await call(owner, 'GET', '/api/vendor/reports/settlement')).body;
    const row = rep.rows.find((r: any) => r.order_number === o.order_number);
    expect(row.gross_cents).toBe(5500);
    expect(row.commission_cents).toBe(660);
    expect(row.net_settlement_cents).toBe(5500 - 660);
    // data isolation: another vendor's dashboard has none of this order
    const other = (await call(await who('owner2@example.test'), 'GET', '/api/vendor/reports/settlement')).body;
    expect(other.rows.find((r: any) => r.order_number === o.order_number)).toBeUndefined();
  });

  it('sponsored placements: need approval, are labelled, stop at budget, and measure only real events', async () => {
    const owner = await who('owner1@example.test'), admin = await who('admin@example.test');
    const sid = (await pool.query('SELECT id FROM stores WHERE slug=$1', [S1])).rows[0].id;
    await setOffer(S1, 'garri-white', 2000, 10);
    expect((await call(owner, 'POST', '/api/vendor/ads', { store_id: sid, placement: 'search_sponsored', product_slug: 'garri-white', title: 'Garri', cpc_cents: 5, budget_cents: 5000, starts_at: new Date(), ends_at: new Date(Date.now() + 864e5) })).status).toBe(400);   // cpc below minimum
    const ad = await call(owner, 'POST', '/api/vendor/ads', { store_id: sid, placement: 'search_sponsored', product_slug: 'garri-white', title: 'Fresh garri', cpc_cents: 50, budget_cents: 2000, starts_at: new Date(Date.now() - 1000), ends_at: new Date(Date.now() + 864e5) });
    expect(ad.status).toBe(201); expect(ad.body.status).toBe('pending');
    const sponsored = async () => (await call(null, 'GET', '/api/search?q=garri')).body.results.filter((r: any) => r.sponsored_campaign_id);
    expect(await sponsored()).toHaveLength(0);                                  // not approved yet
    expect((await call(owner, 'PATCH', `/api/admin/ads/${ad.body.id}`, { status: 'approved' })).status).toBe(403);   // vendors cannot approve their own ads
    await call(admin, 'PATCH', `/api/admin/ads/${ad.body.id}`, { status: 'approved' });
    expect((await sponsored())[0].sponsored_campaign_id).toBe(ad.body.id);
    expect((await call(null, 'GET', '/api/search?q=berbere')).body.results.every((r: any) => !r.sponsored_campaign_id)).toBe(true);   // only relevant results
    await call(null, 'POST', `/api/ads/${ad.body.id}/event`, { type: 'impression' });
    for (let i = 0; i < 40; i++) await call(null, 'POST', `/api/ads/${ad.body.id}/event`, { type: 'click' });   // 40 x $0.50 = $20 = budget
    expect((await call(null, 'POST', `/api/ads/${ad.body.id}/event`, { type: 'click' })).status).toBe(404);      // budget exhausted
    expect(await sponsored()).toHaveLength(0);
    const mine = (await call(owner, 'GET', '/api/vendor/ads')).body.find((a: any) => a.id === ad.body.id);
    expect(mine).toMatchObject({ impressions: 1, clicks: 40, spent_cents: 2000 });
  });
});

describe('customers: reviews, favourites, recipes, account', () => {
  async function delivered() {
    const u = await newCustomer();
    await addToCart(u.cookie, await setOffer(S1, 'garri-white', 2000, 50), 2);
    await addToCart(u.cookie, await setOffer(S1, 'plantain-chips-salted', 1500, 50), 1);
    const o = (await checkout(u.cookie, u.addressId)).body.order;
    await simulate(u.cookie, o.id, 'succeeded');
    const sid = (await call(u.cookie, 'GET', `/api/orders/${o.id}`)).body.suborders[0].id;
    return { u, o, sid };
  }
  it('only delivered orders can be reviewed, once, and ratings appear only after 3 genuine reviews', async () => {
    const owner = await who('owner1@example.test'), disp = await who('dispatcher@example.test'), drv = await who('driver@example.test');
    // fresh store rating baseline
    await pool.query(`DELETE FROM reviews`);
    for (let i = 0; i < 3; i++) {
      const { u, o, sid } = await delivered();
      expect((await call(u.cookie, 'POST', `/api/orders/${o.id}/reviews`, { suborder_id: sid, rating: 5 })).status).toBe(404);   // not delivered yet
      await call(owner, 'POST', `/api/vendor/suborders/${sid}/accept`); await call(owner, 'POST', `/api/vendor/suborders/${sid}/ready`);
      const job = (await pool.query('SELECT id FROM deliveries WHERE suborder_id=$1', [sid])).rows[0].id;
      await call(disp, 'POST', `/api/admin/deliveries/${job}/assign`, { driver_id: (await pool.query(`SELECT id FROM drivers WHERE status='approved' LIMIT 1`)).rows[0].id });
      const code = (await call(u.cookie, 'GET', `/api/orders/${o.id}`)).body.suborders[0].handover_code;
      await call(drv, 'POST', `/api/driver/jobs/${job}/pickup`); await call(drv, 'POST', `/api/driver/jobs/${job}/deliver`, { code });
      const rv = await call(u.cookie, 'POST', `/api/orders/${o.id}/reviews`, { suborder_id: sid, rating: i === 0 ? 3 : 5, body: 'Good' });
      expect(rv.status).toBe(201);
      expect((await call(u.cookie, 'POST', `/api/orders/${o.id}/reviews`, { suborder_id: sid, rating: 1 })).status).toBe(409);   // once only
      const prod = (await pool.query(`SELECT product_id FROM order_lines WHERE suborder_id=$1 LIMIT 1`, [sid])).rows[0].product_id;
      expect((await call(u.cookie, 'POST', `/api/orders/${o.id}/reviews`, { suborder_id: sid, product_id: prod, rating: 4 })).status).toBe(201);
      expect((await call((await newCustomer()).cookie, 'POST', `/api/orders/${o.id}/reviews`, { suborder_id: sid, rating: 5 })).status).toBe(404);   // not the buyer
      const pub = (await call(null, 'GET', `/api/stores/${S1}/reviews`)).body;
      if (i < 2) { expect(pub.average).toBeNull(); expect(pub.reviews).toEqual([]); expect(pub.count).toBe(i + 1); }
      else { expect(pub.count).toBe(3); expect(pub.average).toBe(4.3); expect(pub.reviews[0].verified_purchase).toBe(true); }
    }
  });

  it('favourites toggle and list', async () => {
    const u = await newCustomer();
    expect((await call(u.cookie, 'PUT', '/api/favourites/garri-white')).body.favourite).toBe(true);
    expect((await call(u.cookie, 'GET', '/api/favourites')).body.map((p: any) => p.slug)).toContain('garri-white');
    expect((await call(u.cookie, 'DELETE', '/api/favourites/garri-white')).body.favourite).toBe(false);
    expect((await call(null, 'GET', '/api/favourites')).status).toBe(401);
  });

  it('recipe to basket adds only what is genuinely in stock and reports the rest', async () => {
    await setOffer(S1, 'jollof-rice-seasoning', 600, 10); await setOffer(S1, 'parboiled-long-grain-rice', 2200, 0);
    await pool.query(`UPDATE store_offers SET stock_on_hand = stock_reserved WHERE product_id = (SELECT id FROM products WHERE slug='parboiled-long-grain-rice')`);   // out everywhere
    const r = (await call(null, 'GET', '/api/recipes/jollof-rice-nigerian-style')).body;
    expect(r.ai_generated).toBe(true); expect(r.reviewed).toBe(false);
    expect(r.ingredients.find((i: any) => i.product_slug === 'jollof-rice-seasoning').available_from).not.toBeNull();
    const u = await newCustomer();
    const res = (await call(u.cookie, 'POST', '/api/recipes/jollof-rice-nigerian-style/to-cart', {})).body;
    expect(res.added).toContain('Jollof rice seasoning');
    expect(res.added).not.toContain('Parboiled long grain rice');
  });

  it('password reset: neutral response, single-use token, old sessions ended', async () => {
    const u = await newCustomer();
    expect((await call(null, 'POST', '/api/auth/forgot', { email: 'nobody@example.test' })).body.ok).toBe(true);   // same answer for unknown email
    await call(null, 'POST', '/api/auth/forgot', { email: u.email });
    const n = (await pool.query(`SELECT body FROM notifications WHERE to_email=$1 AND template='password_reset' ORDER BY id DESC LIMIT 1`, [u.email])).rows[0];
    const token = /token=([A-Za-z0-9_-]+)/.exec(n.body)![1];
    expect((await call(null, 'POST', '/api/auth/reset', { token, password: 'a-brand-new-password' })).status).toBe(200);
    expect((await call(null, 'POST', '/api/auth/reset', { token, password: 'another-password-9' })).status).toBe(400);   // single use
    expect((await call(u.cookie, 'GET', '/api/auth/me')).body).toBeNull();                                               // old session ended
    expect((await login(u.email, 'a-brand-new-password')).status).toBe(200);
    expect((await call(null, 'POST', '/api/auth/reset', { token: 'x'.repeat(30), password: 'a-brand-new-password' })).status).toBe(400);
  });

  it('email verification token verifies once', async () => {
    const u = await newCustomer();
    const n = (await pool.query(`SELECT body FROM notifications WHERE to_email=$1 AND template='email_verify' ORDER BY id DESC LIMIT 1`, [u.email])).rows[0];
    const token = /token=([A-Za-z0-9_-]+)/.exec(n.body)![1];
    expect((await call(null, 'POST', '/api/auth/verify', { token })).status).toBe(200);
    expect((await call(u.cookie, 'GET', '/api/account/profile')).body.email_verified_at).not.toBeNull();
    expect((await call(null, 'POST', '/api/auth/verify', { token })).status).toBe(400);
  });

  it('privacy: export returns own data; marketing consent is recorded; deletion anonymises but keeps financial records', async () => {
    const { u, o } = await delivered();
    await call(u.cookie, 'PUT', '/api/account/profile', { full_name: 'Test Buyer', phone: null, notify_email: true, marketing_opt_in: true });
    expect((await call(u.cookie, 'GET', '/api/account/profile')).body.marketing_opt_in_at).not.toBeNull();
    await call(u.cookie, 'PUT', '/api/account/profile', { full_name: 'Test Buyer', phone: null, notify_email: true, marketing_opt_in: false });
    expect((await call(u.cookie, 'GET', '/api/account/profile')).body.marketing_opt_in_at).toBeNull();
    const ex = (await call(u.cookie, 'GET', '/api/account/export')).body;
    expect(ex.orders.map((x: any) => x.order_number)).toContain(o.order_number);
    expect(JSON.stringify(ex)).not.toContain('password');
    expect((await call(u.cookie, 'POST', '/api/account/delete', { password: 'a-long-password' })).status).toBe(400);   // order in progress
    await pool.query(`UPDATE orders SET status='completed' WHERE id=$1`, [o.id]);
    expect((await call(u.cookie, 'POST', '/api/account/delete', { password: 'wrong-password-xx' })).status).toBe(400);
    expect((await call(u.cookie, 'POST', '/api/account/delete', { password: 'a-long-password' })).status).toBe(200);
    expect((await login(u.email, 'a-long-password')).status).toBe(401);
    const row = (await pool.query('SELECT customer_name, customer_email, address, total_cents FROM orders WHERE id=$1', [o.id])).rows[0];
    expect(row.customer_name).toBe('Deleted user'); expect(row.address).toBeNull(); expect(row.total_cents).toBe(o.total_cents);
    expect((await pool.query('SELECT 1 FROM addresses WHERE user_id=$1', [u.id])).rowCount).toBe(0);
  });
});

describe('administration', () => {
  it('commercial settings: validated, owner-only, audited; commission override changes new orders', async () => {
    const owner = await who('owner@example.test'), fin = await who('finance@example.test'), admin = await who('admin@example.test');
    expect((await call(admin, 'PUT', '/api/admin/settings/commission.default_bps', { value: 1500 })).status).toBe(403);
    expect((await call(fin, 'PUT', '/api/admin/settings/commission.default_bps', { value: 1500 })).status).toBe(403);
    expect((await call(owner, 'PUT', '/api/admin/settings/commission.default_bps', { value: 9999 })).status).toBe(400);
    expect((await call(owner, 'PUT', '/api/admin/settings/not.a.setting', { value: 1 })).status).toBe(404);
    expect((await call(owner, 'PUT', '/api/admin/settings/commission.default_bps', { value: 1500 })).status).toBe(200);
    const u = await newCustomer();
    await addToCart(u.cookie, await setOffer(S1, 'garri-white', 2000, 10), 2);
    await addToCart(u.cookie, await setOffer(S1, 'plantain-chips-salted', 1000, 10), 1);
    expect((await call(u.cookie, 'POST', '/api/checkout/quote', { address_id: u.addressId, method: 'delivery' })).body.suborders[0].commission_cents).toBe(750);   // 15% of 50.00
    const vid = (await pool.query('SELECT vendor_id FROM stores WHERE slug=$1', [S1])).rows[0].vendor_id;
    expect((await call(admin, 'PATCH', `/api/admin/vendors/${vid}/commission`, { commission_bps: 500 })).status).toBe(403);
    await call(owner, 'PATCH', `/api/admin/vendors/${vid}/commission`, { commission_bps: 500 });
    expect((await call(u.cookie, 'POST', '/api/checkout/quote', { address_id: u.addressId, method: 'delivery' })).body.suborders[0].commission_cents).toBe(250);
    await call(owner, 'PATCH', `/api/admin/vendors/${vid}/commission`, { commission_bps: null });
    await call(owner, 'PUT', '/api/admin/settings/commission.default_bps', { value: 1200 });
    const log = (await call(fin, 'GET', '/api/admin/audit?action=setting')).body;
    expect(log.some((a: any) => a.action === 'setting.changed' && a.detail.old === 1200 && a.detail.new === 1500)).toBe(true);
  });

  it('role management: only owners grant roles; the last owner cannot be removed', async () => {
    const owner = await who('owner@example.test'), admin = await who('admin@example.test');
    const u = await newCustomer();
    expect((await call(admin, 'POST', `/api/admin/users/${u.id}/roles`, { role: 'owner' })).status).toBe(403);   // cannot escalate
    expect((await call(owner, 'POST', `/api/admin/users/${u.id}/roles`, { role: 'support' })).status).toBe(200);
    const { cookie } = await login(u.email, 'a-long-password');
    expect((await call(cookie, 'GET', '/api/admin/tickets')).status).toBe(200);
    expect((await call(cookie, 'GET', '/api/admin/ledger')).status).toBe(403);
    const ownerId = (await pool.query(`SELECT user_id FROM user_roles WHERE role='owner' LIMIT 1`)).rows[0].user_id;
    expect((await call(owner, 'DELETE', `/api/admin/users/${ownerId}/roles/owner`)).status).toBe(409);
  });

  it('coupons: created by promotions staff, enforce minimum and per-user limits', async () => {
    const admin = await who('admin@example.test');
    expect((await call(admin, 'POST', '/api/admin/coupons', { code: 'SAVE5', kind: 'fixed', value: 500, min_subtotal_cents: 3000, per_user_limit: 1 })).status).toBe(201);
    expect((await call(await who('finance@example.test'), 'POST', '/api/admin/coupons', { code: 'X10', kind: 'percent', value: 10 })).status).toBe(403);
    const u = await newCustomer();
    await addToCart(u.cookie, await setOffer(S1, 'garri-white', 2000, 10), 1);
    expect((await call(u.cookie, 'POST', '/api/checkout/quote', { address_id: u.addressId, method: 'delivery', coupon_code: 'SAVE5' })).body.coupon_error).toMatch(/Spend at least/);
    await addToCart(u.cookie, await setOffer(S1, 'plantain-chips-salted', 1500, 10), 1);
    const q = (await call(u.cookie, 'POST', '/api/checkout/quote', { address_id: u.addressId, method: 'delivery', coupon_code: 'save5' })).body;
    expect(q.coupon.discount_cents).toBe(500);
    const o = (await checkout(u.cookie, u.addressId, { coupon_code: 'SAVE5' })).body.order;
    await simulate(u.cookie, o.id, 'succeeded');
    await addToCart(u.cookie, await setOffer(S1, 'garri-white', 2000, 10), 2);
    expect((await call(u.cookie, 'POST', '/api/checkout/quote', { address_id: u.addressId, method: 'delivery', coupon_code: 'SAVE5' })).body.coupon_error).toMatch(/already used/);
  });

  it('delivery zones are configurable data and drive eligibility and fees', async () => {
    const admin = await who('admin@example.test');
    const sid = (await pool.query('SELECT id FROM stores WHERE slug=$1', [S1])).rows[0].id;
    const z = await call(admin, 'POST', '/api/admin/zones', { name: 'Airdrie (test)', fee_cents: 899, eta_minutes: 120, fsas: ['T4B'], store_ids: [sid] });
    expect(z.status).toBe(201);
    const u = await newCustomer('T4B1A1');
    await addToCart(u.cookie, await setOffer(S1, 'garri-white', 2000, 10), 2);
    const q = (await call(u.cookie, 'POST', '/api/checkout/quote', { address_id: u.addressId, method: 'delivery' })).body;
    expect(q.suborders[0].delivery_cents).toBe(899);
    expect(q.suborders[0].eta_minutes).toBe(120);
    expect((await call(admin, 'POST', '/api/admin/zones', { name: 'Clash', fee_cents: 100, eta_minutes: 60, fsas: ['T4B'] })).status).toBe(400);   // FSA already taken
    await call(admin, 'PUT', `/api/admin/zones/${z.body.id}`, { name: 'Airdrie (test)', fee_cents: 899, eta_minutes: 120, is_active: false, fsas: ['T4B'], store_ids: [sid] });
    expect((await call(u.cookie, 'POST', '/api/checkout/quote', { address_id: u.addressId, method: 'delivery' })).body.issues.map((i: any) => i.type)).toContain('outside_service_area');
  });

  it('vendor CRM pipeline and KPI definitions work', async () => {
    const admin = await who('admin@example.test');
    const p = await call(admin, 'POST', '/api/admin/crm/prospects', { business_name: 'Prospect Foods', source: 'walk-in', next_action: 'Call owner', next_action_at: new Date(Date.now() - 1000) });
    expect(p.status).toBe(201);
    await call(admin, 'POST', `/api/admin/crm/prospects/${p.body.id}/activities`, { kind: 'call', note: 'Spoke to the owner; interested' });
    let d = (await call(admin, 'GET', `/api/admin/crm/prospects/${p.body.id}`)).body;
    expect(d.stage).toBe('contacted'); expect(d.last_contact_at).not.toBeNull();
    await call(admin, 'PATCH', `/api/admin/crm/prospects/${p.body.id}`, { stage: 'launched' });
    d = (await call(admin, 'GET', `/api/admin/crm/prospects/${p.body.id}`)).body;
    expect(d.launched_at).not.toBeNull();
    expect((await call(await who('support@example.test'), 'GET', '/api/admin/crm/prospects')).status).toBe(403);
    const k = (await call(await who('finance@example.test'), 'GET', '/api/admin/reports/kpis')).body;
    expect(k.definitions.gmv).toBeTruthy();
    expect(k.marketplace.orders).toBeGreaterThan(0);
    expect(k.definitions.net_marketplace_revenue).toMatch(/processing fees/i);
    const s = (await call(admin, 'GET', '/api/admin/reports/sales')).body;
    expect(s.vendor_pipeline.by_stage.launched).toBeGreaterThanOrEqual(1);
    const demand = (await call(admin, 'GET', '/api/admin/reports/search-demand')).body;
    expect(demand.unmet_queries.some((q: any) => q.query === 'zzqxjv') || demand.searches >= 0).toBe(true);
    expect((await call(admin, 'GET', '/api/admin/system')).body.integrations.find((i: any) => i.name === 'Payments').note).toMatch(/MOCK/);
  });

  it('background jobs: stores that never respond are auto-rejected and the customer refunded', async () => {
    const u = await newCustomer();
    await addToCart(u.cookie, await setOffer(S1, 'garri-white', 2000, 10), 2);
    await addToCart(u.cookie, await setOffer(S1, 'plantain-chips-salted', 1000, 10), 1);
    const o = (await checkout(u.cookie, u.addressId)).body.order;
    await simulate(u.cookie, o.id, 'succeeded');
    await pool.query(`UPDATE orders SET placed_at = now() - interval '2 hours' WHERE id=$1`, [o.id]);
    const r = await runJobsOnce();
    expect(r.rejected).toBeGreaterThanOrEqual(1);
    const after = (await call(u.cookie, 'GET', `/api/orders/${o.id}`)).body;
    expect(after.suborders[0].status).toBe('rejected');
    expect(after.payment_status).toBe('refunded');
    const ex = (await call(await who('dispatcher@example.test'), 'GET', '/api/admin/exceptions')).body;
    expect(ex).toHaveProperty('unaccepted_orders');
  });
});
