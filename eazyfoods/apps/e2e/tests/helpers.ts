import { existsSync } from 'node:fs';
import { chromium, type Browser, type BrowserContext, type Locator, type Page } from 'playwright-core';
import { expect } from 'vitest';
import pg from 'pg';

export const base = () => process.env.E2E_BASE!;
export const MOBILE = { width: 390, height: 844 };
export const DESKTOP = { width: 1280, height: 900 };

export async function launch(): Promise<Browser> {
  const local = '/opt/pw-browsers/chromium';
  return chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? (existsSync(local) ? local : undefined), args: ['--no-sandbox'] });
}

export async function newPage(browser: Browser, size = DESKTOP): Promise<{ ctx: BrowserContext; page: Page; errors: string[] }> {
  const ctx = await browser.newContext({ viewport: size, hasTouch: size.width < 600, isMobile: size.width < 600 });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  // Console errors are collected so tests can assert there are none (expected 4xx from deliberate negative tests are filtered by callers).
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  return { ctx, page, errors };
}

export async function signIn(page: Page, email: string, password = 'dev-password-123') {
  await page.goto(`${base()}/signin`);
  await page.fill('input[name=email]', email);
  await page.fill('input[name=password]', password);
  await page.click('.auth button[type=submit]');
  await page.waitForURL((u) => !u.pathname.startsWith('/signin'));
}

export async function db() { const c = new pg.Client({ connectionString: process.env.E2E_DB }); await c.connect(); return c; }

/** Sets exact price/stock for a store's product so journeys do not depend on random seed values. */
export async function setOffer(store: string, product: string, cents: number, stock: number) {
  const c = await db();
  try {
    await c.query(`UPDATE inventory_reservations SET status='released' WHERE status='held' AND offer_id IN (SELECT o.id FROM store_offers o JOIN stores s ON s.id=o.store_id JOIN products p ON p.id=o.product_id WHERE s.slug=$1 AND p.slug=$2)`, [store, product]);
    await c.query(
      `INSERT INTO store_offers(store_id, product_id, price_cents, stock_on_hand, stock_reserved, is_active)
       SELECT s.id, p.id, $3, $4, 0, true FROM stores s, products p WHERE s.slug=$1 AND p.slug=$2
       ON CONFLICT (store_id, product_id) DO UPDATE SET price_cents=$3, stock_on_hand=$4, stock_reserved=0, is_active=true, compare_at_cents=NULL`, [store, product, cents, stock]);
  } finally { await c.end(); }
}

export const money = (c: number) => `$${(c / 100).toFixed(2)}`;

/** Locator assertions (vitest's expect has no Playwright matchers). They wait, so they tolerate async rendering. */
export async function seeText(loc: Locator, text: string | RegExp, timeout = 12_000) {
  try { await loc.filter({ hasText: text }).first().waitFor({ state: 'visible', timeout }); }
  catch { throw new Error(`Expected to see ${String(text)} but found: ${(await loc.first().innerText().catch(() => '(nothing)')).slice(0, 400)}`); }
}
export async function noText(loc: Locator, text: string | RegExp) { expect(await loc.filter({ hasText: text }).count(), `did not expect ${String(text)}`).toBe(0); }
export async function visible(loc: Locator, timeout = 12_000) { await loc.first().waitFor({ state: 'visible', timeout }); }
export async function gone(loc: Locator) { expect(await loc.count()).toBe(0); }
export async function enabled(loc: Locator, want: boolean) { await expect.poll(async () => await loc.isEnabled(), { timeout: 10_000 }).toBe(want); }
