# E2E stabilization run state

Status: `FINAL_MATRIX_PENDING — bounded correction wave committed; frozen full run pending`

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
- Current code/harness SHA: `e60e39cece645a4bd776e3a4c4e58a36697ee7b8`
  (Gallery/low-zoom oracles, retry removal, fixture reset, exact runtime,
  explicit WebKit subset and S3 contract gate).
- Current integration HEAD: `e60e39cece645a4bd776e3a4c4e58a36697ee7b8`.
- Primary checkout: `C:\Users\misa\Desktop\Splint-Gemini`; existing dirty
  evidence and user-owned files were not reset, reverted, staged or imported.
- Integration worktree: `C:\Users\misa\AppData\Local\Temp\splint-e2e-system-stabilization`.
- Production: no deployment and no Cloudflare/Render/Neon/R2/Telegram/payment
  mutation. `showalove.ru` remains Closed Alpha LIVE.
- Stars: unchanged, `OFF / FAIL-CLOSED`.

## Active worktrees, agents and ownership

| Role | Location / identity | Ownership | Status |
|---|---|---|---|
| Lead integration | integration worktree, `codex/e2e-system-stabilization` | docs, CI/harness integration, bounded verification | handoff prepared; external gates blocked |
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
- 411 cases remain after source-level project skips; the final matrix reports
  367 executed passes and 71 explicit/conditional skips (the additional skips
  are capability or environment gates, not quarantine).
- Release-critical proposal is maintained in
  `scripts/run-e2e-suite-node22.mjs`: 26 title-selected tests on Chromium and
  Mobile Pixel, plus an explicit 14-test supported Mobile iPhone/WebKit smoke
  subset. Omitted iPhone cases are conditional WebKit/1200/touch or known
  worker/provider-bound scenarios; physical iOS/Telegram remains separate.
- Extended regression is the complete `e2e/` suite in 16 fail-fast-disabled
  shards.
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
| C4 tiled loading/zoom/stroke oracle | 8 initial rows | HARNESS | state-driven waits, completed-response oracle, geometric sampling |
| C5 generic guided fixture hit treatment Fuse | 2 full-shard failures before fix | HARNESS fixture isolation | switched generic guided test to deterministic control fixture; 5/5 + full shard pass |
| C6 mobile worker/cold module event | 1 first-pass creator crop failure | ENVIRONMENT/provider | focused 3/3 and shard rerun pass; no quarantine |
| C7 long mobile visual/guidance journeys | 2 first-pass failures (glyph/guided) | ENVIRONMENT/HARNESS sensitivity | exact focused checks pass; guided root cause separated into C5 |
| C8 false-green release oracles | Gallery delete and low-zoom request-start review findings | HARNESS_FAILURE | strict identity/status/404 assertions and both request/response bounds added; focused checks pass |
| C9 hidden retry and fixture reuse | P0/special-delivery hidden retry and special-glyph deterministic user findings | HARNESS_FAILURE | UI retries removed; cohort reset and unique glyph owners added; targeted checks pass |
| C10 missing R2 contract coverage | critical harness forced local storage | HARNESS_FAILURE / coverage gap | disposable S3-compatible contract job added; no production R2 touched |
| C11 critical browser scope ambiguity | iPhone lane had 11 expected skips and one worker-sensitive case | ENVIRONMENT/coverage boundary | explicit 14-test WebKit smoke subset; physical iOS gate remains required |

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

## Verification ledger

### Focused and repeated evidence

- C2 guided lifecycle: `5/5`.
- Corrected low-zoom iPhone: historical pre-wave `5/5`; current post-wave
  oracle has one focused pass and is scheduled for a fresh repeated run.
- Special visual Pixel fixture isolation: `5/5`.
- Creator crop iPhone: `3/3`.
- Glyph parity iPhone: `1/1` exact focused check.
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
- Remaining debt: post-correction independent Sol Max reviews, one complete
  final 16-shard run, physical Telegram/iOS proof, residual legacy timing/catch
  cleanup and a controlled GitHub CI cost measurement.

## Next action

The bounded correction wave is committed at `e60e39c`. Run focused checks, then
execute one complete 16-shard Node22 matrix without changing SHA. Aggregate that run,
rerun the two independent reviews against its SHA, execute the remaining gates,
and only then decide whether the terminal state is justified.
