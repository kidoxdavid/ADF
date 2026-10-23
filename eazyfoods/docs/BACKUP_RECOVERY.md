# Backup and recovery

## What must be protected
PostgreSQL (all business data and the financial ledger) and the upload directory/bucket (product images; private vendor documents). The ledger and audit log are append-only: **never** restore a partial dump that drops them.

## Recommended setup
1. Use a managed PostgreSQL with **point-in-time recovery** (e.g. continuous WAL archiving) and daily snapshots retained for at least 30 days.
2. In addition, take a nightly logical dump to separate storage: `pg_dump --format=custom --file=eazyfoods-$(date +%F).dump "$DATABASE_URL"`. Encrypt it and keep copies in a second region/account.
3. Replicate uploads to a second bucket (versioning on). Private documents stay private.
4. Store `.env`/secrets in a secrets manager, not in the repository.

## Restore drill (do this before launch, then quarterly)
1. Create an empty database. `pg_restore --clean --if-exists --no-owner -d <new> eazyfoods.dump`.
2. Run `npm run migrate` (it is a no-op if the dump is current).
3. Start the API against the restored database with `DISABLE_BACKGROUND_JOBS=1`.
4. Verify: the ledger balances (`SELECT sum(amount_cents) FROM ledger_entries` is 0), order counts match, recent orders open, vendor documents download.
5. Record the time taken (your recovery time) and the age of the data (recovery point).

## Disaster scenarios
- **Bad deploy:** roll back the API/web; migrations are forward-only and additive, so the previous version keeps working. Write a new migration to fix forward.
- **Data corruption:** restore to a point in time into a *new* database, compare, then promote. Never edit the ledger; add reversing entries.
- **Provider outage:** checkout reports "payment unavailable" and releases the hold. Stores keep working. Expired holds are released by the background job.
