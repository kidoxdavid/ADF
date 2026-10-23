# Deployment

## Requirements
Node 20+, PostgreSQL 14+ (`pg_trgm`, `citext`; the migration creates them), a TLS-terminating proxy, a domain, and (for production) Stripe and an email provider.

## Environments
| | Development | Test | Production |
|---|---|---|---|
| Database | `eazyfoods_dev` | `eazyfoods_test` (dropped and rebuilt every test run; the runner refuses a name without "test") | managed Postgres with PITR |
| Payments | `mock` | `mock` | `stripe` (the API **refuses to boot** with `mock` in production) |
| Email | `log` | `log` | `resend` |
| Seed | `npm run seed` (test data only; refuses to run in production) | automatic | never |

## Configuration (all environment variables; `.env.example` has placeholders only)
`DATABASE_URL`, `WEB_ORIGIN` (the exact public site origin), `PORT`, `NODE_ENV=production`, `PAYMENT_PROVIDER`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PUBLISHABLE_KEY`, `EMAIL_TRANSPORT`, `RESEND_API_KEY`, `EMAIL_FROM`, `UPLOAD_DIR`, `SENTRY_DSN` (optional), `DISABLE_BACKGROUND_JOBS`.

## Steps
1. Build the web app: `npm run build` (outputs `apps/web/dist`). Serve it as static files with SPA fallback to `index.html`, and proxy `/api` and `/uploads` to the API (same origin keeps cookies simple).
2. Run migrations: `npm run migrate` (forward-only, transactional per file).
3. Start the API: `npm -w apps/api run start` (run under a process manager; one instance while uploads are on local disk).
4. Create the first **owner**: sign up in the app, then in the database `INSERT INTO user_roles(user_id, role) VALUES ('<user id>', 'owner');` (one time; afterwards manage roles in Admin > Settings). Do not run the seed in production.
5. In Admin: set commercial settings, create delivery zones (postal-code areas, fees, ETA), review draft policy pages, set the homepage content, create the first collections.
6. Configure the Stripe webhook to `https://<domain>/api/webhooks/payments` and complete the checklist in PAYMENTS.md.
7. Check Admin > System: database ok, integrations configured (payments must not say "MOCK"), no stale holds, outbox empty.

## Scaling notes
Background jobs run in-process (every 30 s); with several API instances they are safe (row-level locking and idempotent operations) but wasteful: run jobs in one instance by setting `DISABLE_BACKGROUND_JOBS=1` on the others. Move uploads to object storage before running more than one API instance.
