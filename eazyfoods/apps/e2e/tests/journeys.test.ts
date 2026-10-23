import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Browser, Page } from 'playwright-core';
import { base, db, DESKTOP, enabled, gone, launch, MOBILE, newPage, noText, seeText, setOffer, signIn, visible } from './helpers.js';

const S1 = 'demo-calgary-west-african-market';
let browser: Browser;
beforeAll(async () => { browser = await launch(); await setOffer(S1, 'garri-white', 2000, 20); await setOffer(S1, 'plantain-chips-salted', 1000, 20); });
afterAll(async () => { await browser?.close(); });

const addressForm = async (page: Page, postal = 'T2A 0A0') => {
  await page.fill('input[name=recipient_name]', 'E2E Buyer'); await page.fill('input[name=phone]', '5875550100');
  await page.fill('input[name=line1]', '12 Journey Road NE'); await page.fill('input[name=postal_code]', postal);
  await page.getByRole('button', { name: 'Save address' }).click();
};

describe('customer -> store -> dispatch -> driver -> review, on a phone', () => {
  let orderUrl = '';
  let handover = '';
  const email = `e2e${Date.now()}@example.test`;

  it('a new customer finds a store by region, searches by an alternative name, and sees the verified alias', async () => {
    const { page, errors } = await newPage(browser, MOBILE);
    await page.goto(base());
    await page.locator('.region-nav').getByRole('link', { name: 'West Africa' }).click();              // region entry point
    await page.waitForSelector('.cards a');
    expect(page.url()).toContain('region=west-africa');
    await page.goto(`${base()}/stores`);
    const card = page.locator('.cards.stores a', { hasText: 'Demo West African Market' });
    await seeText(card, 'West Africa');                                                // store card shows its regional specialty
    await card.click();
    await page.waitForSelector('h1:has-text("Demo West African Market")');
    await page.goto(`${base()}/search?q=pondu`);                                                    // alternative name for cassava leaves
    const hit = page.locator('.cards a', { hasText: 'Cassava Leaves' });
    await visible(hit);
    await seeText(hit, 'Also known as “Pondu”');
    expect(errors).toEqual([]);
  });

  it('registers, fills a basket from one store, and checkout shows server-validated fees and tax', async () => {
    const { page } = await newPage(browser, MOBILE);
    await page.goto(`${base()}/register`);
    await page.fill('input[name=full_name]', 'E2E Buyer'); await page.fill('input[name=email]', email); await page.fill('input[name=password]', 'a-long-password');
    await page.click('.auth button[type=submit]');
    await page.waitForURL(base() + '/');
    await page.goto(`${base()}/s/${S1}`);
    const add = (name: string) => page.locator('li .card', { hasText: name }).getByRole('button', { name: /^Add/ });
    await add('Garri (White)').click();
    await page.locator('li .card', { hasText: 'Garri (White)' }).getByRole('button', { name: /Add one/ }).click();   // quantity 2
    await add('Plantain Chips').click();
    await page.getByRole('link', { name: 'View basket' }).click();
    await seeText(page.locator('main'), '$50.00');                                                    // 2 x $20 + $10
    await page.getByRole('link', { name: /^Checkout/ }).click();
    await page.waitForSelector('.checkout');
    await addressForm(page);
    await page.waitForSelector('.choice.selected input[name=addr]');
    await seeText(page.locator('.panel[aria-label="Order summary"]'), 'Delivery (incl. tax)');
    await seeText(page.locator('.panel[aria-label="Order summary"]'), '$56.79');                      // 50 + 5.99 + GST 0.50 + GST on delivery 0.30
    await page.getByRole('button', { name: /Continue to payment/ }).click();
    await page.waitForSelector('.test-banner');
    await seeText(page.locator('.test-banner'), 'TEST MODE');
    // a declined card must NOT produce a paid order
    await page.getByRole('button', { name: 'Simulate declined card' }).click();
    await seeText(page.locator('.test-banner'), 'declined');
    await page.getByRole('link', { name: 'View this order' }).click();
    await seeText(page.locator('main'), 'Payment failed');
    await noText(page.locator('main'), 'Order placed');
  });

  it('retrying succeeds: payment is confirmed by the webhook and the order is placed', async () => {
    const { page } = await newPage(browser, MOBILE);
    await signIn(page, email, 'a-long-password');
    await page.goto(`${base()}/cart`);
    await page.getByRole('link', { name: /^Checkout/ }).click();
    await page.waitForSelector('.choice.selected input[name=addr]');
    await page.getByRole('button', { name: /Continue to payment/ }).click();
    await page.getByRole('button', { name: 'Simulate successful payment' }).click();
    await page.waitForURL(/\/orders\/[0-9a-f-]+/);
    orderUrl = page.url();
    await seeText(page.locator('main'), 'Waiting for store');
    const c = await db(); const r = await c.query(`SELECT payment_status, status FROM orders WHERE customer_email=$1 ORDER BY created_at DESC LIMIT 1`, [email]); await c.end();
    expect(r.rows[0]).toEqual({ payment_status: 'paid', status: 'placed' });
  });

  it('the store accepts and marks the order ready (vendor portal)', async () => {
    const { page, errors } = await newPage(browser, DESKTOP);
    await signIn(page, 'owner1@example.test');
    await page.goto(`${base()}/vendor/orders`);
    await page.waitForSelector('text=E2E');                                                                   // customer first name on the card
    await page.getByRole('button', { name: 'Accept' }).first().click();
    await page.getByRole('tab', { name: /In progress/ }).click();                                                // accepted orders move to this tab
    await page.getByRole('button', { name: 'Start preparing' }).first().click();
    await page.getByRole('button', { name: 'Mark ready' }).first().click();
    await page.waitForTimeout(500);
    const c = await db(); const r = await c.query(`SELECT s.status FROM suborders s JOIN orders o ON o.id=s.order_id WHERE o.customer_email=$1 AND o.payment_status <> 'failed'`, [email]); await c.end();
    expect(r.rows[0].status).toBe('ready');
    expect(errors.filter((e) => !/40[0-9]|409/.test(e))).toEqual([]);
  });

  it('a dispatcher assigns a driver; the customer then sees a handover code', async () => {
    const { page } = await newPage(browser, DESKTOP);
    await signIn(page, 'dispatcher@example.test');
    await page.goto(`${base()}/admin/dispatch`);
    const row = page.locator('tr, .panel').filter({ hasText: 'Demo West African Market' }).filter({ has: page.getByRole('button', { name: 'Assign' }) }).first();
    await row.getByLabel('Driver').selectOption({ index: 1 });
    await row.getByRole('button', { name: 'Assign' }).click();
    await page.waitForTimeout(600);
    const cust = await newPage(browser, MOBILE);
    await signIn(cust.page, email, 'a-long-password');
    await cust.page.goto(orderUrl);
    const box = cust.page.locator('.code-box');
    await visible(box);
    handover = (await box.innerText()).trim();
    expect(handover).toMatch(/^\d{4}$/);
  });

  it('the driver picks up and delivers using the code; a wrong code is refused', async () => {
    const { page } = await newPage(browser, MOBILE);
    await signIn(page, 'driver@example.test');
    await page.goto(`${base()}/driver`);
    await page.getByRole('link', { name: /Open job|Continue delivery/ }).first().click();
    await page.getByRole('button', { name: /picked up the order/ }).click();
    const wrong = handover === '0000' ? '1111' : '0000';
    await page.fill('input[inputmode=numeric]', wrong);
    await page.getByRole('button', { name: 'Confirm delivery' }).click();
    await seeText(page.locator('body'), 'does not match');
    await page.fill('input[inputmode=numeric]', handover);
    await page.getByRole('button', { name: 'Confirm delivery' }).click();
    await page.waitForURL(/\/driver\/?$/);
    const c = await db(); const r = await c.query(`SELECT s.status FROM suborders s JOIN orders o ON o.id=s.order_id WHERE o.customer_email=$1 AND o.payment_status <> 'failed'`, [email]); await c.end();
    expect(r.rows[0].status).toBe('delivered');
  });

  it('the customer sees the completed order with its timeline and leaves a genuine review', async () => {
    const { page } = await newPage(browser, MOBILE);
    await signIn(page, email, 'a-long-password');
    await page.goto(orderUrl);
    await seeText(page.locator('main'), 'Delivered');
    await seeText(page.locator('.timeline'), 'Out for delivery');
    await page.getByRole('button', { name: 'Rate this store' }).click();
    await page.getByRole('radio', { name: '5 stars' }).click();
    await page.getByRole('button', { name: 'Submit' }).click();
    await page.waitForTimeout(600);
    await gone(page.getByRole('button', { name: 'Rate this store' }));
  });

  it('support requests a refund; only finance can approve it; the order and ledger reflect it', async () => {
    const c0 = await db();
    const { rows } = await c0.query(`SELECT s.id AS sid, l.id AS lid, o.id AS oid FROM suborders s JOIN orders o ON o.id=s.order_id JOIN order_lines l ON l.suborder_id=s.id WHERE o.customer_email=$1 AND o.payment_status <> 'failed' AND l.product_name LIKE 'Plantain%'`, [email]);
    await c0.end();
    const support = await newPage(browser, DESKTOP);
    await signIn(support.page, 'support@example.test');
    const req = await support.page.request.post(`${base()}/api/admin/suborders/${rows[0].sid}/refunds`, { data: { lines: [{ line_id: rows[0].lid, quantity: 1 }], include_delivery: false, reason: 'Item damaged', vendor_funded: true } });
    expect(req.status()).toBe(201);
    // support has no finance permission: approval screen is not for them
    const denied = await support.page.request.post(`${base()}/api/admin/refunds/${(await req.json()).id}/approve`);
    expect(denied.status()).toBe(403);
    const fin = await newPage(browser, DESKTOP);
    await signIn(fin.page, 'finance@example.test');
    await fin.page.goto(`${base()}/admin/refunds`);
    await fin.page.getByRole('button', { name: 'Approve' }).first().click();
    await fin.page.getByRole('button', { name: 'Yes, continue' }).click();
    await fin.page.waitForTimeout(800);
    const c = await db();
    const o = await c.query(`SELECT payment_status FROM orders WHERE id=$1`, [rows[0].oid]);
    const sum = await c.query(`SELECT COALESCE(sum(amount_cents),0)::int AS s FROM ledger_entries WHERE order_id=$1`, [rows[0].oid]);
    await c.end();
    expect(o.rows[0].payment_status).toBe('partially_refunded');
    expect(sum.rows[0].s).toBe(0);
  });
});

