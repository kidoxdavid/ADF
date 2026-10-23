import { randomUUID } from 'node:crypto';
import { buildApp } from '../src/app.js';
import { pool } from '../src/db/pool.js';
import { MockProvider } from '../src/payments/mock.js';

export const app = await buildApp();

export async function login(email: string, password = 'dev-password-123') {
  const r = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password } });
  return { status: r.statusCode, cookie: String(r.headers['set-cookie']).split(';')[0] };
}

export const call = async (cookie: string | null, method: string, url: string, payload?: unknown, headers: Record<string, string> = {}) => {
  const r = await app.inject({ method: method as any, url, payload: payload as any, headers: { ...(cookie ? { cookie } : {}), ...headers } });
  let body: any; try { body = r.json(); } catch { body = r.body; }
  return { status: r.statusCode, body, headers: r.headers };
};

/** All demo stores open 24h so checkout tests do not depend on the clock. */
export async function openAllStores() {
  await pool.query('DELETE FROM store_hours');
  await pool.query(`INSERT INTO store_hours(store_id, dow, opens, closes) SELECT s.id, d, '00:00', '23:59:59' FROM stores s, generate_series(0,6) d`);
}

export const storeId = async (slug: string) => (await pool.query('SELECT id FROM stores WHERE slug=$1', [slug])).rows[0].id as string;
export const productId = async (slug: string) => (await pool.query('SELECT id FROM products WHERE slug=$1', [slug])).rows[0].id as string;

/** Create or reset an offer with exact price and stock. Returns the offer id. */
export async function setOffer(store: string, product: string, price_cents: number, stock: number) {
  await pool.query(`UPDATE inventory_reservations SET status='released', resolved_at=now() WHERE status='held' AND offer_id IN (SELECT id FROM store_offers WHERE store_id=$1 AND product_id=$2)`, [await storeId(store), await productId(product)]);
  const r = await pool.query(
    `INSERT INTO store_offers(store_id, product_id, price_cents, stock_on_hand, stock_reserved, is_active) VALUES ($1,$2,$3,$4,0,true)
     ON CONFLICT (store_id, product_id) DO UPDATE SET price_cents=$3, stock_on_hand=$4, stock_reserved=0, is_active=true, compare_at_cents=NULL RETURNING id`,
    [await storeId(store), await productId(product), price_cents, stock]);
  return r.rows[0].id as string;
}

export async function newCustomer(postal = 'T2A0A1') {
  const email = `c${randomUUID().slice(0, 8)}@example.test`;
  const reg = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { email, password: 'a-long-password', full_name: 'Test Buyer' } });
  const cookie = String(reg.headers['set-cookie']).split(';')[0];
  const a = await call(cookie, 'POST', '/api/addresses', { recipient_name: 'Test Buyer', phone: '5875550100', line1: '1 Test St', city: 'Calgary', postal_code: postal });
  return { cookie, email, addressId: a.body.id as string, id: reg.json().id as string };
}

export const addToCart = (cookie: string, offerId: string, quantity: number) => call(cookie, 'PUT', `/api/cart/items/${offerId}`, { quantity });
export const checkout = (cookie: string, addressId: string | null, extra: object = {}, key = randomUUID()) =>
  call(cookie, 'POST', '/api/checkout', { address_id: addressId, method: 'delivery', ...extra }, { 'idempotency-key': key });
export const simulate = (cookie: string, orderId: string, outcome: 'succeeded' | 'failed') => call(cookie, 'POST', `/api/dev/orders/${orderId}/simulate-payment`, { outcome });

export function signedEvent(type: string, paymentId: string, amount: number, id = 'evt_' + randomUUID()) {
  const body = Buffer.from(JSON.stringify({ id, type, payment_id: paymentId, amount_cents: amount }));
  return { body, headers: { 'x-mock-signature': MockProvider.sign(body), 'content-type': 'application/json' } as Record<string, string>, id };
}

export const ledgerSum = async (orderId: string, account?: string) =>
  Number((await pool.query(`SELECT COALESCE(sum(amount_cents),0) AS s FROM ledger_entries WHERE order_id=$1 ${account ? 'AND account=$2' : ''}`, account ? [orderId, account] : [orderId])).rows[0].s);
export const offerRow = async (id: string) => (await pool.query('SELECT stock_on_hand, stock_reserved FROM store_offers WHERE id=$1', [id])).rows[0];
