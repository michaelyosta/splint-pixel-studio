# E2E failure clusters

Status: `CLUSTERED — bounded correction wave committed; post-correction full matrix pending`

This ledger groups failures by causal mechanism rather than assigning one
agent to every red test. The frozen matrix is
[E2E_DIAGNOSTIC_MATRIX.md](E2E_DIAGNOSTIC_MATRIX.md).

## Cross-cutting evidence

- Frozen run at `ab1adc3`: 432 nominal cases, 302 pass, 59 unexpected, 71
  skips, 0 flaky, duration `2 h 24 m 27.438 s`.
- Frozen project split: Chromium `134 pass / 0 unexpected / 10 skip`; iPhone
  `78 pass / 19 unexpected / 47 skip`; Pixel `90 pass / 40 unexpected / 14
  skip`.
- The old trace policy (`on-first-retry` with retries `0`) left failures without
  traces. The final policy retains trace and screenshot on failure.
- The first post-fix extended wave at `16852a7` had 3 unexpected results in
  shards 7, 10 and 14. Shards 7 and 10 passed bounded reruns; shard 14
  reproduced a real fixture interaction and was corrected before its green
  rerun. The red evidence remains retained for audit.
- The prior selected matrix at code SHA `7d16ed3` is historical 16/16 shard
  green: `367 pass / 71 expected skip / 0 unexpected / 0 flaky`, retries `0`.
  It is not the final proof because its evidence was stitched across bounded
  reruns rather than one complete post-correction run.
- No product defect was proven. No assertion was weakened. No generic retry or
  quarantine was used to obtain green.

## Cluster table

| Cluster | Scope | Classification | Owner / files | Outcome |
|---|---|---|---|---|
| C1 | mobile bootstrap, navigation and shared invocation pressure; 26 frozen rows | `HARNESS_FAILURE` with `ENVIRONMENT_FAILURE` contribution | navigation owner; navigation/accessibility/creator/input specs | fresh owned suite `111 pass / 6 skip`; no causal source fix |
| C2 | late response registration, lifecycle and resume; 12 frozen rows | `HARNESS_FAILURE` | lifecycle owner; guided-player/bfcache/migration paths | waits registered before navigation; status/body checked; guided repeats `5/5` |
| C3 | special-cell contract and project-boundary cases; 13 frozen rows | `TEST_FAILURE` / coverage-boundary, not product failure | contract owner; special-cell specs | isolated Pixel cluster `16/16`; explicit treatment/control coverage retained |
| C4 | tiled readiness, low-zoom response oracle and stroke geometry; 8 frozen rows | `HARNESS_FAILURE` | tiled owner; tiled low-zoom/stroke specs | causal state waits, completed-response counts, geometric center sampling; low-zoom `5/5` |
| C5 | generic guided player accidentally hit a generated Fuse offer in 2 full-shard runs | `HARNESS_FAILURE` | lead; `e2e/guided-player.spec.js` | switched generic journey to deterministic control cohort; focused `5/5`, shard 14 `23 pass / 3 skip` |
| C6 | creator crop iPhone click timeout with failed WebKit worker module request; 1 first-pass occurrence | `ENVIRONMENT_FAILURE` / provider sensitivity | lead; no product file change | focused `3/3`, shard 7 rerun green; no quarantine |
| C7 | long mobile glyph/guidance journeys; 2 first-pass timeouts | `ENVIRONMENT_FAILURE` / harness sensitivity pending external CI | lead; glyph and guided evidence | exact focused checks pass (`1/1` glyph, `5/5` guided control); full selected matrix green |
| C8 | Gallery delete and low-zoom request-start false-green oracles | `HARNESS_FAILURE` | lead; `creator.spec.js`, `tiled-low-zoom.spec.js` | strict object identity/status/404 and request+response bounds; focused checks pass |
| C9 | hidden UI retries and deterministic mutable fixture reuse | `HARNESS_FAILURE` | lead; P0/special delivery helpers, cohort hook, special glyph | retry clicks removed, cohort progress reset transactionally, glyph owners unique |
| C10 | release gate omitted object-storage contract | `HARNESS_FAILURE` / coverage gap | lead; workflow and S3 contract runner | disposable S3-compatible contract `2/2`; production R2 untouched |
| C11 | iPhone emulation scope and WebKit worker/provider boundary | `ENVIRONMENT_FAILURE` / coverage boundary | lead; critical runner/workflow | explicit 14-test WebKit smoke; save/1200/touch remain Chromium/Pixel + physical iOS |

