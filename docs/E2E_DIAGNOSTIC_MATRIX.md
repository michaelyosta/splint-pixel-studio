# Frozen E2E diagnostic matrix

Status: `COMPLETE — failures collected before fixes`

This is the complete failure matrix for one frozen SHA. No source, test, or CI
configuration changes were made while this run was executing.

## Run identity

| Field | Value |
|---|---|
| Frozen source SHA | `ab1adc3daaec6a1b4305952ab342f34e70759673` |
| Integration branch | `codex/e2e-system-stabilization` |
| Diagnostic worktree | `C:\Users\misa\AppData\Local\Temp\splint-e2e-diagnostic-clean` |
| Runtime | Node `v22.23.2`, npm `10.9.8` |
| Playwright | `1.61.1` |
| Browser projects | `chromium`, `Mobile iPhone`, `Mobile Pixel` |
| Host | Windows; Docker Linux attempt excluded as invalid environment evidence |
| Worker/retry policy | 1 worker, `fullyParallel=false`, retries `0`, max failures `0` |
| Start | `2026-08-30T10:28:14.224Z` (`15:28:14` Asia/Qyzylorda) |
| End | `2026-08-30T12:52:41.662Z` (`17:52:41` Asia/Qyzylorda) |
| Duration | `8,667,437.615 ms` (`2 h 24 m 27.438 s`) |
| Command | `node22 node_modules/@playwright/test/cli.js test --reporter=json` |

## Result summary

The Playwright JSON reporter recorded 432 project cases: 302 passed, 59
unexpected, and 71 skipped. The 59 unexpected cases are 48 `failed` results
and 11 `timedOut` results; Playwright reported `flaky=0` because retries were
disabled.

| Project | Passed | Failed | Timed out | Skipped | Total |
|---|---:|---:|---:|---:|---:|
| `chromium` | 134 | 0 | 0 | 10 | 144 |
| `Mobile iPhone` | 78 | 16 | 3 | 47 | 144 |
| `Mobile Pixel` | 90 | 32 | 8 | 14 | 144 |
| **Total** | **302** | **48** | **11** | **71** | **432** |

Project duration totals from result records were approximately 38m45s for
Chromium, 35m20s for Mobile iPhone, and 1h07m55s for Mobile Pixel. The sum is
lower than wall-clock because it excludes runner/setup overhead and some
fixture/server waiting.

## Complete unexpected-result list

Every row below has a Playwright `error-context.md` under the diagnostic
artifact root. No failure result had a trace or automatic screenshot attachment:
the current configuration is `trace: on-first-retry` with `retries: 0`, and
generic failure screenshot/video capture is not configured. The structured
server/Vite output is in `test-results/frozen-diagnostic.console.log`.

