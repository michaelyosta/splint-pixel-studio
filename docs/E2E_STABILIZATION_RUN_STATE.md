# E2E stabilization run state

Status: `FINAL_VALIDATION — expanded critical green; final 16-shard extended matrix running`

This is the durable state for the single E2E stabilization pass. It is updated
at phase boundaries and after every bounded verification/integration wave.

## Baseline and safety

- Base branch: `origin/main`
- Base SHA: `dc01c103544ac953e97cb77fc501842f9dab5f1b`
- Supplied release-candidate SHA: `6ce8f60bdd673030bdbb705f2111c69bdfacf546`
- RC relation: supplied RC is an ancestor of `origin/main`.
- Integration branch: `codex/e2e-system-stabilization`
- Current integration SHA: `b9a82d8a2fb10e5580fb487035ebf84983a7fb0a` plus uncommitted final coverage/runtime hardening wave; no source SHA is frozen until this validation completes.
- Primary dirty checkout: `C:\Users\misa\Desktop\Splint-Gemini`; branch/HEAD
  remain unchanged. A special-contract agent briefly launched a focused run
  from this primary path; it was interrupted immediately after detection.
  Existing dirty evidence files were not reverted or imported. This boundary
  incident is recorded as harness/process debt and all further agent work must
  prove isolated cwd before execution.
- Production: no deployment or production configuration/data/webhook/payment change.
- Stars: unchanged, `OFF / FAIL-CLOSED`.

## Active worktrees and agents

| Role | Worktree | Branch/commit | Ownership | Status |
|---|---|---|---|---|
| Lead integration | `C:\Users\misa\AppData\Local\Temp\splint-e2e-system-stabilization` | `codex/e2e-system-stabilization` / `b9a82d8` | stabilization docs, CI/harness integration | final validation |
| Diagnostic runner | `C:\Users\misa\AppData\Local\Temp\splint-e2e-diagnostic-clean` | detached `ab1adc3` | frozen read-only run artifacts | complete; generated evidence unintegrated |
| Primary checkout | `C:\Users\misa\Desktop\Splint-Gemini` | user-owned dirty branch | unrelated dirty evidence | untouched |
| C1 navigation | agent `01a052cd-d0b1-71c0-a10c-b0db0fdd743f` (isolated worktree) | Luna Max | C1-owned specs | complete; no causal fix |
| C2 lifecycle | agent `01a052cd-d1f5-7fc3-b622-c763d471a607` (isolated worktree) | Luna Max | C2-owned specs | complete; commit reviewed |
| C3 special contracts | `C:\Users\misa\AppData\Local\Temp\splint-e2e-special-contract-owner` | lead after replacement worker boundary refusal | C3-owned specs | isolated cluster run complete; 16 passed; no commit indicated |
| C4 tiled | agent `01a052cd-d47a-7341-a1a6-f4dd48d752ac` (isolated worktree) | Luna Max | C4-owned specs | complete; commit reviewed |

Three original cluster agents completed in isolated worktrees; C3 was completed
by the lead after a launcher primary-cwd incident. No source or harness fix was
made before the complete frozen diagnostic.

## E2E inventory and static audit

- Inventory: [E2E_TEST_INVENTORY.md](E2E_TEST_INVENTORY.md)
- Static audit: [E2E_HARNESS_AUDIT.md](E2E_HARNESS_AUDIT.md)
- Performance evidence: [E2E_CI_PERFORMANCE.md](E2E_CI_PERFORMANCE.md)
- 39 specs, 146 logical tests, 438 nominal project cases.
- Static audit found 49 `waitForTimeout` calls, 37 broad empty catches, 7
  response-wait/catch patterns, 8 fixed-coordinate patterns, 28 timeout
  overrides, 60 browser-storage references, 136 request references, and 52
  explicit screenshot calls.
- Current harness configuration: one worker, `fullyParallel=false`, retries
  `0`, `trace: retain-on-failure`, `screenshot: only-on-failure`; CI emits JSON
  results and uploads `test-results/` plus `playwright-report/` per shard.
  `PLAYWRIGHT_OUTPUT_DIR` allows each local validation run to retain its own
  artifacts instead of allowing a later Playwright invocation to clear the
  previous run's output directory.

## Frozen diagnostic

