# E2E stabilization run state

Status: `POST_INTEGRATION_VALIDATION — integration wave complete`

This is the durable state for the single E2E stabilization pass. It is updated
at phase boundaries and after every bounded verification/integration wave.

## Baseline and safety

- Base branch: `origin/main`
- Base SHA: `dc01c103544ac953e97cb77fc501842f9dab5f1b`
- Supplied release-candidate SHA: `6ce8f60bdd673030bdbb705f2111c69bdfacf546`
- RC relation: supplied RC is an ancestor of `origin/main`.
- Integration branch: `codex/e2e-system-stabilization`
- Current integration SHA: `70af41f94d094239a662fa5bc43b2cb75510a1b4`
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
| Lead integration | `C:\Users\misa\AppData\Local\Temp\splint-e2e-system-stabilization` | `codex/e2e-system-stabilization` / `ab1adc3` | stabilization docs, CI/harness integration | active |
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
- 38 specs, 144 logical tests, 432 nominal project cases.
- Static audit found 49 `waitForTimeout` calls, 37 broad empty catches, 7
  response-wait/catch patterns, 8 fixed-coordinate patterns, 28 timeout
  overrides, 60 browser-storage references, 136 request references, and 52
  explicit screenshot calls.
- Current harness configuration: one worker, `fullyParallel=false`, retries
  `0`, `trace: retain-on-failure`, `screenshot: only-on-failure`; CI emits JSON
  results and uploads `test-results/` plus `playwright-report/` per shard.

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
| Mobile catalog/player navigation and readiness | accessibility, creator, input, onboarding | `HARNESS_FAILURE` candidate | `e2e-navigation-owner` | assigned; clean focused pass |
| Route/resume/lifecycle readiness | bfcache, core-feel, guided, p0, sessions, stabilization | `UNKNOWN` | `e2e-lifecycle-owner` | assigned |
| Special-cell fixtures/contracts | phase2, bomb, special, help | `HARNESS_FAILURE` candidate | `e2e-special-contract-owner` | assigned; clean 1200 pass |
| Tiled loading/zoom/stroke oracles | glyph, completion, low-zoom, stroke | `HARNESS_FAILURE`/`ENVIRONMENT_FAILURE` candidate | `e2e-tiled-owner` | assigned; clean stroke pass |
| Docker Linux runtime | separate invalid attempt | `ENVIRONMENT_FAILURE` | lead | excluded from matrix |
| Route/readiness and resume state | core-feel, guided, p0, stabilization | `UNKNOWN` | pending | reproduce |
| Mobile special-cell treatment state | phase2, special-bomb, special-cells, help | `UNKNOWN` | pending | reproduce |
| Tiled loading/zoom/completion | glyph, completion, low-zoom | `UNKNOWN` / performance vs harness | pending | reproduce |
| Tiled stroke/post-action persistence | bfcache, stroke engine | `UNKNOWN` / environment vs oracle | pending | reproduce |
| Shared mutable fixture / server pressure | cross-cutting mobile failures | `UNKNOWN` | pending | inspect helpers and logs |
| Invalid Docker runtime | separate container attempt | `ENVIRONMENT_FAILURE` | lead | excluded from product matrix |

No test is quarantined. No assertion has been weakened. No product failure has
yet been declared or silently treated as a harness failure.

## Integration ledger

- Commits awaiting integration: `7cc4704d7a21515d799b39d34c2cc547694b43ab`
  (C2 lifecycle), `3e9744657d4d705d48f7f30bd1cc33c8c39c0b9a` (C4 tiled).
- Integrated commits: `3b43297` inventory/audit; `ab1adc3` frozen diagnostic
  state; `70af41f` bounded C2/C4 + lead harness/docs wave.
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
- Repeated previously flaky scenarios: partial evidence captured; final
  post-integration repeat remains pending.
- Post-integration full CI-equivalent run: pending.
- Reliability confirmation: pending.
- Unit/server/PostgreSQL/lint/build/diff checks: pending.
- Independent reliability/product-integrity reviews: pending.

## Cost and remaining debt

- Diagnostic wall-clock: `2 h 24 m 27.438 s` on Windows, one worker.
- Historical GitHub reference: main run `33251937153` used approximately
  `101.77` aggregate E2E runner minutes / `33.98` minutes wall-clock and was
  RED in two tiled-stroke shards; RC run `33247780450` used `86.03` / `19.75`
  and was GREEN. These are not post-stabilization measurements.
- Slowest observed cases include Pixel tiled stroke timeouts at 180s, Pixel
  glyph parity at 174.2s, and Chromium visual audit at 223.7s.
- Remaining debt: prove causes, remove causal timing/isolation defects, add
  useful failure artifacts, define fast/extended gates, and measure CI cost.
- Next action: inspect matrix/error contexts, reproduce causal clusters, then
  delegate only proven independent clusters to isolated agents.
