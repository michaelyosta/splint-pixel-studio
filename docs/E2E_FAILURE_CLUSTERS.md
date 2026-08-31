# E2E failure clusters

Status: `CLUSTERED — causal wave integrated; final 16-shard matrix green`

The 59 unexpected results from the frozen run are grouped by causal mechanism,
not by test count. Row numbers refer to
[E2E_DIAGNOSTIC_MATRIX.md](E2E_DIAGNOSTIC_MATRIX.md).

## Cross-cutting evidence

- Frozen run: 432 cases, one Node 22 Windows invocation, 59 unexpected, 71
  skipped, 0 retries/flakes, 2h24m27s.
- Chromium completed `134/134` executable cases with no unexpected result;
  mobile projects failed only after the long shared invocation had accumulated
  substantial API/tile work.
- Clean focused runs passed: Mobile Pixel accessibility `8/8` in 146.3s,
  Mobile iPhone accessibility `7/7` plus one intentional skip in 137.4s,
  special 1200 treatment/control `2/2` in 119.0s, and Mobile Pixel tiled
  stroke `2/2` in 216.3s.
- Frozen server events showed tile/API latency rising from sub-second to
  multi-second, including one `20.16s` tile response; the API process reached
  approximately `1.2GB` resident memory during the long run. Clean focused
  special/tiled runs returned tiles in approximately `24–55ms`.
- A stroke timeout had already emitted `painted=30`, `wrong=false`, and
  `unloaded=0`, indicating that at least part of the user path completed before
  the post-action/oracle wait stalled.
- The post-integration mixed full run reduced the frozen `59` unexpected rows
  to `44`, but retained the same run-level pressure pattern. A fresh Chromium
  full run had `4` unexpected rows; each of those exact tests passed in its own
  fresh invocation. This is evidence for shared invocation pressure and
  lifecycle/oracle sensitivity, not a product regression.
- The exact-SHA release-critical matrix is green: Chromium `23/23`, Mobile
  iPhone `12/12` executable with `11` conditional skips, and Mobile Pixel
  `23/23`, all with retries `0` and unexpected `0`.
- The exact-SHA extended matrix on `b9a82d8` is green across all 16 isolated
  shard contexts: `361` executed, `71` expected skips, `0` unexpected, `0`
  flaky. No new failure cluster appeared after integration.

These facts prove a run-level pressure/isolation problem is involved. The
focused owner runs subsequently identified the concrete C2 late-response race
and three C4 test-oracle/fixture issues; no product defect was proven.

## Cluster assignments

### C1 — mobile bootstrap/navigation readiness and fixture lifetime

**Rows:** 1–14, 18–23, 25–28, 32–33 (26 results)

**Evidence:** Common locators (`.player-page`, `.coloring-canvas`, catalog/home
cards, `.feed-post`) were absent while error snapshots showed the app still on
home. The same Pixel and iPhone accessibility suites passed from fresh
invocations. Existing helper code uses a click followed by a generic locator
wait and broad catches; all browser projects share one invocation-level API/DB.

**Provisional classification:** `HARNESS_FAILURE` with a contributing
`ENVIRONMENT_FAILURE`/resource-pressure mechanism; no product defect proven.

**Owner:** `e2e-navigation-owner`.

**Exclusive allowed files:**

- `e2e/accessibility.spec.js`
- `e2e/creator.spec.js`
- `e2e/input-gesture-evidence.spec.js`
- navigation/readiness helpers only if they are local to those files

**Prohibited files:** product source, `scripts/e2e-global-setup.mjs`,
`scripts/run-e2e-api.mjs`, `playwright.config.js`, unrelated specs, and CI
workflow files.

**Success criteria:** Reproduce at least one frozen row and one clean run;
replace only non-causal waits/catches with a real navigation/readiness oracle;
prove the assigned rows pass repeatedly in both mobile projects without
weakening assertions or adding sleeps/retries.

**Focused outcome:** The owned suite passed `111` tests with `6` intentional
skips in a fresh run, including Pixel and iPhone accessibility, creator, and
input variants. No owned file changed because no causal spec fix was proven;
the classification is `HARNESS_FAILURE` with run-pressure/fixture contribution,
not a product defect.

### C2 — route/resume/lifecycle asynchronous readiness

**Rows:** 15–17, 24, 29–31, 34, 36–37, 47, 54 (12 results)

