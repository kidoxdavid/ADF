import { describe, expect, it } from 'vitest';
import { app } from './helpers.js';
import { pool } from '../src/db/pool.js';

const search = async (qs: string) => (await app.inject({ url: `/api/search?${qs}` })).json();

describe('search', () => {
  it('finds a product through a verified alias and says so', async () => {
    const r = await search('q=pondu');
    const hit = r.results.find((x: any) => x.slug === 'cassava-leaves-frozen');
    expect(hit).toBeTruthy();
    expect(hit.matched_alias).toBe('Pondu');
  });

  it('does NOT match unverified aliases (no unreviewed equivalences)', async () => {
    const r = await search('q=ogbono');
    expect(r.results.find((x: any) => x.slug === 'egusi-ground-melon-seeds')).toBeUndefined();
  });

  it('tolerates typos', async () => {
    expect((await search('q=shitto')).results.map((x: any) => x.slug)).toContain('shito-black-pepper-sauce');
    expect((await search('q=gari')).results.map((x: any) => x.slug)).toContain('garri-white');
  });

  it('matches by brand', async () => {
    expect((await search('q=sunrise')).results.map((x: any) => x.slug)).toContain('mielie-meal-maize-meal');
  });

  it('filters by region via culinary association', async () => {
    const r = await search('region=east-africa');
    const slugs = r.results.map((x: any) => x.slug);
    expect(slugs).toContain('berbere-spice-blend');
    expect(slugs).not.toContain('garri-white');
  });

  it('a country can sit in two regions (Cameroon: West and Central)', async () => {
    const west = (await search('region=west-africa&country=cameroon')).results.map((x: any) => x.slug);
    const central = (await search('region=central-africa&country=cameroon')).results.map((x: any) => x.slug);
    expect(west).toContain('egusi-ground-melon-seeds');
    expect(central).toContain('egusi-ground-melon-seeds');
  });

  it('returns helpful suggestions and records unmet demand when nothing matches', async () => {
    const r = await search('q=zzqxjv');
    expect(r.total).toBe(0);
    expect(r.suggestions.regions.length).toBeGreaterThan(0);
    await new Promise((res) => setTimeout(res, 100));
    const ev = await pool.query(`SELECT * FROM search_events WHERE query = 'zzqxjv'`);
    expect(ev.rowCount).toBe(1);
  });

  it('sorts by price', async () => {
    const r = await search('sort=price_asc');
    const prices = r.results.map((x: any) => x.min_price);
    expect(prices).toEqual([...prices].sort((a, b) => a - b));
  });

  it('hides products from stores whose vendor is not approved', async () => {
    await pool.query(`UPDATE vendors SET status='suspended' WHERE name LIKE 'Demo Southern%'`);
    const store = await app.inject({ url: '/api/stores/demo-southern-pantry' });
    expect(store.statusCode).toBe(404);
    const stores = (await app.inject({ url: '/api/stores' })).json();
    expect(stores.map((s: any) => s.slug)).not.toContain('demo-southern-pantry');
    await pool.query(`UPDATE vendors SET status='approved' WHERE name LIKE 'Demo Southern%'`);
  });

  it('suggest endpoint offers alias hits', async () => {
    const r = (await app.inject({ url: '/api/search/suggest?q=pond' })).json();
    expect(r.some((x: any) => x.slug === 'cassava-leaves-frozen' && x.via === 'Pondu')).toBe(true);
  });
});

describe('storefront feeds', () => {
  it('deals, new arrivals, related products and facets return usable data', async () => {
    const deals = (await app.inject({ url: '/api/deals' })).json();
    expect(deals.length).toBeGreaterThan(0);
    expect(deals.every((d: any) => d.on_sale && d.in_stock)).toBe(true);
    const fresh = (await app.inject({ url: '/api/new-arrivals' })).json();
    expect(fresh.length).toBeGreaterThan(5);
    const rel = (await app.inject({ url: '/api/products/garri-white/related' })).json();
    expect(rel.map((r: any) => r.slug)).not.toContain('garri-white');
    expect(rel.length).toBeGreaterThan(0);
    const s = (await app.inject({ url: '/api/search?region=west-africa' })).json();
    expect(s.facets.categories.length).toBeGreaterThan(2);
    expect(s.facets.stores.length).toBeGreaterThan(0);
    expect(s.results[0]).toHaveProperty('rating_avg');
  });
  it('service-area lookup says whether we deliver to a postal area', async () => {
    expect((await app.inject({ url: '/api/service-area?postal=T2A 0A0' })).json()).toMatchObject({ serviceable: true, zone: 'Calgary' });
    expect((await app.inject({ url: '/api/service-area?postal=V6B1A1' })).json().serviceable).toBe(false);
    expect((await app.inject({ url: '/api/service-area?postal=nope' })).statusCode).toBe(400);
  });
});
