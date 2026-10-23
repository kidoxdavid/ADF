import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { pool } from '../db/pool.js';
import { requirePerm } from '../lib/permissions.js';

/** Precise KPI definitions live in docs/KPIS.md and are returned with the numbers so nobody has to guess what a figure means. */
export const KPI_DEFINITIONS: Record<string, string> = {
  gmv: 'Gross merchandise value: merchandise (item) value of paid suborders that were not rejected or cancelled, before discounts, tax and delivery. Excludes refunds (shown separately).',
  net_gmv: 'GMV minus merchandise refunded.',
  orders: 'Customer orders whose payment was confirmed in the period.',
  aov: 'Average order value = GMV / orders (merchandise only).',
  gross_marketplace_revenue: 'Commission earned + delivery fees collected, net of reversals from refunds. Before payment-processing fees, driver pay and discounts.',
  net_marketplace_revenue: 'Gross marketplace revenue minus driver pay, platform-funded discounts and marketplace-funded refunds. Payment-processing fees are NOT included because they are not yet imported from the provider, so this overstates true margin.',
  refund_rate: 'Refunded amount / amount paid by customers (orders paid in the period).',
  cancellation_rate: 'Paid suborders rejected or cancelled / paid suborders.',
  avg_fulfilment_minutes: 'Average minutes from payment to delivery/collection for completed suborders.',
  on_time_delivery_rate: 'Deliveries completed at or before the promised time / completed deliveries that had a promised time.',
  repeat_purchase_rate: 'Customers with 2 or more paid orders (lifetime) / customers with at least one paid order in the period.',
  retention_30d: 'Of customers who ordered 30 to 60 days ago, the share who ordered again in the last 30 days.',
  vendor_activation_rate: 'Approved vendors with at least one paid order / approved vendors.',
  vendor_retention_30d: 'Of activated vendors, the share with at least one paid order in the last 30 days.',
  out_of_stock_rate: 'Active offers at orderable stores with nothing available / active offers at orderable stores. (A snapshot, not period-based.)',
  funnel: 'Distinct visitors (signed-in user or anonymous session) reaching each stage in the period. Anonymous product views without a session id are counted once each.',
};

