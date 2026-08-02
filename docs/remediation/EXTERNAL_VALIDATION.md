# External infrastructure validation

Date: 2026-08-02
Branch: `release/public-alpha-rc1`
Base review commit: `140f1226f62dbbd220de2b255268564e9df8910d`
Pre-pass HEAD: `7e65ea401ae3e853a9d9baf338dc40f443ad61aa`
Verdict: `operational_rc_verified_except_telegram`

This pass used only disposable PostgreSQL and MinIO resources. No production credentials, Telegram configuration, remote storage, deployment, push, tag, or release action was used. It does not claim production readiness.

## Runtime gates completed

| Gate | Result | Evidence | Remaining risk |
|---|---|---|---|
| PostgreSQL migrations | PASS | Clean run: 14 applied, 0 skipped. Repeat run: 0 applied, 14 skipped. `schema_migrations` and representative constraints/indexes were checked. | Production-sized lock duration, topology, and data-volume rehearsal remain required. |
| PostgreSQL logic/concurrency | PASS | `npm --prefix server run test:postgres`: 91 passed, 0 skipped, 0 failed against disposable PostgreSQL 16.14. | Multi-instance scale, replicas, and production workload remain untested. |
| MinIO/S3 media lifecycle | PASS | S3 integration: 2 passed, 0 skipped. Private-original lifecycle and canonical media write/read/delete idempotency passed. | Production IAM, policy, network faults, CDN/proxy, and retention remain untested. |
| Media inventory/sweep | PASS | Disposable orphan was detected in dry-run, removed only with explicit confirmation, and absent on repeat dry-run. | This is cleanup tooling, not a durable render outbox. |
| Feed/media recovery smoke | PASS | Restored database plus restored bucket returned `/live` 200, `/ready` 200, feed 200, thumbnail media 200, and a 68-byte PNG response. No base64/private storage URL was returned. | Production latency/query budgets and CDN behavior remain unmeasured. |
| PostgreSQL backup/restore | PASS | Container-local equivalent `pg_dump`/`pg_restore`: 63,633 bytes; SHA-256 `cc094d82f72c8b5e81a1df08551e10f90000844dbf390d545b8cb2b7bd6f964b`. Recovery verified schema migrations=14, template=1, artwork=1, post=1. | Host binary path and production backup retention/offsite policy remain environment-dependent. |
| S3 object backup | PASS | Manifest archive contained 4 objects and 221 bytes; archive verification passed. Manifest SHA-256: `1bc10f54c24a08d37408909ef433a6a16d92e9b749850b3ceb873ae6ccf51416`. | Production encryption, IAM, offsite retention, and lifecycle policy remain unverified. |
| S3 object restore | PASS | Dry-run and apply completed into a separate recovery bucket; every object was read back and checked by byte count/SHA-256. A second apply also returned `verified=true`, `idempotent=true`. | Destination-only objects are intentionally not deleted; reconciliation policy needs owner approval. |
| Liveness/readiness | PASS | `/live` returned exact `{ "status": "alive" }`; `/ready` returned 200 in the recovery smoke. | Reverse proxy and orchestrator routing remain external checks. |
| Graceful shutdown | PASS | POSIX Node 22 container harness observed SIGTERM, exit `{code:0, signal:null}`, shutdown JSON with `forced:false`, and empty stderr. | Target production runtime still needs the manual Telegram/container deployment check. |

## Implementation findings fixed in this pass

- Added `/live` and kept it available during shutdown drain; added an integration regression test.
- Added a POSIX-only liveness/readiness/SIGTERM harness. Windows explicitly reports that POSIX signal validation is unavailable rather than claiming a pass.
- Added manifest/checksum based S3 object backup, archive verification, dry-run restore, explicit apply confirmation, per-object read-back checks, and repeat-apply coverage.
- Fixed media reads/deletes and public URLs for canonical plain S3 keys. The recovery smoke previously exposed a 404 for these keys; the regression test now covers the configured-bucket resolution.
- Added release-CI steps for the POSIX harness and a disposable MinIO object backup/restore roundtrip.

## Not runtime-verified

- Telegram WebView/mobile lifecycle, real `initData` over HTTPS, page suspension/pagehide, proxy behavior, and any real Telegram Stars flow.
- Production credentials, IAM, monitoring, CDN, deployment, backup retention, encryption, and offsite replication.
- Production-scale lock duration, latency, multi-instance behavior, and crash/restart recovery of a durable render outbox. The current completion recovery is deterministic retry-on-replay, not a claim of a durable render outbox.

## Reproduction commands

Use disposable values only; keep credentials in the process environment and never commit them:

```powershell
docker compose -p <rc-project> up -d postgres minio minio-init
$env:DATABASE_URL = 'postgresql://<disposable-user>:<disposable-password>@127.0.0.1:<pg-port>/<disposable-db>'
$env:STORAGE_DRIVER = 's3'
$env:S3_ENDPOINT = 'http://127.0.0.1:<minio-port>'
$env:S3_BUCKET = '<disposable-source-bucket>'
$env:S3_ACCESS_KEY_ID = '<disposable-access-key>'
$env:S3_SECRET_ACCESS_KEY = '<disposable-secret-key>'
npm.cmd --prefix server run storage:init
npm.cmd --prefix server run migrate:postgres
npm.cmd --prefix server run migrate:postgres
npm.cmd --prefix server run test:postgres
node --test server/test/media-storage-s3.integration.test.js
npm.cmd --prefix server run inventory:media
npm.cmd --prefix server run media:sweep -- --dry-run
$env:OBJECT_BACKUP_DIR = '<external-object-backup-directory>'
npm.cmd --prefix server run backup:objects -- --dry-run
npm.cmd --prefix server run backup:objects -- --apply
npm.cmd --prefix server run verify:object-backup
$env:RESTORE_S3_ENDPOINT = $env:S3_ENDPOINT
$env:RESTORE_S3_BUCKET = '<disposable-recovery-bucket>'
$env:RESTORE_S3_ACCESS_KEY_ID = $env:S3_ACCESS_KEY_ID
$env:RESTORE_S3_SECRET_ACCESS_KEY = $env:S3_SECRET_ACCESS_KEY
npm.cmd --prefix server run restore:objects -- --dry-run
$env:CONFIRM_OBJECT_RESTORE = 'YES'
npm.cmd --prefix server run restore:objects -- --apply
npm.cmd --prefix server run check
node server/scripts/graceful-shutdown-posix.mjs
docker compose -p <rc-project> down -v
```

Before destruction, verify the Compose project name and volume names are disposable. Do not use these commands against production databases or buckets. For the Telegram/manual portion, follow [TELEGRAM_WEBVIEW_VALIDATION.md](TELEGRAM_WEBVIEW_VALIDATION.md).
