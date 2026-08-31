# E2E stabilization run state

Status: `C22_FIXED — run 33414881259 fully evidenced; preparing bounded exact-SHA correction matrix`

Last updated: 2026-08-31 (Asia/Qyzylorda)

This file is the durable state for the single stabilization pass. Generated
Playwright evidence is intentionally kept outside commits; paths below refer
to the local integration worktree.

## Baseline and safety

- Base branch: `origin/main`
- Base SHA: `dc01c103544ac953e97cb77fc501842f9dab5f1b`
- Supplied release candidate: `6ce8f60bdd673030bdbb705f2111c69bdfacf546`
- RC relation: supplied RC is an ancestor of `origin/main`.
- Integration branch: `codex/e2e-system-stabilization`
- Current code/harness SHA and integration HEAD:
  `fae35b598161b65b373ff7674a80ea2ae60b864f` (`test: wait for legacy
  coloring readiness`).
- The prior final candidate `2fc52c9cd4bd4c07fbe4ae374e56e015678f96d7`
  remains immutable evidence; the bounded C22 helper correction is now the
  next frozen candidate after targeted proof.
- Latest authoritative GitHub run: `33409940186` (PR event; all jobs complete;
  22/24 extended shards green, all four critical lanes, PostgreSQL, S3 and
  verify green; only C20 Creator navigation oracle failed in shards 9 and 22).
- Preflight before freeze: `146` logical tests / `438` project cases across
  `24` shards, `0` duplicates, `0` unmatched; Pixel critical partitions
  `13 + 13` with exact title coverage.
- Latest targeted proof: C20 representatives Mobile iPhone `10/10` after the
  correction, plus Chromium/Mobile Pixel variants `4/4`; retries `0`, fresh
  Node 22 runtime. C19 responsive Spark remains Chromium `5/5` and Mobile
  Pixel `5/5`.
- C21 representative fresh Mobile iPhone guided-path repeat: `5/5`, retries
  `0`; GitHub run `33412246450` remains cancelled and is not acceptance proof.
- C22 exact-SHA run `33414881259` had one Mobile iPhone keyboard readiness
  failure in shard 17. Trace: loading shell at `focusLegacyCell`, `639` HTTP
  requests, `0` HTTP errors, `67.6 ms` average API latency. Fresh isolated
  pre-fix reproduction was `5/5`, showing a test-harness readiness race.
- C22 correction `fae35b5` waits for causal legacy session readiness before
  canvas focus. Post-fix representative was `5/5` and related input spec
  across all browser projects passed, retries `0`.
- Primary checkout: `C:\Users\misa\Desktop\Splint-Gemini`; existing dirty
  evidence and user-owned files were not reset, reverted, staged or imported.
- Integration worktree: `C:\Users\misa\AppData\Local\Temp\splint-e2e-system-stabilization`.
- Production: no deployment and no Cloudflare/Render/Neon/R2/Telegram/payment
  mutation. `showalove.ru` remains Closed Alpha LIVE.
- Stars: unchanged, `OFF / FAIL-CLOSED`.

## Active worktrees, agents and ownership

| Role | Location / identity | Ownership | Status |
|---|---|---|---|
| Lead integration | integration worktree, `codex/e2e-system-stabilization` | docs, CI/harness integration, bounded verification | C22 fixed; one bounded exact-SHA correction matrix pending |
| Frozen diagnostic | `C:\Users\misa\AppData\Local\Temp\splint-e2e-diagnostic-clean` | read-only frozen evidence | complete |
| Primary checkout | `C:\Users\misa\Desktop\Splint-Gemini` | unrelated user work/evidence | untouched |
| C1 navigation | `01a052cd-d0b1-71c0-a10c-b0db0fdd743f` | navigation/readiness cluster | complete; no speculative fix |
| C2 lifecycle | `01a052cd-d1f5-7fc3-b622-c763d471a607` | late response/lifecycle cluster | complete; integrated |
| C3 special contracts | isolated lead replacement after boundary refusal | special-cell contract cluster | complete; no fix |
| C4 tiled | `01a052cd-d47a-7341-a1a6-f4dd48d752ac` | tiled loading/stroke cluster | complete; integrated |

No commits are awaiting integration. No subagent has permission to change the
primary checkout or production state.

