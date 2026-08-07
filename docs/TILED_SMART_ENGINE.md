# Tiled Smart Engine

## Old Problem

The legacy coloring engine had global knowledge: it could find the best next
window, pick a rewarding color, move the camera there, and automatically
continue after the window was complete. The tiled 1200x1200 player lost that
behavior. Its `TileGuideIndex` knew only loaded/cached tiles, so a player had
to choose a number, find that number on an enormous map, pan around, watch the
minimap, and decide where to go next.

The player also treated a loaded-cache zero as a global color completion:

```js
guideIndex.snapshot(selectedColor).remaining === 0
```

That is a correctness bug. A color can be absent from every currently loaded
tile while still having thousands of cells elsewhere in a 1200x1200 grid.

## Why Loaded-Only Guidance Is Not Enough

Client guidance cannot be global without materializing the full grid, which is
exactly what the bounded tiled architecture forbids. A 1200x1200 map has
1,440,000 cells. The client cache is limited to a few dozen 32x32 tiles. Any
planner built from the cache is blind outside the viewport and goes stale the
moment an LRU tile is evicted.

The fix is server-assisted global guidance: a compact navigation index on the
server, a bounded plan endpoint, and a client state machine that applies plans
without ever loading the full grid.

## Architecture

### Compact Global Index

Static counts are built once when a tiled template is created:

- `coloring_template_color_counts(template_id, color_index, total_count)`
- `coloring_template_tile_color_counts(template_id, tile_x, tile_y, color_index, total_count)`

Progress counters are updated only for tiles/colors touched by a paint batch:

- `coloring_tiled_progress_colors(user_id, template_id, color_index, remaining_count)`
- `coloring_tiled_progress_tile_colors(user_id, template_id, tile_x, tile_y, color_index, remaining_count)`

A missing progress row means the static count is still fully remaining. A zero
row stays explicit so a fully painted color can never be misread as "still
fully remaining". Worst case this is tens of thousands of integer rows, not
1.44 million cells, and the planner never scans `filled_json` of every tile.

### Guidance API

`GET /colorings/:id/guidance` returns a bounded plan:

```json
{
  "schema_version": 1,
  "template_id": "tpl_...",
  "progress_revision": 7,
  "mode": "auto",
  "reason": "SAME_COLOR_NEXT",
  "selected_color": 2,
  "global_remaining_for_color": 1234,
  "next_color": null,
  "color_complete": false,
  "artwork_complete": false,
  "target": {
    "tile_x": 3,
    "tile_y": 5,
    "anchor_x": 104,
    "anchor_y": 172,
    "bounds": { "min_x": 96, "min_y": 160, "max_x": 107, "max_y": 171, "width": 12, "height": 12 },
    "estimated_cells": 37,
    "color": 2
  }
}
```

Reasons: `INITIAL_TARGET`, `SAME_COLOR_NEXT`, `COLOR_COMPLETE`,
`MANUAL_COLOR`, `RETURN_TO_TARGET`, `ARTWORK_COMPLETE`,
`NO_ACTIONABLE_CELLS`.

The planner reads:

- per-color totals (a few dozen rows),
- candidate tiles for the selected color (bounded index rows),
- at most one actual tile (1024 cells) to choose a dense 12x12 actionable
  window whose anchor is an unfilled cell of the selected color.

No full-grid arrays are ever returned. The client normalizer rejects any
payload that leaks `cells`/`filled`.

## Client State Machine

```
idle -> focusing -> ready -> (target painted) -> success -> SAME_COLOR_NEXT -> focusing
                         -> manual pan/zoom -> freeExploration -> RETURN_TO_TARGET -> focusing
ready/color -> COLOR_COMPLETE (server-confirmed global zero) -> next color -> focusing
```

- `idle`: waiting for manifest.
- `focusing`: camera transition to the server target.
- `ready`: target is actionable; user paints.
- `freeExploration`: manual navigation pauses automatic camera movement.
- `color-complete`: server confirmed `global_remaining_for_color === 0`.
- `artwork-complete`: no remaining cells anywhere.

After the active window is painted, the client waits a short controlled delay
for success feedback and then requests `SAME_COLOR_NEXT`. No "next" button is
required. If the color is globally finished, the server returns
`COLOR_COMPLETE` with a rewarding next color and target.

Manual pan, wheel zoom, pinch zoom, minimap taps, zone jumps and the overview
button switch to free exploration. A visible "return to target" control asks
the server for `RETURN_TO_TARGET` and restores the smart route.

Palette selection is still meaningful: `MANUAL_COLOR` asks the server to find
the selected color globally, even when no tile of that color is cached.

## Progress Revision

Guidance is a derived hint, never the source of truth. Every plan carries
`progress_revision`. The client tracks the last committed revision from the
progress contract and ignores/replans any guidance computed against an older
revision. Progress and rewards remain server-authoritative through
`POST /colorings/:id/progress/actions`.

## Performance Bounds

- Client: no `template.cells`/`progress.filled` full-grid arrays, no full-grid
  BFS, no full-tile preload for navigation.
- Guidance payload: bounded object with one target.
- One planning action: reads compact totals/candidates plus at most one actual
  tile.
- Static counts are created once at template creation; legacy templates
  (created before migration 021) are backfilled by an idempotent, restartable
  maintenance command (`npm --prefix server run backfill:guidance`), a
  throttled background job at server startup, or — as a bounded safety net —
  inside the first guidance transaction for that template. Completion is
  tracked by `coloring_template_guidance_index_meta`; a missing marker makes
  the build delete + rebuild, so an interrupted build is always repaired and
  a template without tiles returns an explicit `GUIDANCE_INDEX_MISSING`
  diagnostic instead of pretending the artwork is complete.
- LRU/cache guarantees are unchanged; guidance never depends on cache
  residency. The client caps viewport tile loads to the cache bound even at
  overview zoom, so a 1200×1200 map never floods the server with 1444
  requests on camera reset.

## UX Invariants

1. Opening a new 1200x1200 map lands on a good small task without palette or
   minimap interaction.
2. The selected color is auto-chosen and the camera focuses a paintable zoom.
3. Completing a target auto-advances to the next target.
4. "Color N is ready" is only shown for server-confirmed global completion.
5. Manual navigation pauses automatic camera control; "return to target"
   restores it.
6. Manual color selection searches globally, including outside the cache.

## Tests

- `test/smartRoute.test.js`: bounded payload normalization, stale revision,
  true global completion, camera planning, target completion counting.
- `server/test/tiled-guidance.test.js`: initial autopilot, global discovery,
  same-color advance, true color completion + next color, manual color,
  cache-eviction independence.
- `e2e/guided-player.spec.js`: 1200x1200 open -> auto focus -> paint ->
  auto transition -> manual pan stays free -> return to target restores smart
  route; verifies bounded client state and metadata-only responses.

## Remaining Risks

- The planner reads one candidate tile per planning action; pathological maps
  where candidates race with concurrent devices may need one extra retry.
- The one-time per-template index build inside the first guidance transaction
  costs ~300 ms for a 1200×1200 template and blocks the sqlite scheduler for
  that window; the startup backfill job normally eliminates this path before
  a user opens an old template.
- E2E uses a generated striped 1200x1200 template; real artwork density can
  change which target is selected but not the state machine behavior.
- `e2e/accessibility-1200.spec.js` needs a 120s budget on slow emulated
  mobile projects (creator-from-image flow); the smart-engine reopen assertion
  has headroom after that fix.
