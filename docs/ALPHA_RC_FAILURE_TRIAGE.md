# Alpha RC Chromium failure triage

Status: `TRIAGED — current integration full-suite rerun still required`

This is a failure classification report, not a screenshot refresh and not a
product-direction decision. No production source was changed in the triage
worktree.

## Scope and baseline

The release brief names a historical Chromium result of `102 PASS / 31 FAIL /
10 SKIP`. The first reproducible run available for this triage was made from
integration SHA `1bd14d76a9439c8903bf1dcd1e337c983dda5e8e` and contained an
expanded 144-test Chromium set:

```text
Command: $env:VITE_ALLOW_DEV_AUTH='true'; npm run test:e2e -- --project=chromium
Result: 87 passed / 47 failed / 10 skipped
Log:    C:\Users\misa\AppData\Local\Temp\splint-alpha-rc-chromium-triage.log
```

Therefore this report assigns IDs to all 47 failures that were actually
observed. The historical 31-failure list is not present as a machine-readable
artifact in the worktree; silently inventing a 31-item mapping would make the
RC evidence less trustworthy. The difference in suite size is itself an RC
tracking item. The current integration branch has since advanced through
`57e2a3a`, `60ed9df`, `1bd14d7`, and `45432b3`; those fixes must be followed by
one fresh full run before declaring the burn-down complete.

## Classification rules

- `REAL REGRESSION`: application behavior violates the current contract and is
  reproduced in an isolated verifier. It remains open until a fix and a
  passing verifier exist.
- `STALE TEST`: the test asserts an older or deliberately narrowed contract;
  update/remove the verifier only after the current contract is documented.
- `FLAKE / STABILIZATION`: the same behavior passes in isolation or is caused
  by suite ordering, timing, fixture lifecycle, or request readiness. It still
  requires a deterministic suite verifier; it is not a free skip.
- `ENVIRONMENT-GATED`: no observed failure is classified this way. Existing
  skips remain capability-gated and are not converted into failures.
- `INTENTIONALLY REMOVED BEHAVIOUR`: the test requires a mechanic that the
  current product contract explicitly excludes (notably Choice).

## Exact verifier aliases

The commands below are run from the integration checkout with the same
disposable E2E environment as the baseline. `V0` is the baseline command.

```text
V0  $env:VITE_ALLOW_DEV_AUTH='true'; npm run test:e2e -- --project=chromium
V1  npm run test:e2e -- --project=chromium e2e/creator.spec.js --grep "Completion flow"
V2  npm run test:e2e -- --project=chromium e2e/creator.spec.js --grep "Delete a user-created"
V3  npm run test:e2e -- --project=chromium e2e/guided-player-migration.spec.js --grep "persisted overview camera"
V4  npm run test:e2e -- --project=chromium e2e/accessibility.spec.js e2e/accessibility-1200.spec.js e2e/creator.spec.js
V5  npm run test:e2e -- --project=chromium e2e/phase2-positive-events.spec.js e2e/phase2-session-game.spec.js
V6  npm run test:e2e -- --project=chromium e2e/special-cells.spec.js
V7  npm run test:e2e -- --project=chromium e2e/special-glyph-parity.spec.js
V8  npm run test:e2e -- --project=chromium e2e/stabilization.spec.js
V9  npm run test:e2e -- --project=chromium e2e/creator-preview-visual.spec.js e2e/guided-player.spec.js e2e/guided-player-migration.spec.js
V10 npm run test:e2e -- --project=chromium e2e/special-cells-1200-delivery.spec.js e2e/special-cells-gameplay-v1.spec.js e2e/special-cells-long-journey-evidence.spec.js e2e/special-cells-long-journey.spec.js e2e/special-cells-responsive-evidence.spec.js e2e/special-cells-visual-audit.spec.js e2e/special-help-onboarding.spec.js
V11 npm run test:e2e -- --project=chromium e2e/special-cells-responsive-evidence.spec.js
V12 npm run test:e2e -- --project=chromium e2e/tiled-stroke-engine.spec.js
V13 npm run test:e2e -- --project=chromium e2e/tiled-low-zoom.spec.js
V14 npm run test:e2e -- --project=chromium e2e/tiled-reload-journal.spec.js
```

## Failure register

