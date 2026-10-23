import AxeBuilder from '@axe-core/playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Browser } from 'playwright-core';
import { base, DESKTOP, launch, MOBILE, newPage, signIn } from './helpers.js';

let browser: Browser;
beforeAll(async () => { browser = await launch(); });
afterAll(async () => { await browser?.close(); });

const PUBLIC = ['/', '/search?q=garri', '/search?region=east-africa', '/stores', '/s/demo-calgary-west-african-market', '/p/garri-white', '/recipes', '/recipes/jollof-rice-nigerian-style', '/cart', '/signin', '/register', '/pages/refund-policy'];
const SIGNED_IN = ['/account', '/orders', '/checkout'];
const PORTALS: [string, string][] = [['owner1@example.test', '/vendor'], ['owner1@example.test', '/vendor/orders'], ['owner1@example.test', '/vendor/inventory'], ['owner1@example.test', '/vendor/store'],
  ['owner@example.test', '/admin'], ['owner@example.test', '/admin/catalogue'], ['owner@example.test', '/admin/settings'], ['driver@example.test', '/driver'], ['driver@example.test', '/driver/earnings']];
const WIDTHS = [360, 390, 768, 1280];

describe('responsive: no horizontal scrolling at common widths', () => {
  for (const w of WIDTHS) {
    it(`public pages at ${w}px`, async () => {
      const { page } = await newPage(browser, { width: w, height: 900 });
      const bad: string[] = [];
      for (const path of PUBLIC) {
        await page.goto(base() + path); await page.waitForLoadState('networkidle');
        if (await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)) bad.push(path);
      }
      expect(bad).toEqual([]);
    });
    it(`signed-in and portal pages at ${w}px`, async () => {
      const bad: string[] = [];
      for (const [email, path] of [['customer@example.test', ''] as const, ...PORTALS.map(([e, p]) => [e, p] as const)]) {
        const { page, ctx } = await newPage(browser, { width: w, height: 900 });
        await signIn(page, email);
        for (const p of path ? [path] : SIGNED_IN) {
          await page.goto(base() + p); await page.waitForLoadState('networkidle');
          if (await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)) bad.push(`${email} ${p}`);
        }
        await ctx.close();
      }
      expect(bad).toEqual([]);
    });
  }
});

describe('accessibility (axe, WCAG 2 A/AA): no serious or critical violations', () => {
  const scan = async (page: import('playwright-core').Page, label: string) => {
    const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    return r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${label}: ${v.id} (${v.nodes.length}) ${v.help}`);
  };
  it('public pages on a phone', async () => {
    const { page } = await newPage(browser, MOBILE);
    const found: string[] = [];
    for (const path of PUBLIC) { await page.goto(base() + path); await page.waitForLoadState('networkidle'); found.push(...(await scan(page, path))); }
    expect(found).toEqual([]);
  });
  it('public pages in dark mode', async () => {
    const { page } = await newPage(browser, MOBILE, 'dark');
    const found: string[] = [];
    for (const path of PUBLIC) { await page.goto(base() + path); await page.waitForLoadState('networkidle'); found.push(...(await scan(page, `dark ${path}`))); }
    expect(found).toEqual([]);
  });
  it('signed-in customer and portal pages', async () => {
    const found: string[] = [];
    for (const [email, path] of [['customer@example.test', '/account'] as const, ['customer@example.test', '/orders'] as const, ...PORTALS]) {
      const { page, ctx } = await newPage(browser, DESKTOP);
      await signIn(page, email); await page.goto(base() + path); await page.waitForLoadState('networkidle');
      found.push(...(await scan(page, `${email} ${path}`))); await ctx.close();
    }
    expect(found).toEqual([]);
  });
});

describe('navigation menu', () => {
  for (const [label, size] of [['phone', MOBILE], ['desktop', DESKTOP]] as const) {
    it(`the departments menu opens, stays open, navigates and closes (${label})`, async () => {
      const { page, errors } = await newPage(browser, size);
      await page.goto(base()); await page.waitForLoadState('networkidle');
      await page.getByRole('button', { name: size.width < 600 ? 'Open all departments' : /All departments/ }).first().click();
      const menu = page.getByRole('dialog', { name: 'All departments' });
      await menu.waitFor({ state: 'visible' });
      await page.waitForTimeout(700);                                   // it must still be there a moment later
      expect(await menu.isVisible()).toBe(true);
      await menu.getByRole('link', { name: 'Weekly deals' }).click();
      await page.waitForURL('**/deals');
      await page.getByRole('dialog', { name: 'All departments' }).waitFor({ state: 'hidden', timeout: 5000 });   // closes after navigating
      expect(errors).toEqual([]);
    });
  }
});
