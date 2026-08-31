# Splint E2E system stabilization handoff

Status: `E2E_MATRIX_GREEN — terminal E2E_SYSTEM_STABLE pending PostgreSQL service proof and independent review records`

## Release and Git boundary

- Base branch/SHA: `origin/main` / `dc01c103544ac953e97cb77fc501842f9dab5f1b`.
- Supplied RC: `6ce8f60bdd673030bdbb705f2111c69bdfacf546`, confirmed ancestor of
  `origin/main`.
- Integration branch: `codex/e2e-system-stabilization`.
- Final code-and-harness evidence SHA: `7d16ed3a575efd8c9bc71199e6ce18d55400e8ce`.
  Any later commit in this branch is documentation finalization only unless
  explicitly stated otherwise.
- Primary checkout remained user-owned and dirty; no reset, force push,
  deployment, or production mutation was performed.
- Production remains `showalove.ru` / Closed Alpha LIVE. Stars remain
  `OFF / FAIL-CLOSED`.

## Inventory and audit

The complete per-spec inventory is [E2E_TEST_INVENTORY.md](E2E_TEST_INVENTORY.md).
It contains 39 Playwright specs, 146 logical tests, 438 nominal project cases,
411 expected runnable cases before source-gated skips, browser-project mapping,
feature area, criticality, helpers, fixtures, external dependencies and
overlap notes.

The read-only static audit is [E2E_HARNESS_AUDIT.md](E2E_HARNESS_AUDIT.md).
At the frozen base it recorded 49 `waitForTimeout` calls, 37 broad empty
catches, 7 response-wait/catch patterns, 8 fixed-coordinate patterns, 28
timeout overrides, 60 browser-storage references, 136 request references and
52 explicit screenshot calls. The stabilization pass addressed only proven
failure paths; it did not mechanically rewrite harmless legacy timing or
remove broad regression coverage.

## Frozen diagnostic

The frozen diagnostic matrix is [E2E_DIAGNOSTIC_MATRIX.md](E2E_DIAGNOSTIC_MATRIX.md).
It ran before any fix at SHA `ab1adc3daaec6a1b4305952ab342f34e70759673`, on
Node `22.23.2`, Playwright `1.61.1`, one worker, retries `0`, fail-fast off.

- Nominal matrix: 432 cases.
- Result: `302 passed`, `59 unexpected` (`48 failed` + `11 timed out`),
  `71 skipped`, `0 flaky`.
- Chromium: `134` pass, `0` unexpected, `10` skip.
- Mobile iPhone: `78` pass, `19` unexpected, `47` skip.
- Mobile Pixel: `90` pass, `40` unexpected, `14` skip.
- Duration: `2 h 24 m 27.438 s`.
- Every unexpected row has `error-context.md`; the old trace policy produced
  no trace/screenshot for this retries-zero run, which is itself recorded as a
  diagnostics gap.

## Root-cause clusters and disposition

The full cluster ledger is [E2E_FAILURE_CLUSTERS.md](E2E_FAILURE_CLUSTERS.md).

| Cluster | Initial rows | Final disposition |
|---|---:|---|
| C1 mobile bootstrap/navigation/readiness | 26 | Clean owned-suite pass; no product fix required |
| C2 lifecycle/late response registration | 12 | Harness/test fix: register required response before navigation and validate status/body |
| C3 special-cell fixture/contracts | 13 | Clean isolated Pixel cluster pass; no product fix required |
| C4 tiled loading/zoom/stroke oracle | 8 | Harness/test fixes: causal state wait, no-special fixture span, geometric cell-center sampling |
| C5 generic guided fixture / Fuse offer | 1 recurring full-shard row | Harness fixture fix: deterministic control cohort |
| C6 Creator WebKit worker/module sensitivity | 1 first-pass row | Environment/provider sensitivity; bounded rerun green |
| C7 long mobile glyph/guidance sensitivity | 2 first-pass rows | Environment/provider sensitivity; focused and selected rerun green |

The initial 59 failures were therefore not treated as 59 independent agents or
as product defects. Proven harness/test defects were corrected in C2, C4 and
C5; C1, C3, C6 and C7 were retained as isolated environment/contract evidence
with bounded green verification. No product defect was proven, no product
source was changed, no assertion was weakened, no obsolete test was removed,
and no test was quarantined.

## Harness changes

- Node 22 is authoritative for E2E through the explicit local wrapper and
  `test:e2e:ci-local`.
- `test:e2e:critical` defines the release-critical subset; it enumerates 26
  cases from the selected critical files and accepts a project selector.
- `test:e2e:extended` names the complete suite; CI continues to run it in 16
  fail-fast-disabled shards.
- Trace is `retain-on-failure`, screenshot is `only-on-failure`, retries stay
  `0`, and CI emits JSON plus line output.
- `PLAYWRIGHT_OUTPUT_DIR` and `PLAYWRIGHT_JSON_OUTPUT_FILE` isolate artifacts
  per run/shard; CI uploads `test-results/` and `playwright-report/` on every
  outcome.
- No generic retry, arbitrary sleep, hidden catch, or weakened numeric oracle
  was introduced as a stabilization mechanism.

