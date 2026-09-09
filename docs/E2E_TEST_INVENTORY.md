# E2E test contract and inventory

Status: CANONICAL
Authority: Current Playwright topology, suite classification, and CI
expectations.
Last verified: 2026-09-07 from the checked-in manifest and current test tree.

Navigation: [INDEX.md](INDEX.md) · Current state: [CURRENT_STATE.md](CURRENT_STATE.md)
Manifest: [E2E_SHARD_LOAD_MANIFEST.json](E2E_SHARD_LOAD_MANIFEST.json)

## Topology

- Test directory: `e2e/`.
- Current source inventory: 40 spec files, 150 logical tests, and 450 nominal
  project cases across `chromium`, `Mobile iPhone`, and `Mobile Pixel`.
- Playwright runs with one worker and `fullyParallel: false`.
- Retries are `0`. Do not add hidden retries or arbitrary sleeps to make a
  release gate green.
- The generated manifest was created at
  `2026-09-07T10:08:36.479Z` and selects 24 weighted shards using the current
  inventory fingerprint. Every logical test and applicable project must be
  assigned exactly once; missing, stale, duplicate, or fingerprint-mismatched
  assignments are preflight failures.

The manifest is generated evidence and must be regenerated when the test
inventory or applicability changes. Use the repository's preflight and runner
scripts rather than copying counts from a handoff.

## Suite classification

| Lane | Owner | Contract |
| --- | --- | --- |
| Critical | `scripts/run-e2e-suite-node22.mjs critical*` | 26 explicitly named high-risk logical journeys, partitioned for Chromium, WebKit/iPhone, and Pixel lanes; covers auth, primary IA, creator save, painting, tiled rendering, completion, recovery, unlock fail-closed behavior, and selected special-cell delivery |
| Extended | `scripts/run-e2e-suite-node22.mjs extended` plus the 24-shard manifest | Full current E2E inventory, including accessibility, secondary creator journeys, lifecycle, guidance migration, special-cell experiments/evidence, and compatibility paths |
| Evidence-only | Explicit evidence specs and opt-in capture paths | May produce screenshots/metrics but are not a substitute for the required release gate |
| Legacy/debt | Source-marked migration/parity compatibility cases | Remain runnable and visible; do not delete or silently weaken them |

Criticality is a test classification, not a claim that a whole mixed spec file
belongs in the fast lane. The explicit title list in the runner is the
authoritative critical selection.

## Shared harness and state

`scripts/e2e-global-setup.mjs` starts one Vite server and one E2E API process
for a Playwright invocation. The API uses an isolated temporary SQLite
database and local media storage for that invocation. Tests run sequentially
within the invocation, but they can share seeded state unless a fixture
explicitly isolates it. E2E seed hooks are test-only and must never be enabled
in production.

`playwright.config.js` defines the three projects, one worker, base URL, trace
retention, and retry policy. `scripts/preflight-e2e-shards.mjs` validates the
manifest before the extended matrix. `scripts/summarize-e2e-results.mjs`
produces machine-readable failure summaries without changing test semantics.

## Failure classification

Classify a failure using the narrowest supported cause:

1. product or contract regression;
2. harness/fixture defect;
3. deterministic environment/setup failure;
4. proven flaky timing/runtime failure;
5. expected project/browser skip;
6. infrastructure/provider prerequisite failure.

Do not classify a failure as an external platform bug while a known-good
commit or local harness regression remains unexamined. Keep exact run IDs,
SHAs, shard failures, and investigation timelines in dated evidence/handoff
documents, not here.

## Retry and quarantine policy

The authoritative policy is [E2E_QUARANTINE_POLICY.md](E2E_QUARANTINE_POLICY.md).
Retries remain zero. Quarantine is allowed only for a reproduced flaky test
with owner, first-observed SHA, evidence, impact, restore criteria, and an
extended/visible execution path. It cannot conceal an unresolved critical
defect or make the gate green.

## CI expectations

`.github/workflows/ci.yml` is the authoritative workflow. Required dependency
groups include static/unit/server verification, PostgreSQL, S3-compatible
storage, the four release-critical matrix lanes, and the 24 extended shards;
the final gate requires all of them to succeed. This document describes the
expectation, not the result of a particular CI run.

Run focused evidence first. Run the required suite before merge. Do not rerun
an expensive broad matrix when no relevant source/configuration changed.