- Frozen source SHA: `ab1adc3daaec6a1b4305952ab342f34e70759673`.
- Runtime: Node `v22.23.2`, npm `10.9.8`, Playwright `1.61.1`.
- Browser projects: `chromium`, `Mobile iPhone`, `Mobile Pixel`.
- Host: Windows; Linux Docker attempt excluded as invalid environment evidence.
- Command: `node22 node_modules/@playwright/test/cli.js test --reporter=json`.
- Start: `2026-08-30T10:28:14.224Z` / `15:28:14` local.
- End: `2026-08-30T12:52:41.662Z` / `17:52:41` local.
- Duration: `8,667,437.615 ms` / `2 h 24 m 27.438 s`.
- Result: 302 passed, 59 unexpected, 71 skipped, 0 flaky.
- Unexpected split: 48 failed and 11 timed out.
- Project result: Chromium `134/0/0/10` pass/fail/timeout/skip; iPhone
  `78/16/3/47`; Pixel `90/32/8/14`.
- Full matrix: [E2E_DIAGNOSTIC_MATRIX.md](E2E_DIAGNOSTIC_MATRIX.md).
- Artifact root: `C:\Users\misa\AppData\Local\Temp\splint-e2e-diagnostic-clean\test-results`.
- All unexpected results have `error-context.md`; no failure trace or generic
  screenshot attachment was produced under the frozen pre-wave config.

## Failure clusters

Initial candidates from the frozen matrix; classification remains provisional
until focused reproduction proves the common mechanism.

| Candidate cluster | Affected result groups | Provisional class | Owner | Status |
|---|---:|---|---|---|
| Mobile catalog/player navigation and readiness | accessibility, creator, input, onboarding | `HARNESS_FAILURE` with pressure contributor | `e2e-navigation-owner` | complete; clean focused pass; no fix required |
| Route/resume/lifecycle readiness | bfcache, core-feel, guided, p0, sessions, stabilization | `HARNESS_FAILURE` | `e2e-lifecycle-owner` | complete; causal fix integrated |
| Special-cell fixtures/contracts | phase2, bomb, special, help | `HARNESS_FAILURE` / contract review | `e2e-special-contract-owner` | complete; isolated pass; no fix required |
| Tiled loading/zoom/stroke oracles | glyph, completion, low-zoom, stroke | `HARNESS_FAILURE` with pressure contributor | `e2e-tiled-owner` | complete; causal test fixes integrated |
| Docker Linux runtime | separate invalid attempt | `ENVIRONMENT_FAILURE` | lead | excluded from matrix |
| Route/readiness and resume state | core-feel, guided, p0, stabilization | `HARNESS_FAILURE` | complete | response registration fixed; repeated PASS |
| Mobile special-cell treatment state | phase2, special-bomb, special-cells, help | `HARNESS_FAILURE` candidate disproven by clean run | complete | isolated contract suite passed |
| Tiled loading/zoom/completion | glyph, completion, low-zoom | `HARNESS_FAILURE` | complete | causal readiness/oracle corrections; repeated PASS |
| Tiled stroke/post-action persistence | bfcache, stroke engine | `HARNESS_FAILURE` | complete | strict corrected stroke oracle; repeated PASS |
| Shared mutable fixture / server pressure | cross-cutting mobile failures | `ENVIRONMENT_FAILURE` contributor | assessed | isolated shards remove observed cross-run pressure |
| Invalid Docker runtime | separate container attempt | `ENVIRONMENT_FAILURE` | excluded | host Docker socket defect; not product matrix |

No test is quarantined. No assertion has been weakened. No product failure has
yet been declared or silently treated as a harness failure.

## Integration ledger

- Commits awaiting integration: none; the C2 lifecycle and C4 tiled commits
  were reviewed and integrated in `70af41f`.
- Integrated commits: `3b43297` inventory/audit; `ab1adc3` frozen diagnostic
  state; `70af41f` bounded C2/C4 + lead harness/docs wave; `16fb30c` targeted
  validation record; `b6db4b6` Node 22 suite runner, retained output
  directories, and the isolated release-critical CI gate; `e74c7fe` bounded
  C4 fixture/oracle correction; `b9a82d8` critical-suite selector correction.
