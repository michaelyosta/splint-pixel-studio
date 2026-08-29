# Tiled player UX checkpoint

Status: ready for physical-device validation. All locally runnable gates
pass; the remaining step is measuring the tiled player in a real Telegram
WebView on mobile hardware.

## Problem

A 1200x1200 map opened in the tiled player was technically paint-ready, but
the experience made painting look broken:

- The initial camera parked at overview zoom (0.08), where a cell is ~2.5 px,
  numbers are hidden, and a painted cell is invisible.
- Zone jumps only panned; the camera never zoomed to a paintable scale, so
  every zone looked like the same tiny overview.
- Tapping with the default palette color almost never matched the tapped
  cell, and the rejection was invisible at overview zoom.
- There was no smart guidance: no highlight of the selected color's cells, no
  visible count, and no way to advance to the next area with that color.
- The creator recomputed a 1200x1200 map on the main thread in WebViews
  without Worker support, freezing the UI while the slider moved.

## Changes

### Adaptive zones and overview performance

- Zone counts are adaptive: a 1200x1200 map gets 4x4 = 16 zones instead of
  6, so each zone shows roughly a quarter as many cells at once. 400-899
  maps get 3x3 = 9 zones, 200-399 get 2x3 = 6, and smaller maps keep 2x3.
- Zone jumps zoom to `WORK_ZOOM = 1` (32 px cells) so the user lands on a
  comfortably tappable scale instead of a dense overview.
- The overview renderer no longer draws every visible cell: below a 5 px cell
  size it draws the preview image at high alpha plus only painted-cell
  overlays. At working zoom it still draws cells, numbers, and guide outlines.
- The smart guide moved from a per-frame scan of every loaded tile to an
  incremental `TileGuideIndex`: tile summaries are built once per tile load,
  refreshed only on paint, and removed on cache eviction. Pan, zoom, and
  paint no longer rescan tens of thousands of loaded cells.
- The 16-button zone grid was replaced by a draggable minimap: it renders the
  preview image, painted-cell overlays, and zone boundaries on a small
  canvas. Dragging the white viewport rectangle pans the camera, and tapping
  any other point jumps there at a tappable working scale. Zone shortcuts
  (1-9) and the "Дальше" guide button remain available.
- A one-finger navigation mode ("Режим перемещения" button in the canvas
  controls) lets a single touch drag pan the canvas without painting. The
  minimap viewport indicator is clamped to a visible 14px minimum so it
  stays draggable even when the real viewport is a tiny fraction of a
  1200x1200 map.
- Successful strokes now fire a light haptic impact in both the tiled and
  classic engines. When the selected colour has no remaining cells in the
  loaded area, the tiled player shows a green "Цвет N готов" chip, fires a
  success haptic, and announces the milestone, so the moment of finishing a
  colour is felt and seen immediately.
- The tiled player persists the camera centre and zoom per template
  (debounced, in localStorage). Reopening a large coloring resumes exactly
  where the player left off instead of parking at the overview.
- Finishing a colour no longer leaves the player idle: after the "Цвет N
  готов" chip, it auto-jumps to the next zone with cells of that colour, or
  auto-selects the next colour with remaining loaded cells. The chip now
  also names the next step ("дальше зона N" or "дальше цвет N"), so the
  player always knows what happens next.
- Large legacy rows (width or height > 160) now route through the same tiled
  player and chunked save queue instead of the smart engine. The routing
  predicate lives in `src/lib/tileGrid.js` (`isLargeGridTemplate`), so a
  pre-tiled row can never reach the whole-grid smart path that froze on
  1.44M cells.

### Tiled player

- `jumpToZone` now zooms to a working scale (`WORK_ZOOM = 0.5`, ~16 px cells)
  instead of clamping to the overview, and centers on the zone's first
  unfilled cell of the selected color when one is loaded.
