# E2E stabilization run state

Status: `BLOCKED — authoritative PostgreSQL/CI evidence and independent final reviews unavailable`

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
- Current code/harness SHA: `7d16ed3` (`test: isolate guided player from special-cell offers`).
- Primary checkout: `C:\Users\misa\Desktop\Splint-Gemini`; existing dirty
  evidence and user-owned files were not reset, reverted, staged or imported.
- Integration worktree: `C:\Users\misa\AppData\Local\Temp\splint-e2e-system-stabilization`.
- Production: no deployment and no Cloudflare/Render/Neon/R2/Telegram/payment
  mutation. `showalove.ru` remains Closed Alpha LIVE.
- Stars: unchanged, `OFF / FAIL-CLOSED`.

## Active worktrees, agents and ownership

| Role | Location / identity | Ownership | Status |
|---|---|---|---|
| Lead integration | integration worktree, `codex/e2e-system-stabilization` | docs, CI/harness integration, bounded verification | active |
| Frozen diagnostic | `C:\Users\misa\AppData\Local\Temp\splint-e2e-diagnostic-clean` | read-only frozen evidence | complete |
| Primary checkout | `C:\Users\misa\Desktop\Splint-Gemini` | unrelated user work/evidence | untouched |
| C1 navigation | `01a052cd-d0b1-71c0-a10c-b0db0fdd743f` | navigation/readiness cluster | complete; no speculative fix |
| C2 lifecycle | `01a052cd-d1f5-7fc3-b622-c763d471a607` | late response/lifecycle cluster | complete; integrated |
| C3 special contracts | isolated lead replacement after boundary refusal | special-cell contract cluster | complete; no fix |
| C4 tiled | `01a052cd-d47a-7341-a1a6-f4dd48d752ac` | tiled loading/stroke cluster | complete; integrated |

No commits are awaiting integration. No subagent has permission to change the
primary checkout or production state.

## Independent final review status

Two requested Sol Max read-only reviews were dispatched against the final
code/harness SHA, one for Test Reliability and one for Product Integrity. Both
terminated before producing a review because the model provider returned the
same external usage-limit error. No reviewer PASS/FAIL is inferred from that
error, and the lead's local inspection is not counted as independent review.

## E2E inventory and classification

- Inventory: [E2E_TEST_INVENTORY.md](E2E_TEST_INVENTORY.md).
- 39 Playwright spec files, 146 logical tests, 438 nominal project cases.
- 411 cases remain after source-level project skips; the final matrix reports
  367 executed passes and 71 explicit/conditional skips (the additional skips
  are capability or environment gates, not quarantine).
- Release-critical proposal is maintained in
  `scripts/run-e2e-suite-node22.mjs`: 26 title-selected tests across the three
  projects.
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

No product defect was proven. No assertion was weakened. No test was
quarantined and no obsolete test was removed.

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

## Verification ledger

### Focused and repeated evidence

- C2 guided lifecycle: `5/5`.
- Corrected low-zoom iPhone: `5/5`.
- Special visual Pixel fixture isolation: `5/5`.
- Creator crop iPhone: `3/3`.
- Glyph parity iPhone: `1/1` exact focused check.
- Guided player Pixel before fixture correction: `3/3`; after deterministic
  control fixture: `5/5`.
- Final control-fixture shard 14: `23 pass / 3 skip / 0 unexpected / 0 flaky`.

### Final selected extended matrix

The selected final evidence is one result for every shard, all on the same
code/harness SHA `7d16ed3`: shards 1–6, 8–9, 11–13 and 15–16 from the final
wave; shard 7 and shard 10 from their bounded green reruns; shard 14 from the
control-fixture rerun.

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
  three project jobs run in CI parallelism. Physical Telegram/iOS remains a
  separate human/device gate.

### Non-E2E gates

- Root unit suite: `455 pass / 0 fail`, `32.620 s`.
- Server suite: `401 pass / 0 fail / 67 skipped`, `205.805 s`.
- Lint: exit `0`, warning budget `100/100`; warnings are existing debt and the
  budget is exactly saturated, so this is a pass with a maintenance warning.
- Vite build: pass, `7.44 s`.
- `git diff --check`: pass (only line-ending warnings from generated evidence).
- PostgreSQL suite: `42 pass / 0 fail / 65 skipped`, exit `0`, but no
  `DATABASE_URL` and no local PostgreSQL service were available. This is not
  authoritative PostgreSQL PASS and remains a strict blocker.

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
- Remaining debt: real PostgreSQL service proof, independent Sol Max reviews,
  physical Telegram/iOS proof, residual legacy timing/catch cleanup and a
  controlled GitHub CI cost measurement.

## Next action

Re-run the two independent final reviews when the Sol Max provider is
available, obtain authoritative PostgreSQL plus live branch CI evidence, and
recheck primary Git/production safety. Until then, hand off with these exact
blockers; do not close as stable.
