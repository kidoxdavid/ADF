import { beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { addToCart, app, call, checkout, ledgerSum, newCustomer, offerRow, openAllStores, setOffer, signedEvent, simulate, storeId } from './helpers.js';
import { pool } from '../src/db/pool.js';
import { releaseExpiredReservations } from '../src/services/payments.js';

const S1 = 'demo-calgary-west-african-market';
const S2 = 'demo-horn-spice-grocer';

beforeAll(openAllStores);

async function basket() {
  const u = await newCustomer();
  const garri = await setOffer(S1, 'garri-white', 2000, 10);      // zero-rated
  const chips = await setOffer(S1, 'plantain-chips-salted', 1000, 10); // standard (5% GST)
  await addToCart(u.cookie, garri, 2);
  await addToCart(u.cookie, chips, 1);
  return { u, garri, chips };
}

describe('quote', () => {
  it('prices per store with delivery, GST only on taxable goods and delivery, and reconciles', async () => {
    const { u } = await basket();
    const q = (await call(u.cookie, 'POST', '/api/checkout/quote', { address_id: u.addressId, method: 'delivery' })).body;
    expect(q.ok).toBe(true);
    expect(q.subtotal_cents).toBe(5000);              // 2*20.00 + 10.00
    expect(q.suborders).toHaveLength(1);
    const s = q.suborders[0];
    expect(s.delivery_cents).toBe(599);               // flat zone fee (subtotal below free-delivery threshold)
    expect(s.tax_cents).toBe(50);                     // 5% of 10.00 chips only
    expect(s.delivery_tax_cents).toBe(30);            // 5% of 5.99 rounded
    expect(q.total_cents).toBe(5000 + 599 + 50 + 30);
    expect(s.commission_cents).toBe(600);             // 12% default of 50.00 merchandise
    expect(q.separate_deliveries).toBe(false);
  });

  it('discloses separate deliveries and fees for a multi-store basket', async () => {
    const u = await newCustomer();
    await addToCart(u.cookie, await setOffer(S1, 'garri-white', 2000, 10), 2);
    await addToCart(u.cookie, await setOffer(S2, 'berbere-spice-blend', 2500, 10), 1);
    const q = (await call(u.cookie, 'POST', '/api/checkout/quote', { address_id: u.addressId, method: 'delivery' })).body;
    expect(q.suborders).toHaveLength(2);
    expect(q.separate_deliveries).toBe(true);
    expect(q.suborders.every((s: any) => s.delivery_cents === 599)).toBe(true);
    expect(q.delivery_cents).toBe(2 * (599 + 30));
  });

  it('blocks addresses outside the service area, below store minimums, and closed stores', async () => {
    const far = await newCustomer('V6B1A1');
    await addToCart(far.cookie, await setOffer(S1, 'garri-white', 2000, 10), 2);
    let q = (await call(far.cookie, 'POST', '/api/checkout/quote', { address_id: far.addressId, method: 'delivery' })).body;
    expect(q.issues.map((i: any) => i.type)).toContain('outside_service_area');

    const u = await newCustomer();
    await addToCart(u.cookie, await setOffer(S1, 'plantain-chips-salted', 500, 10), 1); // below $25 minimum
    q = (await call(u.cookie, 'POST', '/api/checkout/quote', { address_id: u.addressId, method: 'delivery' })).body;
    expect(q.issues.map((i: any) => i.type)).toContain('min_order');

    await pool.query(`UPDATE stores SET ordering_paused = true WHERE slug = $1`, [S1]);
    q = (await call(u.cookie, 'POST', '/api/checkout/quote', { address_id: u.addressId, method: 'delivery' })).body;
    expect(q.issues.map((i: any) => i.type)).toContain('store_unavailable');
    await pool.query(`UPDATE stores SET ordering_paused = false WHERE slug = $1`, [S1]);
  });

  it('applies a first-order coupon across lines and refuses reuse', async () => {
    const { u } = await basket();
    const q = (await call(u.cookie, 'POST', '/api/checkout/quote', { address_id: u.addressId, method: 'delivery', coupon_code: 'WELCOME10' })).body;
    expect(q.coupon.discount_cents).toBe(500);       // 10% of 50.00
    expect(q.suborders[0].lines.reduce((a: number, l: any) => a + l.discount_cents, 0)).toBe(500);
    expect(q.total_cents).toBe(5000 - 500 + 599 + Math.round((1000 - Math.round(500 * 1000 / 5000)) * 0.05) + 30);
    expect((await call(u.cookie, 'POST', '/api/checkout/quote', { address_id: u.addressId, method: 'delivery', coupon_code: 'NOPE' })).body.ok).toBe(false);
  });
});

describe('checkout and payment', () => {
  it('reserves stock, creates a payment for the exact server total, and is idempotent', async () => {
    const { u, garri } = await basket();
    const key = randomUUID();
    const a = await checkout(u.cookie, u.addressId, {}, key);
    expect(a.status).toBe(201);
    const b = await checkout(u.cookie, u.addressId, {}, key);
    expect(b.body.order.order_number).toBe(a.body.order.order_number);
    expect((await pool.query('SELECT count(*)::int n FROM orders WHERE user_id=$1', [u.id])).rows[0].n).toBe(1);
    expect(await offerRow(garri)).toEqual({ stock_on_hand: 10, stock_reserved: 2 });       // reserved, not yet sold
    const pay = (await pool.query('SELECT * FROM payments WHERE order_id=$1', [a.body.order.id])).rows[0];
    expect(pay.amount_cents).toBe(a.body.order.total_cents);
    expect(a.body.order.payment_status).toBe('pending');
  });

  it('a successful signed payment places the order, deducts stock and books a balanced ledger', async () => {
    const { u, garri } = await basket();
    const o = (await checkout(u.cookie, u.addressId)).body.order;
    const r = await simulate(u.cookie, o.id, 'succeeded');
    expect(r.body.outcome).toBe('processed');
    const order = (await call(u.cookie, 'GET', `/api/orders/${o.id}`)).body;
    expect(order.status).toBe('placed');
    expect(order.payment_status).toBe('paid');
    expect(order.suborders[0].status).toBe('placed');
    expect(await offerRow(garri)).toEqual({ stock_on_hand: 8, stock_reserved: 0 });
    // ledger: cash in = total; vendor owed = merchandise - commission; commission/delivery/tax recognised
    expect(await ledgerSum(o.id)).toBe(0);
    expect(await ledgerSum(o.id, 'cash_provider')).toBe(o.total_cents);
    expect(await ledgerSum(o.id, 'vendor_payable')).toBe(-(5000 - 600));
    expect(await ledgerSum(o.id, 'commission_revenue')).toBe(-600);
    expect(await ledgerSum(o.id, 'delivery_revenue')).toBe(-599);
    expect(await ledgerSum(o.id, 'tax_payable')).toBe(-(50 + 30));
    // basket emptied
    expect((await call(u.cookie, 'GET', '/api/cart')).body.item_count).toBe(0);
  });

  it('replayed webhooks are ignored (idempotent)', async () => {
    const { u } = await basket();
    const o = (await checkout(u.cookie, u.addressId)).body.order;
    const p = (await pool.query('SELECT provider_payment_id, amount_cents FROM payments WHERE order_id=$1', [o.id])).rows[0];
    const ev = signedEvent('payment.succeeded', p.provider_payment_id, p.amount_cents);
    const first = await app.inject({ method: 'POST', url: '/api/webhooks/payments', payload: ev.body, headers: ev.headers });
    const again = await app.inject({ method: 'POST', url: '/api/webhooks/payments', payload: ev.body, headers: ev.headers });
    expect(first.json().outcome).toBe('processed');
    expect(again.json().duplicate).toBe(true);
    expect(await ledgerSum(o.id, 'cash_provider')).toBe(o.total_cents);   // booked once
    // a *different* event for an already-paid payment must not double-deduct stock either
    const ev2 = signedEvent('payment.succeeded', p.provider_payment_id, p.amount_cents);
    const r2 = await app.inject({ method: 'POST', url: '/api/webhooks/payments', payload: ev2.body, headers: ev2.headers });
    expect(r2.json().outcome).toBe('already_paid');
    expect(await ledgerSum(o.id, 'cash_provider')).toBe(o.total_cents);
  });

  it('rejects forged webhooks and never trusts a mismatched amount', async () => {
    const { u } = await basket();
    const o = (await checkout(u.cookie, u.addressId)).body.order;
    const p = (await pool.query('SELECT provider_payment_id, amount_cents FROM payments WHERE order_id=$1', [o.id])).rows[0];
    const forged = signedEvent('payment.succeeded', p.provider_payment_id, p.amount_cents);
    expect((await app.inject({ method: 'POST', url: '/api/webhooks/payments', payload: forged.body, headers: { ...forged.headers, 'x-mock-signature': 'deadbeef' } })).statusCode).toBe(400);
    const wrong = signedEvent('payment.succeeded', p.provider_payment_id, 100);
    const r = await app.inject({ method: 'POST', url: '/api/webhooks/payments', payload: wrong.body, headers: wrong.headers });
    expect(r.json().outcome).toBe('amount_mismatch');
    expect((await call(u.cookie, 'GET', `/api/orders/${o.id}`)).body.payment_status).toBe('pending');
  });

  it('a failed payment never produces a paid order and releases the stock', async () => {
    const { u, garri } = await basket();
    const o = (await checkout(u.cookie, u.addressId)).body.order;
    await simulate(u.cookie, o.id, 'failed');
    const order = (await call(u.cookie, 'GET', `/api/orders/${o.id}`)).body;
    expect(order.status).toBe('payment_failed');
    expect(order.payment_status).toBe('failed');
    expect(await offerRow(garri)).toEqual({ stock_on_hand: 10, stock_reserved: 0 });
    expect(await ledgerSum(o.id, 'cash_provider')).toBe(0);
    expect((await call(u.cookie, 'GET', '/api/cart')).body.item_count).toBe(3);   // basket kept so they can retry
  });

  it('a stale basket cannot buy an item that has since sold out', async () => {
    const { u, garri } = await basket();
    await pool.query('UPDATE store_offers SET stock_on_hand = 1 WHERE id = $1', [garri]);   // basket holds 2
    const r = await checkout(u.cookie, u.addressId);
    expect(r.status).toBe(409);
    expect(r.body.details.issues.some((i: any) => i.type === 'insufficient_stock' && i.available === 1)).toBe(true);
    expect((await pool.query('SELECT count(*)::int n FROM orders WHERE user_id=$1', [u.id])).rows[0].n).toBe(0);
    await pool.query('UPDATE store_offers SET stock_on_hand = 0 WHERE id = $1', [garri]);
    const r2 = await checkout(u.cookie, u.addressId);
    expect(r2.body.details.issues.some((i: any) => i.type === 'unavailable')).toBe(true);
  });

  it('server ignores a stale browser price: a price change is applied and flagged', async () => {
    const { u, garri } = await basket();
    await pool.query('UPDATE store_offers SET price_cents = 2500 WHERE id = $1', [garri]);
    const cart = (await call(u.cookie, 'GET', '/api/cart')).body;
    expect(cart.stores[0].items.find((i: any) => i.offer_id === garri).price_changed).toBe(true);
    const o = (await checkout(u.cookie, u.addressId)).body.order;
    const lines = (await pool.query(`SELECT unit_price_cents FROM order_lines WHERE offer_id=$1`, [garri])).rows;
    expect(lines.some((l) => l.unit_price_cents === 2500)).toBe(true);
    expect(o.total_cents).toBeGreaterThan(5000 + 599);
  });

  it('two shoppers racing for the last unit: exactly one wins, no oversell', async () => {
    const offer = await setOffer(S1, 'egusi-ground-melon-seeds', 3000, 1);
    const [a, b] = await Promise.all([newCustomer(), newCustomer()]);
    await Promise.all([addToCart(a.cookie, offer, 1), addToCart(b.cookie, offer, 1)]);
    const [ra, rb] = await Promise.all([checkout(a.cookie, a.addressId), checkout(b.cookie, b.addressId)]);
    expect([ra.status, rb.status].sort()).toEqual([201, 409]);
    expect(await offerRow(offer)).toEqual({ stock_on_hand: 1, stock_reserved: 1 });
  });

  it('expired unpaid orders free their stock; a late payment re-claims it if still free, else is refunded', async () => {
    const { u, garri } = await basket();
    const o = (await checkout(u.cookie, u.addressId)).body.order;
    await pool.query(`UPDATE inventory_reservations SET expires_at = now() - interval '1 minute'`);
    expect(await releaseExpiredReservations()).toBeGreaterThanOrEqual(1);
    expect((await call(u.cookie, 'GET', `/api/orders/${o.id}`)).body.status).toBe('expired');
    expect(await offerRow(garri)).toEqual({ stock_on_hand: 10, stock_reserved: 0 });
    const p = (await pool.query('SELECT provider_payment_id, amount_cents FROM payments WHERE order_id=$1', [o.id])).rows[0];
    // someone else buys the stock meanwhile
    await pool.query('UPDATE store_offers SET stock_on_hand = 1 WHERE id = $1', [garri]);
    const ev = signedEvent('payment.succeeded', p.provider_payment_id, p.amount_cents);
    const r = await app.inject({ method: 'POST', url: '/api/webhooks/payments', payload: ev.body, headers: ev.headers });
    expect(r.json().outcome).toBe('processed');
    const order = (await call(u.cookie, 'GET', `/api/orders/${o.id}`)).body;
    expect(order.suborders[0].status).toBe('cancelled');        // could not be fulfilled...
    expect(order.payment_status).toBe('refunded');              // ...so the customer got everything back
    expect(await ledgerSum(o.id)).toBe(0);
    expect(await ledgerSum(o.id, 'cash_provider')).toBe(0);
    expect(await ledgerSum(o.id, 'vendor_payable')).toBe(0);
    expect(await offerRow(garri)).toEqual({ stock_on_hand: 1, stock_reserved: 0 });
  });
});

describe('refunds keep the books balanced', () => {
  async function paidOrder() {
    const { u, garri, chips } = await basket();
    const o = (await checkout(u.cookie, u.addressId, { coupon_code: 'WELCOME10' })).body.order;
    await simulate(u.cookie, o.id, 'succeeded');
    const order = (await call(u.cookie, 'GET', `/api/orders/${o.id}`)).body;
    return { u, o: order, garri, chips };
  }
  const login = async (email: string) => {
    const r = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password: 'dev-password-123' } });
    return String(r.headers['set-cookie']).split(';')[0];
  };

  it('a store rejection refunds everything and nets every account to zero', async () => {
    const { u, o } = await paidOrder();
    const owner = await login('owner1@example.test');
    const r = await call(owner, 'POST', `/api/vendor/suborders/${o.suborders[0].id}/reject`, { reason: 'Out of stock today' });
    expect(r.status).toBe(200);
    const after = (await call(u.cookie, 'GET', `/api/orders/${o.id}`)).body;
    expect(after.payment_status).toBe('refunded');
    expect(after.suborders[0].status).toBe('rejected');
    for (const acct of ['cash_provider', 'vendor_payable', 'commission_revenue', 'delivery_revenue', 'tax_payable', 'discount_expense'])
      expect(await ledgerSum(o.id, acct)).toBe(0);
  });

  it('a partial refund of one line reconciles tax, discount, commission and cash', async () => {
    const { u, o } = await paidOrder();
    const finance = await login('finance@example.test');
    const chipLine = o.suborders[0].lines.find((l: any) => l.name.startsWith('Plantain'));
    const support = await login('support@example.test');
    const req = await call(support, 'POST', `/api/admin/suborders/${o.suborders[0].id}/refunds`, { lines: [{ line_id: chipLine.id, quantity: 1 }], include_delivery: false, reason: 'Item damaged', vendor_funded: true });
    expect(req.status).toBe(201);
    expect((await call(support, 'POST', `/api/admin/refunds/${req.body.id}/approve`)).status).toBe(403);   // support cannot approve
    const ok = await call(finance, 'POST', `/api/admin/refunds/${req.body.id}/approve`);
    expect(ok.status).toBe(200);
    expect(ok.body.status).toBe('succeeded');
    // chips: 10.00, 10% coupon share 1.00 (500*1000/5000=100), tax 5% of 9.00 = 0.45 -> 0.45 rounds to 45? (900*5%=45)
    const refund = (await pool.query('SELECT * FROM refunds WHERE id=$1', [req.body.id])).rows[0];
    expect(refund.merchandise_cents).toBe(1000);
    expect(refund.discount_cents).toBe(100);
    expect(refund.tax_cents).toBe(45);
    expect(refund.amount_cents).toBe(1000 - 100 + 45);
    expect(refund.commission_cents).toBe(120);
    expect(await ledgerSum(o.id)).toBe(0);
    expect(await ledgerSum(o.id, 'cash_provider')).toBe(o.total_cents - refund.amount_cents);
    expect((await call(u.cookie, 'GET', `/api/orders/${o.id}`)).body.payment_status).toBe('partially_refunded');
    // the same line cannot be refunded twice
    const again = await call(support, 'POST', `/api/admin/suborders/${o.suborders[0].id}/refunds`, { lines: [{ line_id: chipLine.id, quantity: 1 }], include_delivery: false, reason: 'dup', vendor_funded: true });
    expect(again.status).toBe(400);
  });

  it('a marketplace-funded refund leaves the vendor paid and books our loss', async () => {
    const { o } = await paidOrder();
    const finance = await login('finance@example.test');
    const line = o.suborders[0].lines[0];
    const rq = await call(finance, 'POST', `/api/admin/suborders/${o.suborders[0].id}/refunds`, { lines: [{ line_id: line.id, quantity: 1 }], include_delivery: true, reason: 'Late delivery', vendor_funded: false });
    expect(rq.status).toBe(403);   // finance may approve but not raise; support/admin raise
    const admin = await login('owner@example.test');
    const rq2 = await call(admin, 'POST', `/api/admin/suborders/${o.suborders[0].id}/refunds`, { lines: [{ line_id: line.id, quantity: 1 }], include_delivery: true, reason: 'Late delivery', vendor_funded: false });
    expect(rq2.status).toBe(201);
    expect((await call(finance, 'POST', `/api/admin/refunds/${rq2.body.id}/approve`)).body.status).toBe('succeeded');
    expect(await ledgerSum(o.id)).toBe(0);
    expect(await ledgerSum(o.id, 'vendor_payable')).toBe(-(5000 - 600));  // vendor untouched
    expect(await ledgerSum(o.id, 'refund_loss')).toBeGreaterThan(0);
  });
});

