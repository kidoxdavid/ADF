import { describe, expect, it } from 'vitest';
import { app, login } from './helpers.js';
import { pool } from '../src/db/pool.js';

const storeId = async (slug: string) => (await pool.query('SELECT id FROM stores WHERE slug=$1', [slug])).rows[0].id;
const productId = async (slug: string) => (await pool.query('SELECT id FROM products WHERE slug=$1', [slug])).rows[0].id;

describe('authentication', () => {
  it('registers, reads profile, logs out', async () => {
    const reg = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { email: 'new@example.test', password: 'a-long-password', full_name: 'New Person' } });
    expect(reg.statusCode).toBe(201);
    const cookie = String(reg.headers['set-cookie']).split(';')[0];
    expect(String(reg.headers['set-cookie'])).toMatch(/HttpOnly/i);
    const me = await app.inject({ url: '/api/auth/me', headers: { cookie } });
    expect(me.json().email).toBe('new@example.test');
    await app.inject({ method: 'POST', url: '/api/auth/logout', headers: { cookie } });
    expect((await app.inject({ url: '/api/auth/me', headers: { cookie } })).json()).toBeNull();
  });

  it('rejects weak passwords, duplicate emails, wrong passwords', async () => {
    expect((await app.inject({ method: 'POST', url: '/api/auth/register', payload: { email: 'x@example.test', password: 'short', full_name: 'X' } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: '/api/auth/register', payload: { email: 'new@example.test', password: 'a-long-password', full_name: 'Dup' } })).statusCode).toBe(409);
    expect((await login('customer@example.test', 'wrong-password-1')).status).toBe(401);
  });

  it('never stores plaintext passwords', async () => {
    const r = await pool.query(`SELECT password_hash FROM users WHERE email='customer@example.test'`);
    expect(r.rows[0].password_hash).toMatch(/^scrypt\$/);
    expect(r.rows[0].password_hash).not.toContain('dev-password-123');
  });

  it('rejects cross-origin state-changing requests', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/auth/login', headers: { origin: 'https://evil.example' }, payload: { email: 'a@b.co', password: 'xxxxxxxxxx' } });
    expect(r.statusCode).toBe(403);
  });
});

