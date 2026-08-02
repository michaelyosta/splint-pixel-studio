# External infrastructure validation

Date: 2026-08-02
Branch: `release/public-alpha-rc1`
Base review commit: `140f122`
Code validation commit: `dc609f2` (`fix(concurrency): align PostgreSQL replay and CAS regression cases`)
Verdict: `infrastructure_rc_partially_verified`

This pass used only disposable PostgreSQL and MinIO resources. No production credentials, Telegram configuration, remote storage, deployment, push, tag, or release action was used.

## Runtime gates completed

| Gate | Result | Evidence | Remaining risk |
|---|---|---|---|
| PostgreSQL migrations | PASS | Clean run: 14 applied, 0 skipped. Repeat run: 0 applied, 14 skipped. `schema_migrations` contains `001`–`014`; checksum and representative indexes/constraints were present. | Lock duration and a production-sized data copy still require staging rehearsal. |
| PostgreSQL logic/concurrency | PASS | `npm --prefix server run test:postgres`: 91 tests, 91 passed, 0 skipped, 0 failed. Includes CAS, HTTP progress conflicts, payment idempotency, concurrent purchases, report concurrency, rollback and production-security tests. | Multi-instance and production-scale load were not tested. |
| MinIO/S3 lifecycle | PASS | `media-storage-s3.integration.test.js`: 2 passed, 0 skipped. Private original lifecycle and deterministic canonical media idempotency passed. | Production IAM, bucket policy, CDN/proxy and network failure behavior remain untested. |
| Media sweep | PASS | Disposable orphan was detected by dry-run, removed only with explicit confirmation, and absent on the repeat dry-run. Existing local uploads were inventory-read only and not changed. | The sweep is not a durable render outbox. |
| Feed payload smoke | PASS | Disposable PG/S3 server returned 200 for `limit=100` with 3 bounded items, no `data:image`, `s3://`, or `local://` values; malformed cursor returned 400. | Query count/latency budget is code-reviewed, not measured by a runtime query counter; the `feedQueryCount` metric is not populated. |
| Backup/restore | PASS | Disposable custom-format dump: 71,900 bytes; SHA-256 `77dbd92713b8af0e6ede850df3139e16ed32acf7b983a200e9fdddc934ce2052`. Restore into a separate database succeeded; `schema_migrations` verified as `14:014`, representative users count 31. | Object storage backup/restore and a production remote-backup target were not tested. |
| Readiness | PASS | Healthy `/health` 200, `/ready` 200 with database/object storage `ok`; with disposable MinIO stopped, `/ready` returned 503 and object storage `error`; `/metrics` returned 200. | `/live` is not implemented and returned 404. |
| Graceful shutdown | PARTIAL | Handler, readiness drain state, connection close and DB close are present in the working-tree `server/index.js`. | Windows child-process signal delivery terminated the probe before the Node handler log could be observed; POSIX/container signal validation remains required. |

## Test separation

The canonical local server aggregate was rerun without external variables: 219 total, 163 passed, 56 expected environment-conditional skips, 0 failed. The SQLite child-process integration tests create temporary SQLite paths but inherit process-level `DATABASE_URL`/S3 settings; running that suite with PG/S3 variables caused incompatible fixture assumptions. It is not used as the PG gate. The PG and S3 gates above were run separately with the disposable services and passed.

## Migrations and disposable infrastructure

The external run exercised migrations `010`–`014` together with the complete migration chain `001`–`014`, on a clean disposable PostgreSQL database and on a second run. The database service was PostgreSQL 16.14. MinIO was provisioned in a separate disposable Compose project and bucket; existing local database files, uploads, and user files were not touched.

The backup drill used an equivalent container-local `pg_dump`/`pg_restore` path because host PostgreSQL client binaries were not available. The repository backup and restore scripts pass syntax checks, but their host-binary invocation remains environment-dependent.

## Not runtime-verified

- Telegram WebView/mobile lifecycle, real `initData` over HTTPS, page suspension/pagehide, proxy behavior, and Telegram Stars.
- Production credentials, production IAM, production monitoring, CDN, and deployment.
- POSIX/container graceful signal delivery and a `/live` liveness contract.
- Durable render outbox/crash recovery; completion/media recovery is deterministic retry-on-replay.
- S3 object backup/restore as part of a coordinated database recovery drill.

## Reproduction commands

Use disposable values only; keep them in the process environment and never commit them:

```powershell
docker compose -p <rc-project> up -d postgres minio minio-init
$env:DATABASE_URL = 'postgresql://<disposable-user>:<disposable-password>@127.0.0.1:<pg-port>/<disposable-db>'
$env:STORAGE_DRIVER = 's3'
$env:S3_ENDPOINT = 'http://127.0.0.1:<minio-port>'
$env:S3_BUCKET = '<disposable-bucket>'
$env:S3_ACCESS_KEY_ID = '<disposable-access-key>'
$env:S3_SECRET_ACCESS_KEY = '<disposable-secret-key>'
npm.cmd --prefix server run storage:init
npm.cmd --prefix server run migrate:postgres
npm.cmd --prefix server run migrate:postgres
npm.cmd --prefix server run test:postgres
node --test server/test/media-storage-s3.integration.test.js
npm.cmd --prefix server run media:sweep -- --dry-run
npm.cmd --prefix server run backup:postgres
$env:CONFIRM_RESTORE = 'YES'
$env:BACKUP_FILE = '<disposable-backup-file>'
npm.cmd --prefix server run restore:postgres
npm.cmd --prefix server run check
docker compose -p <rc-project> down -v
```

Before destruction, verify the Compose project name and volume names are disposable. Do not use these commands against production databases or buckets.
