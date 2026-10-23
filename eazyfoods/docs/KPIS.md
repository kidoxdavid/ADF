# KPI definitions

Computed by `GET /api/admin/reports/kpis` (and `/reports/sales`, `/reports/search-demand`). The API returns these definitions next to the numbers. Seed data is not business performance; figures include any demo data present in the database.

| KPI | Definition |
|---|---|
| Orders | Orders whose payment was confirmed in the period. |
| GMV | Merchandise value of paid suborders not rejected/cancelled, before discounts, tax, delivery. Refunds shown separately; **Net GMV** subtracts refunded merchandise. |
| AOV | GMV / orders (merchandise only). |
| Gross marketplace revenue | Commission earned + delivery fees collected, net of refund reversals. Before processing fees, driver pay and discounts. |
| Net marketplace revenue | Gross marketplace revenue - driver pay - platform-funded discounts - marketplace-funded refunds. **Excludes payment-processing fees** (not yet imported), so it overstates margin. |
| Refund rate | Refunded amount / amount paid (orders paid in the period). |
| Cancellation rate | Paid suborders rejected or cancelled / paid suborders. |
| Fulfilment time | Mean minutes from payment to delivery/collection for completed suborders. |
| On-time delivery rate | Deliveries completed at or before the promised time / completed deliveries with a promise. |
| Repeat purchase rate | Customers with 2+ paid orders (lifetime) / customers who ordered in the period. |
| 30-day retention | Of customers who ordered 30-60 days ago, the share who ordered in the last 30 days. |
| Vendor activation | Approved vendors with at least one paid order / approved vendors. |
| Vendor retention (30d) | Of activated vendors, the share with a paid order in the last 30 days. |
| Out-of-stock rate | Active offers at orderable stores with nothing available / active offers at orderable stores (snapshot). |
| Funnel | Distinct visitors (user or anonymous session) who viewed a product, added to basket, started checkout, paid. Conversion = paid / viewers. |
| Search demand | Zero-result searches and most common unmet queries. |
| Vendor pipeline | Prospects by stage; prospect-to-launch %; average days first contact to launch. |
| Orders per active store | Orders / stores with at least one order in the period. |
| Sales by region / category | Merchandise by a product's first culinary region, and by category. |
| Promotion performance | Orders and discount cost per coupon code. |
| Sponsored performance | Impressions, clicks, CTR from our own event log. We make **no** claim about sales caused by ads. |