**Evidence:** Frozen snapshots include `Загружаем…`, state `idle` instead of
`loadingTarget`, missing progressive sessions, late response waits, and test
timeouts at 60–120s. Neighboring lifecycle/guided/session tests pass. Static
audit found broad catches around readiness and late `waitForResponse` patterns.

**Classification:** `HARNESS_FAILURE` for the late response-wait mechanism;
no product defect proven.

**Focused outcome:** The lifecycle owner reproduced the late response-wait race
and fixed it causally in the two guided-player specs. The affected rows and
related checks passed without retries: bfcache `2/2`, core-feel `1/1`, migration
`2/2`, guided repeated `5/5`, P0 `1/1`, session goals `1/1`, artifact reload
`1/1`, Spark iPhone `1/1`, and stabilization `1/1`. The full migration spec
passed `5/5`. One separate post-action transition remains explicitly
unproven; it is not hidden by this fix.

**Integrated in bounded wave:**
`70af41f05f65a3807c0d49747aeb4fa538e1ed31`.

**Owner:** `e2e-lifecycle-owner`.

**Exclusive allowed files:**

- `e2e/bfcache-lifecycle.spec.js`
- `e2e/core-feel-slice.spec.js`
- `e2e/guided-player.spec.js`
- `e2e/guided-player-migration.spec.js`
- `e2e/p0-final-acceptance.spec.js`
- `e2e/session-goals.spec.js`
- `e2e/special-cells.spec.js`
- `e2e/stabilization.spec.js`

**Prohibited files:** product source, fixture/server scripts, `playwright.config.js`,
special-cell files owned by C3, tiled files owned by C4, and unrelated specs.

**Success criteria:** Identify the exact causal state transition or response;
ensure required response waits are registered before the action and required
failures retain status/body evidence; no arbitrary sleep, generic retry, or
assertion weakening; focused 5-pass evidence for each repaired mechanism.

### C3 — special-cell fixture/cohort determinism and stale contract review

**Rows:** 35, 38–46, 51–53 (13 results)

**Evidence:** Bomb/Spark/help/1200 assertions were false or absent only in the
late Pixel portion of the frozen invocation. Clean special-1200 treatment and
control tests passed `2/2` with low tile latency. Static inventory identifies
mutating seed endpoints, fixed cohort/user identifiers, and server-backed
special fixtures shared within an invocation.

**Classification:** `HARNESS_FAILURE` caused by long mixed-run pressure and
readiness/oracle sensitivity in the observed rows. The isolated C3 run passed
all assigned contract tests; no `LEGACY_CONTRACT_FAILURE` or product defect
was proven, and no test was removed.

**Focused evidence:** The delegated worker launcher was stopped after it
attempted to run from the primary dirty checkout. The lead then ran all C3
special-contract specs from the clean isolated worktree
`C:\Users\misa\AppData\Local\Temp\splint-e2e-special-contract-owner` at
`ab1adc3daaec6a1b4305952ab342f34e70759673`, using Node `v22.23.2`, Mobile
Pixel, ports `5195/3017`, retries `0`, and no fail-fast. Playwright reported
`16 passed (6.3m)`, `0 failed`, `0 timed out`, and `0 skipped`. This is strong
evidence against a product-wide special-cell failure; remaining work is to
classify whether the original failures arose from mixed-run pressure, fixture
state, or an assertion/readiness oracle.

**Owner:** `e2e-special-contract-owner`.

**Exclusive allowed files:**

- `e2e/phase2-positive-events.spec.js`
- `e2e/special-bomb-artifact-reload.spec.js`
- `e2e/special-bomb-tiled.spec.js`
- `e2e/special-cells-1200-delivery.spec.js`
- `e2e/special-cells-gameplay-v1.spec.js`
- `e2e/special-cells-long-journey-evidence.spec.js`
- `e2e/special-cells-long-journey.spec.js`
- `e2e/special-cells-visual-audit.spec.js`
- `e2e/special-help-onboarding-responsive-evidence.spec.js`
- `e2e/special-help-onboarding.spec.js`

**Prohibited files:** product source, shared fixture/server scripts, navigation
files owned by C1, lifecycle files owned by C2, tiled stroke/glyph files owned
by C4, and quarantine/CI configuration.

**Success criteria:** Prove whether each assigned failure is fixture collision,
state leakage, stale contract, or real product behavior; make fixture identity
unique and cleanup causal where needed; preserve special assertions and
fail-closed Stars/payment checks; focused repeated PASS evidence on both
relevant mobile projects.