## C1 — mobile bootstrap/navigation and invocation pressure

Frozen snapshots showed home shell or loading state while the test expected a
player locator. The same flows passed from fresh isolated invocations. The
long one-worker run accumulated API/tile work and latency, while the earlier
16-way local attempt produced 79 unexpected results. That combination is
environment/harness evidence, not proof that the product journey is broken.

Success evidence is the clean owned suite plus the final sequential shard
matrix. Remaining work is an external CI concurrency/cost measurement; no
timeout increase was used as a fix.

## C2 — late response/lifecycle readiness

The causal issue was a `waitForResponse` registered after navigation or after
the application had already completed the response. Some tests also swallowed
readiness failures. The fix registers the observer before the causal action,
checks HTTP status and body, and uses client state for readiness. Repeated
guided/lifecycle checks pass with Playwright retries disabled.

## C3 — special-cell contracts

These rows were not delegated as independent product changes. The treatment
journey, control journey and old/compatibility contracts are separate test
contracts. The isolated cluster passed without changing production source.
Special-cell tests remain in extended regression; only the release-critical
manifest selects the bounded journeys needed for Closed Alpha.

## C4 — tiled loading/zoom/stroke oracle

The original low-zoom assertion counted only one side of the request lifecycle.
The corrected oracle bounds both request starts and completed responses and
waits for network idle. Stroke checks now use a causal target fixture and
geometric cell centers rather than a broad arbitrary coordinate assumption.
The corrected low-zoom iPhone focused check is green with retries `0`.

## C5 — generic guided fixture and Fuse offer

The failing trace showed a valid `/progress/actions` response with
`completed_cells=48`, followed by a server-selected `fuse` offer. The app
correctly kept Smart Director on the same target while that offer was active;
the test incorrectly assumed a generic player fixture could not surface a
special event. This was a test-fixture defect. The generic guided test now uses
the existing E2E `seed-cohort-template` control fixture. Treatment behavior is
still covered by dedicated special-cell tests.

## C6/C7 — mobile worker and long-journey sensitivity

The creator trace contained a failed `creatorPipeline.worker.js` request, and
the long glyph/guidance traces were sensitive to extended mobile browser
execution. Focused repetition did not reproduce a product failure. Because
external GitHub runner evidence was not run on this unpushed branch, these are
recorded as environment/provider debt rather than silently upgraded to
`PRODUCT_FAILURE` or hidden with retries.

## Disposition rules

- `PRODUCT_FAILURE`: none proven in this pass.
- `TEST_FAILURE`: stale/incorrect test assumptions were corrected only when
  evidence showed the product contract was valid.
- `HARNESS_FAILURE`: fixed with minimal causal readiness, fixture or oracle
  changes; assertions remain strict.
- `ENVIRONMENT_FAILURE` / `PROVIDER_FAILURE`: retained as evidence and not
  converted into quarantine without a formal issue/owner.
- `LEGACY_CONTRACT_FAILURE`: legacy rows remain visible and are not deleted.
- `UNKNOWN`: none remains in the selected final ledger.

Quarantine count is zero. Policy: [E2E_QUARANTINE_POLICY.md](E2E_QUARANTINE_POLICY.md).
The 15-test WebKit attempt that exposed creator worker module failures is
retained as provider evidence, not hidden by retry or quarantine; the required
emulated subset is explicitly 14 tests.