describe('basket merge and reorder', () => {
  it('merges a signed-out basket (capping to stock, skipping dead offers) and can reorder a past order', async () => {
    const u = await newCustomer();
    const garri = await setOffer(S1, 'garri-white', 2000, 3);
    const chips = await setOffer(S1, 'plantain-chips-salted', 1500, 0);
    const r = await call(u.cookie, 'POST', '/api/cart/merge', { items: [{ offer_id: garri, quantity: 5 }, { offer_id: chips, quantity: 1 }, { offer_id: randomUUID(), quantity: 1 }] });
    expect(r.status).toBe(200);
    expect(r.body.skipped).toHaveLength(2);
    expect(r.body.stores[0].items[0].quantity).toBe(3);          // capped to what the store has
    const again = await call(u.cookie, 'POST', '/api/cart/merge', { items: [{ offer_id: garri, quantity: 2 }] });
    expect(again.body.stores[0].items[0].quantity).toBe(3);      // never exceeds stock

    await setOffer(S1, 'garri-white', 2000, 10);
    await setOffer(S1, 'plantain-chips-salted', 1500, 10);
    const b = await newCustomer();
    await addToCart(b.cookie, garri, 2); await addToCart(b.cookie, chips, 1);
    const o = (await checkout(b.cookie, b.addressId)).body.order;
    await simulate(b.cookie, o.id, 'succeeded');
    await pool.query('UPDATE store_offers SET stock_on_hand = 0 WHERE id = $1', [chips]);
    const re = await call(b.cookie, 'POST', `/api/orders/${o.id}/reorder`);
    expect(re.status).toBe(200);
    expect(re.body.skipped).toEqual(['Plantain Chips (Salted)']);
    expect(re.body.item_count).toBe(2);
    expect((await call((await newCustomer()).cookie, 'POST', `/api/orders/${o.id}/reorder`)).status).toBe(404);
  });
});
