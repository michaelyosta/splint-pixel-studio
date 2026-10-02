# Backup and restore runbook

Status: CANONICAL
Authority: Independent protection and isolated recovery of database and media.
Navigation: [../INDEX.md](../INDEX.md) · Live facts: [../CURRENT_STATE.md](../CURRENT_STATE.md)

## Protection and ownership

The operator owns backup coverage, retention and restoration. A provider replica,
an existing script, an old snapshot or a green readiness check is not proof of
independent current protection. Inspect Neon history/snapshots and actual R2 copies.
Keep archives outside Git and the ephemeral application host on approved encrypted
storage with restrictive access. On Windows verify the containing directory ACL.
Database dumps and object manifests contain private user data and media keys;
never upload them to public CI artifacts, issue attachments or documentation.

Operational acceptance target: an independent recovery point no older than 24 hours,
at least seven daily points, and a monthly isolated rehearsal. These are targets,
not a configured schedule or measured RPO/RTO. Record actual provider windows,
copies and recovery measurements in CURRENT_STATE and dated evidence.

## PostgreSQL backup

Use a direct endpoint and compatible pg_dump/pg_restore versions. Load DATABASE_URL
privately through existing operator configuration; do not print credentials.

    npm --prefix server run backup:postgres

BACKUP_DIR selects the protected destination. Keep the custom dump, SHA-256 sidecar
and metadata together. Metadata stores an opaque source fingerprint. A partial dump
is not published as a completed archive. The client uses a temporary restricted
pgpass file; credentials are excluded from argv and application secrets from its env.

## PostgreSQL recovery

Choose a separately identified recovery database and confirm it in the dashboard.
Set RESTORE_DATABASE_URL to recovery and BACKUP_FILE to the protected dump.
DATABASE_URL remains the source; it is never an implicit restore destination.
Legacy archives without metadata also require SOURCE_DATABASE_URL or source DATABASE_URL.

    CONFIRM_RESTORE=YES npm --prefix server run restore:postgres

Checksum and source isolation are verified before connecting, including common
Neon pooled/direct aliases. Restore uses one transaction and stops at the first
error. Do not edit metadata to bypass the guard or restore over the active target.
Source provider ACL grants are not applied: cloud roles may not exist on recovery.
The recovery operator owns the restored objects and must configure least-privilege
database access separately before a traffic cutover; application entitlements and
user records are preserved.
Compare migration versions and aggregate users/progress/artworks/ownership/ledger
counts; verify representative data without publishing rows. Check auth, saved
progress and canonical media on recovery targets before an approved cutover.

## R2/object backup and recovery

Load existing source S3 configuration privately. Set OBJECT_BACKUP_DIR to protected
storage outside the repository. Dry-run inventories; only apply creates the archive.

    npm --prefix server run backup:objects -- --dry-run
    npm --prefix server run backup:objects -- --apply
    npm --prefix server run verify:object-backup

The manifest and every object's bytes/checksum are verified. Logs expose only
aggregates and failure classes. Configure RESTORE_S3_ENDPOINT, RESTORE_S3_BUCKET
and recovery credentials for an isolated target; legacy archives need source
S3_ENDPOINT to identify their bucket. New archives store an opaque fingerprint.

    npm --prefix server run restore:objects -- --dry-run
    CONFIRM_OBJECT_RESTORE=YES npm --prefix server run restore:objects -- --apply

Restore rejects source targets before connection, verifies uploaded size/SHA-256
and preserves destination-only objects. Repeat for idempotency evidence. Compare
database-referenced media before cutover; DB/media snapshots are not one transaction.

## Continuous verification and incident recovery

The CI PostgreSQL job tests a current-schema archive, isolated restore and repeat.
The release-candidate S3 gate uses pinned LocalStack on localhost. The old MinIO
image was retired upstream. Synthetic rehearsals prove tooling, not production copies.
During incidents preserve source state, choose a recovery point, restore to separate
targets and verify before approved cutover. Never reset production, sweep media,
delete copies or alter ownership/ledger to make a restore appear successful.

## Technical contract migration

OLD: PostgreSQL restore used DATABASE_URL as destination without enforced checksum
or source rejection. NEW: explicit RESTORE_DATABASE_URL, pre-connect checksum and
isolation checks, transactional restore; object recovery also rejects its source.
Recovery also excludes source-owner/ACL grants for portability to a separate host.
WHY: operator mistakes must not overwrite active data or restore corruption.
TESTED: postgres-backup-safety.test.js, object-backup-manifest.test.js, disposable
PostgreSQL/S3 rehearsals and CI recovery. UNCHANGED: production data/schema, painting,
ownership, payments/refunds/gates and provider topology.
