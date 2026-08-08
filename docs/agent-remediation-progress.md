# Agent remediation progress — codex/tiled-player-1200

Engineering log for the merge-readiness loop on commit
`8c8ebab92dcb86b2670ac0921d21ac340c5053ee`.

## Hypotheses (from audit)

- A. Completion/render critical path: tiled completion may render canonical
  PNG inside the user DB transaction (CPU-heavy sync work before commit).
- B. Completed GET progress: may re-read all tiles and regenerate thumbnail
  on every read.
- C. Visible tile cache invariant: LruTileCache may evict pinned visible
  tiles when all entries are pinned and limit is exceeded.
- D. Production diagnostics overhead: FPS/DOM/heap sampling may always run
  in production.
- E. Idempotency response parsing: replay path may mis-parse `response_json`
  and lose saved response/rewards.
- F. Scope/regression risk: huge commit; focus on tiled critical path only.

## Findings

### A. Completion/render critical path — CONFIRMED (P1)

- `processTiledProgressAction` (server/routes/colorings.js:848) calls
  `prepareTiledArtwork(tx, ...)` inside `withDbTransaction` on the fresh
  completion path.
- `prepareTiledArtwork` (colorings.js:772) reads all template tiles via
  `readTiledTemplateTiles(tx, ...)` and synchronously builds the canonical
  1200x1200 PNG (`renderCanonicalTiledPng` -> `deflateSync(level 9)` over
  5.76MB RGBA) plus the thumbnail inside the DB transaction.
- Media persistence happens after commit via `persistTiledArtworkMedia`, but
  still inside the HTTP completion request (colorings.js:1130-ish), so the
  client waits for media write as well.
- On idempotent replay of a completed batch, `prepareTiledArtwork` is called
  again inside the transaction, re-rendering the full PNG on every replay.
- SQLite transactions hold `BEGIN IMMEDIATE` (database/transaction.js:131),
  so the render blocks all other DB operations while the transaction is open.

### B. Completed GET progress — CONFIRMED (P1)

- `GET /colorings/:id/progress` (colorings.js:684) calls
  `loadTiledPreviewDataUrl` (colorings.js:836) for every completed tiled
  template. That function re-reads all 1444 template tiles and re-renders
  the thumbnail synchronously on every read.
- If the artwork row is missing, GET progress also runs
  `prepareTiledArtwork` inside a transaction plus `persistTiledArtworkMedia`
  in the read path.

### C. Visible tile cache invariant — CONFIRMED (P1)

- `LruTileCache.evictIfNeeded` (src/features/coloring/large-grid/tileCache.js)
  falls back to evicting the first entry when all entries are pinned and
  `entries.size > maxTiles`.
- At `MIN_ZOOM=0.08` a 390x844 viewport spans ~5x11 = 55 visible tiles, which
  exceeds `maxTiles=48`; every visible tile is pinned, so the fallback evicts
  pinned visible tiles.

### D. Production diagnostics overhead — CONFIRMED (P2)

- `ProgressiveColoringSession` runs a perpetual `requestAnimationFrame`
  sampler and calls `document.querySelectorAll('*')` every 500ms even when
  `VITE_SHOW_COLORING_DIAGNOSTICS` is not set (added to make the metrics
  harness work without the flag).

### E. Idempotency response parsing — CONFIRMED (P1)

- Both tiled and legacy replay paths parse `response_json` with
  `parseJsonArray`, which returns `null` for a JSON object.
- SQLite stores `response_json` as TEXT, so `JSON.parse` yields an object and
  `parseJsonArray` returns `null`; the stored response (including `rewards`)
  is lost on replay.
- PostgreSQL JSONB path works because `typeof === 'object'`.

### F. Scope — respected. Changes will stay within tiled critical path plus
the directly coupled completion/render/read/cache code.

## Rejected findings

- _None yet._

## Completed fixes

### A. Completion/render critical path — FIXED

- `server/routes/colorings.js`: replaced `prepareTiledArtwork` (which read
  all tiles and synchronously rendered PNG inside the DB transaction) with
  `createTiledArtworkMetadata`, which only upserts artwork metadata (pending)
  inside the transaction. The render outbox job is enqueued in the same
  transaction; the HTTP completion response returns immediately with
  `render_status: 'pending'` and `result_preview_data_url: null`.
- Removed `persistTiledArtworkMedia` (synchronous media write in the HTTP
  path) and the tile-re-reading preview; the worker (`render-outbox.js`)
  owns rendering and media persistence.

### B. Completed GET progress — FIXED

- `GET /colorings/:id/progress` no longer re-reads all template tiles or
  re-renders thumbnails. When the artwork is ready it reads the persisted
  thumbnail object (`readMediaObject`) and returns a bounded data URL; when
  artwork is missing it creates pending metadata + enqueues a job without
  rendering. A source-level regression test forbids tile reads/renders in the
  progress read path.

### C. Visible tile cache invariant — FIXED

- `LruTileCache.evictIfNeeded` no longer falls back to evicting pinned tiles;
  the cache may grow above `maxTiles` while the pinned set exceeds the limit
  and shrinks once pins are released. Regression test covers pinned > maxTiles.

### D. Production diagnostics overhead — FIXED

- The `requestAnimationFrame`/DOM/heap sampler in
  `ProgressiveColoringSession` now runs only when
  `VITE_SHOW_COLORING_DIAGNOSTICS=true` or `?splintMetrics=1` is present.
  Cheap metrics (`firstTileAt`, `commits`) stay always-on.

### E. Idempotency response parsing — FIXED

- Added `parseJsonObject` and used it in both tiled and legacy replay paths;
  SQLite replays now return the stored response including `rewards`.

## Tests run

- `node --test server/test/tiled-render-architecture.test.js` — 3/3 pass.
- `node --test server/test/coloring-chunks.integration.test.js` — pass.
- `node --test server/test/render-outbox-http.test.js` — 2/2 pass.
- `npm test` — 265/265 pass.
- `npm --prefix server test` — 213 pass / 0 fail / 65 skipped.
- `npm run lint` — 89/100 warnings; `npm run build` — green.
- e2e `tiled-completion` + `accessibility-1200` — 2/2 pass.
- `scripts/capture-tiled-device-metrics.mjs` — metrics captured with
  `?splintMetrics=1`: firstTile 805ms, interaction FPS 60, cache 48 tiles /
  196KB, DOM 138, heap 40MB, frame median 16.6ms / p95 18.1ms.
- Full Chromium e2e control (creator, session-goals, unlocks, accessibility,
  stabilization, accessibility-1200, tiled-completion) — 56 passed / 1 skip.
- Mobile Pixel: 1200x1200 + tiled-completion — 2/2 pass.
- Diagnostics-enabled 1200x1200 e2e — pass.
- `git diff --check` — clean.

## Remaining risks

- Legacy completion (<=160) still renders inside the DB transaction and
  writes media in the HTTP request; bounded (~25K cells) and not part of the
  tiled scope, documented as a known follow-up.
- Physical Telegram WebView measurements remain external.
