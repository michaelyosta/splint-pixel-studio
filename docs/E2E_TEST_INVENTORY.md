# E2E test inventory

Inventory source: Playwright `--list --reporter=json` on the integration worktree at base `dc01c103544ac953e97cb77fc501842f9dab5f1b`.

The current suite contains 38 spec files, 144 logical tests and 432 project cases. Every logical test is enumerated for the three configured projects; source-level project skips account for 27 expected skipped cases. Timings below are deliberately left as `pending` until the same frozen SHA is run on the authoritative Node 22/Linux environment. A timing from Node 24 on Windows would not be CI evidence.

Legend: `C` = Chromium desktop, `iP` = Mobile iPhone/WebKit, `Px` = Mobile Pixel/Chromium. The criticality column is a release-gate proposal, not a claim that every test in a mixed file belongs in the fast gate.

| Spec | Logical / project cases | Projects | Area | Criticality | Fixtures, network and state | Visual / timing / overlap notes |
|---|---:|---|---|---|---|---|
| `accessibility-1200.spec.js` | 1 / 3 | C, iP, Px | 1200 tiled player, keyboard/touch, persistence | A | creator upload; `/api/colorings`, tile/progress reads; per-test user header | DOM bounds and touch; coordinate-sensitive; overlaps tiled stroke and accessibility |
| `accessibility-evidence.spec.js` | 6 / 18 | C, iP, Px | accessibility evidence captures | B | creator upload; local onboarding state; evidence-only flow | 5 screenshots; opt-in `ACCESSIBILITY_EVIDENCE=1`; overlaps accessibility and visual evidence |
| `accessibility.spec.js` | 8 / 24 | C, iP, Px | accessibility smoke and responsive controls | B | demo catalog; local onboarding state | one arbitrary 100 ms wait and fixed coordinate; overlaps shell/player specs |
| `bfcache-lifecycle.spec.js` | 4 / 12 | C, iP, Px | pagehide/pageshow and resume | A | `seed-cohort-template`; localStorage; per-cohort user | lifecycle ordering; shared run database; overlaps recovery and reload |
| `coloring-surface-gesture-guard.spec.js` | 6 / 18 | C, iP, Px | selection/gesture guards and paint | A | demo and generated player state; no direct API fixture | 18/300 ms waits; pointer/camera assumptions; overlaps input evidence |
| `core-feel-slice.spec.js` | 6 / 18 | C, iP, Px | core-feel experiment journeys | B | URL subject IDs; analytics/progress requests | experiment/control contracts; overlaps guided and session journeys |
| `creator-preview-visual.spec.js` | 2 / 6 | C, iP, Px | creator preview layout | B | uploaded fixture image; per-viewport user | 2 screenshots; Chromium-only capture is source-gated; overlaps creator |
| `creator.spec.js` | 24 / 72 | C, iP, Px | creator, upload, preview, save, gallery/feed | A/B | uploaded `test-image.png`; create/colorings APIs; per-test user | 4 waits, 7 broad catches, 20 direct requests; one WebKit 1200 skip; largest overlap surface |
| `guided-path.spec.js` | 2 / 6 | C, iP, Px | guided catalog/player path | A | generated create API; onboarding localStorage; per-test user | readiness catch; overlaps guided-player and P0 |
| `guided-player-migration.spec.js` | 5 / 15 | C, iP, Px | pre-021 migration and tiled guidance | C | `seed-pre021-template`; `/manifest`, tiles; fixed test user | compatibility/legacy contract; WebKit 1200 skips; overlaps tiled guidance |
| `guided-player.spec.js` | 1 / 3 | C, iP, Px | 1200 autofocus, exploration and return | A | generated create API; per-test user | 16 ms and 1500 ms waits; one response catch; overlaps tiled low zoom |
| `input-gesture-evidence.spec.js` | 7 / 21 | C, iP, Px | keyboard, touch, pinch, cancel and viewport fit | A | demo/player state; local onboarding state | CDP/touch/pointer capture; 300 ms wait; WebKit cases source-skipped where CDP is required |
| `p0-final-acceptance.spec.js` | 1 / 3 | C, iP, Px | closed-alpha P0 journey | A | create/progress APIs; fixed test user; screenshots | 600/400 ms waits, 2 screenshots; canonical fast-gate candidate |
| `phase2-manual-first-reveal.spec.js` | 1 / 3 | C, iP, Px | manual first reveal experiment | B | `seed-cohort-template`; per-project user | touch/gesture path; experimental scope |
| `phase2-positive-events.spec.js` | 2 / 6 | C, iP, Px | bounded positive event experiment | B | `seed-cohort-template`; per-project users; localStorage | event/progression network calls; experimental scope |
| `phase2-session-game.spec.js` | 1 / 3 | C, iP, Px | session-game experiment | B | `seed-cohort-template`; per-project user | secondary journey; extended only |
| `recovery-p0.spec.js` | 1 / 3 | C, iP, Px | reload/recovery P0 | A | generated create API; local storage journal; random per-test user | 750 ms wait and optional retry UI; canonical reload candidate |
| `session-goals-evidence.spec.js` | 3 / 9 | C, iP, Px | session-goal visual evidence | B | demo state; evidence localStorage | 2 screenshots; opt-in `SESSION_GOALS_EVIDENCE=1`; overlaps session goals |
| `session-goals.spec.js` | 6 / 18 | C, iP, Px | session goals and celebration | B | `input-gesture-helpers.js`; create API; localStorage; per-test user | optional readiness catches and coordinates; overlaps Phase 2 |
| `special-bomb-artifact-reload.spec.js` | 2 / 6 | C, iP, Px | compatibility special reload paths | C | `seed-cohort-template`; fixed/derived users; progress/actions | server/player compatibility; overlaps `special-cells.spec.js` |
| `special-bomb-tiled.spec.js` | 1 / 3 | C, iP, Px | tiled bomb compatibility path | C | `seed-cohort-template`; fixed `user_bomb_e2e`; tiles/actions | tiled special path; possible cross-project user collision to verify |
| `special-cells-1200-delivery.spec.js` | 2 / 6 | C, iP, Px | 1200 special-cell delivery and controls | B | `seed-cohort-template`; tiles/actions; cohort users | 10 screenshots, 8 waits, 2 timeout overrides; overlaps all tiled/special specs |
| `special-cells-gameplay-v1.spec.js` | 1 / 3 | C, iP, Px | special gameplay journey | B | `seed-cohort-template`; imports `server/services/tiled-specials.js`; tile/actions | 2 screenshots; 360 s timeout; server implementation coupling |
| `special-cells-long-journey-evidence.spec.js` | 1 / 3 | C, iP, Px | long special journey evidence | B | `seed-cohort-template`; actions/manifest/tiles | 2 screenshots; long-journey overlap |
| `special-cells-long-journey.spec.js` | 1 / 3 | C, iP, Px | long special journey | B | `seed-cohort-template`; actions/manifest/tiles | 1 screenshot; explicit compatibility comments; overlaps gameplay v1 |
| `special-cells-responsive-evidence.spec.js` | 1 / 3 | C, iP, Px | responsive special-cell evidence | B | seed fixture; imports tiled special/hazard services and gesture helper | screenshot; per-project random UUID user; device evidence |
| `special-cells-visual-audit.spec.js` | 1 / 3 | C, iP, Px | special-cell visual audit | B | seeded treatment; local state; tile/actions | 5 screenshots and 450 ms wait; evidence-only |
| `special-cells.spec.js` | 5 / 15 | C, iP, Px | special-cell server/UI contracts | B | seed fixture; actions, tiles, progress; project-derived users | fail-closed action contracts; overlaps bomb/artifact paths |
| `special-glyph-parity.spec.js` | 6 / 18 | C, iP, Px | legacy/tiled glyph parity | C | seed fixture; localStorage; actions/progress | 7 screenshots, 6 waits, 8 broad catches, 300 s max; explicit legacy compatibility scope |
| `special-help-onboarding-responsive-evidence.spec.js` | 2 / 6 | C, iP, Px | special help/onboarding visual evidence | B | seed fixture; localStorage | 4 screenshots; responsive evidence-only |
| `special-help-onboarding.spec.js` | 3 / 9 | C, iP, Px | special help/onboarding contract | B | seed fixture; localStorage; progress | six localStorage references; overlaps special visual/evidence |
| `stabilization.spec.js` | 18 / 54 | C, iP, Px | broad shell/player stabilization checks | A/B | mostly UI/demo state; no direct API fixture | 9 arbitrary waits and fixed coordinates; highest shared timing surface |
| `tiled-completion.spec.js` | 1 / 3 | C, iP, Px | tiled completion overlay and server state | A | generated 1200 create/progress APIs; local onboarding | server-authoritative completion; fast-gate candidate |
| `tiled-low-zoom.spec.js` | 1 / 3 | C, iP, Px | overview/work LOD and recoverable tile errors | A | generated create API; tile requests | 3 waits, screenshots, transient 500 route; fast-gate candidate |
| `tiled-reload-journal.spec.js` | 1 / 3 | C, iP, Px | offline journal and reload replay | A | generated create API; localStorage; tile/progress API | no arbitrary sleep; reload oracle; fast-gate candidate |
| `tiled-stroke-engine.spec.js` | 2 / 6 | C, iP, Px | tiled live stroke and tile-boundary paint | A | creator upload; create/tiles/progress; local onboarding | 7 waits, response catches, 3 screenshots; pointer/touch cluster |
| `unlocks-recommendations.spec.js` | 7 / 21 | C, iP, Px | recommendations, locked state, premium fail-closed | A | create/progress/unlocks/catalog APIs; local state | direct-ID and payment-disabled contracts; fast-gate candidate |
| `zone-visual.spec.js` | 1 / 3 | C, iP, Px | 16-zone visual evidence | B | uploaded catalog asset; local onboarding | 1 screenshot and 1200 ms wait; evidence-only |

