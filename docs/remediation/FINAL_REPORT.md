# Public-alpha release-candidate final verification

Date of verification: 2026-08-02  
Base commit: `140f122` (`docs: map project and deployment readiness`)  
Review branch: `release/public-alpha-rc1` (created after the review; see Git handoff)  
Release verdict: `local_rc_partially_verified`

This is a local public-alpha release candidate without real payments. It is not production-ready. PostgreSQL, object storage, Telegram WebView, and backup/restore validation remain required.

## Verified local evidence

| Check | Result | Evidence classification |
|---|---:|---|
| Root tests (`npm test`) | 201 passed, 0 skipped, 0 failed | verified by test |
| Server tests (`npm --prefix server test`) | 219 total: 163 passed, 56 skipped, 0 failed | SQLite/code verified; 54 PostgreSQL and 2 S3/MinIO cases skipped by environment |
| PostgreSQL suite (`npm --prefix server run test:postgres`) | 94 total: 40 passed, 54 skipped, 0 failed | SQLite portions ran; PostgreSQL runtime pending |
| Browser E2E (`npm run test:e2e`) | 114 total: 110 passed, 4 skipped | verified locally; skipped cases are desktop-only wheel scenarios |
| Server syntax check | 39 files passed | verified by `npm --prefix server run check` |
| Lint | exit 0; 89 warnings against a 100-warning budget | verified by lint; warning backlog remains |
| Production build | passed | verified by Vite build |
| Dependency audits | root and server: 0 vulnerabilities | verified by `npm audit --omit=dev` and server equivalent |
| Clean installs | root and server `npm ci` passed | verified locally |

## Claim-level verdicts

### Verified by code review and local tests

- Production defaults to `PAYMENTS_MODE=disabled`; real Telegram Stars are not connected. Internal credits are not described as Stars.
- Completion uses the server template and authoritative progress state. Client `resultDataUrl` is accepted only for compatibility/UI flow and is not persisted or used as the canonical result.
- Repeated completion is idempotent for the artwork and deterministic canonical media keys. Publication requires `render_status=ready`.
- Achievement grants are transactional and idempotent. The current rules include the style threshold at 3 and the completion threshold at 5; there is no unverified claim of a generic completion achievement at 3.
- The old production completion/simulate endpoint is absent from the route surface.
- IndexedDB journal writes are scoped by user/template, bounded, replayable, and awaited by `flushAndDispose()`. New snapshots are rejected after disposal. Queue and journal regression tests pass.
- Canonical artwork thumbnails are server-derived, bounded, and preferred by feed responses. New canonical artwork rows do not store new base64 preview data. Feed DTOs are bounded and cursor-based, with a joined query rather than per-row enrichment.
- Local media access rejects traversal, handles missing objects safely, validates supported image structure, and has a dry-run media sweep. Canonical full/thumbnail writes are deterministic and retry-safe.
- Likes, comments, message transitions, idempotency keys, quotas, pending-request limits, cursor pagination, and abuse counters are covered by code/SQLite tests. The abuse counter update is atomic at the SQL operation level.
- Complexity limits, worker cancellation/fallback paths, readiness, metrics, graceful shutdown, structured logs, backup/restore scripts, migration checksum handling, CI checks, ADRs, and runbooks are present and syntax/test checked where possible.

### Partially verified

- Failure recovery is retry-on-replay for deterministic completion/media keys; a durable render outbox/worker was not implemented and must not be inferred from the report.
- Original user-upload media creation still needs a production-level retry/idempotency review; canonical artwork media is the idempotent path.
- Image validation performs structural/decompression checks for supported formats and canonical PNG re-encoding. This is not a claim that every arbitrary JPEG/WebP is fully decoded and re-encoded by the server.
- SQLite concurrency and unit logic do not prove PostgreSQL locking, partial-index behavior, or multi-instance shared-store behavior.
- Browser tests cover the queue contract, but real Telegram/mobile `pagehide`, WebView suspension, proxy, and offline recovery are manual gates.

### Environment validation required

- PostgreSQL migration replay on a clean database and a copy of a prior schema; PostgreSQL concurrency/security suites.
- S3/MinIO write/read/delete, private-original lifecycle, bucket policy, missing-object behavior, media sweep, and CDN/proxy behavior.
- Telegram initData and real target WebView lifecycle over HTTPS.
- Backup checksum, disposable restore, integrity verification, and rollback drill.
- Production-like credentials, IAM, monitoring, proxy, and deployment configuration.

## Migrations 010-014

The five migrations exist in both PostgreSQL and SQLite trees. Local SQLite tests cover clean application, legacy upgrade, checksum enforcement, and rerun idempotence through `014`. Migration `010` has an idempotent PostgreSQL constraint guard. PostgreSQL runtime execution and lock-duration/data-copy rehearsal remain pending.

## Manual external validation

Use a disposable environment and keep credentials outside the repository. The following is the required pass; it was not run in this review:

```powershell
docker compose up -d postgres minio minio-init
$env:DATABASE_URL = 'postgresql://splint:splint_dev_password@localhost:5432/splint'
$env:STORAGE_DRIVER = 's3'
$env:S3_ENDPOINT = 'http://127.0.0.1:9000'
$env:S3_BUCKET = 'splint-originals'
$env:S3_ACCESS_KEY_ID = 'splint_minio'
$env:S3_SECRET_ACCESS_KEY = 'splint_minio_password'
npm.cmd --prefix server run storage:init
npm.cmd --prefix server run migrate:postgres
npm.cmd --prefix server run migrate:postgres
npm.cmd --prefix server run test:postgres
node --test server/test/media-storage-s3.integration.test.js
npm.cmd --prefix server run inventory:media
npm.cmd --prefix server run media:sweep
npm.cmd --prefix server run backup:postgres
```

For a restore rehearsal, use a disposable recovery database and an explicit confirmation:

```powershell
$env:CONFIRM_RESTORE = 'YES'
$env:BACKUP_FILE = '.\backups\splint-<timestamp>.dump'
npm.cmd --prefix server run restore:postgres
```

Verify the backup SHA-256 sidecar, `schema_migrations`, representative users/progress/artworks/posts, media inventory, `/ready`, authenticated smoke flows, and then run `docker compose down -v` only when the disposable environment may be destroyed. Do not use the restore command against a production database without an incident owner and recovery window.

## Rollback and workspace safety

- Roll back application code to the recorded base commit or a reviewed release-candidate commit; do not use destructive reset/clean commands on a working copy containing user data.
- Treat applied migrations as forward-only. Restore a database backup into a disposable target and verify integrity before traffic cutover.
- The pre-review patch and status snapshot were stored outside the repository and are intentionally not release artifacts.
- Never commit `.env` files, credentials, private keys, database files, uploads, MinIO data, traces, screenshots, videos, coverage, logs, build output, backup archives, or local test artifacts.

## Explicitly unresolved before public rollout

The allowed posture is: `Local public-alpha release candidate without real payments. PostgreSQL, object storage, Telegram WebView and restore validation remain required.` No tag, push, pull request, release, deployment, BotFather change, or production-secret change was performed.