describe('authorization', () => {
  it('vendor routes require login', async () => {
    expect((await app.inject({ url: '/api/vendor/stores' })).statusCode).toBe(401);
  });

  it("a vendor cannot read or modify another vendor's store inventory", async () => {
    const { cookie } = await login('owner1@example.test');
    const other = await storeId('demo-horn-spice-grocer');
    const pid = await productId('berbere-spice-blend');
    expect((await app.inject({ url: `/api/vendor/stores/${other}/offers`, headers: { cookie } })).statusCode).toBe(403);
    const put = await app.inject({ method: 'PUT', url: `/api/vendor/stores/${other}/offers/${pid}`, headers: { cookie }, payload: { price_cents: 1 } });
    expect(put.statusCode).toBe(403);
    const stock = await app.inject({ method: 'POST', url: `/api/vendor/stores/${other}/offers/${pid}/stock`, headers: { cookie }, payload: { delta: 100, reason: 'receive' } });
    expect(stock.statusCode).toBe(403);
  });

  it('a vendor can manage their own store, and the change shows on the storefront', async () => {
    const { cookie } = await login('owner1@example.test');
    const mine = await storeId('demo-calgary-west-african-market');
    const pid = await productId('garri-white');
    const put = await app.inject({ method: 'PUT', url: `/api/vendor/stores/${mine}/offers/${pid}`, headers: { cookie }, payload: { price_cents: 1234 } });
    expect(put.statusCode).toBe(200);
    const page = (await app.inject({ url: '/api/stores/demo-calgary-west-african-market' })).json();
    expect(page.products.find((p: any) => p.slug === 'garri-white').price_cents).toBe(1234);
    const a = await pool.query(`SELECT 1 FROM audit_log WHERE action='offer.upsert'`);
    expect(a.rowCount).toBeGreaterThan(0);
  });

  it('customers cannot use vendor or admin endpoints', async () => {
    const { cookie } = await login('customer@example.test');
    const s = await storeId('demo-calgary-west-african-market');
    expect((await app.inject({ url: `/api/vendor/stores/${s}/offers`, headers: { cookie } })).statusCode).toBe(403);
    const v = (await pool.query('SELECT id FROM vendors LIMIT 1')).rows[0].id;
    expect((await app.inject({ method: 'PATCH', url: `/api/admin/vendors/${v}/status`, headers: { cookie }, payload: { status: 'approved' } })).statusCode).toBe(403);
  });

  it('vendor owners cannot self-approve', async () => {
    const { cookie } = await login('owner1@example.test');
    const v = (await pool.query('SELECT id FROM vendors LIMIT 1')).rows[0].id;
    expect((await app.inject({ method: 'PATCH', url: `/api/admin/vendors/${v}/status`, headers: { cookie }, payload: { status: 'approved' } })).statusCode).toBe(403);
  });

  it('admin approval gates publication and is audited', async () => {
    const { cookie } = await login('admin@example.test');
    const vend = (await pool.query(`INSERT INTO vendors(name,status,is_test_data) VALUES ('Gate Test','submitted',true) RETURNING id`)).rows[0].id;
    const st = (await pool.query(`INSERT INTO stores(vendor_id,slug,name,is_test_data) VALUES ($1,'gate-test','Gate Test',true) RETURNING id`, [vend])).rows[0].id;
    const early = await app.inject({ method: 'PATCH', url: `/api/admin/stores/${st}/status`, headers: { cookie }, payload: { status: 'published' } });
    expect(early.statusCode).toBe(409);
    // approval needs a verified business document
    expect((await app.inject({ method: 'PATCH', url: `/api/admin/vendors/${vend}/status`, headers: { cookie }, payload: { status: 'approved' } })).json().error).toBe('docs_required');
    const doc = (await pool.query(`INSERT INTO vendor_documents(vendor_id, kind, url) VALUES ($1,'business_licence','/uploads/x.pdf') RETURNING id`, [vend])).rows[0].id;
    expect((await app.inject({ method: 'PATCH', url: `/api/admin/vendor-documents/${doc}`, headers: { cookie }, payload: { status: 'verified' } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'PATCH', url: `/api/admin/vendors/${vend}/status`, headers: { cookie }, payload: { status: 'approved' } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'PATCH', url: `/api/admin/stores/${st}/status`, headers: { cookie }, payload: { status: 'published' } })).statusCode).toBe(200);
    const a = await pool.query(`SELECT action FROM audit_log WHERE entity_id = $1 OR entity_id = $2`, [vend, st]);
    expect(a.rows.map((r) => r.action)).toEqual(expect.arrayContaining(['vendor.approved', 'store.published']));
  });
});

describe('inventory integrity', () => {
  it('concurrent decrements never push stock negative and are all recorded', async () => {
    const { cookie } = await login('owner2@example.test');
    const sid = await storeId('demo-horn-spice-grocer');
    const pid = await productId('berbere-spice-blend');
    await pool.query(`UPDATE store_offers SET stock_on_hand=10, stock_reserved=0 WHERE store_id=$1 AND product_id=$2`, [sid, pid]);
    const calls = Array.from({ length: 20 }, () =>
      app.inject({ method: 'POST', url: `/api/vendor/stores/${sid}/offers/${pid}/stock`, headers: { cookie }, payload: { delta: -1, reason: 'damage' } }));
    const results = await Promise.all(calls);
    const ok = results.filter((r) => r.statusCode === 200).length;
    expect(ok).toBe(10);
    const row = (await pool.query('SELECT stock_on_hand FROM store_offers WHERE store_id=$1 AND product_id=$2', [sid, pid])).rows[0];
    expect(row.stock_on_hand).toBe(0);
  });

  it('cannot reduce stock below reserved units', async () => {
    const { cookie } = await login('owner2@example.test');
    const sid = await storeId('demo-horn-spice-grocer');
    const pid = await productId('teff-flour-ivory');
    await pool.query(`UPDATE store_offers SET stock_on_hand=5, stock_reserved=4 WHERE store_id=$1 AND product_id=$2`, [sid, pid]);
    const r = await app.inject({ method: 'POST', url: `/api/vendor/stores/${sid}/offers/${pid}/stock`, headers: { cookie }, payload: { delta: -3, reason: 'correction' } });
    expect(r.statusCode).toBe(409);
  });

  it('stock history and audit log are append-only at the database level', async () => {
    await expect(pool.query('UPDATE inventory_adjustments SET delta = 0')).rejects.toThrow(/append-only/);
    await expect(pool.query('DELETE FROM audit_log')).rejects.toThrow(/append-only/);
  });
});
