# EAZyfoods

A multi-vendor marketplace for African groceries, launching with independent African grocers in Calgary, Alberta.
Built from scratch as a TypeScript modular monolith: Fastify API + PostgreSQL + React (Vite).

See [PROJECT_STATUS.md](PROJECT_STATUS.md) for what works today and what is next, and
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for decisions, data model and commercial rules.

## Requirements
Node 20+, PostgreSQL 14+ (needs the `pg_trgm` and `citext` extensions, shipped with `postgresql-contrib`).

## Setup
```bash
npm install
createdb eazyfoods_dev && createdb eazyfoods_test
cp apps/api/.env.example apps/api/.env      # set DATABASE_URL
npm run migrate                               # apply SQL migrations
npm run seed                                  # DEV-ONLY demo data (refuses to run in production)
npm run dev:api                               # http://localhost:4000
npm run dev:web                               # http://localhost:5173 (proxies /api)
```

Seeded dev logins (password `dev-password-123`, `example.test` addresses, never for production):
`admin@`, `customer@`, `owner1@`, `owner2@`, `owner3@example.test`.

## Tests
```bash
npm test            # API integration tests against a real Postgres (TEST_DATABASE_URL, default eazyfoods_test)
npm run typecheck
npm run build
```
The test database is **dropped and recreated** on every run; the runner refuses any database name not containing `test`.

## Layout
```
apps/api/migrations   versioned SQL migrations (forward-only)
apps/api/src/routes   auth, catalogue, search, stores, vendor, admin
apps/api/test         integration tests (search, auth, authorization, inventory integrity)
apps/web              customer storefront (React + Vite)
```
