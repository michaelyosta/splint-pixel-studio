# Splint E2E system stabilization handoff

Status: `E2E_MATRIX_GREEN — terminal E2E_SYSTEM_STABLE pending PostgreSQL service proof and independent review records`

## Release and Git boundary

- Base branch/SHA: `origin/main` / `dc01c103544ac953e97cb77fc501842f9dab5f1b`.
- Supplied RC: `6ce8f60bdd673030bdbb705f2111c69bdfacf546`, confirmed ancestor of
  `origin/main`.
- Integration branch: `codex/e2e-system-stabilization`.
- Final code-and-harness evidence SHA: `b9a82d8a2fb10e5580fb487035ebf84983a7fb0a`.
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
| C1 mobile bootstrap/navigation/readiness | 26 | Clean owned-suite pass; no source fix required |
| C2 lifecycle/late response registration | 12 | Harness/test fix: register required response before navigation and validate status/body |
| C3 special-cell fixture/contracts | 13 | Clean isolated Pixel cluster pass; no source fix required |
| C4 tiled loading/zoom/stroke oracle | 8 | Harness/test fixes: causal state wait, no-special fixture span, geometric cell-center sampling |

The initial 59 failures were therefore not treated as 59 independent agents or
as product defects. Four causal harness/test defects were corrected across C2
and C4. No product defect was proven, no product source was changed, no
assertion was weakened, no obsolete test was removed, and no test was
quarantined.

## Harness changes

- Node 22 is authoritative for E2E through the explicit local wrapper and
  `test:e2e:ci-local`.
- `test:e2e:critical` defines the release-critical subset; it enumerates 23
  cases from 15 files and accepts a project selector.
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

Extended regression is the complete 38-spec suite, including accessibility
breadth, rare mobile combinations, long journeys, visual evidence and legacy
compatibility paths. Source-gated skips remain explicit and are not silently
converted into passes.

The formal quarantine rule is [E2E_QUARANTINE_POLICY.md](E2E_QUARANTINE_POLICY.md).
Current quarantine count is zero.

## Final E2E evidence

Release-critical before the final auth/Gallery manifest expansion on SHA
`b9a82d8`:

- Chromium: `23 pass`, `0 unexpected`, `0 flaky`, `6 m 11.139 s`.
- Mobile iPhone: `12 executable pass`, `11 conditional skips`, `0 unexpected`,
  `1 m 20.157 s`.
- Mobile Pixel: `23 pass`, `0 unexpected`, `0 flaky`, `6 m 11.395 s`.

Extended on the same pre-expansion code SHA used 16 isolated shard contexts:

- `361` executed, `71` expected skips, `0` unexpected, `0` flaky.
- All 16 shards exited `0`.
- Sum of shard test durations: `75 m 15.732 s`.
- Slowest shard: `12 m 08.608 s`.
- Evidence roots: `test-results/full-b9-shard-01/` through
  `test-results/full-b9-shard-16/`; aggregate ledger:
  `test-results/full-b9-shards-summary.log`.

Previously sensitive scenarios also have repeated PASS evidence: lifecycle
guided flow `5/5`, corrected tiled stroke `5/5`, and low-zoom `5/5`, with
Playwright retries disabled.

## Other verification

- Root unit suite: `455 pass / 0 fail`.
- Server suite: `401 pass / 0 fail / 67 dependency-gated skips`.
- Server syntax: `67/67` files.
- Lint: `99/100` warning budget, exit `0`; warnings are pre-existing and the
  configured budget was not exceeded.
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
75-minute sequential runner-time proxy, with a 12-minute slowest shard; it is
not a GitHub billing estimate. The three-project release-critical matrix fits
the intended approximately 5–10 minute PR gate when jobs run in parallel.

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

## Remaining debt and release decision

The E2E harness has a reproducible green pre-expansion critical and extended
matrix. The goal cannot yet be declared terminal under the strict exit criteria
until:

- PostgreSQL tests run against a real disposable PostgreSQL 16 service on the
  final candidate SHA and pass without environment skips; and
- the independent Test Reliability and Product Integrity reviews are recorded
  as PASS; and
- the expanded 26-test critical manifest and the explicit physical-iOS gate
  are either proven or their scope is formally accepted by the release owner.

No production deployment is part of this handoff. The next safe action is to
run those two final reviews and obtain the CI PostgreSQL service evidence in a
future PR/runner context, then update the run-state status.
