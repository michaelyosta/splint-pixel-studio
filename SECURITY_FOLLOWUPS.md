# Security Follow-ups

The following items are out of scope for the `security/backend-auth-hardening` PR and should be addressed in separate follow-up tasks:

1. **Stars transactions** — Ensure atomic balance transfers, prevent race conditions, add audit logging.
2. **Seed/reset of database** — Review seed data for security-sensitive defaults, ensure `resetDemoData` cannot be called in production.
3. **Report abuse** — Add rate limiting and deduplication for the report endpoint.
4. **Achievements validation** — Ensure achievements cannot be unlocked via direct API calls without actual progress.
5. **N+1 queries** — Optimise enrichment functions (e.g. `enrichPost`, `enrichComment`) to avoid repeated DB round-trips.
6. **Media-storage traversal** — Validate file keys to prevent path traversal attacks in `services/media-storage.js`.
7. **SQLite/Postgres sync** — Ensure all schema features (roles, CHECK constraints) work identically on both backends.
8. **Smart Coloring Engine** — Review rendering pipeline for potential injection vectors in user-uploaded images.
9. **UI animations** — No known security issues, but validate that animation libraries are up to date.
10. **Large `App.jsx` refactor** — Reduce attack surface by splitting monolith components.
11. **AWS SDK audit** — Run `npm audit fix` and review dependency tree for known CVEs.