## Independent final review status

Two independent Sol Max read-only reviews completed against the pre-correction
final evidence and both returned `FAIL` with actionable findings. The bounded
correction wave addresses hidden UI retries, Gallery and low-zoom false-green
oracles, deterministic fixture reset, exact critical manifest preflight, exact
Node/npm runtime, and an isolated S3 contract gate. The reviews must be rerun
against the post-correction SHA after the final full matrix.

## E2E inventory and classification

- Inventory: [E2E_TEST_INVENTORY.md](E2E_TEST_INVENTORY.md).
- 39 Playwright spec files, 146 logical tests, 438 nominal project cases.
- 411 cases remain after source-level project skips. The first complete
  post-correction candidate matrix at `70a93a5` reported 366 passes, 71
  explicit/conditional skips and one proven C12 fixture failure. The next
  complete matrix at `958ec96` reported 365 passes, 71 skips and two C13
  loopback failures. Wave6 at `f0c8d35` reported 365 passes, 71 skips and
  two harness failures; the final matrix on the current topology SHA is
  pending. Skips are
  capability or environment gates, not quarantine.
- Release-critical proposal is maintained in
  `scripts/run-e2e-suite-node22.mjs`: 26 title-selected tests on Chromium and
  Mobile Pixel, plus an explicit 14-test supported Mobile iPhone/WebKit smoke
  subset. Omitted iPhone cases are conditional WebKit/1200/touch or known
  worker/provider-bound scenarios; physical iOS/Telegram remains separate.
- Extended regression is the complete `e2e/` suite in 24 fail-fast-disabled
  fresh-runtime shards, selected by the weighted logical-test manifest in
  `docs/E2E_SHARD_LOAD_MANIFEST.json`.
- Legacy/debt cases remain visible and are not deleted merely because they are
  not in the fast gate.

## Static harness audit

Read-only findings are in [E2E_HARNESS_AUDIT.md](E2E_HARNESS_AUDIT.md):

- 49 `waitForTimeout` calls;
- 37 broad empty catches;
- 7 response-wait/catch patterns;
- 8 fixed-coordinate patterns;
- 28 timeout overrides;
- 60 storage references and 136 request references;
- 52 explicit screenshot calls.

The bounded wave addressed proven readiness/oracle/isolation defects. It did
not mechanically rewrite every legacy wait or remove useful regression
coverage. Remaining smells are recorded debt, not silently declared safe.

## Runtime contract

- Authoritative local/CI E2E runtime: Node `v22.23.2`, npm `10.9.8`.
- Playwright `1.61.1`; Windows validation was run with fresh per-shard ports.
- `retries=0`, `fullyParallel=false`, one worker per local shard.
- `trace=retain-on-failure`, `screenshot=only-on-failure`, JSON + line output.
- CI continues to upload `test-results/` and `playwright-report/` on every
  shard outcome.
- `localhost` is the readiness authority because Windows loopback behavior
  differed between `127.0.0.1`, `localhost` and `::1` during diagnosis.

## Frozen diagnostic

Frozen before fixes at SHA `ab1adc3daaec6a1b4305952ab342f34e70759673`:

- 432 nominal cases; 302 passed; 59 unexpected (`48 failed + 11 timed out`);
  71 skipped; 0 flaky; duration `2 h 24 m 27.438 s`.
- Chromium: `134 pass / 0 fail / 0 timeout / 10 skip`.
- Mobile iPhone: `78 pass / 16 fail / 3 timeout / 47 skip`.
- Mobile Pixel: `90 pass / 32 fail / 8 timeout / 14 skip`.
- Matrix: [E2E_DIAGNOSTIC_MATRIX.md](E2E_DIAGNOSTIC_MATRIX.md).
- The old `trace: on-first-retry` plus `retries=0` configuration produced no
  failure traces; this diagnostics gap is now fixed.

## Failure clusters and disposition

Full ledger: [E2E_FAILURE_CLUSTERS.md](E2E_FAILURE_CLUSTERS.md).

