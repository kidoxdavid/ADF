# Project status

_Last updated: 2026-10-23 · Branch `build/eazyfoods-full`_

## Verified today (run, not assumed)
| Check | Result |
|---|---|
| API integration tests (real Postgres) | **68 passed** |
| Browser end-to-end + quality suite (real Chromium, real API/DB) | **23 passed**: 12 cross-role journeys, no horizontal overflow at 360/390/768/1280 px on every public, signed-in and portal page, axe WCAG 2 A/AA: no serious/critical violations (light, dark, portals) |
| `tsc` (api + web), production web build | clean |
| `npm audit --omit=dev` | 0 vulnerabilities |

Journeys covered end to end in the browser: find a store by region; search by alternative name; basket; validated checkout; **declined payment leaves no paid order**; successful signed payment; vendor accepts/ready; dispatcher assigns; driver delivers with the handover code (wrong code refused); customer review; support requests + finance approves a refund with the ledger netting to zero; vendor price edit shows on storefront; stale basket cannot buy sold-out stock; role/ownership access control; admin verifies and approves a vendor.

## Built
Customer: regional discovery, search (typo + verified aliases), catalogue, stores, basket (guest merge), checkout (delivery/pickup, zones, fees, GST, coupons, multi-store disclosure), payment step, order tracking and timeline, substitutions, cancellation, issue reports, reviews, reorder, favourites, recipes-to-basket, account (addresses, consent, export, deletion), password reset, email verification, policy pages.
Vendor portal: onboarding checklist and documents, store profile/hours, orders workflow, inventory with audit history, CSV import (check-only first), product suggestions, promotions, ads, dashboard, settlement report/CSV, support.
Admin: vendors/documents/approval, stores, catalogue moderation + aliases, taxonomy, collections, delivery zones, orders, refunds (request vs approve split), dispatch, drivers, support, coupons, ads review, content/templates/recipes, CRM, finance (payouts, ledger), KPIs, settings (validated, audited), roles, audit log, system health.
Driver portal: application, availability, jobs, pickup, code-confirmed delivery, issue/failure reporting, history, earnings.
Platform: double-entry ledger enforced by the database, stock reservations, idempotent verified webhooks, background jobs (hold expiry, silent-store auto-reject, email outbox), first-party analytics and error log, CI workflow.

## Not done / known gaps (honest list)
- **Stripe is unverified.** The adapter and Stripe Payment Element code are written but have never been run against Stripe (no credentials). Only the dev mock provider has been exercised. Follow `docs/PAYMENTS.md` before any live money. Vendor Connect onboarding is manual (an admin enters the `acct_` id).
- **No real photography.** Real product/store photos must come from stores; UI shows initial tiles until then. Upload pipeline works and is validated.
- **All stores, prices, stock, aliases and recipes in the seed are invented** (labelled "Demo store"; recipes are labelled unreviewed AI-assisted drafts). Aliases need review by someone with domain knowledge. The seeded Calgary FSA list and fees are development defaults.
- **Legal pages are drafts** (privacy, terms, vendor agreement) marked as needing legal review. No legal, tax or privacy compliance is claimed. Product tax classes must be verified by an accountant.
- Payment-processing fees are not imported, so "net marketplace revenue" overstates margin (stated in the KPI definition).
- Email is log-only unless `RESEND_API_KEY` is set (the Resend call is unverified). No SMS.
- Local-disk uploads (single API instance only); no malware scanning; no 2FA for staff; no automated data-retention enforcement.
- The live site https://eazyfoods.ca and the old repository were not reviewed (not reachable / out of scope).
- Axe covers automated WCAG checks only; no manual screen-reader pass. Not tested on real iOS/Android devices.
- Not built (by design, see PRD): live GPS, referrals/loyalty, marketing automation, guest checkout, scheduled orders, weight-based final billing.
- Browser tests run against the dev server with the mock payment provider; there is no staging environment yet.

## Configuration required
`DATABASE_URL`, `WEB_ORIGIN`. For launch: `PAYMENT_PROVIDER=stripe` + Stripe keys, `EMAIL_TRANSPORT=resend` + key, object storage, `SENTRY_DSN` (optional). See `docs/DEPLOYMENT.md`.

## Decisions awaiting you
See `docs/DECISIONS.md`: commission 12%, delivery $5.99/store, driver pay $4.50, GST handling, payout hold, payment provider, driver status, legal review, pilot stores.

## Exact next steps
1. Approve/adjust commercial defaults (DECISIONS.md).
2. Open Stripe test account; run the PAYMENTS.md checklist; fix whatever the first real run reveals.
3. Recruit the 3-5 pilot stores (LAUNCH_PLAN.md); load real catalogues and photos; verify aliases and tax classes.
4. Legal and accountant review; complete LAUNCH_CHECKLIST.md.
5. Stand up staging with managed Postgres, run the e2e suite there, rehearse backup restore.
