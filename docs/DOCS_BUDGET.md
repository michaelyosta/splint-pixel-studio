# Documentation budget

Status: CANONICAL
Authority: Operational policy for documentation scope discipline.

Navigation: [INDEX.md](INDEX.md) · Current state: [CURRENT_STATE.md](CURRENT_STATE.md)

Documentation became a second codebase: every micro-fix drags doc edits,
reviews slow down, and history accumulates in living documents. This policy
caps documentation churn per change without weakening canonical contracts.

## Budget rules

1. A normal PR touches at most **3** Markdown files under `docs/`, excluding
   dated evidence files under `docs/evidence/`.
2. A PR that intentionally changes a stable product or technical contract
   must update the canonical contract document in the same PR and answer
   `OLD CONTRACT / NEW CONTRACT / WHY INTENTIONAL / WHERE TESTED /
   WHAT REMAINS UNCHANGED`. Such a PR carries the `contract-change` label
   and is exempt from rule 1, but must still list every touched canonical
   document in the PR description.
3. `docs/CURRENT_STATE.md` is rewritten, not appended. It stays short and
   bounded (target: under 200 lines). Permanent history belongs in a dated
   file under `docs/evidence/`, never in `CURRENT_STATE.md`.
4. New handoff, investigation, or experiment logs go to
   `docs/evidence/YYYY-MM-DD-<topic>.md` with an explicit `HISTORICAL` or
   `EXPERIMENTAL` header and a link back to `CURRENT_STATE.md`.
5. No temporary PR numbers, SHAs, tunnel URLs, incident logs, or short-lived
   experiment status in `AGENTS.md` or any canonical contract.

## Check script

Run before opening a PR:

```sh
node scripts/check-docs-budget.mjs
node scripts/check-docs-budget.mjs --base origin/main --max 3
```

The script compares the current branch against its merge-base with `--base`
(default `origin/main`), counts added/modified `docs/**/*.md` files outside
`docs/evidence/`, and fails when the count exceeds `--max`. It also warns
when `docs/CURRENT_STATE.md` grows beyond 200 lines. Evidence files are
listed, never failed. CI wiring (`.github/workflows/ci.yml`) is intentionally
not part of this change and is proposed as a follow-up: run the script in
`verify` and fail the job on budget breach unless the PR carries the
`contract-change` label.

## What this policy does NOT change

- Canonical product, commerce, content, infrastructure, and security
  contracts keep their authority. This policy only bounds churn.
- `AGENTS.md` section 20 (documentation updates) still applies: stable
  contract change means update the canonical document in the same PR;
  operational-state change means rewrite `CURRENT_STATE.md`.