| Cluster | Initial / follow-up signal | Classification | Disposition |
|---|---:|---|---|
| C1 mobile bootstrap/navigation | 26 initial rows | HARNESS + environment pressure | owned suite clean; no product defect |
| C2 late response/lifecycle registration | 12 initial rows | HARNESS | response registered before navigation/check; focused repeats pass |
| C3 special-cell contracts | 13 initial rows | HARNESS/test coverage boundary | isolated Pixel cluster pass; special paths stay explicit |
| C4 tiled loading/zoom/stroke oracle | 8 initial rows plus wave6 initial-plan race | HARNESS | state-driven waits, initial `workPlans` readiness, completed-response oracle, geometric sampling |
| C5 generic guided fixture hit treatment Fuse | 2 full-shard failures before fix | HARNESS fixture isolation | switched generic guided test to deterministic control fixture; 5/5 + full shard pass |
| C6 mobile worker/cold module event | 1 first-pass creator crop failure | ENVIRONMENT/provider | focused 3/3 and shard rerun pass; no quarantine |
| C7 long mobile visual/guidance journeys | 2 first-pass failures (glyph/guided) | ENVIRONMENT/HARNESS sensitivity | exact focused checks pass; guided root cause separated into C5 |
| C8 false-green release oracles | Gallery delete and low-zoom request-start review findings | HARNESS_FAILURE | strict identity/status/404 assertions and both request/response bounds added; focused checks pass |
| C9 hidden retry and fixture reuse | P0/special-delivery hidden retry, special-glyph and wave6 low-zoom user findings | HARNESS_FAILURE | UI retries removed; cohort reset, unique glyph owners, and per-project/repeat low-zoom users added; targeted checks pass |
| C10 missing R2 contract coverage | critical harness forced local storage | HARNESS_FAILURE / coverage gap | disposable S3-compatible contract job added; no production R2 touched |
| C11 critical browser scope ambiguity | iPhone lane had 11 expected skips, one worker-sensitive case and wave6 visual timeout | ENVIRONMENT/coverage boundary | explicit 14-test WebKit smoke subset; zone visual has the same explicit skip; physical iOS gate remains required |
| C12 legacy Alpha glyph fixture seed | 1 failure in the first complete post-correction matrix; 1/5 failure in focused reproduction | HARNESS_FAILURE | lead; `special-glyph-parity.spec.js`, `e2e-hooks.js` | explicit `alpha-glyph-kinds` fixture uses a stable seed and variant id; post-fix focused browser checks pass |
| C13 browser/Vite loopback host mismatch | 2 failures in the second complete matrix; both browser-side `ERR_CONNECTION_REFUSED` | HARNESS_FAILURE / environment boundary | lead; `playwright.config.js`, `e2e-global-setup.mjs` | browser base URL and Vite bind are both explicit `127.0.0.1`; pointer and Bomb focused repeats pass |
| C14 creator visual bootstrap resource exhaustion | 1 wave7 timeout; trace had `index.css: ERR_NO_BUFFER_SPACE` and DOM stuck on session recovery | ENVIRONMENT_PRESSURE | lead; no product file change | fresh Node22 Chromium repeat `10/10`; no retry, timeout inflation or quarantine |
| C15 tiled direct-read loopback timeout | 1 wave7 `ETIMEDOUT` on one direct tile read; neighboring tile requests and next stroke passed | ENVIRONMENT_PRESSURE | lead; no product file change | fresh Node22 Mobile Pixel repeat `5/5`; stroke `30/30`, API responses `200`, no retry or oracle weakening |
| C16 GitHub runtime path mismatch | 19 E2E/critical jobs stopped before Playwright with identical npm CLI `MODULE_NOT_FOUND` | HARNESS_FAILURE | lead; runtime wrappers and CI dispatch | centralized Node22/npm validation; targeted wrapper case `1/1`; exact-SHA dispatch pending |
| C17 summary-script lint warning | verify job reached `101/100` warnings due one new ANSI regex warning | HARNESS_FAILURE | lead; `summarize-e2e-results.mjs` | regex corrected; local lint back to strict `100/100` |

No product defect was proven. No assertion was weakened. No test was
quarantined and no obsolete test was removed. The old stitched matrix is now
historical evidence only; it is not final full-run proof for the current
correction SHA.

## Integrated commit ledger