## Shared topology and dependencies

- Global setup starts one Vite server and one E2E API process per Playwright invocation. The API receives a fresh temporary SQLite DB and media directory for that invocation, not a fresh database per test.
- The browser projects share that invocation-level server/database while Playwright runs with one worker and `fullyParallel: false`.
- Most tests rely on `VITE_ALLOW_DEV_AUTH=true` and `X-User-Id`; some IDs are generated from `testInfo.testId`, while others are fixed or only project-scoped. This is an isolation risk to investigate, not yet a proven defect.
- Seed hooks under `/api/__e2e/*` mutate the E2E database. Direct `page.request` calls are common and are part of the user-path timing surface.
- The only repeated local helper import is `e2e/input-gesture-helpers.js`; two special-cell specs import production service modules directly.
- Evidence specs write screenshots into tracked `docs/evidence` paths. They are not appropriate for the fast required PR gate unless the evidence contract is deliberately retained there.

## Proposed release-gate split

The final split must be validated against observed timing and reliability. Initial candidates:

- Fast A gate: `p0-final-acceptance`, `guided-path`, `creator` critical upload/save subset, `input-gesture-evidence` critical paint subset, `tiled-stroke-engine`, `tiled-reload-journal`, `tiled-completion`, `tiled-low-zoom`, `recovery-p0`, and the premium fail-closed subset of `unlocks-recommendations`.
- Extended B gate: all accessibility breadth/evidence, full creator secondary journeys, bfcache breadth, core-feel/Phase 2 journeys, special-cell gameplay/visual/evidence, session goals, and zone evidence.
- Legacy/debt: migration and parity/compatibility tests whose source comments explicitly say they are not player-facing release contracts. They remain tracked and require owner/restore criteria; they are not silently deleted.
