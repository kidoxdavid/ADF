# Decisions made on your behalf, and what still needs your approval

You asked me to go with my own decisions. These are the choices built into the product. Every value below is **configurable in the admin console (owner role)** and is recorded in the audit log when changed. None is a legal or tax opinion.

## Commercial defaults (provisional: confirm before launch)
| Setting | Default | Why |
|---|---|---|
| Commission | **12%** of merchandise value (per-vendor override possible) | Typical marketplace range is 10-20%. 12% is competitive for thin-margin grocers while covering payment fees and support. Vendors keep full tax and delivery pass-through separately. |
| Delivery fee | **$5.99 per store**, free over $75 of that store's items, ~90 min estimate | Each store is a separate trip, so the fee is per store and disclosed before payment. |
| Driver pay | **$4.50 per delivery** | Leaves ~$1.49 of the delivery fee to contribute toward payment fees. Confirm against local rates and employment-status advice for drivers. |
| Minimum order | per store (the store sets it; demo stores use $25) | Protects store economics on small baskets. |
| Tax | GST 5% on items marked *standard* and on delivery fees; basic groceries marked *zero-rated* | Many basic groceries are zero-rated in Canada but snacks, confectionery and some beverages are not. **Every product's tax class must be verified by an accountant.** Alberta has no PST. |
| Payout hold | **2 days** after delivery | Gives time for problems to surface before paying out. |
| Stock hold at checkout | 15 minutes | Long enough to pay, short enough not to block sales. |
| Store response time | escalate at 15 min; auto-reject and refund at 45 min | A paid customer must not wait indefinitely. |
| Processing fees | paid by EAZyfoods, not deducted from vendors | Simpler and more attractive pitch; revisit if margins demand. |
| Discounts (coupons) | funded by EAZyfoods; vendor earnings unaffected | Keeps vendors whole; promotions are a marketing cost. |

## Illustrative unit economics (assumptions, not measurements)
Assume a $50 basket from one store, delivered, and a payment fee of 2.9% + $0.30 (**check Stripe's current Canadian pricing; this is an assumption**).
- Commission: $6.00. Delivery fee: $5.99. Customer pays about $62.31 including GST on delivery (zero-rated groceries).
- Payment fee ~ $2.11. Driver pay: $4.50.
- Contribution before software, support and marketing: $6.00 + $5.99 - $2.11 - $4.50 = **~$5.38 (about 10.8% of the basket)**.
- Multi-store baskets earn a delivery fee and pay a driver per store, so they scale linearly.
- Implication: at 12% commission the business only works with disciplined delivery cost and a healthy average basket. The KPI dashboard reports *net marketplace revenue* so this can be measured; it **excludes payment fees until they are imported from the provider**, so it overstates margin.

## Payment provider
**Stripe Connect** (separate charges and transfers) is the leading candidate for multi-vendor payouts in Canada. The adapter is written but **has not been run against Stripe**: no credentials were available. A generic payment processor (e.g. Helcim) does not by itself provide marketplace onboarding and split payouts. See PAYMENTS.md for the verification checklist before any live money.

## Delivery
Own/contract drivers with manual dispatch for the pilot. Service areas are postal-code (FSA) zones, configured in the admin console. The seeded Calgary FSA list and fees are development defaults: verify before launch.

## Still needs your decision
1. Approve or change the commission, delivery fee, driver pay and minimum-order defaults.
2. Driver status (contractor vs employee) and insurance: get professional advice.
3. Open a Stripe account, confirm Connect eligibility, and supply keys (test first).
4. Choose hosting and an email provider (Resend is wired; any SMTP/API provider can be added).
5. Legal review of the Terms, Privacy Policy and Vendor Agreement drafts (marked in the product as drafts).
6. Which real stores to pilot with, and who reviews their catalogue and the alias list.
7. Food-safety and licensing requirements for each vendor (collected as documents; verification is a human step).