- `3b43297` inventory and static audit docs.
- `ab1adc3` frozen diagnostic state.
- `70af41f` bounded C2/C4 wave.
- `16fb30c` post-integration targeted validation.
- `b6db4b6` Node 22 runner, retained output and critical gate.
- `e74c7fe` C4 fixture/oracle correction.
- `b9a82d8` critical title-selector correction.
- `16852a7` runtime/mobile oracle stabilization.
- `7d16ed3` deterministic control fixture for generic guided player.
- `e60e39c` bounded correction wave: strict Gallery/low-zoom oracles, no hidden
  UI retries, cohort progress reset, unique special-glyph owners, exact
  Node/npm preflight, explicit WebKit subset and disposable S3 contract.
- `9eaedea` bounded C12 correction: explicit Alpha glyph fixture contract and
  stable legacy generation seed; no product source change.
- `b4105a3` bounded C13 correction: align browser navigation with Vite's
  explicit loopback bind; no product source change.
- `508d917` bounded wave6 correction: wait for initial tiled WORK plan,
  isolate low-zoom users per project/repeat, skip unsupported WebKit creator
  visual path explicitly, remove its shared screenshot path.
- `f1ba991` bounded diagnostics correction: machine-readable failure
  fingerprints, SHA/run/shard-scoped CI artifacts, and captured run logs.

## Verification ledger

### Focused and repeated evidence

- C2 guided lifecycle: `5/5`.
- Corrected low-zoom: historical iPhone `5/5`; current Pixel post-wave
  correction `5/5` with retries `0`.
- Special visual Pixel fixture isolation: `5/5`.
- Creator crop iPhone: `3/3`.
- Legacy glyph parity: Pixel `5/5`; Chromium+iPhone `2/2`.
- Related tiled glyph parity: Chromium+Pixel `2/2`.
- C13 tiled pointer capture: `5/5`; Phase 2 Bomb: `5/5`.
- CI-mode C13 pair with separate HTML output: `2/2`.
- Low-zoom Pixel after wave6 correction: `5/5`, retries `0`.
- Zone visual matrix after wave6 correction: Chromium/Pixel `4/4`, WebKit
  `2` expected capability skips, `0` unexpected.
- Wave7 creator visual local targeted repeat: `10/10`, retries `0`.
- Wave7 tiled touch local targeted repeat: `5/5`, retries `0`; stroke
  diagnostics reported `30/30` painted cells on each pass.
- Guided player Pixel before fixture correction: `3/3`; after deterministic
  control fixture: `5/5`.
- Final control-fixture shard 14: `23 pass / 3 skip / 0 unexpected / 0 flaky`.

### Historical selected extended matrix

The prior selected evidence used one result for every shard at code/harness
SHA `7d16ed3`, but the reviewers correctly identified that its timestamps did
not prove one complete run after the last correction. It remains historical,
not final acceptance evidence.

- 16 shards; `367 pass`, `71 expected skip`, `0 unexpected`, `0 flaky`.
- Retries remained `0`; every shard exited `0`.
- Sum of selected shard test durations: `73 m 56.861 s` (local sequential
  runner-time proxy; not a GitHub billing number).
- The first post-fix wave was `364 pass / 71 skip / 3 unexpected`; the three
  affected shards were investigated, fixed or correctly classified, and
  rerun in one bounded correction sequence. The original red evidence remains
  in `test-results/full-seq3-final-shard-*`.

### First complete post-correction matrix

- Frozen SHA: `70a93a564ec353435550670fb618064a3f09578a`.
- All `16/16` sequential shards completed with fail-fast disabled.
- Result: `366 pass / 71 skip / 1 unexpected / 0 flaky`; the single failure
  was C12, the random legacy 96x96 glyph fixture omitting `artifact`.
- Wall-clock: `1 h 14 m 24.606 s`; the result is diagnostic evidence for the
  proven C12 correction, not final acceptance for the new SHA.
- Failure evidence: `test-results/final-wave4-shard-15/`.
- Focused C12 reproduction before correction: `4 pass / 1 fail` in five Pixel
  repeats. After correction: Pixel `5/5`, Chromium+iPhone `2/2`, and related
  tiled Chromium+Pixel `2/2`.

### Second complete post-correction matrix