| ID | Suite / scenario | Classification | Root cause and evidence | Verifier | Owner / status |
|---|---|---|---|---|---|
| RC-F001 | `accessibility-1200`: tiled 1200 player, keyboard paint and zone navigation | FLAKE / STABILIZATION | Full run timed out before `.progressive-coloring-session` became visible. The accessibility group passed when isolated; no stable application error was reproduced. | V0; isolate `e2e/accessibility-1200.spec.js` | Stabilization — open until isolated pass on current SHA |
| RC-F002 | `accessibility`: HUD controls keyboard-operable | FLAKE / STABILIZATION | Full run timed out waiting for `.player-page`; isolated accessibility run passed. This is suite readiness/order evidence, not permission to skip the check. | V0; V4 | Stabilization — open |
| RC-F003 | `creator-preview-visual`: 390px preview readable | FLAKE / STABILIZATION | Full run saw 192px option `idle` instead of `ready` for 60s; the same 390px preview passed in the isolated creator/preview run. | V0; V9 | Creator/stabilization — open |
| RC-F004 | `creator-preview-visual`: 430px preview readable | FLAKE / STABILIZATION | Same readiness race as RC-F003; isolated 430px run passed. | V0; V9 | Creator/stabilization — open |
| RC-F005 | `creator`: completion flow 100% → overlay → Escape → buttons | REAL REGRESSION | Reproduced in a one-test run: the expected `Completion flow fixture` row never appears in Gallery after the create/complete flow. This breaks a user-facing creator-to-gallery path. | V1 (fails; row locator timeout) | Creator/Gallery — `OPEN`, release blocker |
| RC-F006 | `creator`: delete user-created coloring from Gallery | REAL REGRESSION | Reproduced in the creator-focused group: after save/back, `.gallery-list` is not visible. The route cannot expose the newly created user artwork to the deletion flow. | V2; V4 (fails) | Creator/Gallery — `OPEN`, release blocker |
| RC-F007 | `guided-player-migration`: persisted overview camera still allows guidance | REAL REGRESSION | Reproduced in isolation: a saved `zoom: 0.08` overview remains at `0.08` where the current guided contract requires at least `0.4` before the actionable target. | V3 (fails: received `0.08`) | Smart Director/camera — `OPEN`, release blocker |
| RC-F008 | `guided-player`: 1200 autofocus/auto-advance/free exploration | FLAKE / STABILIZATION | Full run timed out waiting for the manifest response; the guided-player scenario passed in the isolated run. Request readiness/order remains to be made deterministic. | V0; V9 | Tiled player/stabilization — open |
| RC-F009 | `phase2-positive-events`: automatic Spark bounded target | FLAKE / STABILIZATION | Full run found no Spark marker. The three Phase 2 positive-event/session tests passed together in isolation, so the baseline failure is not evidence that the prototype is broken. | V0; V5 (3/3 isolated PASS) | Special/stabilization — open |
| RC-F010 | `phase2-positive-events`: Bomb one spatial action | FLAKE / STABILIZATION | Full run received a non-OK claim response; the same Bomb flow passed in the isolated Phase 2 run. | V0; V5 | Special/stabilization — open |
| RC-F011 | `phase2-session-game`: manual Spark pauses after authored reveal | FLAKE / STABILIZATION | Full run did not find the Spark element; isolated Phase 2 session run passed. | V0; V5 | Special/stabilization — open |
| RC-F012 | `special-bomb-artifact-reload`: Bomb default center after reload | FLAKE / STABILIZATION | Full run got a non-OK claim; isolated Special flow was green. Treat as request/fixture lifecycle until current-HEAD rerun says otherwise. | V0; isolate `e2e/special-bomb-artifact-reload.spec.js` | Special/stabilization — open |
| RC-F013 | `special-bomb-artifact-reload`: Artifact progress after reload | FLAKE / STABILIZATION | Full run got a non-OK progress claim; the corresponding legacy artifact/reload path passed in the isolated Special suite. | V0; V6 | Special/stabilization — open |
| RC-F014 | `special-bomb-tiled`: compact center offer and use flow | INTENTIONALLY REMOVED BEHAVIOUR | The verifier is tied to the earlier Bomb presentation/center-offer contract. Bomb is not a promoted Alpha mechanic; the current bounded prototype is experimental and must not be restored solely for this legacy expectation. | V0; isolate `e2e/special-bomb-tiled.spec.js` only if the prototype remains in scope | Special — update/archive verifier |
| RC-F015 | `special-cells-1200-delivery`: INITIAL_TARGET must expose a Spark ID | STALE TEST | Effort-aware Director selection no longer guarantees that every initial target carries a Spark. The failure was `special_id: undefined`; current continuation contract validates a playable target, not forced early Spark placement. | V0; V10 | Special/Director — update verifier |
| RC-F016 | `special-cells-gameplay-v1`: all five event kinds including Choice | INTENTIONALLY REMOVED BEHAVIOUR | The current contract intentionally excludes Choice; the run received four active kinds. Do not re-enable Choice to satisfy an old journey. | V0; V10 | Special — remove old Choice expectation |
| RC-F017 | `special-cells-long-journey-evidence`: evidence for Choice | INTENTIONALLY REMOVED BEHAVIOUR | Same intentional Choice removal; the evidence test still requires `['artifact','bomb','choice','fuse','spark']`. | V0; V10 | Special/evidence — archive or rewrite |
| RC-F018 | `special-cells-long-journey`: every old special kind | STALE TEST | The seed/fixture response also failed in the full run, but the test's required five-kind journey is obsolete because Choice is excluded. A retained journey needs a new fixture and active-kind contract. | V0; V10 | Special/fixtures — rewrite before retaining |
| RC-F019 | `special-cells-responsive-evidence`: responsive Spark flow | STALE TEST | The verifier throws `ReferenceError: tiledPayload is not defined` before testing product behavior. The missing helper import was applied on the parent integration path; this report records the original test defect. | V0; V10; V11 after current import fix | Special/evidence — test owner |
| RC-F020 | `special-cells-visual-audit`: initial guidance must have `special_id` | STALE TEST | The visual audit assumes forced initial special delivery; the current Director continuation contract does not. Parent commit `45432b3` aligns this test to the newer contract; rerun it on current HEAD. | V0; V10 | Visual/Special — verify current patch |
| RC-F021 | `special-cells`: Spark stays in tiled Canvas flow and cannot replay | FLAKE / STABILIZATION | Full run's use request was non-OK, while the complete `special-cells.spec.js` group passed 5/5 in isolation. | V0; V6 (5/5 isolated PASS) | Special/stabilization — open |
| RC-F022 | `special-cells`: legacy 28×28 discovers Spark and continues | FLAKE / STABILIZATION | Full run timed out waiting for `claim_spark`; isolated Special group passed. | V0; V6 | Special/stabilization — open |
| RC-F023 | `special-cells`: legacy control has no Spark marker/action/HUD | FLAKE / STABILIZATION | Full run timed out at the progress action; isolated Special group passed, including control behavior. | V0; V6 | Special/stabilization — open |
| RC-F024 | `special-cells`: last-cell Spark is suppressed | FLAKE / STABILIZATION | Full run received a non-OK legacy paint response; isolated Special group passed. | V0; V6 | Special/stabilization — open |
| RC-F025 | `special-cells`: Artifact progress survives `/progress` reload | FLAKE / STABILIZATION | Full run got a non-OK claim; isolated Special group passed this reload contract. | V0; V6 | Special/stabilization — open |
| RC-F026 | `special-glyph-parity`: six distinct legacy glyph masks | INTENTIONALLY REMOVED BEHAVIOUR | Isolated parity run received five kinds instead of six; Choice is not an active product mechanic. | V7 (4 failures, all missing Choice) | Special/visual — remove Choice assertion |
| RC-F027 | `special-glyph-parity`: six tiled glyph masks | INTENTIONALLY REMOVED BEHAVIOUR | Same deliberate Choice exclusion; the remaining five-kind glyph check is the relevant contract. | V7 | Special/visual — remove Choice assertion |
| RC-F028 | `special-glyph-parity`: tiled reveal claims exactly once and reloads | INTENTIONALLY REMOVED BEHAVIOUR | The scenario's fixture enumerates the six-kind set and fails before a valid current set can be evaluated. Split the current five-kind/Artifact contract from the old Choice fixture. | V7 | Special/visual — rewrite fixture |
| RC-F029 | `special-glyph-parity`: legacy reveal claims exactly once and reloads | INTENTIONALLY REMOVED BEHAVIOUR | Same six-kind fixture mismatch; no production glyph regression was demonstrated. | V7 | Special/visual — rewrite fixture |
| RC-F030 | `special-help-onboarding`: one pre-paint hint survives reload | FLAKE / STABILIZATION | Full run could not see the hint within 5s. The exact test passed alone (1/1, 11.9s); preserve the bounded hint contract and fix suite readiness rather than skipping it. | V0; V10 (isolated 1/1 PASS) | Onboarding/stabilization — open |
| RC-F031 | `stabilization`: single tap paints a cell | FLAKE / STABILIZATION | Full run never reached Home; isolated stabilization group passed. | V0; V8 (18/18 isolated PASS) | Core input/stabilization — open |
| RC-F032 | `stabilization`: paint has no page error | FLAKE / STABILIZATION | Same full-suite Home readiness timeout; isolated pass. | V0; V8 | Core input/stabilization — open |
| RC-F033 | `stabilization`: camera does not move during paint | FLAKE / STABILIZATION | Session was not visible in the full run; isolated pass. | V0; V8 | Camera/stabilization — open |
| RC-F034 | `stabilization`: onboarding completion persists/replays | FLAKE / STABILIZATION | Full run never reached the session; isolated pass. | V0; V8 | Onboarding/stabilization — open |
| RC-F035 | `stabilization`: free exploration requires explicit return | FLAKE / STABILIZATION | Onboarding overlay intercepted pointer events in the full run; isolated pass. | V0; V8 | Onboarding/camera — open |
| RC-F036 | `stabilization`: overview explicitly enters free exploration | FLAKE / STABILIZATION | Same onboarding overlay interception; isolated pass. | V0; V8 | Onboarding/camera — open |
| RC-F037 | `stabilization`: auto transition focuses until animation completes | FLAKE / STABILIZATION | Full run could not find the first Home card; isolated pass. | V0; V8 | Smart Director/stabilization — open |
| RC-F038 | `stabilization`: ten Next actions change target or finish | FLAKE / STABILIZATION | Full run observed `focusingTarget` where the test waits for `ready`; isolated pass. This is an unresolved deterministic settle/readiness issue, not a timeout-only fix. | V0; V8 | Smart Director/stabilization — open |
| RC-F039 | `stabilization`: manual palette selection activates target | FLAKE / STABILIZATION | Full run never reached the first Home card; isolated pass. | V0; V8 | Palette/stabilization — open |
| RC-F040 | `stabilization`: completed color keeps truthful target | FLAKE / STABILIZATION | Session did not become visible in the full run; isolated pass. | V0; V8 | Smart Director/stabilization — open |
| RC-F041 | `stabilization`: expanding HUD preserves target | FLAKE / STABILIZATION | Onboarding overlay intercepted the HUD click; isolated pass. | V0; V8 | HUD/stabilization — open |
| RC-F042 | `stabilization`: resize preserves manual camera/target | FLAKE / STABILIZATION | Onboarding overlay intercepted the action; isolated pass. | V0; V8 | Camera/stabilization — open |
| RC-F043 | `tiled-low-zoom`: overview then work LOD and tile retry | FLAKE / STABILIZATION | Full run remained in `data-lod-mode="overview"` where the test waits for `work`. It needs an isolated current-HEAD run to distinguish route-readiness/order from a real LOD transition defect. | V0; V13 | Tiled LOD — open, not a skip |
| RC-F044 | `tiled-reload-journal`: offline journal replays resident tile | FLAKE / STABILIZATION | Full run observed cell state `0` instead of the expected pending `-1` after timeout. Because this touches offline progress integrity, it remains an open release check until isolated and repeated. | V0; V14 | Offline/save — open, high attention |
| RC-F045 | `tiled-stroke-engine`: touch drag paints progressively | STALE TEST | The test calls `.fill("18")` on `.grid-detail-range`, but the current control is a discrete slider with `min=0 max=3 step=1`; Playwright rejects the value before exercising stroke input. | V0; V12 | Input test owner — update range contract |
| RC-F046 | `tiled-stroke-engine`: drag across tile boundary | STALE TEST | Same obsolete resolution-control value; no cross-tile stroke assertion executes. | V0; V12 | Input test owner — update range contract |
| RC-F047 | `zone-visual`: capture 16-zone player at 390px | STALE TEST | The test uses the obsolete detail-range value and fails in `locator.fill` before capture; it is not evidence of a visual zone regression. | V0; V12 | Visual/test owner — update fixture |

