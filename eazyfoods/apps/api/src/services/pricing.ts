import type { Queryable } from '../lib/db-types.js';
import { allocate, bps } from '../lib/money.js';
import { getSetting } from '../lib/settings.js';

export type Issue = { type: string; message: string; offer_id?: string; store_slug?: string; available?: number };
export type QuoteLine = {
  offer_id: string; product_id: string; product_slug: string; name: string; brand: string | null; pack_label: string | null; sold_by: string;
  unit_price_cents: number; added_price_cents: number; quantity: number;
  line_total_cents: number; discount_cents: number; tax_rate_bps: number; tax_cents: number; commission_cents: number;
};
export type QuoteSub = {
  store_id: string; store_slug: string; store_name: string; vendor_id: string; lines: QuoteLine[];
  subtotal_cents: number; discount_cents: number; delivery_cents: number; delivery_tax_cents: number; tax_cents: number; total_cents: number;
  commission_bps: number; commission_cents: number; eta_minutes: number | null; fulfilment_method: 'delivery' | 'pickup';
};
export type Quote = {
  ok: boolean; issues: Issue[]; warnings: Issue[]; suborders: QuoteSub[];
  subtotal_cents: number; discount_cents: number; delivery_cents: number; tax_cents: number; total_cents: number;
  coupon: { id: string; code: string; discount_cents: number } | null; coupon_error?: string;
  separate_deliveries: boolean;
};

export const normalisePostal = (s: string) => s.replace(/\s+/g, '').toUpperCase();
export const isCanadianPostal = (s: string) => /^[A-Z][0-9][A-Z][0-9][A-Z][0-9]$/.test(normalisePostal(s));

type Opts = { addressId?: string | null; method: 'delivery' | 'pickup'; couponCode?: string | null };

