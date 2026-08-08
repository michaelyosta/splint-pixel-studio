# Public-alpha release-candidate final verification

## Validation pass addendum — 2026-08-03

- Initial and final HEAD: `7246358dd4fc958f8780ff24a7f8c1b617979e79`; new commits: none.
- Working tree protection remained intact: `src/lib/imageCrop.js` and `src/lib/pixelColoring.js` were not changed by this pass; local DB/uploads were preserved.
- HTTPS smoke used an ephemeral Cloudflare Quick Tunnel to the frontend ingress. Frontend, `/api/live`, and `/api/ready` returned successfully. The temporary hostname is intentionally omitted from repository documentation.
- The browser session was not Telegram: `window.Telegram?.WebApp` was absent, `initData` was not present, and the UI identified itself as `LOCAL`. Therefore no real Telegram authentication or device lifecycle claim is made.
- Local browser smoke passed catalog load, 32×32 canvas paint, and reload restoration under development auth. This is synthetic/local evidence only.
- Root tests: 201 passed. Server aggregate: 223 total, 167 passed, 56 skipped, 0 failed after removing a stale orphan test server on fixed port 32001. Server syntax: 44 files passed. Lint: 89 warnings, 0 errors, within the 100-warning budget. Build and clean installs passed.
- PostgreSQL/MinIO disposable gates were blocked because Docker Desktop was unavailable. Without those services, `test:postgres` reported 40 passed and 54 environment skips; S3 integration reported 0 passed and 2 skips.
- E2E: 109 passed, 4 skipped, 1 failed in the full 114-test run. The only failure was Mobile iPhone stabilization case 13b; its isolated rerun passed 1/1 in 8.8s, so no source fix was justified.
- Current verdict: `telegram_rc_partially_verified`. Operational subtype: `operational_rc_verified_except_telegram`. Release blockers remain the real Telegram launch/initData, physical Android/iOS validation, mobile lifecycle/offline replay, and disposable PostgreSQL/MinIO evidence.

Date of verification: 2026-08-02
Base commit: `140f1226f62dbbd220de2b255268564e9df8910d`
Pre-pass HEAD: `7e65ea401ae3e853a9d9baf338dc40f443ad61aa`
Branch: `release/public-alpha-rc1`
Final commit: the final documentation commit containing this report; authoritative SHA is recorded by the final `git rev-parse HEAD` handoff.
Release verdict: `operational_rc_verified_except_telegram`

This is a local public-alpha release candidate without real payments. It is not production-ready. PostgreSQL, disposable object storage, database/object restore, liveness, and POSIX shutdown now have evidence. Telegram WebView/mobile lifecycle, real Telegram Stars, production credentials/IAM/retention, and target deployment behavior remain required external gates.

## Exact verification results

| Check | Result | Evidence classification |
|---|---:|---|
| Root tests (`npm test`) | 201 passed, 0 skipped, 0 failed | verified locally |
| Server aggregate (`npm --prefix server test`) | 223 total: 167 passed, 56 skipped, 0 failed | SQLite/local gate; skips are environment-conditional PostgreSQL/S3 cases |
| PostgreSQL external suite (`npm --prefix server run test:postgres`) | 91 passed, 0 skipped, 0 failed | verified against disposable PostgreSQL 16.14 |
| S3/MinIO integration | 2 passed, 0 skipped, 0 failed | verified against disposable MinIO |
| Browser E2E (`npm run test:e2e`) | 114 total: 110 passed, 4 skipped, 0 failed | local Chromium; four expected desktop-only/mobile-profile skips |
| Server syntax check | 44 files passed | verified by `npm --prefix server run check` |
| Lint | exit 0; 89 warnings, 0 errors, budget 100 | verified; pre-existing warning backlog remains |
| Production build | passed | verified by Vite build |
| Dependency audits | root and server: 0 vulnerabilities | verified by both `npm audit --omit=dev` commands |
| Clean installs | root and server `npm ci` passed | lockfiles consistent |
| POSIX liveness/shutdown | passed in Node 22 Linux container; Windows host run explicitly skips | `/live` 200, `/ready` 200, SIGTERM exit 0, shutdown `forced:false` |
| Object backup/restore | 4 objects, 221 bytes; archive and repeated restore verified | manifest SHA-256 `1bc10f54c24a08d37408909ef433a6a16d92e9b749850b3ceb873ae6ccf51416` |
| Database backup/restore | passed; 63,633-byte custom-format dump | SHA-256 `cc094d82f72c8b5e81a1df08551e10f90000844dbf390d545b8cb2b7bd6f964b` |

The server aggregate had one initial startup-timeout under concurrent Windows process load; the isolated API integration test and the immediate repeat of the full aggregate passed. No test was skipped or loosened to hide that observation.

## Claim-level verdicts

### Verified by code and tests

