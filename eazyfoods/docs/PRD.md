# Product requirements: EAZyfoods

## Problem
People in Calgary who cook African food struggle to find the exact brand, size or regional ingredient they need. It is scattered across independent grocers with no online presence, no price comparison, and no delivery. Grocers are busy, not technical, and cannot justify building and running their own e-commerce.

## Customers
- **Shoppers:** diaspora households and curious cooks. Need: trustworthy availability, transparent prices and fees, delivery, help when something goes wrong.
- **Store owners:** independent African grocers. Need: more customers with no IT work, simple order handling, honest reporting.
- **Drivers:** contractors doing local deliveries. Need: clear jobs, correct addresses, auditable earnings.
- **EAZyfoods staff:** operate a multi-vendor marketplace safely and understand if the business works.

## Value proposition
Customers: authentic ingredients from local stores, compared side by side, delivered. Stores: reach new customers, manage orders in one place, run promotions, understand sales, without a developer. We do not promise sales, earnings or customer numbers.

## Business model (all rates configurable; defaults need owner approval, see DECISIONS.md)
Commission on merchandise value, per-store delivery fee, optional sponsored placements (cost per click, budget-capped).

## MVP (built)
Regional + country discovery; search with typo tolerance and *verified* aliases; shared catalogue with per-store offers; basket; server-validated checkout (stock, price, hours, minimums, service area, coupon, tax); per-store suborders; stock reservations; payments through a provider interface with signed idempotent webhooks; order tracking; substitutions with customer consent; refunds; double-entry ledger; vendor onboarding and portal; admin console; manual dispatch; driver portal with handover code; support tickets; reviews (verified purchases only); recipes-to-basket; sponsored placements; vendor CRM; KPIs.

## Explicitly not in the first release
Live GPS tracking; route optimisation; native apps (the site is mobile-first and installable as a web app later); loyalty points and referrals (no business case yet: coupons cover first-order offers); marketing automation and email campaigns beyond consented opt-in storage; multi-currency; scheduled/future-dated orders (stores must be open to order); variable-weight billing adjustments (disclosed; handled by partial refund); vendor POS integrations; guest checkout (accounts are required so orders, refunds and reorders work).

## Acceptance criteria (summary; see tests)
1. A customer can find a store by region and a product by an alternative name. *(search + e2e tests)*
2. Prices, stock, delivery eligibility and fees are re-validated on the server at checkout; a stale basket cannot buy sold-out stock. *(checkout tests)*
3. An order is paid only from a verified webhook; failed payments leave no paid order and release stock. *(checkout tests)*
4. Stores see paid orders, accept/reject with reasons, propose substitutions; the customer approves. *(fulfilment tests)*
5. A driver sees only their jobs and completes delivery with the customer's code. *(fulfilment + e2e tests)*
6. Refunds update the ledger so every account nets correctly. *(checkout tests)*
7. Vendors cannot see or change other vendors' data; staff only do what their role allows. *(authorization tests)*
8. Money never uses floating point; ledger entries cannot be edited. *(db constraint tests)*

## Backlog (next)
Stripe Connect onboarding link for vendors and a live-mode checklist run; payment-processing-fee import for true net margin; photo capture for proof of delivery; SMS notifications; scheduled orders; weight-based final billing; saved basket sharing; vendor POS/CSV scheduled sync; recipe review workflow with named reviewers; French-language UI; loyalty/referrals once repeat-purchase data justifies them.