export async function buildQuote(c: Queryable, userId: string, opts: Opts): Promise<Quote> {
  const issues: Issue[] = [];
  const warnings: Issue[] = [];
  const [taxRates, defaultBps, requireOpen] = await Promise.all([
    getSetting<Record<string, number>>('tax.rates_bps', c), getSetting<number>('commission.default_bps', c), getSetting<boolean>('ordering.require_open', c)]);

  const items = (await c.query(
    `SELECT ci.offer_id, ci.quantity, ci.added_price_cents,
            o.price_cents, o.is_active, o.stock_on_hand - o.stock_reserved AS available, o.store_id,
            p.id AS product_id, p.slug AS product_slug, p.name, p.status AS pstatus, p.tax_class, p.sold_by, p.pack_size, p.pack_unit, b.name AS brand,
            s.slug AS store_slug, s.name AS store_name, s.orderable, s.is_open, s.ordering_paused, s.min_order_cents, s.offers_delivery, s.offers_pickup, s.vendor_id,
            v.commission_bps
       FROM cart_items ci JOIN carts ct ON ct.id = ci.cart_id
       JOIN offers_live o ON o.id = ci.offer_id
       JOIN products p ON p.id = o.product_id
       JOIN storefronts s ON s.id = o.store_id
       JOIN vendors v ON v.id = s.vendor_id
       LEFT JOIN brands b ON b.id = p.brand_id
      WHERE ct.user_id = $1 ORDER BY s.name, p.name`, [userId])).rows;

  if (!items.length) issues.push({ type: 'empty_cart', message: 'Your basket is empty.' });

  // Delivery zone for the chosen address
  let zone: { id: string; fee_cents: number; free_over_cents: number | null; eta_minutes: number } | null = null;
  let zoneStores = new Set<string>();
  if (opts.method === 'delivery') {
    if (!opts.addressId) issues.push({ type: 'address_required', message: 'Choose a delivery address.' });
    else {
      const a = (await c.query('SELECT postal_code FROM addresses WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL', [opts.addressId, userId])).rows[0];
      if (!a) issues.push({ type: 'address_required', message: 'That address was not found.' });
      else {
        zone = (await c.query(
          `SELECT z.id, z.fee_cents, z.free_over_cents, z.eta_minutes FROM delivery_zone_fsas f JOIN delivery_zones z ON z.id = f.zone_id AND z.is_active WHERE f.fsa = $1`,
          [a.postal_code.slice(0, 3)])).rows[0] ?? null;
        if (!zone) issues.push({ type: 'outside_service_area', message: `We do not deliver to ${a.postal_code.slice(0, 3)} yet.` });
        else zoneStores = new Set((await c.query('SELECT store_id FROM store_delivery_zones WHERE zone_id = $1', [zone.id])).rows.map((r) => r.store_id));
      }
    }
  }

  const groups = new Map<string, any[]>();
  for (const it of items) {
    if (!it.orderable || it.ordering_paused) issues.push({ type: 'store_unavailable', message: `${it.store_name} is not taking orders right now.`, store_slug: it.store_slug });
    else if (!it.is_active || it.pstatus !== 'published') issues.push({ type: 'unavailable', message: `${it.name} is no longer available from ${it.store_name}.`, offer_id: it.offer_id, store_slug: it.store_slug, available: 0 });
    else if (it.available < it.quantity)
      issues.push({ type: it.available <= 0 ? 'unavailable' : 'insufficient_stock', message: it.available <= 0 ? `${it.name} is out of stock at ${it.store_name}.` : `Only ${it.available} of ${it.name} left at ${it.store_name}.`,
        offer_id: it.offer_id, store_slug: it.store_slug, available: Math.max(0, it.available) });
    if (it.added_price_cents !== it.price_cents)
      warnings.push({ type: 'price_changed', message: `${it.name} at ${it.store_name} changed from ${(it.added_price_cents / 100).toFixed(2)} to ${(it.price_cents / 100).toFixed(2)}.`, offer_id: it.offer_id });
    (groups.get(it.store_id) ?? groups.set(it.store_id, []).get(it.store_id)!).push(it);
  }

  const subs: QuoteSub[] = [];
  const stdRate = taxRates.standard ?? 0;
  for (const [storeId, rows] of groups) {
    const f = rows[0];
    if (requireOpen && f.orderable && !f.is_open) issues.push({ type: 'store_closed', message: `${f.store_name} is closed right now. Come back during opening hours.`, store_slug: f.store_slug });
    if (opts.method === 'pickup' && !f.offers_pickup) issues.push({ type: 'pickup_unavailable', message: `${f.store_name} does not offer pickup.`, store_slug: f.store_slug });
    if (opts.method === 'delivery') {
      if (!f.offers_delivery) issues.push({ type: 'delivery_unavailable', message: `${f.store_name} does not offer delivery.`, store_slug: f.store_slug });
      else if (zone && !zoneStores.has(storeId)) issues.push({ type: 'not_deliverable', message: `${f.store_name} does not deliver to this address.`, store_slug: f.store_slug });
    }
    const lines: QuoteLine[] = rows.map((r) => {
      const rate = taxRates[r.tax_class] ?? 0;
      const total = r.price_cents * r.quantity;
      return {
        offer_id: r.offer_id, product_id: r.product_id, product_slug: r.product_slug, name: r.name, brand: r.brand,
        pack_label: r.pack_size ? `${Number(r.pack_size)} ${r.pack_unit ?? ''}`.trim() : r.pack_unit ? `per ${r.pack_unit}` : null, sold_by: r.sold_by,
        unit_price_cents: r.price_cents, added_price_cents: r.added_price_cents, quantity: r.quantity,
        line_total_cents: total, discount_cents: 0, tax_rate_bps: rate, tax_cents: 0, commission_cents: 0,
      };
    });
    const subtotal = lines.reduce((a, l) => a + l.line_total_cents, 0);
    if (f.min_order_cents && subtotal < f.min_order_cents)
      issues.push({ type: 'min_order', message: `${f.store_name} has a ${(f.min_order_cents / 100).toFixed(2)} minimum order. Add ${((f.min_order_cents - subtotal) / 100).toFixed(2)} more.`, store_slug: f.store_slug });
    const cbps = f.commission_bps ?? defaultBps;
    subs.push({
      store_id: storeId, store_slug: f.store_slug, store_name: f.store_name, vendor_id: f.vendor_id, lines, subtotal_cents: subtotal, discount_cents: 0,
      delivery_cents: 0, delivery_tax_cents: 0, tax_cents: 0, total_cents: 0, commission_bps: cbps, commission_cents: 0,
      eta_minutes: opts.method === 'delivery' ? zone?.eta_minutes ?? null : null, fulfilment_method: opts.method,
    });
  }

  // Coupon: discount is platform-funded and spread across suborders, then across lines.
  const merch = subs.reduce((a, s) => a + s.subtotal_cents, 0);
  let coupon: Quote['coupon'] = null;
  let couponError: string | undefined;
  if (opts.couponCode?.trim()) {
    const r = await evaluateCoupon(c, userId, opts.couponCode.trim(), merch);
    if ('error' in r) couponError = r.error; else coupon = r;
  }
  if (coupon) {
    const perSub = allocate(coupon.discount_cents, subs.map((s) => s.subtotal_cents));
    subs.forEach((s, i) => {
      s.discount_cents = perSub[i];
      const perLine = allocate(perSub[i], s.lines.map((l) => l.line_total_cents));
      s.lines.forEach((l, j) => (l.discount_cents = perLine[j]));
    });
  }

  for (const s of subs) {
    for (const l of s.lines) {
      l.tax_cents = bps(l.line_total_cents - l.discount_cents, l.tax_rate_bps);
      l.commission_cents = bps(l.line_total_cents, s.commission_bps);
    }
    s.tax_cents = s.lines.reduce((a, l) => a + l.tax_cents, 0);
    s.commission_cents = s.lines.reduce((a, l) => a + l.commission_cents, 0);
    if (opts.method === 'delivery' && zone) {
      s.delivery_cents = zone.free_over_cents && s.subtotal_cents >= zone.free_over_cents ? 0 : zone.fee_cents;
      s.delivery_tax_cents = bps(s.delivery_cents, stdRate);
    }
    s.total_cents = s.subtotal_cents - s.discount_cents + s.delivery_cents + s.delivery_tax_cents + s.tax_cents;
  }

  const sum = (f: (s: QuoteSub) => number) => subs.reduce((a, s) => a + f(s), 0);
  return {
    ok: issues.length === 0 && !couponError, issues, warnings, suborders: subs,
    subtotal_cents: merch, discount_cents: sum((s) => s.discount_cents), delivery_cents: sum((s) => s.delivery_cents + s.delivery_tax_cents),
    tax_cents: sum((s) => s.tax_cents), total_cents: sum((s) => s.total_cents), coupon, coupon_error: couponError, separate_deliveries: subs.length > 1,
  };
}