- Additional correction waves: at most one bounded wave after post-fix full
  validation identifies a newly proven root cause.

## Verification ledger

- Frozen diagnostic: complete, RED, evidence captured.
- Cluster reproductions: C1 clean owned-suite `111 passed / 6 skipped`; C2
  affected rows passed with guided `5/5`; C3 full isolated Pixel cluster
  `16 passed`; C4 low-zoom `5/5` and clean stroke `2/2`, with one explicit
  load-sensitive residual. These are evidence against a simple product-wide
  failure, not final classifications for every matrix row.
- Targeted verification: complete for owner checks and integrated SHA: Mobile
  Pixel guided/migration/glyph/low-zoom/stroke `15/15 passed` in `9.9m` with
  retries `0`.
- Repeated previously flaky scenarios: C2 guided flow `5/5`; C4 corrected
  tiled stroke `5/5`; low-zoom `5/5`; related owner checks pass with retries
  `0`.
- Post-integration full CI-equivalent run: RED under a single mixed Windows
  invocation on `16fb30c` (317 executed, 44 unexpected, 71 skipped, 2 h 15 m
  16 s); the four fresh Chromium failures reproduced as individual PASSes.
  Final exact-SHA full proof is recorded below in the isolated shard evidence.
- Release-critical gate on `b9a82d8` before auth/Gallery coverage expansion:
  Chromium `23/23`, Mobile iPhone `12/12` executable (`11` conditional
  skips), and Mobile Pixel `23/23`; retries `0`, unexpected `0`. The current
  manifest is now 26 tests in 16 files and requires a fresh final run.
- Expanded release-critical matrix (current worktree, before final commit):
  Chromium `26/26`, Mobile iPhone `15 passed / 11 expected conditional skips`,
  Mobile Pixel `26/26`; all `0` unexpected and `0` flaky, retries `0`. The
  current final 16-shard extended matrix is running with separate ports
  `5901..5916` / `3901..3916` and output roots
  `test-results/full-final-shard-01..16`.
- Reliability confirmation: the prior exact-SHA full 16-shard matrix was
  green; the current expanded matrix must complete before this ledger is
  promoted to final. Repeated focused evidence exists for lifecycle, input,
  tiled, and special-cell mechanisms. No Playwright retry was used.
- Unit/server/lint/build/diff checks: Node 22 unit `455/455`, server `401` pass
  with `67` dependency-gated skips, syntax `67/67`, lint and build pass, and
  `git diff --check` pass. PostgreSQL service suite is not locally proven
  because Docker/PostgreSQL is unavailable on this Windows host; CI postgres
  job remains the authoritative gate.
- Independent reliability/product-integrity reviews: pending.

## Final extended validation evidence

- Exact code SHA: `b9a82d8a2fb10e5580fb487035ebf84983a7fb0a`.
- 16 isolated shard contexts: every shard exited `0`; aggregate `361`
  executed, `71` expected skips, `0` unexpected, `0` flaky.
- Results: `test-results/full-b9-shard-01/` through
  `test-results/full-b9-shard-16/`; aggregate ledger:
  `test-results/full-b9-shards-summary.log`.
- Sum of shard test durations: `75 m 15.732 s`; slowest shard:
  `12 m 08.608 s`. This sequential Windows measurement is a runner-time
  proxy, not a GitHub billing claim.

## Cost and remaining debt

- Diagnostic wall-clock: `2 h 24 m 27.438 s` on Windows, one worker.
- Historical GitHub reference: main run `33251937153` used approximately
  `101.77` aggregate E2E runner minutes / `33.98` minutes wall-clock and was
  RED in two tiled-stroke shards; RC run `33247780450` used `86.03` / `19.75`
  and was GREEN. These are not post-stabilization measurements.
- Slowest observed cases include Pixel tiled stroke timeouts at 180s, Pixel
  glyph parity at 174.2s, and Chromium visual audit at 223.7s.
- Remaining debt: obtain a post-wave PostgreSQL service result, run independent
  reliability and product-integrity reviews, and complete the handoff/final
  document commit. No test is quarantined and no product defect is proven.
- Next action: collect all `full-final-shard-*` JSON results, run mandatory
  non-E2E gates, update the evidence docs, obtain fresh independent reviews,
  then finalize the handoff and recheck primary/production safety.
