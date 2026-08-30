# E2E system stabilization run state

Status: `INVENTORY_AND_STATIC_AUDIT`

This file is the durable state for the single E2E stabilization pass. It is updated at every phase boundary and after each bounded verification wave.

## Baseline

- Base branch: `origin/main`
- Base SHA: `dc01c103544ac953e97cb77fc501842f9dab5f1b`
- Production release SHA supplied for verification: `6ce8f60bdd673030bdbb705f2111c69bdfacf546`
- Production relation verified: `6ce8f60` is an ancestor of `origin/main`.
- Integration branch: `codex/e2e-system-stabilization`
- Integration worktree: `C:\Users\misa\AppData\Local\Temp\splint-e2e-system-stabilization`
- Current integration SHA: `pending initial audit-doc commit`
- Primary dirty checkout: preserved at `C:\Users\misa\Desktop\Splint-Gemini`; no files from it are in this worktree.
- Production deployment: explicitly out of scope; no production configuration/data/webhook/payment changes authorized.
- Stars: must remain `OFF / FAIL-CLOSED`.

## Active worktrees and agents

| Role | Worktree | Branch/commit | Ownership | Status |
|---|---|---|---|---|
| Lead integration | `C:\Users\misa\AppData\Local\Temp\splint-e2e-system-stabilization` | `codex/e2e-system-stabilization` | stabilization docs, CI/harness integration | active |
| Primary checkout | `C:\Users\misa\Desktop\Splint-Gemini` | `codex/concurrent-special-cells-audit-2026-08-12` | user-owned dirty evidence; preserve | untouched |
| Cluster agents | none assigned yet | — | assignment follows frozen diagnostic | pending |

Pre-existing worktrees were observed but are not assigned to this pass and will not be reused without an explicit ownership check.

## E2E inventory snapshot

- Specs: 38
- Logical tests: 144
- Playwright project cases: 432 (144 each in `chromium`, `Mobile iPhone`, `Mobile Pixel`)
- Expected runnable cases from enumeration: 405
- Expected project skips from source conditions: 27
- Approximate and p50 timing: pending frozen diagnostic run
- Inventory document: [E2E_TEST_INVENTORY.md](E2E_TEST_INVENTORY.md)

## Static audit snapshot

- Static audit document: [E2E_HARNESS_AUDIT.md](E2E_HARNESS_AUDIT.md)
- `waitForTimeout` calls: 49
- broad empty catches matching the audit rule: 37
- `waitForResponse` patterns followed by a catch: 7
- fixed coordinate patterns: 8
- `test.setTimeout` overrides: 28
- trace configuration mismatch: `trace: on-first-retry` with `retries: 0`
- CI artifact upload: not configured in the current workflow

No source or harness fixes have been made before the diagnostic run.

## Diagnostic run

- Frozen SHA: pending audit-doc commit
- Runtime: Node 22 on Linux Playwright container, exact lockfiles
- Command: pending
- Fail-fast: disabled (`strategy.fail-fast: false` in CI; local run must collect all failures)
- Run start/end: pending
- Results/artifact directory: pending
- Failure matrix: pending

## Failure clusters

Pending frozen diagnostic. Do not create one agent per test; cluster by causal mechanism.

| Cluster | Affected tests | Classification | Owner | Status |
|---|---:|---|---|---|
| pending | pending | pending | pending | pending |

## Integration ledger

- Commits awaiting integration: none
- Integrated commits: none
- Additional correction waves permitted: one bounded wave only, and only for a newly proven root cause after full validation.

## Verification ledger

- Targeted verification: pending
- Repeated previously flaky scenarios: pending
- Full frozen diagnostic: pending
- Post-integration full CI-equivalent run: pending
- Reliability confirmation: pending
- Unit suite: pending
- Server suite: pending
- PostgreSQL suite: pending
- Lint: pending
- Build: pending
- `git diff --check`: pending

## Cost and remaining debt

- CI wall-clock before: pending measurement
- CI runner minutes before: pending measurement
- CI wall-clock after: pending measurement
- CI runner minutes after: pending measurement
- Slowest shards/specs: pending measurement
- Quarantined tests: none approved
- Remaining debt: pending root-cause review
- Next action: complete and commit inventory/static audit, then freeze the SHA and run the diagnostic matrix.
