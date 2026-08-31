# E2E harness static audit

Audit scope: read-only inspection of the 39 Playwright specs, shared setup,
package scripts, and CI workflows at frozen base
`dc01c103544ac953e97cb77fc501842f9dab5f1b`. No source or harness changes were
made during this audit.

## Executive result

The harness boots from a fresh per-invocation SQLite/media runtime and uses
lockfile installs, but the frozen audit identified several release-gate risks:
trace mismatch, absent CI artifact publication, swallowed readiness failures,
49 arbitrary sleeps, and mutable state shared by all tests in one Playwright
invocation. These were audit findings only until the frozen diagnostic proved
their impact; the bounded fixes and remaining debt are recorded below.

## Static inventory metrics

| Signal | Count / current setting | Risk |
|---|---:|---|
| Playwright specs | 39 | broad suite with large overlap |
| Logical tests | 146 | test-level ownership needed |
| Project cases | 432 | 3 projects × logical tests before skips |
| Expected runnable project cases | 411 | 27 source-gated skips |
| `waitForTimeout` calls | 49 | causal state is not encoded at these sites |
| broad empty catches matching audit rule | 37 | potential readiness and oracle loss |
| `waitForResponse` followed by catch | 7 | request evidence may be discarded |
| fixed-coordinate patterns | 8 | viewport/DOM drift risk |
| `test.setTimeout` overrides | 28 | long tests may hide slow regressions |
| localStorage/sessionStorage/indexedDB references | 60 | state persistence needs explicit ownership |
| `page.request`/request references | 136 | direct server probes can change timing and state |
| screenshot calls | 52 | evidence exists in selected tests, not automatic failure artifacts |

## Timing and readiness findings

1. At the frozen audit SHA, `playwright.config.js` had `retries: 0` and
   `trace: 'on-first-retry'`. With no retries, a failed test had no trace from
   this configuration. This direct diagnostics gap was confirmed by the
   frozen run and corrected to `retain-on-failure`.
2. 49 `page.waitForTimeout` calls remain. The largest concentrations are `stabilization.spec.js` (9), `special-cells-1200-delivery.spec.js` (8), `tiled-stroke-engine.spec.js` (7), and `special-glyph-parity.spec.js` (6). Some may model animation/input settling, but each needs a causal state oracle before release-gate use.
3. 37 broad empty catches are used for onboarding, response readiness, optional UI and cleanup. A test can proceed after a failed readiness assertion or missing response without recording the cause.
4. Several response waits are registered and then caught without a failure artifact. A request that is optional must be asserted as optional with observable state; a required request must fail with status/body evidence.
5. `scripts/e2e-global-setup.mjs` polls health with a causal HTTP endpoint, but server child processes inherit stdio and do not write structured per-run logs. On Windows its stop path uses `taskkill`; on POSIX it waits up to 5 seconds after group termination but does not force-close after the race.
6. At the frozen audit SHA no deterministic Node 22 local command existed.
   The final harness now provides the explicit Node `22.23.2` / npm `10.9.8`
   procedure and `npm run test:e2e:ci-local`; ordinary `npm run test:e2e`
   remains PATH-driven and is not the authoritative parity command.

## State and isolation findings

1. `scripts/run-e2e-api.mjs` creates a fresh temporary SQLite DB/media root per Playwright invocation, which is a good run-level boundary. It does not provide per-test transaction/cleanup isolation.
2. Browser projects share the same invocation-level API/database. Most users use `testInfo.testId`, but fixed IDs such as `e2e_guided_1200` and `user_bomb_e2e`, project-derived IDs, and seeded catalog data require cluster-level collision checks. Deterministic cohort fixture reuse now resets all user-scoped progress rows transactionally; special-glyph owners are unique within each test.
3. Seed endpoints under `/api/__e2e/*` are mutating fixtures. Tests that seed, then read through `page.request`, can affect subsequent tests in the same project/run if IDs or catalog rows overlap.
4. Local storage is deliberately used by reload/onboarding tests, but no global convention proves that state is cleared before every test. The current config has no `storageState` fixture and no explicit per-test context policy beyond Playwright's normal new context.
5. Two specs import production special-cell services directly. This can be valid for deterministic fixture construction, but it couples E2E outcomes to server implementation rather than only the public contract and should be documented per test.

