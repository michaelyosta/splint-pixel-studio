# Server-Authoritative Unlockable Content Checkpoint

Status: implemented end-to-end and covered by focused SQLite + PostgreSQL
tests. This slice owns the server side only; no client files were modified.

## Goal

Production-grade server-authoritative unlockable content and personalized
recommendations: durable unlock rules evaluated from facts the server already
owns (level/XP, achievements, streak, completed artworks/collections),
idempotent and concurrency-safe grants on SQLite and PostgreSQL, bounded API
payloads, locked-state enforcement on every read/start path, and explainable
bounded recommendations that work with legacy and tiled 1200x1200 history.

## Data Model (migration 020)

Both `server/migrations/020_unlockable_content.sql` and
`server/migrations/sqlite/020_unlockable_content.sql` add:

- `unlock_rules(subject_type, subject_id, rule_type, target_value, rule_order,
  created_at)` with a primary key over
  `(subject_type, subject_id, rule_type, target_value)`.
- `template_entitlements(user_id, template_id, source, granted_at)` with a
  primary key over `(user_id, template_id)`; this is the concurrency guard for
  template grants.

Collections continue to use the existing `collection_ownerships` primary key
as the single entitlement table, so paid, free, legacy, and progression
ownership never diverge.

Rule types: `level`, `xp`, `achievement`, `streak` (uses
`daily_streaks.longest_streak` so unlocks stay durable), `completed_artworks`,
and `collection_completion`.

## Unlock Semantics

States are stable and distinguishable:

- `available`: free/public content with no unmet gate; startable now.
- `owned`: materialized entitlement (`collection_ownerships` or
  `template_entitlements`) or template owner.
- `progression_locked`: one or more rules are unmet; requirements and progress
  are returned.
- `premium_locked`: the template's collection is `pack_type='premium'` and not
  owned. Progression can never grant this state.

Evaluation is deterministic and read-only. Grants are lazy/backfill-safe:
when rules are satisfied, the first access materializes the entitlement inside
the caller's transaction (`INSERT ... ON CONFLICT DO NOTHING`), and replay or a
concurrent first unlock is a no-op.

## API Contract

New authenticated routes:

- `GET /unlocks/me`: bounded snapshot with `progression_facts`, per-subject
  state/requirements, summary counts, and up to 3 `next_actionable` unlocks
  ranked by unmet rules then progress ratio.
- `GET /unlocks/collections/:id` and `GET /unlocks/templates/:id`: one
  subject's state, stable `reason_code`, and requirements/progress.
- `GET /colorings/recommendations?limit=8`: bounded personalized list with
  `reason_code` (`CONTINUE_PROGRESS`, `THEME_AFFINITY`, `COLLECTION_AFFINITY`,
  `DIFFICULTY_MATCH`, `DAILY_FEATURED`, `COLD_START`) and `signals`.

Stable reason codes: `CONTENT_AVAILABLE`, `CONTENT_OWNED`,
`PROGRESSION_REQUIRED`, `PREMIUM_REQUIRED`, `UNLOCK_READY`, `LEVEL_REQUIRED`,
`XP_REQUIRED`, `ACHIEVEMENT_REQUIRED`, `STREAK_REQUIRED`,
`COMPLETIONS_REQUIRED`, `COLLECTION_REQUIRED`.

Existing endpoints keep their contracts. Legacy `GET /colorings`, `/today`,
and `/meta/daily-challenge` exclude `source_type='unlockable'` content, so the
editorial catalog and daily challenge never surface gated content. Locked
reads return `403` with the stable code on `GET /colorings/:id`, `/manifest`,
`/tiles|chunks/:x/:y`, `/zones`, `/progress`, `/result`, `PUT
/:id/favorite`, `POST /:id/progress/actions`, and
`/meta/collections/:id/templates`.

## Seed Metadata

`server/db.js` bootstraps durable unlockable content (idempotent upserts):

- `col_starter-path` (free): level 2 + 1 completed artwork.
- `col_premium-gallery` (premium, 120 stars): purchase-only, no progression
  rules.
- `col_master-gallery` (free): requires completing `col_starter-path`.
- `color_streak_badge`: streak 3.

## Recommendations

`server/services/recommendations.js` uses one bounded history query (legacy
progress, tiled progress, completed artworks; deduped by template) and one
bounded candidate query (max 200 rows, no cell arrays). Ranking is additive
and deterministic; cold start is stable per user via a template/user hash.
Completed, hidden, own, `premium_locked`, and unmet `progression_locked`
templates are excluded by default.

## Concurrency Proof

- SQLite: `server/test/unlock-service.test.js` runs two parallel
  `withTransaction` first unlocks and asserts exactly one ownership and one
  entitlement row.
- PostgreSQL: `server/test/postgres-unlocks.test.js` runs the same test
  against a real pool (two parallel transactions, one materialized row each)
  plus a concurrent premium test asserting zero rows are ever granted. It
  uses the existing `DATABASE_URL` skip convention and is wired into
  `npm run test:postgres`.

## Tests and Verification

New tests:

- `server/test/unlock-service.test.js`: 6 tests covering all rule types and
  boundaries, premium separation, lazy backfill, replay, SQLite concurrency,
  snapshot/next-actionable ordering, batch flags, and collection enforcement.
- `server/test/recommendations.test.js`: 4 tests for cold start, personalization,
  legacy/tiled dedupe, locked/hidden/completed exclusion, and 1200x1200
  bounded payloads.
- `server/test/unlocks-http.test.js`: 5 tests for auth, direct-ID bypass,
  premium purchase separation, concurrent first unlock over HTTP, tiled
  recommendations, and catalog/daily-challenge isolation.
- `server/test/postgres-unlocks.test.js`: 2 real-PostgreSQL concurrency tests.

Updated tests: migration counts moved 001-019 -> 001-020 in
`server/test/database.test.js` and `server/test/postgres-database.test.js`,
including legacy-DB upgrade counts and checksum idempotency.

Verification on this workspace:

- `npm --prefix server test`: 272 tests, 208 passed, 64 skipped
  (environment-gated PostgreSQL), 0 failed.
- `npm --prefix server run check`: syntax check passed for 53 server files.
- `npm --prefix server run test:postgres`: wiring executes; PostgreSQL cases
  self-skip locally without `DATABASE_URL` (62 skipped, 0 failed).
- Root `npm run lint`: warning budget 89/100 (no new warnings).
- Root `npm run build`: passes.

## Remaining External Gates

- PostgreSQL unlock tests must run in CI/staging with `DATABASE_URL`; they
  self-skip locally by the repo convention.
- Premium purchase of `col_premium-gallery` requires a non-disabled
  `PAYMENTS_MODE`; production defaults to `disabled` until Telegram Stars is
  configured.
- Unlockable content is intentionally surfaced through `/unlocks` and
  `/colorings/recommendations` rather than the legacy editorial catalog to
  keep existing catalog clients byte-compatible; this is a product decision
  that can be revisited by adding unlock flags to the catalog later.