- Frozen SHA: `958ec968b3390e6cfe8bd14669a02e20e015ebdb`.
- All `16/16` sequential shards completed with fail-fast disabled.
- Result: `365 pass / 71 skip / 2 unexpected / 0 flaky`.
- Both unexpected rows were C13 browser-side `ERR_CONNECTION_REFUSED`
  failures; traces and screenshots are retained under
  `test-results/final-wave5-shard-01/` and
  `test-results/final-wave5-shard-03/`.
- Wall-clock: `1 h 18 m 03.624 s`.
- The wave6 matrix below is required after the C13 correction.

### Wave6 complete matrix before bounded correction

- Frozen SHA: `f0c8d35cdbee1377b29623d7ad39629f99bf431a`.
- All `16/16` sequential shards completed with fail-fast disabled.
- Result: `365 pass / 71 skip / 2 unexpected / 0 flaky`; summed wall proxy
  `63 m 41.141 s`, slowest shard `10 m 20.586 s`.
- Shard 11: Mobile iPhone zone visual timed out on the 1200 creator preset;
  trace retained WebKit creator worker-module errors.
- Shard 16: Mobile Pixel low-zoom counted 11 cancelled (`net::ERR_ABORTED`)
  tile starts as overview work.
- Focused follow-up before correction: low-zoom Pixel `2/3` unexpected and
  `1/3` pass. After correction: low-zoom Pixel `5/5`; zone Chromium/Pixel
  `4/4`, WebKit `2` explicit skips, `0` unexpected.
- This is diagnostic evidence for the bounded correction, not final
  acceptance on the current SHA.

### Wave7 complete local diagnostic matrix on frozen `9cba274`

- All `16/16` sequential Node22 shards completed with fail-fast disabled and
  retries `0`.
- Result: `364 pass / 72 expected skip / 2 unexpected / 0 flaky`.
- Shard 2 Chromium: creator visual 430px timed out waiting for `Создать`;
  trace and screenshot showed the recovery shell and `index.css:
  net::ERR_NO_BUFFER_SPACE`.
- Shard 16 Mobile Pixel: one direct `/tiles/7/18` read returned local
  `connect ETIMEDOUT`; neighboring tile requests were successful and the
  following stroke test passed.
- Machine-readable per-shard summaries are retained under
  `test-results/final-wave7-shard-02/summary.json` and
  `test-results/final-wave7-shard-16/summary.json`; the CI workflow now emits
  the same summary for every shard.
- Classification: both rows are `ENVIRONMENT_PRESSURE` on the local Windows
  long-run path, not proven product defects. Fresh isolated targeted evidence
  is creator `10/10` and tiled touch `5/5`, retries `0`, with no code fix
  justified.
- Sum of recorded shard test durations: `39 m 28.037 s`; slowest shard test
  duration: `7 m 45.766 s`. This local sequential measurement is diagnostic,
  not authoritative GitHub billing or final acceptance.

### GitHub PR failure map on merge ref `6c1f8e6`

- Run `33386651214` completed all `16/16` extended shards, 3 critical lanes,
  verify, PostgreSQL and S3 jobs; no job was cancelled.
- All 16 extended and 3 critical jobs failed before Playwright because of the
  same C16 npm CLI path mismatch. Their summary steps failed secondarily on
  missing `results.json`; the correction now preserves an explicit
  `report_available: false` summary artifact without changing job status.
- Verify passed `455/455` unit tests but failed the strict lint budget at
  `101/100`; this was C17 and is corrected without changing the budget.
- PostgreSQL passed `100/100`; S3 contract passed `2/2`.
- The PR event used merge ref `6c1f8e6`; the workflow now supports manual
  dispatch so the next authoritative run will use the exact integration HEAD.

### Final critical gate

- Chromium: `26 pass / 0 skip / 0 unexpected / 0 flaky`, `6 m 48.958 s`.
- Mobile iPhone: `15 pass / 11 expected conditional skip / 0 unexpected /
  0 flaky`, `2 m 38.644 s`.
- Mobile Pixel: `26 pass / 0 skip / 0 unexpected / 0 flaky`, `6 m 53.653 s`.
- Retries `0`; release-critical wall-clock target is achievable when the
  three project jobs run in CI parallelism. The post-correction WebKit smoke
  check is `14/14` locally; the earlier 15-test attempt exposed a WebKit worker
  module/provider failure on creator save and is recorded as C6/C11 evidence.
  Physical Telegram/iOS remains a separate human/device gate.