- A bounded smart guide counts unfilled cells of the selected color across
  loaded tiles only (`computeLoadedGuide` in
  `src/features/coloring/large-grid/guide.js`), shows a chip
  ("Цвет N В· видно M"), and highlights those cells on the canvas with a cyan
  outline.
- The guide's "Дальше" advances to the next zone that still has cells of the
  selected color; when none remain in loaded fragments it offers "Сменить
  цвет" and auto-selects the color with the most visible unfilled cells.
- Selecting a color moves the camera only when the user is at overview or the
  active zone has no cells of that color, so the camera does not yank away
  from active work.
- Wrong-color taps now show a visible chip ("Эта клетка относится к цвету N"),
  fire a haptic error, and announce the required color.
- Stroke cells in not-yet-loaded tiles are queued and painted once the tile
  arrives, instead of being silently dropped.
- Canvas drawing now culls tiles outside the viewport before painting, so pan
  and zoom redraws touch only visible tiles.

### Creator main-thread fallback

- `buildColoringFromImage` accepts `yieldEvery` and uses chunked async
  variants of the heavy loops (`sampleGridColorsAsync`,
  `edgeAwareSmoothColorsAsync`, `smoothCellsAsync`,
  `cleanUpSmallRegionsAsync`, `mapColorsToPaletteAsync`), yielding to the
  main thread every N rows. The Worker path keeps the synchronous hot loops.
- The no-Worker fallback in `App.jsx` passes `yieldEvery` to the pipeline,
  uses `createTiledTemplateAsync` for the tile conversion, and
  `assessQualityAsync` for quality scoring, so a 1200x1200 recompute no
  longer blocks the UI for seconds.
- Sync exports used by tests (`cleanUpSmallRegions`, `sampleGridColors`,
  `edgeAwareSmoothColors`, `createTiledTemplate`, `assessQuality`) are
  unchanged.

## Verification

- Root tests: 263 passed, including the new `TileGuideIndex` incremental
  count/eviction/reveal coverage in `test/guide.test.js`.
- Production build passes; lint 0 errors, 90 warnings (budget 100).
- E2E `accessibility-1200.spec.js` passes on Chromium with new assertions:
  zone jump zoom >= 0.4 and the guide chip visible with an integer remaining
  count.
- E2E `accessibility-1200.spec.js` now also verifies touch paint through
  CDP touch events: a real tap commits the cell, POSTs `/progress/actions`,
  and the server tile returns the painted color.
- E2E also verifies minimap navigation: a tap at 92%/92% of the minimap
  moves the camera and lands at zoom >= 1, and the minimap exposes
  `data-zone-count`/`data-active-zone` plus one canvas per surface (main
  field and minimap).
- E2E also verifies one-finger navigation: with the mode enabled, a touch
  drag changes the camera position, and disabling it restores painting.
- E2E also verifies camera persistence: after panning, reopening the
  coloring through the deep link restores the same world centre and zoom
  (within one cell).
- A new tiled-completion E2E verifies the full UI finish path: a completed
  tiled template opens the player and immediately shows the completion
  dialog with "Опубликовать" and "Сохранить результат". The 1200x1200
  completion/render/publication chain itself stays covered by the server
  chunk contract integration test.
- E2E zone visual evidence captures 16 zones at 390 px with zoom 1.0 and no
  horizontal overflow: `docs/evidence/zones-16-390.png`.
- The 1200x1200 player gate passes on Chromium and the Mobile Pixel project
  (Chromium engine, touch emulation): painting, minimap navigation, camera
  persistence, and bounded DOM all work at a mobile viewport. WebKit
  emulation stays skipped for this one creator-heavy gate because the
  1200x1200 image compute is not practical to finish inside the e2e budget
  there; iPhone rendering is still covered by the general accessibility and
  stabilization suites.
- E2E `session-goals`, `unlocks-recommendations`, and `stabilization` pass on
  Chromium.