## Browser/input findings

1. The suite uses CDP touch dispatch, `page.touchscreen`, pointer capture, wheel/pinch paths, fixed positions and coordinate-derived canvas cells. These are legitimate coverage for the input surface but are high-risk clusters, especially across WebKit emulation and mobile viewport changes.
2. Several source-level skips exclude WebKit for CDP or 1200×1200 creation. The inventory must distinguish an intentional unsupported-emulation gate from a silently absent mobile contract.
3. The current single worker reduces internal contention but increases total wall time and still leaves shared-run state/order dependency possible. It is not evidence of isolation.

## Network/data findings

1. CI E2E installs root dependencies, server dependencies and both Chromium/WebKit browsers independently in all 16 shards. This creates measurable duplicate setup cost; no optimization should be made until timings are recorded.
2. CI uses `strategy.fail-fast: false`, which is appropriate for collecting all
   shard failures. The final harness also emits a JSON result and keeps
   per-shard output directories; a consolidated cross-shard failure matrix is
   still a documentation/CI follow-up rather than a generated provider report.
3. At the frozen audit SHA the E2E workflow did not upload
   `test-results`, `playwright-report`, traces, screenshots, server logs or a
   JSON summary. The final workflow uploads `test-results/` and
   `playwright-report/` for every shard outcome and emits JSON; structured
   server-log collation remains debt.
4. Readiness is mixed between DOM assertions, response waits, polling and arbitrary delays. The final helper policy should prefer visible/attribute/API state that is causal to the next action.

## Diagnostic and release-gate findings

1. Default Playwright screenshot/video settings were not enabled in `use`; the
   final config now guarantees a generic failure screenshot with
   `screenshot: 'only-on-failure'` (video remains disabled).
2. At the frozen audit SHA the workflow had no fast/extended distinction. The
   final workflow defines `e2e-critical` for the 26-case Chromium/Pixel gate,
   an explicit 14-case supported iPhone/WebKit smoke gate, and keeps the
   complete suite as the 16-shard extended job; branch-protection enforcement
   still requires repository settings/provider confirmation. A separate
   `storage-s3-contract` job covers the S3-compatible object path without
   touching production R2.
3. Evidence-only suites are source-gated by environment variables (`ACCESSIBILITY_EVIDENCE`, `SESSION_GOALS_EVIDENCE`) and appear in normal enumeration as expected skips. They need explicit extended/nightly ownership.
4. The frozen audit found no quarantine manifest/policy. The stabilization pass
   added `E2E_QUARANTINE_POLICY.md`; current quarantine count remains zero.

## Post-wave disposition

The frozen audit findings were used as investigation priorities rather than as
a reason for a mechanical rewrite. The proven false-green/diagnostic gaps in
the release paths were addressed: Node 22 is now explicit, retries remain `0`,
failure traces and screenshots are retained, JSON results and per-run output
directories are supported, and CI uploads diagnostics on every outcome. The
C2 late-response race, C4 tiled fixture/oracle races, and C5 generic
guided-player fixture collision with a valid Fuse offer were fixed causally.
The generic guided journey now seeds the existing deterministic `control`
cohort; special-cell treatment remains covered by dedicated specs.

The remaining 49-sleep/37-catch counts are legacy debt outside the proven
failure mechanisms; they remain visible in the audit and are not hidden by a
green run. The prior stitched 16-shard matrix is historical; a new complete
matrix is required after the current correction wave. PostgreSQL service proof
is saved from a fresh disposable Docker service, and the S3-compatible
contract is covered by a dedicated CI job.

## Root-cause investigation priorities

1. Obtain the final complete Node 22/Linux CI matrix and provider timing for
   the post-correction candidate branch.
2. Add structured server-log collation and a machine-generated cross-shard
   failure matrix when CI implementation cost is justified.
3. Reduce the remaining waits/catches only with a concrete causal oracle and
   focused repeated evidence; do not mechanically rewrite or weaken assertions.
4. Confirm branch-protection required checks and physical Telegram WebView/iOS
   coverage before expanding the release claim beyond emulated projects.
