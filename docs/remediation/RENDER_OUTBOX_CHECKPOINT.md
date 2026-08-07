# Canonical Render Outbox Checkpoint

Status: implemented and covered by focused server tests.

## Goal

A coloring completion can no longer be stranded in `pending`/`failed` when the
process dies or object storage is unavailable after the database commit. Every
completion transaction now enqueues a durable render job in the same
transaction that creates or marks the artwork complete.

## Schema (migration 019)

`render_outbox` is added in both migration trees:

- `server/migrations/019_render_outbox.sql` (PostgreSQL)
- `server/migrations/sqlite/019_render_outbox.sql` (SQLite)

The table has an explicit state machine: `pending`, `processing`, `retry`,
`ready`, `dead`. It also records `attempt_count`, `max_attempts`,
`next_attempt_at`, `lease_owner`, `lease_expires_at`, `last_error`, and
timestamps. `artwork_id` is unique, which makes the job identity deterministic
and prevents duplicate jobs across idempotent replay or concurrent completion.

## Service

`server/services/render-outbox.js` owns the lifecycle:

- `enqueueRenderJob(tx, ...)` runs inside the completion transaction and is
  deduplicated by `artwork_id`.
- `claimRenderJobs(db, ...)` claims a bounded batch. PostgreSQL multi-instance
  workers are protected by a conditional update; SQLite serializes through the
  existing `BEGIN IMMEDIATE` scheduler. Expired processing leases are
  reclaimable, active leases are never stolen.
- `processRenderJob(db, job)` builds the canonical plan from DB state, writes
  the full image and thumbnail, and throws on the first failed write. Tiled
  plans use bounded tile rows only and never assemble a full 1200x1200 filled
  array.
- `completeRenderJob` marks job and artwork `ready` in one transaction, only
  after both media objects were written.
- `failRenderJob` schedules bounded exponential retry or `dead` after the final
  attempt, and leaves `last_error` for diagnostics.
- `retryRenderJob` resets a `dead` job to `pending` for manual recovery.
- `markArtworkAndJobReady` lets the existing synchronous best-effort completion
  path mark a successfully written job ready without becoming the only recovery
  mechanism.

## Integration

- `server/routes/colorings.js` enqueues jobs for legacy completion, tiled
  completion, and the tiled progress-read recovery path. The synchronous media
  write stays in place for UX; failures still return `MEDIA_RETRY_REQUIRED` and
  the durable job remains for the worker.
- `POST /colorings/:id/render/retry` manually requeues a dead job for the
  artwork owner.
- `server/index.js` runs a bounded, `unref()`ed poller. It is enabled by
  default in production and opt-in in development:
  `RENDER_OUTBOX_ENABLED=true`, `RENDER_OUTBOX_POLL_MS`,
  `RENDER_OUTBOX_BATCH_SIZE`.

## Tests

- `server/test/render-outbox.test.js`: enqueue dedupe, one-of-two concurrent
  claim, lease recovery, backoff/dead transitions, successful two-object write
  then ready, and a tiled 1200 plan that contains no full filled array.
- `server/test/render-outbox-http.test.js`: legacy and tiled HTTP flows force a
  media outage after completion, verify the durable job exists, restore
  storage, drain the worker, and verify the artwork becomes ready and
  publishable.
- `server/test/postgres-render-outbox.test.js`: PostgreSQL claim concurrency
  and lease-reclaim semantics; skips without `DATABASE_URL`.
- Migration count assertions in `server/test/database.test.js` and
  `server/test/postgres-database.test.js` were updated for migration 019.

## Operations

Inspect stuck jobs:

```sql
SELECT artwork_id, status, attempt_count, max_attempts, next_attempt_at,
       lease_owner, lease_expires_at, last_error
FROM render_outbox
WHERE status <> 'ready'
ORDER BY updated_at DESC;
```

Manually requeue a dead job with `POST /colorings/:id/render/retry` (owner
only), or reset it directly as a database operator.

## Remaining Risks

- Pre-existing completed artworks that were already `pending`/`failed` before
  migration 019 do not automatically get an outbox row. New completions are
  safe because enqueue and completion commit together; a one-time ops backfill
  should enqueue rows for those older artworks if any remain.
- PostgreSQL semantics were authored and exercised through the existing harness
  as a self-skipping test; a real `DATABASE_URL` run is still required in CI or
  staging before production deployment.
- S3 outages that exhaust the retry budget surface as `dead` and require manual
  retry; this is intentional so permanent failures stay visible instead of
  spinning forever.