- The full `e2e/creator.spec.js` suite now passes 21/21 on Chromium: the
  catalog-dependent tests were updated for the home-first default and the
  redesigned catalog/feed/profile navigation, so no legacy test expectations
  remain.
- Live browser on 1200x1200: zone jump zoom 0.08 -> 1.0; guide chip reports
  visible cells; wrong-color tap shows "Эта клетка относится к цвету N";
  correct-color tap returns POST `/progress/actions` 200; canvas pixel probe
  confirms the guide outline (13,152 cyan pixels) and selected-cell fill
  (35,390 pixels).
- Creator recompute at 1200x1200 measured p95 frame 17 ms, 0 stalls > 50 ms
  on a Worker-capable Chromium.

## Remaining risks

- Real Telegram WebView/mobile memory, FPS, and lifecycle measurements for the
  tiled player remain release gates. Local mobile emulation (Chromium/Pixel)
  passes the full 1200x1200 interaction path, but physical WebView
  measurements still require the Telegram infrastructure.

## Final local gate summary

- Unit tests: 264 passed, 0 failed.
- Server tests: 210 passed, 0 failed (65 skipped by environment, e.g. S3/
  PostgreSQL-specific paths).
- Production build and lint: green (lint warning budget 89/100).
- Full e2e control run on Chromium: 56 passed, 1 skipped (WebKit-only
  creator-heavy 1200 gate), covering creator, session goals, unlocks,
  accessibility, stabilization, the 1200x1200 player, and tiled completion.
- Mobile Pixel (Chromium engine, touch emulation) passes the full 1200x1200
  interaction path including touch paint, camera persistence, and the tiled
  completion overlay (2/2).
- The tiled player now exposes a lightweight device-metrics channel:
  `window.__splintTiledMetrics` always carries `templateId`, `startedAt`,
  `firstTileAt`, and `commits`. The heavier cache/DOM/heap/FPS sampling only
  runs when explicitly enabled (`VITE_SHOW_COLORING_DIAGNOSTICS=true` or a
  `?splintMetrics=1` query parameter), and that mode also shows a visible FPS
  panel. The 1200x1200 e2e asserts the channel is populated and the
  first-tile timestamp is recorded, so the remaining physical-device
  measurements can be taken from a real Telegram WebView without changing
  the app and without paying a production sampling cost.
- Final local verification (2026-08-07): full Chromium control run 56 passed /
  1 skipped, Mobile Pixel 1200x1200 + completion 2/2, unit 264/264, server
  210/0, lint 89/100, production build green. The diagnostics-enabled
  1200x1200 run also passes, confirming the metrics channel and FPS panel
  work under the opt-in flag.
- Full audit after the final diagnostic/auto-advance changes: Chromium
  control run 56 passed / 1 skipped; Mobile iPhone (WebKit emulation)
  stabilization/session-goals/unlocks 22 passed / 4 skipped; diagnostics
  panel visibility is now asserted in e2e when the opt-in flag is set.
- A reusable metrics harness now exists at
  `scripts/capture-tiled-device-metrics.mjs`: it creates a 1200x1200 tiled
  coloring, paints a cell, drags the canvas, and writes
  `docs/evidence/device-metrics-2026-08-07.json`. Local baseline captured
  on Chromium mobile emulation: first tile ~616 ms, interaction FPS 56
  (max 62), cache 48 tiles / ~196 KB, DOM 138 nodes, JS heap ~40 MB,
  frame median 16.6 ms / p95 18.2 ms. The same command can run in a real
  Telegram WebView context to produce comparable physical-device numbers.
- Final audit 2026-08-07: units 264/264, server 210/0, lint 89/100,
  production build green, full Chromium control run 56 passed / 1 skipped,
  Mobile iPhone 22 passed / 4 skipped, Mobile Pixel 1200x1200 + completion
  2/2. All locally runnable gates are green; physical Telegram WebView
  measurements remain the only external step.