## Release-critical and extended gates

Release-critical covers boot, signed Telegram auth, artwork/player entry, painting/input,
stroke persistence, reload/resume, Creator, upload, tiled painting/completion,
premium locked state, and Stars fail-closed. The exact list is maintained in
`scripts/run-e2e-suite-node22.mjs` and runs across Chromium, Mobile iPhone and
Mobile Pixel. The emulated iPhone lane intentionally reports conditional
skips for Chromium/CDP-only and 1200×1200 software-rendering scenarios; those
are not evidence for physical iOS. A separate physical Telegram WebView/iOS
gate is required before claiming full iPhone release coverage.

Extended regression is the complete 39-spec suite, including accessibility
breadth, rare mobile combinations, long journeys, visual evidence and legacy
compatibility paths. Source-gated skips remain explicit and are not silently
converted into passes.

The formal quarantine rule is [E2E_QUARANTINE_POLICY.md](E2E_QUARANTINE_POLICY.md).
Current quarantine count is zero.

## Final E2E evidence

Release-critical on final code/harness SHA `7d16ed3`:

- Chromium: `26 pass`, `0 unexpected`, `0 flaky`, `6 m 48.958 s`.
- Mobile iPhone: `15 executable pass`, `11 conditional skips`, `0 unexpected`,
  `2 m 38.644 s`.
- Mobile Pixel: `26 pass`, `0 unexpected`, `0 flaky`, `6 m 53.653 s`.

Selected final extended evidence on the same final code/harness SHA uses one
evidence run per shard after bounded corrections:

- `367` executed, `71` expected skips, `0` unexpected, `0` flaky.
- All 16 shards exited `0`.
- Sum of selected shard test durations: `73 m 56.861 s`.
- Slowest selected shard: `11 m 56.614 s`.
- Evidence roots: `test-results/full-seq3-final-shard-*/`, with bounded rerun
  replacements for shards 7, 10 and 14; the aggregate selected ledger is
  `test-results/full-seq3-shards-summary.log`.

Previously sensitive scenarios also have repeated PASS evidence: lifecycle
guided flow `5/5`, corrected tiled stroke `5/5`, and low-zoom `5/5`, with
Playwright retries disabled.

## Other verification

- Root unit suite: `455 pass / 0 fail`.
- Server suite: `401 pass / 0 fail / 67 dependency-gated skips`.
- Server syntax: `67/67` files.
- Lint: `100/100` warning budget, exit `0`; warnings are pre-existing and the
  configured budget was not exceeded, but the budget has no remaining margin.
- Build: Vite production build passed.
- `git diff --check`: passed.
- PostgreSQL-specific suite: command exits `0` but `65` tests self-skip because
  no `DATABASE_URL` is available. This is not counted as PostgreSQL PASS.
  Docker/PostgreSQL was unavailable on the host; the CI postgres service job
  remains the authoritative proof and was not run on this unpushed branch.

## CI cost and policy

The performance record is [E2E_CI_PERFORMANCE.md](E2E_CI_PERFORMANCE.md).
Historical GitHub references were `101.77` runner minutes / `33.98` wall-clock
for a RED main run and `86.03` / `19.75` for the supplied GREEN RC run; these
are not controlled before/after values. The final local extended result is a
`73 m 56.861 s` sequential runner-time proxy, with an `11 m 56.614 s` slowest
shard; it is not a GitHub billing estimate. The three-project release-critical
matrix fits the intended approximately 5–10 minute PR gate when jobs run in
parallel.

Recommended policy:

1. Require `e2e-critical` plus unit, lint, build and server checks for merge.
2. Keep full 16-shard E2E as extended regression, with artifacts retained and
   owners for every source-gated or legacy skip.
3. Run the full suite on PR when budget permits and on a scheduled/nightly
   cadence; do not add retries to manufacture green.
4. Run the PostgreSQL service job in CI for every merge candidate and retain
   its migration/concurrency evidence.
5. Quarantine only with a root-cause issue, owner, first-observed SHA,
   reproduction evidence and restore criteria. Current quarantine count is 0.

## Independent final review status

Two requested Sol Max read-only reviews were dispatched against final SHA
`7d16ed3`: Test Reliability and Product Integrity. Both reviewer launches
terminated before producing a verdict because the model provider returned an
external usage-limit error. This handoff therefore records no independent
review PASS/FAIL; the lead's local inspection is not substituted for that
required gate.

## Remaining debt and release decision

The E2E harness has a reproducible green final critical matrix and a selected
green extended matrix, with three first-pass rows requiring bounded rerun or
fixture correction. The goal cannot yet be declared terminal under the strict
exit criteria until:

- PostgreSQL tests run against a real disposable PostgreSQL 16 service on the
  final candidate SHA and pass without environment skips; and
- the 26-test critical manifest and the explicit physical-iOS gate are either
  proven or their scope is formally accepted by the release owner; and
- the independent Test Reliability and Product Integrity reviews are recorded
  as PASS.

No production deployment is part of this handoff. The next safe actions are to
run the two final reviews and obtain authoritative PostgreSQL plus live branch
CI evidence in a future PR/runner context, then update the run-state status.
