# Git checkpoint plan for the current local work

Status: plan only. No files have been staged, committed, or pushed.

## Current state

- branch: `codex/tiled-player-1200`;
- local HEAD and `origin/codex/tiled-player-1200` both point to `b433a27`;
- the working tree contains more than one development phase: large-grid/tiled
  changes, Special Cells server/client work, QA evidence, and documentation;
- migrations 023-025 are still untracked and must land before code that reads
  the Special Cells tables;
- several pre-existing evidence images are modified; they must be reviewed
  explicitly and never swept into a commit by a broad `git add .`.

## Safe checkpoint sequence

Create a new owner-approved branch from the current checkout while preserving
the working tree. Then stage by explicit path lists and inspect each staged
diff. Recommended commit order:

1. **Tiled 1200 foundation** — existing large-grid client, guidance, tile
   cache, journal, LOD and their tests/docs. Keep unrelated evidence images out
   until their producing tests are identified.
2. **Special Cells schema and server foundation** — migrations 023-025,
   placement/state services, `progress/actions`, guidance integration, cohort
   gates, server tests. Migration SQL must be immutable after merge.
3. **Special Cells client transport and recovery** — legacy+tiled offer flow,
   active-offer barrier, offline/retry reconciliation, diagnostics and unit
   tests.
4. **Gameplay v1 family** — the existing Bomb/Fuse/Choice/Artifact/Hazard
   slices and long-journey tests, without the later Spark redesign.
5. **Spark full-target + balance v4** — persisted target snapshot, 144-cell
   internal ceiling, unchanged 64-cell stroke and 32-cell non-Spark caps,
   simulator/mix v4, QA preflight, focused tests.
6. **Visual language and evidence** — only the reviewed CSS/Canvas/glyph
   changes and newly generated responsive screenshots. Do not include stale
   evidence simply because its timestamp changed.
7. **Documentation and operational plans** — balance/experiment/loop log,
   Telegram QA, Git plan, and upload-abuse roadmap, synchronized to the final
   verifier results.

If separating steps 1-4 would require risky line-level surgery in heavily
shared files such as `colorings.js`, `useColoringSession.js`, or
`ProgressiveColoringSession.jsx`, keep them as one reviewed foundation commit
rather than manufacturing conflicts. Commits 5-7 are clean review boundaries
and should remain separate.

## PR structure

Prefer one draft PR with the ordered commits because schema, server contract,
and both players are not independently deployable. The PR description should
name the application-layer feature/cohort rollback and state that applied
migrations are not rolled back destructively. A second PR is appropriate only
for documentation/evidence if code review would otherwise be obscured.

## Verification per checkpoint

- schema/server: migrations on fresh and 023-era SQLite/Postgres fixtures,
  full server suite, replay/concurrency/completion tests;
- client/recovery: root unit suite plus offline/reload E2E;
- Spark v4: focused full-target server tests, normal-batch cap test, simulator
  assisted ratio, treatment/control 1200 E2E;
- visual: 360/390/430 screenshots, reduced motion, glyph parity, LOD view;
- final PR: build, lint budget, multi-event journey, and explicit review of
  every staged binary.

## Owner decision

Before any Git write, the owner chooses the checkpoint branch name and whether
to create one draft PR or split documentation/evidence. Until then: no staging,
commit, push, rebase, reset, clean, or history rewrite.