- Production defaults fail closed with `PAYMENTS_MODE=disabled`; real Telegram Stars are not connected and internal credits are not represented as Stars.
- Canonical completion derives the final image from server template/progress state; client `resultDataUrl` is not authoritative or persisted as the canonical result.
- Repeated completion is idempotent for the artwork and deterministic canonical media keys. Publication requires `render_status=ready`; production simulate-completion is absent.
- Achievement grants are transactional/idempotent; the verified thresholds are style at 3 and completion at 5.
- IndexedDB journal scope, compaction/limits, replay, `flushAndDispose()`, shutdown rejection, and client batch idempotency are locally covered. Actual Telegram/mobile suspension remains manual.
- Feed DTOs are bounded and cursor-paginated; payload smoke returned no base64 or private storage URL. Canonical thumbnails are used for feed media.
- PostgreSQL CAS, message/payment/report concurrency, rollback, moderation audit, shared abuse SQL behavior, and migrations 001–014 passed against disposable PostgreSQL.
- S3 media write/read/delete idempotency, malformed-image decode limits, media inventory/sweep, object manifest checksum, archive verification, additive restore, and repeated restore passed against disposable MinIO.
- `/live` is dependency-independent and remains available during shutdown drain. POSIX SIGTERM was observed as a graceful exit with structured shutdown log and no stderr stack.

### Partially verified or environment-dependent

- Completion recovery is deterministic retry-on-replay; there is no durable render outbox or claim of crash-safe worker semantics.
- Feed query count and production latency budgets are code-reviewed but not measured against production-scale data; the `feedQueryCount` metric is not populated.
- Database and object restore were coordinated against disposable targets. Production retention, encryption, IAM, offsite replication, CDN, and host `pg_dump` availability remain environment gates.
- Telegram `initData` over real HTTPS, iOS/Android WebView pagehide/background behavior, proxy routing, and device-specific save/reload require the manual package in [TELEGRAM_WEBVIEW_VALIDATION.md](TELEGRAM_WEBVIEW_VALIDATION.md).

## Migrations 010–014

The disposable PostgreSQL run exercised the complete chain `001`–`014`, including `010`, `011`, `012`, `013`, and `014`. A clean run applied 14 migrations; a repeat applied 0 and skipped 14. Schema checksums, representative foreign keys/unique constraints/indexes, legacy/data-copy paths, and schema-dependent tests passed. Production-sized lock duration and a prior production schema copy remain staging work.

## Release gates and CI

The release workflow installs root/server dependencies, runs root/server/PG tests, migration replay, lint, build, E2E, media inventory/sweep, POSIX shutdown, disposable object backup/restore, backup-script syntax checks, audits, and tracked-artifact hygiene. No production secret is required by these disposable gates. The workflow is triggered only by manual dispatch or an explicitly created `v*` tag; no tag was created in this pass.

## Manual validation commands

Use only disposable values and keep them in the process environment:

```bash
npm ci
npm --prefix server ci
npm test
npm --prefix server run check
npm --prefix server test
npm run lint
npm run build
npm run test:e2e
npm --prefix server run migrate:postgres
npm --prefix server run test:postgres
node --test server/test/media-storage-s3.integration.test.js
node server/scripts/graceful-shutdown-posix.mjs
npm --prefix server run backup:objects -- --dry-run
npm --prefix server run backup:objects -- --apply
npm --prefix server run verify:object-backup
npm --prefix server run restore:objects -- --dry-run
CONFIRM_OBJECT_RESTORE=YES npm --prefix server run restore:objects -- --apply
CONFIRM_OBJECT_RESTORE=YES npm --prefix server run restore:objects -- --apply
```

For disposable infrastructure, use `docker compose up -d postgres minio minio-init`, run the migration and storage commands from [EXTERNAL_VALIDATION.md](EXTERNAL_VALIDATION.md), then destroy only the verified disposable Compose project. For Telegram/WebView use [TELEGRAM_WEBVIEW_VALIDATION.md](TELEGRAM_WEBVIEW_VALIDATION.md); do not record `initData`, tokens, cookies, auth headers, or personal messages.

## Rollback and workspace safety

- Roll back application code only to a reviewed RC commit. Do not use destructive reset/clean/checkout/restore commands on this working copy.
- Treat migrations as forward-only. Restore database and objects into separate disposable recovery targets, verify schema/counts/checksums, then obtain owner approval before any traffic switch.
- Object restore is additive and intentionally does not delete destination-only objects. Review reconciliation before using it for an incident.
- Never commit `.env` files, credentials, private keys, database files, uploads, MinIO data, traces, screenshots, videos, coverage, logs, build output, backup archives, patch snapshots, or local test artifacts.

Intentionally outside commits for owner review/protection: `src/lib/imageCrop.js`, `src/lib/pixelColoring.js`, `server/splint-preview-20260729.db.bin`, `server/uploads/`, and the external pre-review patch/status snapshots. The local database and uploads were inventory-read only and preserved.

No tag, push, pull request, release, deployment, BotFather change, Telegram Stars change, or production-secret change was performed.
