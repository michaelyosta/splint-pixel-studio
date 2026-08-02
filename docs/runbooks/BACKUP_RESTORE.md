# Backup and restore runbook

## Release-candidate validation order

Run only against disposable services and keep credentials outside Git. This sequence was prepared during the local review but was not executed because Docker/PostgreSQL/S3 credentials were unavailable:

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
```

The second migration run must apply zero migrations. The inventory is read-only; the media sweep defaults to `--dry-run`. Use `--apply` only after reviewing candidates and setting `CONFIRM_MEDIA_SWEEP=YES`.

## Pre-release backup

```bash
npm --prefix server run backup:postgres
```

The command requires `DATABASE_URL`, writes a timestamped custom `pg_dump` and a SHA-256 sidecar. Copy both outside the application host. For media, run an S3/MinIO inventory and sync to a separately protected location; do not use an unreviewed `--delete` restore.

## Restore rehearsal

```bash
CONFIRM_RESTORE=YES DATABASE_URL="$RECOVERY_DATABASE_URL" \
  BACKUP_FILE="./backups/splint-<timestamp>.dump" \
  npm --prefix server run restore:postgres
```

Restore only into a disposable recovery database unless an incident owner has approved a production recovery window. Verify `schema_migrations`, users, progress, artworks, posts, ledger tables and media inventory before switching traffic.

Verify the `.sha256` sidecar before restore, restore only into a disposable recovery database, run authenticated smoke checks and `/ready`, and compare representative object checksums. `docker compose down -v` destroys the disposable database and MinIO volume; use it only after the rehearsal is complete and the data is explicitly disposable.

## Incident recovery

1. Stop writes or place the app in maintenance mode.
2. Preserve current logs/database state for investigation.
3. Restore database and media into separate recovery targets.
4. Compare counts, checksums and representative objects.
5. Record the recovered SHA, migration versions, backup checksum and owner approval.
6. Switch traffic only after `/ready` and authenticated smoke checks pass.
