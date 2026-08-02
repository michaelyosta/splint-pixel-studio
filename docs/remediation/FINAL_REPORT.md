# Public-alpha release-candidate final verification

Date of verification: 2026-08-02
Base commit: `140f122` (`docs: map project and deployment readiness`)
Branch: `release/public-alpha-rc1`
External validation code commit: `dc609f2`
Final documentation commit: see the final `git log` handoff after this report update
Release verdict: `infrastructure_rc_partially_verified`

This is a local public-alpha release candidate without real payments. It is not production-ready. Disposable PostgreSQL, MinIO/S3, migration replay, concurrency, media sweep, backup/restore and readiness checks passed in this external pass. Telegram WebView, real Telegram Stars, production credentials, object-storage backup/restore, POSIX graceful signals and `/live` remain unresolved.

## Exact verification results

| Check | Result | Evidence classification |
|---|---:|---|
| Root tests (`npm test`) | 201 passed, 0 skipped, 0 failed | verified locally |
| Server aggregate (`npm --prefix server test`) | 219 total: 163 passed, 56 skipped, 0 failed | SQLite/local code gate; 54 PostgreSQL and 2 S3 cases are conditional in this command |
| PostgreSQL external suite (`npm --prefix server run test:postgres`) | 91 total: 91 passed, 0 skipped, 0 failed | verified against disposable PostgreSQL 16.14 |
| S3/MinIO integration | 2 passed, 0 skipped, 0 failed | verified against disposable MinIO |
| Browser E2E (`npm run test:e2e`) | 114 total: 110 passed, 4 skipped, 0 failed | verified locally; skips are expected desktop-only wheel scenarios |
| Server syntax check | 39 files passed | verified by `npm --prefix server run check` |
| Lint | exit 0; 89 warnings, 0 errors, budget 100 | verified; warning backlog remains |
| Production build | passed | verified by Vite build |
| Dependency audits | root and server: 0 vulnerabilities | verified by `npm audit --omit=dev` and server equivalent |
| Clean installs | root and server `npm ci` passed | verified locally |
| Backup/restore | passed in disposable PostgreSQL | 71,900-byte dump; SHA-256 `77dbd92713b8af0e6ede850df3139e16ed32acf7b983a200e9fdddc934ce2052`; restored `schema_migrations=14:014`, users=31 |

The earlier 4-failure result came from running the SQLite child-process aggregate with PG/S3 variables inherited. Those tests explicitly create temporary SQLite fixtures but do not clear inherited external driver variables. The canonical clean aggregate and the separate external suites above are the authoritative results.

## Claim-level verdicts

### Verified by code and tests

- Production defaults fail closed with `PAYMENTS_MODE=disabled`; real Telegram Stars are not connected and internal credits are not described as Stars.
- Canonical completion derives the final image from server template/progress state; client `resultDataUrl` is not authoritative or persisted as the canonical result.
- Repeated completion is idempotent for the artwork and deterministic canonical media keys. Publication requires `render_status=ready`.
- Achievement grants are transactional/idempotent; the verified thresholds are style at 3 and completion at 5.
- The production simulate-completion endpoint is absent.
- IndexedDB journal scope, compaction, replay, `flushAndDispose()` and shutdown snapshot rejection are covered by local tests; Telegram/mobile lifecycle remains manual.
- Canonical media is bounded and server-derived; feed payload smoke returned no base64 or private storage URLs, bounded the requested page to 30, and rejected malformed cursors.
- PostgreSQL CAS, payment/message idempotency, rollback, report concurrency, moderation audit, shared abuse-counter SQL behavior and migrations passed against disposable PostgreSQL.
- MinIO private-original lifecycle, canonical media write/read/delete idempotency, and explicit media sweep behavior passed against disposable MinIO.

### Partially verified or unresolved

- Recovery is deterministic retry-on-replay; there is no durable render outbox/worker and no claim of crash-safe outbox semantics.
- The feed route uses one bounded joined query by code review, but `feedQueryCount` is not populated and production query/latency budgets were not measured.
- Backup/restore was verified for the PostgreSQL database. S3 object backup/restore was not part of the drill.
- `/health`, `/ready` and `/metrics` were runtime-checked. `/ready` returned 503 when disposable MinIO was stopped. `/live` is not implemented and returned 404.
- Graceful shutdown code is present, but Windows child signal delivery terminated the probe before the handler log could be observed; validate SIGTERM/SIGINT in the target container/runtime.
- Real Telegram initData over HTTPS, Telegram WebView suspension/pagehide, production proxy, IAM, monitoring and credentials remain external gates.

## Migrations 010-014

The external run exercised the complete PostgreSQL chain `001`–`014`, including `010`–`014`. A clean run applied 14 migrations; the repeat run applied 0 and skipped 14. `schema_migrations` contained all versions through `014`; checksum, index, foreign-key/unique and render-status constraint checks passed through the PostgreSQL suite. The legacy/data-copy cases passed in the suite. Production-sized lock duration and a prior production schema copy remain staging work.

## External validation record

Detailed evidence, disposable reproduction commands and remaining gates are in [EXTERNAL_VALIDATION.md](EXTERNAL_VALIDATION.md). The external run used a separate Compose project and did not touch the existing local database, uploads, or user files.

## Rollback and workspace safety

- Roll back application code only to a reviewed release-candidate commit; do not use destructive reset, clean, checkout or restore commands on this working copy.
- Treat migrations as forward-only. Restore a backup into a disposable target and verify integrity before any traffic cutover.
- Never commit `.env` files, credentials, private keys, database files, uploads, MinIO data, traces, screenshots, videos, coverage, logs, build output, backup archives, patch snapshots, or local test artifacts.
- Intentionally outside the commits for owner review: `server/index.js`, `src/lib/imageCrop.js`, `src/lib/pixelColoring.js`, and the ignored local database `server/splint-preview-20260729.db.bin`.
- The pre-review patch/status snapshots are outside the repository and are not release artifacts.

## Explicitly unresolved before public rollout

Allowed posture: `Local public-alpha release candidate without real payments. PostgreSQL, object storage, Telegram WebView and restore validation remain required.` The external disposable PG/MinIO and PostgreSQL restore gates now have evidence, but this does not authorize a production rollout or a fully verified public release. No tag, push, pull request, release, deployment, BotFather change, Telegram Stars change, or production-secret change was performed.