export const adminReportRoutes: FastifyPluginAsync = async (app) => {
  const rep = requirePerm('reports.view');
  const range = z.object({ from: z.string().optional(), to: z.string().optional() });
  const win = (q: z.infer<typeof range>) => [q.from ?? new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10), q.to ?? new Date().toISOString().slice(0, 10)];

  app.get('/reports/kpis', { preHandler: rep }, async (req) => {
    const [from, to] = win(range.parse(req.query));
    const P = [from, to];
    const placed = `o.placed_at >= $1::date AND o.placed_at < $2::date + 1`;
    const one = async (sql: string, p: unknown[] = P) => (await pool.query(sql, p)).rows[0];

    const sales = await one(`SELECT COUNT(DISTINCT o.id)::int AS orders,
        COALESCE(sum(s.subtotal_cents) FILTER (WHERE s.status NOT IN ('rejected','cancelled')),0)::int AS gmv_cents,
        COALESCE(sum(o.total_cents) FILTER (WHERE true),0)::int AS paid_cents,
        count(s.*) FILTER (WHERE s.status IN ('rejected','cancelled'))::int AS cancelled_suborders, count(s.*)::int AS suborders
      FROM orders o JOIN suborders s ON s.order_id = o.id WHERE o.placed_at IS NOT NULL AND ${placed}`);
    const refunds = await one(`SELECT COALESCE(sum(r.amount_cents),0)::int AS refunded_cents, COALESCE(sum(r.merchandise_cents),0)::int AS refunded_merch_cents FROM refunds r JOIN orders o ON o.id = r.order_id WHERE r.status='succeeded' AND ${placed}`);
    const ledger = await one(`SELECT COALESCE(-sum(amount_cents) FILTER (WHERE account='commission_revenue'),0)::int AS commission_cents, COALESCE(-sum(amount_cents) FILTER (WHERE account='delivery_revenue'),0)::int AS delivery_cents,
        COALESCE(sum(amount_cents) FILTER (WHERE account='delivery_cost'),0)::int AS driver_cost_cents, COALESCE(sum(amount_cents) FILTER (WHERE account='discount_expense'),0)::int AS discount_cents,
        COALESCE(sum(amount_cents) FILTER (WHERE account='refund_loss'),0)::int AS refund_loss_cents FROM ledger_entries l WHERE l.created_at >= $1::date AND l.created_at < $2::date + 1`);
    const ful = await one(`SELECT COALESCE(round(avg(extract(epoch FROM (s.completed_at - o.placed_at))/60)),0)::int AS avg_minutes FROM suborders s JOIN orders o ON o.id = s.order_id WHERE s.status IN ('delivered','collected') AND ${placed}`);
    const ontime = await one(`SELECT count(*) FILTER (WHERE d.delivered_at <= s.promised_at)::int AS on_time, count(*)::int AS total FROM deliveries d JOIN suborders s ON s.id = d.suborder_id JOIN orders o ON o.id = s.order_id WHERE d.status='delivered' AND s.promised_at IS NOT NULL AND ${placed}`);
    const repeat = await one(`WITH c AS (SELECT user_id, count(*) n FROM orders WHERE placed_at IS NOT NULL GROUP BY user_id), p AS (SELECT DISTINCT user_id FROM orders o WHERE ${placed})
        SELECT count(*)::int AS customers, count(*) FILTER (WHERE c.n >= 2)::int AS repeat FROM p JOIN c USING (user_id)`);
    const ret = await one(`WITH prev AS (SELECT DISTINCT user_id FROM orders WHERE placed_at >= now() - interval '60 days' AND placed_at < now() - interval '30 days'),
        recent AS (SELECT DISTINCT user_id FROM orders WHERE placed_at >= now() - interval '30 days')
        SELECT (SELECT count(*) FROM prev)::int AS base, (SELECT count(*) FROM prev JOIN recent USING (user_id))::int AS kept`, []);
    const vend = await one(`SELECT (SELECT count(*) FROM vendors WHERE status='approved' AND NOT is_test_data)::int AS approved,
        (SELECT count(DISTINCT s.vendor_id) FROM suborders s JOIN vendors v ON v.id = s.vendor_id WHERE v.status='approved' AND NOT v.is_test_data AND s.status NOT IN ('awaiting_payment','expired'))::int AS activated,
        (SELECT count(DISTINCT s.vendor_id) FROM suborders s JOIN orders o ON o.id = s.order_id JOIN vendors v ON v.id = s.vendor_id WHERE NOT v.is_test_data AND o.placed_at > now() - interval '30 days')::int AS active30,
        (SELECT count(*) FROM vendors WHERE status='approved')::int AS approved_all, (SELECT count(DISTINCT s.vendor_id) FROM suborders s WHERE s.status NOT IN ('awaiting_payment','expired'))::int AS activated_all`, []);
    const oos = await one(`SELECT count(*) FILTER (WHERE o.stock_on_hand - o.stock_reserved <= 0)::int AS out, count(*)::int AS total FROM store_offers o JOIN storefronts s ON s.id = o.store_id AND s.orderable WHERE o.is_active`, []);
    const funnel = await one(`WITH e AS (SELECT type, COALESCE(user_id::text, session_id, 'anon-' || id) AS visitor FROM analytics_events WHERE created_at >= $1::date AND created_at < $2::date + 1)
        SELECT count(DISTINCT visitor) FILTER (WHERE type='product_view')::int AS viewed, count(DISTINCT visitor) FILTER (WHERE type='add_to_cart')::int AS added,
               count(DISTINCT visitor) FILTER (WHERE type='checkout_started')::int AS checkout, count(DISTINCT visitor) FILTER (WHERE type='order_paid')::int AS paid FROM e`);
    const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 1000) / 10 : null);
    const gross = ledger.commission_cents + ledger.delivery_cents;
    return {
      period: { from, to }, definitions: KPI_DEFINITIONS,
      marketplace: {
        orders: sales.orders, gmv_cents: sales.gmv_cents, net_gmv_cents: sales.gmv_cents - refunds.refunded_merch_cents, aov_cents: sales.orders ? Math.round(sales.gmv_cents / sales.orders) : null,
        gross_marketplace_revenue_cents: gross, net_marketplace_revenue_cents: gross - ledger.driver_cost_cents - ledger.discount_cents - ledger.refund_loss_cents,
        refund_rate_pct: pct(refunds.refunded_cents, sales.paid_cents), cancellation_rate_pct: pct(sales.cancelled_suborders, sales.suborders),
        avg_fulfilment_minutes: ful.avg_minutes || null, on_time_delivery_rate_pct: pct(ontime.on_time, ontime.total), out_of_stock_rate_pct: pct(oos.out, oos.total),
      },
      customers: { repeat_purchase_rate_pct: pct(repeat.repeat, repeat.customers), retention_30d_pct: pct(ret.kept, ret.base), customers_in_period: repeat.customers },
      vendors: { approved: vend.approved_all, activation_rate_pct: pct(vend.activated_all, vend.approved_all), retention_30d_pct: pct(vend.active30, vend.activated_all) },
      funnel: { ...funnel, view_to_cart_pct: pct(funnel.added, funnel.viewed), cart_to_checkout_pct: pct(funnel.checkout, funnel.added), checkout_to_paid_pct: pct(funnel.paid, funnel.checkout), overall_conversion_pct: pct(funnel.paid, funnel.viewed) },
      data_caveat: 'Figures include any demo/test data present in this database.',
    };
  });

  app.get('/reports/search-demand', { preHandler: rep }, async (req) => {
    const [from, to] = win(range.parse(req.query));
    const unmet = (await pool.query(`SELECT query, count(*)::int AS searches FROM search_events WHERE result_count = 0 AND created_at >= $1::date AND created_at < $2::date + 1 GROUP BY query ORDER BY searches DESC LIMIT 30`, [from, to])).rows;
    const tot = (await pool.query(`SELECT count(*)::int AS searches, count(*) FILTER (WHERE result_count = 0)::int AS zero FROM search_events WHERE created_at >= $1::date AND created_at < $2::date + 1`, [from, to])).rows[0];
    return { period: { from, to }, searches: tot.searches, zero_result_searches: tot.zero, zero_result_rate_pct: tot.searches ? Math.round((tot.zero / tot.searches) * 1000) / 10 : null, unmet_queries: unmet };
  });

  app.get('/reports/sales', { preHandler: rep }, async (req) => {
    const [from, to] = win(range.parse(req.query));
    const P = [from, to];
    const base = `o.placed_at >= $1::date AND o.placed_at < $2::date + 1 AND s.status NOT IN ('rejected','cancelled','awaiting_payment','expired')`;
    const [byRegion, byCategory, byStore, promos, ads, pipeline] = await Promise.all([
      pool.query(`SELECT COALESCE(r.name,'Unassigned') AS region, sum(l.line_total_cents)::int AS gmv_cents FROM order_lines l JOIN suborders s ON s.id = l.suborder_id JOIN orders o ON o.id = s.order_id
                   LEFT JOIN LATERAL (SELECT rg.name FROM product_countries pc JOIN region_countries rc ON rc.country_id = pc.country_id JOIN regions rg ON rg.id = rc.region_id WHERE pc.product_id = l.product_id AND pc.kind='culinary' ORDER BY rg.sort_order LIMIT 1) r ON true
                  WHERE ${base} GROUP BY 1 ORDER BY 2 DESC`, P),
      pool.query(`SELECT COALESCE(c.name,'Uncategorised') AS category, sum(l.line_total_cents)::int AS gmv_cents FROM order_lines l JOIN suborders s ON s.id = l.suborder_id JOIN orders o ON o.id = s.order_id JOIN products p ON p.id = l.product_id LEFT JOIN categories c ON c.id = p.category_id WHERE ${base} GROUP BY 1 ORDER BY 2 DESC`, P),
      pool.query(`SELECT st.name AS store, count(*)::int AS orders, sum(s.subtotal_cents)::int AS gmv_cents FROM suborders s JOIN orders o ON o.id = s.order_id JOIN stores st ON st.id = s.store_id WHERE ${base} GROUP BY 1 ORDER BY 3 DESC`, P),
      pool.query(`SELECT c.code, count(o.*)::int AS orders, COALESCE(sum(o.discount_cents),0)::int AS discount_cost_cents, COALESCE(sum(o.subtotal_cents),0)::int AS merchandise_cents FROM coupons c LEFT JOIN orders o ON o.coupon_id = c.id AND o.status IN ('placed','completed') AND o.placed_at >= $1::date AND o.placed_at < $2::date + 1 GROUP BY c.code ORDER BY orders DESC`, P),
      pool.query(`SELECT count(*) FILTER (WHERE e.type='impression')::int AS impressions, count(*) FILTER (WHERE e.type='click')::int AS clicks FROM ad_events e WHERE e.created_at >= $1::date AND e.created_at < $2::date + 1`, P),
      pool.query(`SELECT stage, count(*)::int AS n FROM vendor_prospects GROUP BY stage`),
    ]);
    const pl = Object.fromEntries(pipeline.rows.map((r) => [r.stage, r.n])) as Record<string, number>;
    const total = Object.values(pl).reduce((a, b) => a + b, 0);
    const timeToLaunch = (await pool.query(`SELECT round(avg(extract(epoch FROM (launched_at - created_at))/86400)::numeric, 1)::float AS days FROM vendor_prospects WHERE launched_at IS NOT NULL`)).rows[0].days;
    const activeStores = byStore.rows.length;
    const ordersTotal = byStore.rows.reduce((a, r) => a + r.orders, 0);
    return {
      period: { from, to }, by_region: byRegion.rows, by_category: byCategory.rows, by_store: byStore.rows, orders_per_active_store: activeStores ? Math.round((ordersTotal / activeStores) * 10) / 10 : null,
      promotions: promos.rows,
      // Measured only: impressions and clicks are counted by us; we do not claim any effect on sales.
      sponsored: { ...ads.rows[0], ctr_pct: ads.rows[0].impressions ? Math.round((ads.rows[0].clicks / ads.rows[0].impressions) * 1000) / 10 : null },
      vendor_pipeline: { by_stage: pl, total, prospect_to_launch_pct: total ? Math.round(((pl.launched ?? 0) / total) * 1000) / 10 : null, avg_days_first_contact_to_launch: timeToLaunch },
    };
  });
};
