# Project status

_Last updated: 2026-10-23 · Branch `build/eazyfoods-m1`_

## Milestone 1: foundation + discovery (current)
### Completed and verified
- Monorepo, TypeScript, migration runner, `.env.example`, README setup.
- Schema: identity/roles/sessions, audit log, regions/countries (many-to-many), brands, categories, products, aliases,
  vendors, stores, hours, store offers, append-only inventory adjustments, collections, search events.
- Auth: register / login / logout / me (scrypt, hashed session tokens, HttpOnly cookie, rate limiting, Origin check).
- Public API: regions, categories, collections, product detail with per-store offers, stores, store detail, search + suggest.
- Search: typo tolerance, brand match, **verified-alias** matching, region/country/category/store/price/stock filters, sorting, pagination, no-result suggestions, unmet-demand logging.
- Vendor API: list own stores/offers, upsert offer, stock adjustment (row-locked, audited, cannot go below reserved), adjustment history.
- Admin API: vendor approve/suspend, store publish gated on vendor approval, all audited.
- Web: home (regions, collections, stores), search with filters, product, store, sign in/up. Mobile-first, focus states, reduced-motion and dark-mode aware; checked in Chromium at 390px and 1280px: no horizontal overflow, no console errors.
- Tests: **23 API integration tests** (search, authN, authZ cross-vendor/customer/admin, concurrency, DB append-only). `tsc` clean for api and web; web production build succeeds.

### Not started (next milestones)
| # | Milestone |
|---|---|
| M2 | Cart, delivery address + service-area validation, delivery fee/tax calc, server-side price/stock revalidation |
| M3 | Orders -> suborders, inventory reservations, Stripe test-mode payments + verified webhooks, refunds, ledger |
| M4 | Vendor portal UI (onboarding wizard, offers/inventory, CSV import, order accept/reject/ready) |
| M5 | Admin console UI, driver portal, dispatch, support tickets, notifications/email |
| M6 | Reviews (verified purchasers only), recipes-to-cart, promotions, CRM for vendor prospects, analytics |

## Known gaps / defects
- **No product photography**; UI shows initial tiles. Need real images + object storage.
- No cart or checkout; the product page says ordering opens soon. No email verification or password reset yet.
- Seed data (3 demo stores, 16 products, prices, stock) is invented. `is_test_data` stores display "Demo store".
- Search not load-tested; relevance thresholds in `routes/search.ts` need tuning on real queries.
- Seed aliases are a small starter set; a domain expert must review them before real use.
- No CI pipeline, error monitoring, or automated accessibility audit yet (manual checks only).
- No browser end-to-end tests yet (the Chromium check was manual).
- The live site https://eazyfoods.ca was not reachable from the build environment and was not reviewed.

## Configuration required
`DATABASE_URL`, `WEB_ORIGIN`. Not yet needed: payment provider keys, email provider, object storage, maps/geocoding.

## Outstanding business decisions
1. Commission %, vendor fees, delivery fee model, minimum order, tax handling (confirm GST treatment of groceries and delivery with an accountant).
2. Payment provider and payout model (Stripe Connect vs alternatives): needs account-level verification.
3. Pilot delivery model: own drivers, vendor delivery, or third party; service radius.
4. Pilot stores and who supplies/approves the first catalogue data.
5. Hosting and backup policy.

## Exact next steps
1. Review M1; decide where this code should live (it is currently a subfolder of the `adf` repo).
2. M2: `carts`, `cart_items`, `addresses`, `delivery_zones`; cart endpoints re-price from `store_offers` on the server.
3. Choose the payment provider (blocks live mode of M3, not test mode).