| # | Project | Location | Test | Outcome | Observed error/oracle |
|---:|---|---|---|---|---|
| 1 | iPhone | `accessibility.spec.js:100` | keyboard-only cursor, zoom, and paint | failed | `.player-page` absent after navigation helper |
| 2 | iPhone | `accessibility.spec.js:136` | keyboard palette and state labels | failed | `.player-page` absent after navigation helper |
| 3 | iPhone | `accessibility.spec.js:155` | touch input paints | failed | `.player-page` absent after navigation helper |
| 4 | iPhone | `accessibility.spec.js:170` | HUD controls keyboard-operable | failed | `.player-page` absent after navigation helper |
| 5 | iPhone | `accessibility.spec.js:190` | reduced motion keeps painting/controls | failed | `.player-page` absent after navigation helper |
| 6 | iPhone | `accessibility.spec.js:239` | mobile widths avoid overflow | failed | `.player-page` absent after navigation helper |
| 7 | Pixel | `accessibility.spec.js:70` | one canvas, radio palette, bounded live regions | failed | `.player-page` absent; page remained on home |
| 8 | Pixel | `accessibility.spec.js:100` | keyboard-only cursor, zoom, and paint | failed | `.player-page` absent; page remained on home |
| 9 | Pixel | `accessibility.spec.js:136` | keyboard palette and state labels | failed | `.player-page` absent; page remained on home |
| 10 | Pixel | `accessibility.spec.js:155` | touch input paints | failed | `.player-page` absent; page remained on home |
| 11 | Pixel | `accessibility.spec.js:170` | HUD controls keyboard-operable | failed | `.player-page` absent; page remained on home |
| 12 | Pixel | `accessibility.spec.js:190` | reduced motion keeps painting/controls | failed | `.player-page` absent; page remained on home |
| 13 | Pixel | `accessibility.spec.js:218` | forced-colors selected state | failed | `.player-page` absent; page remained on home |
| 14 | Pixel | `accessibility.spec.js:239` | mobile widths avoid overflow | failed | `.player-page` absent; page remained on home |
| 15 | Pixel | `bfcache-lifecycle.spec.js:113` | legacy queue after persisted pagehide/pageshow | timedOut | 60s test timeout |
| 16 | Pixel | `bfcache-lifecycle.spec.js:143` | tiled queue after persisted pagehide/pageshow | timedOut | 60s test timeout |
| 17 | iPhone | `core-feel-slice.spec.js:187` | partial progress resumes | failed | 30s `.coloring-session[data-route-status=ready]` readiness; DOM stayed `Загружаем…` |
| 18 | iPhone | `creator.spec.js:463` | catalog opens player | failed | `.player-page` absent |
| 19 | iPhone | `creator.spec.js:474` | delete created coloring | failed | `.creator-success-page` absent |
| 20 | iPhone | `creator.spec.js:551` | guided player has no persistent metrics | failed | `.player-page` absent |
| 21 | iPhone | `creator.spec.js:567` | player menu and secondary actions | failed | home featured/continue/art card absent |
| 22 | iPhone | `creator.spec.js:583` | catalog card alignment | failed | `.catalog-art-card` absent |
| 23 | iPhone | `creator.spec.js:595` | player dock reveal/classic switch | failed | `.player-page` absent |
| 24 | Pixel | `creator.spec.js:474` | delete created coloring | timedOut | 60s test timeout |
| 25 | Pixel | `creator.spec.js:495` | feed like/comment/follow | failed | `.feed-post` absent |
| 26 | Pixel | `creator.spec.js:551` | guided player has no persistent metrics | failed | `.player-page` absent |
| 27 | Pixel | `creator.spec.js:567` | player menu and secondary actions | failed | home featured/continue/art card absent |
| 28 | Pixel | `creator.spec.js:583` | catalog card alignment | failed | `.catalog-art-card` absent |
| 29 | Pixel | `guided-player-migration.spec.js:204` | cold target requests target tile | failed | `.progressive-coloring-session` absent; page stayed `Загружаем…` |
| 30 | Pixel | `guided-player-migration.spec.js:252` | slow target shows `loadingTarget` then READY | failed | state remained `idle` instead of `loadingTarget` |
| 31 | Pixel | `guided-player.spec.js:36` | guided autofocus/advance/exploration | failed | required `/response` wait timed out at 15s |
| 32 | iPhone | `input-gesture-evidence.spec.js:57` | classic keyboard paint persists | failed | `.coloring-canvas` absent |
| 33 | Pixel | `input-gesture-evidence.spec.js:57` | classic keyboard paint persists | failed | `.coloring-canvas` absent |
| 34 | Pixel | `p0-final-acceptance.spec.js:22` | existing progress first action is PAINT | timedOut | 60s test timeout |
| 35 | Pixel | `phase2-positive-events.spec.js:67` | Bomb bounded area reveal | failed | `[data-phase2-bomb]` absent |
| 36 | iPhone | `session-goals.spec.js:298` | hidden goals preserve save/revision | timedOut | 60s test timeout |
| 37 | iPhone | `special-bomb-artifact-reload.spec.js:89` | artifact progress after reload | timedOut | 60s test timeout |
| 38 | Pixel | `special-bomb-artifact-reload.spec.js:42` | Bomb default center/use | failed | boolean assertion false |
| 39 | Pixel | `special-bomb-artifact-reload.spec.js:89` | artifact progress after reload | failed | boolean assertion false |
| 40 | Pixel | `special-bomb-tiled.spec.js:45` | tiled Bomb claim/use | failed | boolean assertion false |
| 41 | Pixel | `special-cells-1200-delivery.spec.js:322` | INITIAL_TARGET identifies early Spark | failed | target metadata undefined |
| 42 | Pixel | `special-cells-1200-delivery.spec.js:634` | 1200 control has no special UI | failed | `.progressive-coloring-session` absent |
| 43 | Pixel | `special-cells-gameplay-v1.spec.js:239` | 1200 Alpha journey/recovery | failed | boolean assertion false |
| 44 | Pixel | `special-cells-long-journey-evidence.spec.js:148` | long journey Spark offer | failed | Spark offer absent |
| 45 | Pixel | `special-cells-long-journey.spec.js:140` | long journey active specials | failed | Spark offer absent |
| 46 | Pixel | `special-cells-visual-audit.spec.js:251` | responsive Spark/next beat | failed | target tile `18:18` did not expose Spark |
| 47 | iPhone | `special-cells.spec.js:157` | legacy Spark real-canvas journey | timedOut | 60s test timeout |
| 48 | Pixel | `special-glyph-parity.spec.js:627` | tiled glyphs readable at low zoom | failed | `.progressive-coloring-session` absent |
| 49 | Pixel | `special-glyph-parity.spec.js:699` | tiled reveal exactly once/reload | timedOut | 120s test timeout |
| 50 | Pixel | `special-glyph-parity.spec.js:743` | legacy reveal exactly once/reload | failed | `.coloring-session` not `data-route-mode=treatment` |
| 51 | Pixel | `special-help-onboarding-responsive-evidence.spec.js:145` | treatment onboarding/help responsive | failed | `.onboarding-card` absent |
| 52 | iPhone | `special-help-onboarding.spec.js:116` | special hint and reload | failed | `[data-special-help-hint]` absent |
| 53 | Pixel | `special-help-onboarding.spec.js:116` | special hint and reload | failed | `[data-special-help-hint]` absent |
| 54 | Pixel | `stabilization.spec.js:192` | initial actionable target | timedOut | 60s test timeout |
| 55 | Pixel | `tiled-completion.spec.js:3` | tiled completion overlay | failed | completion element was null |
| 56 | iPhone | `tiled-low-zoom.spec.js:72` | preview/work/retry low zoom | failed | measured value `144`, expected `<80` |
| 57 | Pixel | `tiled-low-zoom.spec.js:72` | preview/work/retry low zoom | failed | route mode never became `work` |
| 58 | Pixel | `tiled-stroke-engine.spec.js:306` | 30-cell touch drag | timedOut | 180s test timeout |
| 59 | Pixel | `tiled-stroke-engine.spec.js:440` | tile-boundary drag | timedOut | 180s test timeout |

