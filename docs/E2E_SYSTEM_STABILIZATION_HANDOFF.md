# Splint E2E system stabilization handoff

Status: `FINAL_MATRIX_PENDING — bounded correction wave committed; frozen full run pending`

## Release and Git boundary

- Base branch/SHA: `origin/main` / `dc01c103544ac953e97cb77fc501842f9dab5f1b`.
- Supplied RC: `6ce8f60bdd673030bdbb705f2111c69bdfacf546`, confirmed ancestor of
  `origin/main`.
- Integration branch: `codex/e2e-system-stabilization`.
- Last pre-correction code-and-harness SHA: `7d16ed3a575efd8c9bc71199e6ce18d55400e8ce`.
- Current integration HEAD: `e60e39cece645a4bd776e3a4c4e58a36697ee7b8`, the
  committed bounded correction wave.
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
| C8 false-green release oracles | review findings | Gallery identity/status/404 and low-zoom request+response bounds fixed |
| C9 hidden retry and fixture reuse | review findings | UI retries removed; cohort reset and unique glyph fixture owners fixed |
| C10 missing R2 contract coverage | review finding | disposable S3-compatible contract job added; production R2 untouched |
| C11 iPhone scope/provider boundary | review finding | explicit 14-test WebKit smoke; physical iOS remains separate |

The initial 59 failures were therefore not treated as 59 independent agents or
as product defects. Proven harness/test defects were corrected in C2, C4 and
C5; C1, C3, C6 and C7 were retained as isolated environment/contract evidence
with bounded green verification. No product defect was proven, no product
source was changed, no assertion was weakened, no obsolete test was removed,
and no test was quarantined. The prior stitched matrix is historical and is
not final full-run evidence for the current correction SHA.

## Harness changes

- Node `22.23.2` and npm `10.9.8` are authoritative for E2E through the
  explicit local wrapper and `test:e2e:ci-local`.
- `test:e2e:critical` defines the 26-test Chromium/Pixel release-critical
  subset; `test:e2e:critical-webkit` defines the explicit 14-test supported
  iPhone/WebKit smoke subset and accepts a project selector.
- `storage-s3-contract` exercises the S3-compatible object path against a
  disposable in-process endpoint; it does not contact production R2.
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
`scripts/run-e2e-suite-node22.mjs` and runs as 26 tests on Chromium and Mobile
Pixel, plus an explicit 14-test supported Mobile iPhone/WebKit smoke subset.
The omitted iPhone cases are conditional WebKit/1200/touch or known worker
provider-bound scenarios; they are not evidence for physical iOS. A separate
physical Telegram WebView/iOS gate is required before claiming full iPhone
release coverage.

Extended regression is the complete 39-spec suite, including accessibility
breadth, rare mobile combinations, long journeys, visual evidence and legacy
compatibility paths. Source-gated skips remain explicit and are not silently
converted into passes.

The formal quarantine rule is [E2E_QUARANTINE_POLICY.md](E2E_QUARANTINE_POLICY.md).
Current quarantine count is zero.

## Final E2E evidence

Release-critical on the last pre-correction code/harness SHA `7d16ed3`:

- Chromium: `26 pass`, `0 unexpected`, `0 flaky`, `6 m 48.958 s`.
- Mobile iPhone: `15 executable pass`, `11 conditional skips`, `0 unexpected`,
  `2 m 38.644 s`; a new explicit 14-test WebKit smoke run is the current
  supported emulation target.
- Mobile Pixel: `26 pass`, `0 unexpected`, `0 flaky`, `6 m 53.653 s`.

Historical selected extended evidence on the same pre-correction code/harness
SHA uses one evidence run per shard after bounded corrections:

- `367` executed, `71` expected skips, `0` unexpected, `0` flaky.
- All 16 shards exited `0`.
- Sum of selected shard test durations: `73 m 56.861 s`.
- Slowest selected shard: `11 m 56.614 s`.
- Evidence roots: `test-results/full-seq3-final-shard-*/`, with bounded rerun
  replacements for shards 7, 10 and 14; the aggregate selected ledger is
  `test-results/full-seq3-shards-summary.log`. This is historical and does not
  satisfy the required one-complete-run proof after the correction wave.

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
- PostgreSQL service suite: `100 pass / 0 fail / 0 skipped`, exit `0`, duration
  `87.537 s`, on a fresh disposable Docker `postgres:16`; `28` migrations
  applied under Node `22.23.2` and npm `10.9.8`. The container was removed
  after the run; evidence is in `docs/evidence/postgres-final.md`.
- S3-compatible storage contract: `2 pass / 0 fail / 0 skipped` under Node
  `22.23.2`, using a disposable in-process object-store endpoint. No
  production R2 credentials or objects were used.

## CI cost and policy

The performance record is [E2E_CI_PERFORMANCE.md](E2E_CI_PERFORMANCE.md).
Historical GitHub references were `101.77` runner minutes / `33.98` wall-clock
for a RED main run and `86.03` / `19.75` for the supplied GREEN RC run; these
are not controlled before/after values. The final local extended result is a
  `73 m 56.861 s` sequential runner-time proxy, with an `11 m 56.614 s` slowest
shard; it is not a GitHub billing estimate. The three-project release-critical
matrix fits the intended approximately 5–10 minute PR gate when jobs run in
parallel.

PostgreSQL service evidence was subsequently completed on a fresh disposable
Docker `postgres:16` container using Node `22.23.2` and npm `10.9.8`: `28`
migrations applied, then `100 pass / 0 fail / 0 skipped` in `87.537 s`. The
container was removed after the run. This closes the local authoritative
database gate; live GitHub provider timing remains unmeasured.

Recommended policy:

1. Require `e2e-critical`, the S3 storage contract, unit, lint, build and
   server checks for merge.
2. Keep full 16-shard E2E as extended regression, with artifacts retained and
   owners for every source-gated or legacy skip.
3. Run the full suite on PR when budget permits and on a scheduled/nightly
   cadence; do not add retries to manufacture green.
4. Run the PostgreSQL service job in CI for every merge candidate and retain
   its migration/concurrency evidence.
5. Quarantine only with a root-cause issue, owner, first-observed SHA,
   reproduction evidence and restore criteria. Current quarantine count is 0.

## Independent final review status

Two independent Sol Max read-only reviews were completed against the
pre-correction evidence and both returned `FAIL` with actionable findings:
the final full run was stitched rather than single-SHA, hidden UI retries and
mutable fixture reuse existed, Gallery/low-zoom oracles were too weak, the
critical manifest lacked an explicit project preflight, R2 coverage was
missing, and the Node/npm contract was incomplete. The bounded correction wave
addresses those findings; both reviews must be rerun against the post-wave SHA
after the complete final matrix.

## Remaining debt and release decision

The E2E harness has a green historical critical matrix and a selected green
extended matrix, but neither is final proof for the current correction wave.
The goal cannot yet be declared terminal under the strict exit criteria until:

- one complete 16-shard Node22 matrix is green on one frozen post-wave SHA;
- the 26-test Chromium/Pixel critical manifest plus the explicit 14-test
  WebKit smoke and physical-iOS scope are documented and accepted; and
- the independent Test Reliability and Product Integrity reviews are recorded
  as PASS.

No production deployment is part of this handoff. The next safe actions are to
commit the bounded wave, run one complete final matrix without changing its
SHA, rerun both independent reviews, then update the run-state and handoff
with the final evidence. Live GitHub branch timing remains a separate CI
measurement debt.
