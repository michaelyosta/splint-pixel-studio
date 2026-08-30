# E2E harness static audit

Audit scope: read-only inspection of the 38 Playwright specs, shared setup, package scripts, and CI workflows at frozen base `dc01c103544ac953e97cb77fc501842f9dab5f1b`. No source or harness changes were made during this audit.

## Executive result

The harness boots from a fresh per-invocation SQLite/media runtime and uses lockfile installs, but it is not yet a trustworthy release gate. The principal false-green/poor-diagnostics risks are the trace mismatch, absent CI artifact publication, swallowed readiness failures, 49 arbitrary sleeps, and mutable state shared by all tests in one Playwright invocation. These are audit findings only until the frozen diagnostic run proves their impact.

## Static inventory metrics

| Signal | Count / current setting | Risk |
|---|---:|---|
| Playwright specs | 38 | broad suite with large overlap |
| Logical tests | 144 | test-level ownership needed |
| Project cases | 432 | 3 projects × logical tests before skips |
| Expected runnable project cases | 405 | 27 source-gated skips |
| `waitForTimeout` calls | 49 | causal state is not encoded at these sites |
| broad empty catches matching audit rule | 37 | potential readiness and oracle loss |
| `waitForResponse` followed by catch | 7 | request evidence may be discarded |
| fixed-coordinate patterns | 8 | viewport/DOM drift risk |
| `test.setTimeout` overrides | 28 | long tests may hide slow regressions |
| localStorage/sessionStorage/indexedDB references | 60 | state persistence needs explicit ownership |
| `page.request`/request references | 136 | direct server probes can change timing and state |
| screenshot calls | 52 | evidence exists in selected tests, not automatic failure artifacts |

## Timing and readiness findings

1. `playwright.config.js` has `retries: 0` and `trace: 'on-first-retry'`. With no retries, a failed test has no trace from this configuration. This is a direct diagnostics gap.
2. 49 `page.waitForTimeout` calls remain. The largest concentrations are `stabilization.spec.js` (9), `special-cells-1200-delivery.spec.js` (8), `tiled-stroke-engine.spec.js` (7), and `special-glyph-parity.spec.js` (6). Some may model animation/input settling, but each needs a causal state oracle before release-gate use.
3. 37 broad empty catches are used for onboarding, response readiness, optional UI and cleanup. A test can proceed after a failed readiness assertion or missing response without recording the cause.
4. Several response waits are registered and then caught without a failure artifact. A request that is optional must be asserted as optional with observable state; a required request must fail with status/body evidence.
5. `scripts/e2e-global-setup.mjs` polls health with a causal HTTP endpoint, but server child processes inherit stdio and do not write structured per-run logs. On Windows its stop path uses `taskkill`; on POSIX it waits up to 5 seconds after group termination but does not force-close after the race.
6. No deterministic Node 22 local command exists. `npm run test:e2e` uses whichever `node` is first on PATH; the current Windows shell is Node 24.19.0, while CI uses Node 22.

## State and isolation findings

1. `scripts/run-e2e-api.mjs` creates a fresh temporary SQLite DB/media root per Playwright invocation, which is a good run-level boundary. It does not provide per-test transaction/cleanup isolation.
2. Browser projects share the same invocation-level API/database. Most users use `testInfo.testId`, but fixed IDs such as `e2e_guided_1200` and `user_bomb_e2e`, project-derived IDs, and seeded catalog data require cluster-level collision checks.
3. Seed endpoints under `/api/__e2e/*` are mutating fixtures. Tests that seed, then read through `page.request`, can affect subsequent tests in the same project/run if IDs or catalog rows overlap.
4. Local storage is deliberately used by reload/onboarding tests, but no global convention proves that state is cleared before every test. The current config has no `storageState` fixture and no explicit per-test context policy beyond Playwright's normal new context.
5. Two specs import production special-cell services directly. This can be valid for deterministic fixture construction, but it couples E2E outcomes to server implementation rather than only the public contract and should be documented per test.

## Browser/input findings

1. The suite uses CDP touch dispatch, `page.touchscreen`, pointer capture, wheel/pinch paths, fixed positions and coordinate-derived canvas cells. These are legitimate coverage for the input surface but are high-risk clusters, especially across WebKit emulation and mobile viewport changes.
2. Several source-level skips exclude WebKit for CDP or 1200×1200 creation. The inventory must distinguish an intentional unsupported-emulation gate from a silently absent mobile contract.
3. The current single worker reduces internal contention but increases total wall time and still leaves shared-run state/order dependency possible. It is not evidence of isolation.

## Network/data findings

1. CI E2E installs root dependencies, server dependencies and both Chromium/WebKit browsers independently in all 16 shards. This creates measurable duplicate setup cost; no optimization should be made until timings are recorded.
2. CI uses `strategy.fail-fast: false`, which is appropriate for collecting all shard failures, but there is no explicit machine-readable result collation or failure matrix artifact.
3. The E2E workflow does not upload `test-results`, `playwright-report`, traces, screenshots, server logs or a JSON summary. Logs are only whatever remains in the Actions console.
4. Readiness is mixed between DOM assertions, response waits, polling and arbitrary delays. The final helper policy should prefer visible/attribute/API state that is causal to the next action.

## Diagnostic and release-gate findings

1. Default Playwright screenshot/video settings are not enabled in `use`; selected specs capture screenshots but a generic failure screenshot is not guaranteed.
2. The release-candidate workflow runs the entire suite without a fast/extended distinction. The PR CI workflow also runs all 16 shards, while branch protection requirements are not proven by repository files alone.
3. Evidence-only suites are source-gated by environment variables (`ACCESSIBILITY_EVIDENCE`, `SESSION_GOALS_EVIDENCE`) and appear in normal enumeration as expected skips. They need explicit extended/nightly ownership.
4. No quarantine manifest/policy exists in the current harness. No test is quarantined by this audit.

## Root-cause investigation priorities

1. Capture all failures from one frozen Node 22/Linux run before touching the listed smells.
2. Cluster pointer/touch, lifecycle/readiness, tiled loading/cache, fixture/database isolation, mobile project behavior, stale contracts and provider/environment failures.
3. Use the failure evidence to decide which waits/catches are causal fixes versus harmless visual stabilization. Do not mechanically replace all waits or weaken assertions.
4. Add failure artifacts and a Node 22 local procedure only after the diagnostic proves the exact requirements.