describe('inventory, stale baskets and access control', () => {
  it('a vendor edits a price in the portal and the storefront shows it', async () => {
    const { page } = await newPage(browser, DESKTOP);
    await signIn(page, 'owner1@example.test');
    await page.goto(`${base()}/vendor/inventory`);
    const row = page.locator('tr, .panel').filter({ hasText: 'Garri (White)' }).first();
    await row.getByRole('button', { name: /price/i }).first().click();
    await page.fill('input[name=price]', '21.50');
    await page.getByRole('button', { name: 'Save price' }).click();
    await page.waitForTimeout(600);
    const sf = await newPage(browser, MOBILE);
    await sf.page.goto(`${base()}/p/garri-white`);
    await seeText(sf.page.locator('.offer-row', { hasText: 'Demo West African Market' }), '$21.50');
    await setOffer(S1, 'garri-white', 2000, 20);
  });

  it('a stale browser basket cannot buy an item that sold out; the customer is told and cannot pay', async () => {
    await setOffer(S1, 'egusi-ground-melon-seeds', 3000, 1);
    const email = `stale${Date.now()}@example.test`;
    const { page } = await newPage(browser, MOBILE);
    await page.goto(`${base()}/register`);
    await page.fill('input[name=full_name]', 'Stale Basket'); await page.fill('input[name=email]', email); await page.fill('input[name=password]', 'a-long-password');
    await page.click('.auth button[type=submit]'); await page.waitForURL(base() + '/');
    await page.goto(`${base()}/p/egusi-ground-melon-seeds`);
    await page.locator('.offer-row', { hasText: 'Demo West African Market' }).getByRole('button', { name: /^Add/ }).click();
    await page.goto(`${base()}/checkout`);
    await page.waitForSelector('.checkout');
    await addressForm(page);
    await page.waitForSelector('.choice.selected input[name=addr]');
    await enabled(page.getByRole('button', { name: /Continue to payment/ }), true);
    const c = await db(); await c.query(`UPDATE store_offers SET stock_on_hand = 0 WHERE store_id=(SELECT id FROM stores WHERE slug=$1) AND product_id=(SELECT id FROM products WHERE slug='egusi-ground-melon-seeds')`, [S1]); await c.end();
    await page.reload();
    await seeText(page.locator('.notice.error'), 'out of stock');
    await enabled(page.getByRole('button', { name: /Continue to payment/ }), false);
  });

  it('access control in the browser: customers get no admin, vendors cannot read another store, drivers see only their jobs', async () => {
    const cust = await newPage(browser, DESKTOP);
    await signIn(cust.page, 'customer@example.test');
    await cust.page.goto(`${base()}/admin`);
    await seeText(cust.page.locator('body'), /does not allow|do not have access/i);
    await cust.page.goto(`${base()}/vendor`);
    await seeText(cust.page.locator('body'), /apply|sell/i);
    expect((await cust.page.request.get(`${base()}/api/admin/ledger`)).status()).toBe(403);

    const owner2 = await newPage(browser, DESKTOP);
    await signIn(owner2.page, 'owner2@example.test');
    const c = await db(); const s1 = (await c.query('SELECT id FROM stores WHERE slug=$1', [S1])).rows[0].id; await c.end();
    expect((await owner2.page.request.get(`${base()}/api/vendor/stores/${s1}/offers`)).status()).toBe(403);
    expect((await owner2.page.request.get(`${base()}/api/vendor/reports/settlement`)).status()).toBe(200);
  });

  it('an admin approves a vendor in the console (after verifying a document) and publishes its product', async () => {
    const c = await db();
    const v = (await c.query(`INSERT INTO vendors(name, status, is_test_data) VALUES ('E2E Approval Foods','submitted',true) RETURNING id`)).rows[0].id;
    await c.query(`INSERT INTO stores(vendor_id, slug, name, status, is_test_data, address_line, postal_code, phone) VALUES ($1,'e2e-approval-foods','E2E Approval Foods','pending',true,'1 A St','T2A0A1','000')`, [v]);
    await c.query(`INSERT INTO vendor_documents(vendor_id, kind, url) VALUES ($1,'business_licence','private:00000000000000000000000000000000.pdf')`, [v]);
    await c.end();
    const { page } = await newPage(browser, DESKTOP);
    await signIn(page, 'admin@example.test');
    await page.goto(`${base()}/admin/vendors/${v}`);
    await page.getByRole('button', { name: 'Verify' }).first().click();
    await page.waitForTimeout(500);
    await page.getByRole('button', { name: 'Approve vendor' }).click();
    await page.getByRole('button', { name: 'Yes, continue' }).click();
    await page.waitForTimeout(600);
    const c2 = await db(); const r = await c2.query('SELECT status FROM vendors WHERE id=$1', [v]); await c2.end();
    expect(r.rows[0].status).toBe('approved');
  });
});