export async function evaluateCoupon(c: Queryable, userId: string, code: string, merchCents: number):
  Promise<{ id: string; code: string; discount_cents: number } | { error: string }> {
  const cp = (await c.query('SELECT * FROM coupons WHERE code = $1 AND is_active', [code])).rows[0];
  const now = Date.now();
  if (!cp || (cp.starts_at && new Date(cp.starts_at).getTime() > now) || (cp.ends_at && new Date(cp.ends_at).getTime() < now)) return { error: 'This code is not valid.' };
  if (merchCents < cp.min_subtotal_cents) return { error: `Spend at least ${(cp.min_subtotal_cents / 100).toFixed(2)} to use this code.` };
  const live = `status IN ('pending_payment','placed','completed')`;
  if (cp.first_order_only) {
    const n = (await c.query(`SELECT count(*)::int AS n FROM orders WHERE user_id = $1 AND status IN ('placed','completed')`, [userId])).rows[0].n;
    if (n > 0) return { error: 'This code is for first orders only.' };
  }
  const used = (await c.query(`SELECT count(*) FILTER (WHERE user_id = $2)::int AS mine, count(*)::int AS total FROM orders WHERE coupon_id = $1 AND ${live}`, [cp.id, userId])).rows[0];
  if (used.mine >= cp.per_user_limit) return { error: 'You have already used this code.' };
  if (cp.max_redemptions && used.total >= cp.max_redemptions) return { error: 'This code has been fully redeemed.' };
  let d = cp.kind === 'percent' ? bps(merchCents, cp.value * 100) : cp.value;
  if (cp.max_discount_cents) d = Math.min(d, cp.max_discount_cents);
  d = Math.min(d, merchCents);
  return { id: cp.id, code: cp.code, discount_cents: d };
}