## Post-baseline evidence

The following isolated checks were run without modifying product code:

- Phase 2 positive events plus session: `3/3 PASS` (`V5`).
- Special Cells core regression group: `5/5 PASS` (`V6`).
- Stabilization group: `18/18 PASS` (`V8`).
- Creator/preview/guided group: creator previews and guided player passed; the
  two migration failures included RC-F007 and a transient retry failure.
- Accessibility/creator group: `30/33 PASS`; the two creator failures are
  RC-F005/RC-F006, and the remaining accessibility checks passed.
- Special glyph parity: `2/6 PASS`; all four failures are the same removed
  Choice expectation (RC-F026–RC-F029).
- Special-help hint: `1/1 PASS` when isolated (RC-F030).

These results support the classifications above but do not replace a full
current-HEAD run. Parent integration commits after the baseline include:

- `57e2a3a` — keep Artifact total consistent across discovery surfaces;
- `60ed9df` — settle player before dismissing onboarding;
- `1bd14d7` — stabilize creator preview error and visual contract;
- `45432b3` — align visual audit with Phase 2 continuation contract.

The parent path also applied the missing `tiledPayload` import for RC-F019.
Each must be verified on the final candidate, and no screenshot update should
be accepted as a fix without a passing behavioral assertion.

## Release interpretation

At the baseline, RC-F005, RC-F006 and RC-F007 are reproduced user-journey
regressions. RC-F043 and RC-F044 remain unproven but high-attention
stabilization checks because they concern tiled loading and offline progress.
The Choice and obsolete slider failures are test-contract debt, not reasons to
restore removed mechanics. The large set of isolated passes indicates a
suite-lifecycle/readiness problem that must be eliminated before Alpha RC can
claim `0 unexplained failures`.

No observed failure is environment-gated. The existing ten skips should retain
their explicit capability reasons and be reported separately by the release
runner.
