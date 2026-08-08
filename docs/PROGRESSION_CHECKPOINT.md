# Server Game Progression Checkpoint

Status: implemented and covered by focused server tests.

## Goal

Server game progression is internally consistent, concurrency-safe, and
functionally identical for legacy and tiled 1200x1200 maps. Achievements,
streaks, XP, and daily/weekly challenges are all derived from server-verified
game events, never from client counters.

## Concurrency Semantics

- `server/services/progression-achievements.js` owns streaks and achievement
  grants. Every write is an atomic UPSERT or CAS:
  - `unlockAchievement` uses `INSERT ... ON CONFLICT (user_id, achievement_id)
    DO NOTHING`, so concurrent grants collapse to one row.
  - `touchDailyStreak` uses `INSERT ... ON CONFLICT (user_id) DO NOTHING` plus
    a conditional `UPDATE ... WHERE last_active_date=?` CAS loop. A losing
    transaction retries against the new row instead of double counting a day.
  - Daily and weekly challenge progress use `INSERT ... ON CONFLICT DO UPDATE`
    with clamped `CASE` expressions that are valid in both SQLite and
    PostgreSQL. Completion is then claimed with `UPDATE ... WHERE
    completed_at IS NULL`; XP is additionally deduplicated by the existing
    `user_xp_events (user_id, dedupe_key)` unique constraint.
- Painting XP stays cell-atomic through `user_template_xp_cells`; weekly and
  daily progress only consume newly claimed cells, so undo/repaint/replay
  cannot farm progress or rewards.
- All helpers require the caller's transaction. The route completion
  transactions pass `tx` explicitly and never fall back to global writes.

## Achievement Rules

All nine seeded achievement IDs are preserved and reachable:

- `ach_first_pixel`: first server-validated non-erase paint.
- `ach_first_zone`: first completed artwork (legacy and tiled).
- `ach_daily_3` / `ach_daily_7`: server streak reaches 3 / 7 consecutive UTC
  days; granted inside `touchDailyStreak`.
- `ach_style_night` / `ach_style_forest` / `ach_style_space`: third completed
  artwork in the matching theme group, counted from `artworks` joined to the
  authoritative template theme.
- `ach_collector`: collection membership via `collection_ownerships`, or any
  completed artwork with a `collection_id`. The completion path only counts a
  server-created artwork, so there is no client claim.
- `ach_complete_5`: fifth completed artwork, counted from `artworks`.

The `ach_first_zone` seed description was tightened to "Завершите первую
раскраску." so the text matches the server rule; the ID and all other seeds
are unchanged.

## `/colorings/mine`

The query now joins both `coloring_progress` and `coloring_tiled_progress`, so
tiled-progress-only templates appear. Tiled rows keep the bounded
`tiledProgressPayload` (revision, completed/total cells, percent, no `filled`
array), and `parseTemplate` never materializes a legacy row-major map for
tiled storage. The 1200x1200 `/mine` response stays under 100 KB.

## Migration 020

Migration 020 now adds the server-authoritative unlockable-content schema
(`unlock_rules` and `template_entitlements`) in both SQLite and PostgreSQL
trees. Progression unlocks stay deterministic and idempotent via primary-key
grants, and premium collections remain purchase-only. The daily-challenge
assignment excludes gated/unlockable content so a frozen challenge is always
startable. See `docs/UNLOCKS_CHECKPOINT.md` for the full contract, tests, and
remaining external gates.

## Tests

- `server/test/progression.test.js`: deterministic grant paths for all nine
  achievements, negative non-grant cases, undo/repaint/replay XP guards, tiled
  daily/weekly upsert behavior, and SQLite concurrent first streak/achievement/
  weekly writes.
- `server/test/progression-http.test.js`: legacy/tiled achievement parity,
  `/mine` tiled inclusion with a bounded 1200x1200 payload, and HTTP
  replay/undo/parallel anti-farm assertions.
- `server/test/postgres-progression.test.js`: real PostgreSQL concurrent
  streak/achievement/weekly/daily semantics; self-skips without
  `DATABASE_URL` and is part of `npm run test:postgres`.

Full verification on this workspace:

- Server aggregate: `npm --prefix server run check` passes.
- Server suite: 254 tests, 193 passed, 61 skipped (environment-gated), 0
  failures.
- PostgreSQL suite: self-skipped locally without `DATABASE_URL`; the new
  PostgreSQL progression file is wired into `test:postgres` for real runs.
- Lint warning budget: 89/100 (no new warnings).
- Production build: `npm run build` passes.

## Remaining Risks

- The PostgreSQL progression suite was authored against real pool semantics
  but self-skipped in this workspace because `DATABASE_URL` is absent; it must
  run in CI/staging against PostgreSQL before release.
- `ach_first_zone` now means first completed artwork rather than a literal
  zone-progress threshold; this keeps legacy/tiled behavior identical and is
  documented in the seed description.
