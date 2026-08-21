# Alpha RC Git consolidation audit

Audit date: 2026-08-21  
Repository: `michaelyosta/splint-pixel-studio`  
Scope: branch/worktree topology, Phase 0-5 history, candidate integration
boundary, and safe Alpha RC checkpoint plan.

## Executive result

The project has one coherent local integration line and many deliberately
preserved experiment/recovery worktrees. The correct release boundary is the
local `codex/product-phase-2-autonomous` line, not any single historical Phase
branch. No reset, clean, force-push, blind rebase, or blind cherry-pick was
performed. The dirty primary checkout remains untouched.

At the time of the final read-only audit, before the release documentation
commit:

| Ref | SHA | State |
| --- | --- | --- |
| `codex/product-phase-2-autonomous` | `8242b87` | local candidate, ahead of its remote tracking ref |
| `origin/codex/product-phase-2-autonomous` | `57ae86cb81d6c9a4bbe3df9418612ded260d7764` | remote checkpoint, not force-updated |
| `origin/main` | `68d751e1da35de3bfd92f6bec382f0af830ac502` | shared base, not automatically merged |
| merge-base(candidate, `origin/main`) | `140f1226f62dbbd220de2b255268564e9df8910d` | common ancestor |

The candidate is `97` commits ahead of `origin/main` and `1` commit behind it
by graph count (`git rev-list --left-right --count origin/main...candidate`:
`1 97`). This is expected for a long-lived product integration line; it is
not a reason to merge or rebase blindly.

This audit branch was created from the candidate's security checkpoint
`3b1bafb36d55480d25dbaac99ecc9b3e1c8c7020` so that the PostgreSQL harness fix
could be developed without touching the shared candidate worktree.

The stabilization candidate subsequently passed the final full Chromium,
root, server, PostgreSQL, build, lint, and diff gates. The exact release tip,
remote checkpoint, and `codex/alpha-rc-1` branch are recorded in
`ALPHA_RC_1_HANDOFF.md`; `origin/main` remains intentionally unmerged.

## Worktree inventory

The read-only `git worktree list --porcelain` audit found:

* primary dirty checkout: `C:\Users\misa\Desktop\Splint-Gemini`, branch
  `codex/concurrent-special-cells-audit-2026-08-12`, HEAD `ee5e41b`; it contains
  user/previous-cycle changes and remains out of scope;
* shared integration candidate: `C:\Users\misa\Desktop\Splint-Gemini-Phase2-Autonomous`,
  branch `codex/product-phase-2-autonomous`, current local HEAD above;
* isolated Alpha RC worktrees for Special correctness, flake stabilization,
  visual capture, and creator preview;
* historical Phase 2 session/special-event, Phase 3 ceremony, Phase 4
  content/gallery/metadata/pacing/resume, Phase 5 abuse/premium, and
  pixelization-R&D worktrees;
* Product Recovery state, pixelization, preview, gameplay, HUD, surface, and
  recovery-quality worktrees;
* content/catalog-factory and older production-readiness/release/security
  branches.

These worktrees are evidence and rollback context, not an instruction to merge
all their tips. They may have different fixtures, contracts, or partial
implementations.

## Phase history and duplicate-commit review

The integrated candidate already contains equivalent changes for the approved
Recovery and Phase 2-5 slices. `git cherry`/patch-id review showed the
following representative historical tips are already represented and should
not be blindly cherry-picked:

| Historical stream | Tip(s) observed | Consolidation action |
| --- | --- | --- |
| Phase 2 session simulator | `4baba2f` | equivalent integrated change; retain branch as evidence |
| Phase 2 special-event prototypes | `981770b` | equivalent integrated change; no duplicate cherry-pick |
| Phase 3 ceremony | `0ccc68d`, `d570daf` | integrated product change plus later test-only duplicate; review only if a missing verifier is proven |
| Phase 4 content quality/metadata | `6164982`, `1d85ee2` | represented in candidate |
| Phase 4 gallery/pacing/resume | `13a3078`, `f40b34e`, `1bb1422` | represented in candidate |
| Phase 5 premium/abuse | `68b07f0`, `cee8736` | represented in candidate; duplicate abuse tips are not additional scope |
| Pixelization R&D | `326c12b` | research/evidence branch; no automatic art-style merge |
| Recovery P0/P1/P3 | `75b8c06`, `7feaf06`, `9d7c97f`, `58295d5`, `c189df3`, `6089bfa` | equivalent recovery outcomes are on the candidate; keep historical tips for traceability |

The branch tips are not all descendants of one another. A matching subject or
similar diff is not sufficient evidence for cherry-picking: migration order,
fixtures, test contracts, and later security changes matter.

## Unintegrated work that needs explicit review

The audit identified historical/test-only or duplicate-looking tips that are
not automatically part of the candidate, including later Phase 3 test work,
older abuse test variants, and recovery branch tips that have equivalent but
different SHAs in the candidate. They are not release blockers by themselves.
Each should be evaluated by file-level diff and verifier evidence before any
future integration. The current PostgreSQL harness fix in this branch is a new,
bounded release-correctness change and is recorded in its own commit after this
document.

## Safe integration graph

Recommended graph:

```text
origin/main
   \ 
    codex/product-phase-2-autonomous  (current integrated product candidate)
       \ 
        codex/alpha-rc-1               (create after stabilization)
           \ 
            PR -> main                 (owner/release decision; no auto-merge)
```

Operational rules:

1. Keep `codex/product-phase-2-autonomous` as the single integration line while
   Alpha RC stabilization is in progress.
2. Cherry-pick only exact, reviewed stabilization commits onto that line; do
   not cherry-pick entire historical Phase branches.
3. After full regression is green, create `codex/alpha-rc-1` at one exact SHA,
   push it as a normal remote branch, and use a dependency-ordered PR to the
   intended base.
4. Do not merge `main`, force-push, or rewrite shared history automatically.
5. Keep the primary dirty checkout separate until its owner decides how its
   local changes are preserved.
6. Before release handoff, record the candidate SHA, remote SHA, migration
   versions, environment mode, and test evidence in `docs/ALPHA_RC_1_HANDOFF.md`.

## Checkpoint created by this audit

The isolated branch `codex/alpha-rc-git-repro` contains:

* PostgreSQL reset/test-harness correction;
* stale daily challenge verifier correction for the shipped FK/status contract;
* reproducibility evidence;
* this Git consolidation report.

It is based on `3b1bafb` and is intentionally not pushed or merged by this
subtask. The parent integration agent can cherry-pick the exact commits after
review. The shared candidate moved independently to `1bd14d76` while this
audit was running; the fix applies as a bounded test/docs change and should be
cherry-picked once onto that current candidate, not onto multiple historical
branches.

## Open Git/release debt

* Remote candidate is seven commits behind the current local candidate; push a
  normal checkpoint only after parent integration and full verification.
* The final Alpha RC branch and PR base are intentionally not created here,
  because stabilization streams are still integrating.
* Old worktrees contain valuable evidence but should be archived only after
  their branches are confirmed no longer needed; deleting them is outside this
  audit.
* Physical Telegram, production payment, S3/IAM, deployment, legal, and public
  release decisions remain non-Git validation/business debt.
