# Public-alpha migrations and backfill notes

Migrations `010`–`014` are additive and must be applied through the existing checksum-protected runner.

| Version | Purpose | Backfill/compatibility |
|---|---|---|
| 010 | artwork media metadata and render status | existing artwork URLs remain available as legacy metadata; new canonical completions populate storage metadata |
| 011 | progress batch idempotency | no existing progress is rewritten; batches begin at first new client save |
| 012 | message request deduplication and expiry index | existing messages are untouched; new creates require a durable key/fingerprint |
| 013 | shared abuse counters | empty at migration time; short-lived buckets are safe to expire |
| 014 | one active post per artwork | creates a partial unique index; verify no duplicate active publications before applying |

Do not edit an applied migration. Verify the migration table and run `server/scripts/inventory-media.mjs` after rollout. Any legacy data-URI artwork or missing object must be handled by an explicit inventory/backfill job; the server must not silently claim that an object exists.

## Independent review note (2026-08-02)

Clean SQLite application, legacy upgrade, checksum enforcement, and rerun behavior passed locally. PostgreSQL execution was not available. Migration `010` now uses an idempotent PostgreSQL constraint guard, but still requires a clean-database and prior-schema rehearsal before rollout.
