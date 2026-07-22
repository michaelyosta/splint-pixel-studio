# Security Follow-ups

The following items are out of scope for completed PRs and should be addressed in separate follow-up tasks:

1. ~~**Stars transactions**~~ — DONE in PR #5 `security/stars-transactions`. Atomic balance transfers, conditional debit, append-only immutable ledger, idempotency-key contract, collection ownership backfill, concurrent test coverage on both SQLite and PostgreSQL.
2. ~~**Seed/reset of database**~~ — DONE in PR #3 `security/database-safety-foundation`. Demo seed requires explicit action, production reset is blocked.
3. **Report abuse** — Add rate limiting and deduplication for the report endpoint.
4. **Achievements validation** — Ensure achievements cannot be unlocked via direct API calls without actual progress.
5. **N+1 queries** — Optimise enrichment functions (e.g. `enrichPost`, `enrichComment`) to avoid repeated DB round-trips.
6. **Media-storage traversal** — Validate file keys to prevent path traversal attacks in `services/media-storage.js`.
7. ~~**SQLite/Postgres sync**~~ — DONE in PR #3. Migration runner ensures same logical schema, backend-specific migrations with separate checksums.
8. **Smart Coloring Engine** — Review rendering pipeline for potential injection vectors in user-uploaded images.
9. **UI animations** — No known security issues, but validate that animation libraries are up to date.
10. **Large `App.jsx` refactor** — Reduce attack surface by splitting monolith components.
11. **AWS SDK audit** — Run `npm audit fix` and review dependency tree for known CVEs.
12. ~~**Database runtime integrity**~~ — DONE in PR #4 `security/database-runtime-integrity`. Unified SQLite scheduler, AsyncLocalStorage transaction context, optimistic locking for progress, CAS semantics, client 409 handling. This is the required foundation for Stars transactions.