### C4 — tiled loading/zoom/completion/stroke post-action oracle

**Rows:** 48–50, 55–59 (8 results)

**Evidence:** Frozen Pixel tiled cases timed out or saw missing session/route
state; iPhone low-zoom measured `144` against `<80`; Pixel low-zoom never
reached work mode. Clean Pixel tiled-stroke passed `2/2` in 216.3s, with tile
responses around 24–40ms; frozen stroke had correct server-side paint evidence
before 180s timeout. This points to load pressure and/or a post-action oracle,
but the low-zoom numeric bound still needs an independent product-vs-test
decision.

**Classification:** `HARNESS_FAILURE` with an environment-pressure contributor;
no product defect proven. Low-zoom strict state/manifest/tile checks pass in a
clean repeat.

**Focused outcome:** State-driven readiness removed arbitrary sleeps and
swallowed required tile waits in the owned tiled specs. Mobile Pixel low-zoom
passed `5/5`; the original residual was reproduced. Evidence then showed the
test had selected a line containing a Bomb offer (which correctly blocks the
next stroke), and its pixel helper sampled `+4` rather than the geometric cell
center at low zoom. The bounded correction changed only the test: select spans
without special cells, wait on the causal second-stroke metric, and sample the
true cell center. The corrected scenario passed `5/5` on Pixel with strict
`painted=30`, `wrong=false`, `unloaded=0`, and two recorded strokes.

**Integrated in bounded wave:**
`70af41f05f65a3807c0d49747aeb4fa538e1ed31`; later C4 fixture/oracle
correction: `e74c7feb2b39996a3c8d6aab30d32251bf5ecc5b`.

**Owner:** `e2e-tiled-owner`.

**Exclusive allowed files:**

- `e2e/special-glyph-parity.spec.js`
- `e2e/tiled-completion.spec.js`
- `e2e/tiled-low-zoom.spec.js`
- `e2e/tiled-stroke-engine.spec.js`

**Prohibited files:** product source unless a real defect is proven and the
minimal production ownership is explicitly documented; server/fixture scripts,
navigation/lifecycle files, special-cell files, `playwright.config.js`, and CI
workflow files.

**Success criteria:** Separate tile/network readiness from rendering and
post-action persistence; remove swallowed required-response failures; no
arbitrary sleep/retry or weakened numeric bound; 5–10 consecutive passes for
stroke/zoom mechanisms and related browser variants at reasonable cost.

## Classification ledger

| Classification | Current count | Meaning at this phase |
|---|---:|---|
| `PRODUCT_FAILURE` | 0 proven | No product change was authorized from the diagnostic evidence |
| `TEST_FAILURE` | 0 proven | No assertion was weakened or removed |
| `HARNESS_FAILURE` | 59 initial rows; common pressure/readiness mechanism confirmed across all four clusters | C2/C4 received causal fixes; C1/C3 were proven by isolated fresh runs without a source fix |
| `ENVIRONMENT_FAILURE` | 1 separate Docker attempt | EROFS container run excluded from the 432-case matrix |
| `PROVIDER_FAILURE` | 0 | No GitHub/provider failure observed in this local run |
| `LEGACY_CONTRACT_FAILURE` | 0 | C3 contract review did not identify an obsolete release-critical contract |
| `UNKNOWN` | 0 owner rows | One load-sensitive pressure symptom remains tracked as debt, not hidden or quarantined |

## Final disposition

All four initial clusters were investigated. C1 and C3 passed their clean
owned suites without a source change; the common run-level pressure mechanism
is supported, but their exact per-row trigger is not claimed as independently
proven. C2 received a causal response-registration fix. C4 received a causal
state wait plus test-only fixture selection and geometric pixel sampling
corrections. The final pre-coverage-expansion critical and extended matrices
were green with retries disabled. There are no quarantined tests, no removed
tests, and no proven product defects from this pass.

## Delegation rules

Each owner must reproduce at least one assigned frozen row and one clean
invocation, state the root cause, and make only a minimal causal fix in its
isolated worktree. No owner may add an arbitrary wait, generic retry, weaken an
assertion, hide a failure, change product source for a harness failure, or
quarantine a test. The lead will review ownership and diffs, then integrate one
bounded wave only after all returned commits are inspected.