## Evidence limitations and environment separation

- The valid run was authoritative for Node 22 and the frozen source, but it ran
  on Windows. It is not proof of Linux GitHub-runner parity.
- A separate Docker `node:22-bookworm` attempt was not counted: the container
  failed with `EROFS: read-only file system, mkdtemp '/tmp/playwright_*'` and
  render-outbox errors before completing the matrix.
- The diagnostic server log contains structured request events. During slow
  tiled cases, successful requests were observed at roughly 0.8–3.6s and one
  tile request at 20.16s, so environment/resource pressure is a live
  hypothesis for several mobile/tiled failures, not a classification by itself.
- One stroke case emitted `painted=30`, `wrong=false`, `unloaded=0` before the
  test timed out. That is evidence against simply labeling the product path
  broken; the post-action oracle and tile/persistence wait still need causal
  investigation.
- The matrix is a diagnostic baseline, not a release result. No failure has
  been quarantined and no assertion has been weakened.

## Exact-SHA GitHub follow-up: run 33388276591

This follow-up was run after the C16/C17 runtime and diagnostics correction at
exact integration SHA `3a993d14da514fa564909d4461f66a81bab42357`. It is the
authoritative evidence used for the shard-lifetime topology decision; no
source changed while the run was executing.

| Lane | Result | Completed jobs | Retries | Notes |
|---|---:|---:|---:|---|
| Critical | `66 pass / 0 unexpected` | `3/3` | `0` | Chromium, iPhone and Pixel green |
| Extended | `356 pass / 72 expected skip / 5 unexpected` | `16/16` | `0` | RED only in shards 3, 4 and 6 |
| Verify | PASS | `1/1` | n/a | unit, lint and build green |
| PostgreSQL | PASS | `1/1` | n/a | service-backed validation green |
| S3 contract | PASS | `1/1` | n/a | disposable contract green |

The five failures were not investigated as five independent defects:

| Shard | Project | Test mechanism | Failure | Fresh isolated repeat |
|---:|---|---|---|---:|
| 3 | Chromium | guided player | `/guidance` response wait timed out | `3/3` |
| 3 | Chromium | keyboard input | `.coloring-canvas` was not visible | `3/3` |
| 3 | Chromium | Phase 2 Bomb | Bomb control was not visible | `3/3` |
| 4 | Chromium | tiled glyph parity | five-minute tile-read test timeout | `5/5` |
| 6 | Mobile iPhone | accessibility width | `.player-page` was not visible | `5/5` |

Trace and server-log evidence shows the common sequence `fresh shard → low
latency → long/heavy workload → accumulated API/SQLite/tile latency → later
readiness/oracle timeout`. The classification is
`HARNESS_RESOURCE_LIFETIME / SHARD_PRESSURE`; no product defect was proven and
no individual spec was changed for these rows. The first targeted guided
invocation with an invalid PowerShell `--project` transfer was a
`TOOLING_INVOCATION_ERROR`, not E2E evidence.