### Non-E2E gates

- Root unit suite: `455 pass / 0 fail`, `32.620 s`.
- Server suite: `401 pass / 0 fail / 67 skipped`, `205.805 s`.
- Lint: exit `0`, warning budget `100/100`; warnings are existing debt and the
  budget is exactly saturated, so this is a pass with a maintenance warning.
- Vite build: pass, `7.44 s`.
- `git diff --check`: pass (only line-ending warnings from generated evidence).
- PostgreSQL service suite: `100 pass / 0 fail / 0 skipped`, exit `0`, duration
  `87.537 s`, on fresh disposable Docker `postgres:16`; migrations were
  `28 applied / 0 skipped` under Node `22.23.2` and npm `10.9.8`. The container
  was removed after the run. Evidence is saved in
  `docs/evidence/postgres-final.md`; the no-`DATABASE_URL` result (`42/0/65`)
  remains historical pre-service evidence, not the final result.
- S3-compatible storage contract: `2 pass / 0 fail / 0 skipped`, Node
  `22.23.2`, disposable in-process object-store endpoint; no production R2
  credentials or objects were used.

### Exact-SHA GitHub run 33388276591

- Frozen SHA: `3a993d14da514fa564909d4461f66a81bab42357`; all 16 extended and
  all 3 critical jobs completed with fail-fast disabled and retries `0`.
- Critical: `66 pass / 0 unexpected / 0 flaky`.
- Extended: `356 pass / 72 expected skip / 5 unexpected / 0 flaky`; failures
  were only in shards 3, 4 and 6.
- Verify, PostgreSQL and S3 were green. The five representative failures pass
  on fresh isolated Node22 repeats: guided `3/3`, keyboard `3/3`, Bomb `3/3`,
  accessibility iPhone `5/5`, tiled glyph `5/5`.
- The first two targeted PowerShell invocations with invalid `--project`
  transfer/grep syntax are recorded as `TOOLING_INVOCATION_ERROR`, not test
  evidence.
- Failure evidence is retained under `test-results/github-33388276591` and
  the GitHub run log; classification is C18 shard lifetime/resource pressure.

### Topology correction wave

- Static comparison was run on the 438 nominal project cases and 146 logical
  groups. Built-in projected slowest workload: 16=`22.57 min`, 24=`19.83 min`
  with 3 empty shards, 32=`17.54 min` with 4 empty shards.
- Selected: deterministic weighted 16-shard manifest, projected slowest
  workload `9.84 min`, zero empty shards.
- Manifest: `docs/E2E_SHARD_LOAD_MANIFEST.json`.
- Coverage preflight: `146/146` logical, `438/438` project cases, zero
  duplicate and zero unmatched assignments.
- The topology wave changes only CI selection, diagnostics and runtime
  measurement. No product source or individual extended assertion changed.

## CI cost and remaining debt

- Frozen diagnostic: `144.46` one-worker wall-clock minutes.
- Selected extended matrix: `73.95` sequential shard-duration minutes;
  slowest selected shard is shard 15 at approximately `11 m 56.614 s`.
- Critical local project durations are approximately `6.82`, `2.64` and
  `6.89` minutes; CI parallel wall-clock should be approximately the slowest
  lane plus setup, subject to runner/provider variance.
- The earlier 16-way concurrent local attempt produced 79 unexpected results
  from resource pressure. This is why local evidence is sequential; CI shard
  concurrency still needs an external controlled measurement.
- Remaining debt: one authoritative exact-SHA GitHub run after the topology
  wave, post-final independent Sol Max reviews, physical Telegram/iOS proof,
  residual legacy timing/catch cleanup and final measured topology cost.

## Next action

Run `33414881259` completed all jobs and had one C22 Mobile iPhone keyboard
readiness race. Its fresh isolated representative passed `5/5`; the causal
helper correction is committed as `fae35b598161b65b373ff7674a80ea2ae60b864f`,
with related input coverage green across all browser projects. Run docs
coverage/lint/diff preflight, push the durable state, then allow exactly one
authoritative GitHub matrix on this correction SHA to finish in full. If it is
green, stop testing and proceed directly to the two independent reviews and
final handoff; do not start another local full matrix.
