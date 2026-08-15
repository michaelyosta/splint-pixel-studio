# Splint Recovery Handoff

Status: **PARTIAL — HUMAN GATE**

This document records the recovery work only. It does not authorize or begin PRODUCT-PHASE-2+.

## RECOVERY-P0 — state and resume correctness

### Root cause

Home Continue previously mixed seeded/recommended artwork, viewed-card history, rounded percentages, and cached state. The final client sort could therefore prefer “Neon Cat” even when the user had recently painted a different unfinished upload. A rounded `0%` could also make a one-cell or large artwork look completed. Standalone reload booted through a blank shell and then the root route, losing the active coloring route before the resume state was restored.

### Fix

- Continue is selected from server progress activity (`updated_at`) for the most recently meaningfully used unfinished artwork. Exact `completed_cells >= total_cells` excludes only completed work.
- `skip_spark`, `skip_fuse`, and `skip_hazard` do not advance meaningful painting activity.
- A versioned per-artwork resume snapshot stores artwork ID, route, server revision, camera, zoom, selected color, Smart target, last interaction, and pending-save information.
- Server progress/revision remains authoritative. A Smart target is reused only when its revision still matches; otherwise guidance is refreshed.
- `pagehide`/`visibilitychange` flush the resume snapshot and durable journal. Explicit `?coloring=` wins over a local root resume.
- Cold root boot selects the last genuinely started artwork and an inline boot shell replaces the white-screen gap.

### Evidence

- Focused P0 tests: 13/13.
- Cold-reopen E2E: 1/1; BFCache lifecycle: 4/4; tiled journal reload: 1/1.
- Full integrated Node suite: 394/394.
- Build and diff-check pass; lint remains within the existing warning budget.

### Remaining physical gate

Run Safari iPhone Home Screen standalone through background/foreground, process eviction, and Cloudflare Tunnel. Telegram WebView remains a separate physical gate. No claim of perfect iOS lifecycle is made from Chromium alone.

## RECOVERY-P1A — pixelization R&D

### Diagnosis

The prior path was effectively resize + palette reduction. It created fragmented micro-regions, stale paintability metrics after cleanup, non-local color merges, weak edge measurement, a collision-prone 32-bit cell hash, and no independent proof that preview pixels matched final cells. Existing “portrait/landscape” evidence was mostly already-pixel-art assets and could not answer the user’s photo-to-pixel-art question.

### Approaches investigated

- Classic baseline versus paintable palette/segmentation cleanup.
- Typed flat buffers and bounded cleanup passes.
- Boundary-only region merges, isolated/micro-region cleanup, silhouette/edge preservation, optional ordered dither, and style presets.
- Independent 4/8-connected region metrics, tiny-area/fragmentation ratios, palette coherence, DeltaE, edge precision/recall, lower-bound effort, and number-readability proxies.
- Separate typed 128-bit-style cell result fingerprint (`px128`) and independently rendered RGBA preview fingerprint (`rgba128`).

### Candidate verdict

Paintable is **not** a universal default and has not been declared artistically “better”. On the representative seven-image corpus, at 512 it reduced effort in 7/7 (median -51.1%) and tiny-area ratio in 7/7, but edge recall fell by more than 3 percentage points in 5/7. At 192 there were effort regressions for two images. Classic golden compatibility is 14/14.

Paintable is explicitly capped at 512 logical cells. Six 1024/1200 probes reject with `PAINTABLE_RESOLUTION_LIMIT`; classic continues to support those logical sizes. This preserves the distinction between logical pixel-art resolution and render resolution. A synthetic uncapped 1200 run improved from roughly 619 MB to 191 MB RSS after typed-buffer work, but this is not an iOS safety proof.

### Visual/evaluation evidence

- Public-domain/CC0 corpus: portrait, animal, landscape, object, gradient/fog, silhouette, and a simple non-pixel illustration. Local hashes and licenses are pinned.
- 14 paired 192/512 panels, six 1024/1200 capability probes, and decisive review panels are under `docs/evidence/pixelization/`.
- Producer metrics match independent final-cell metrics 14/14; 14 distinct cell and preview fingerprints.
- Integrated focused pixel/evaluator suite: 39/39; evaluator report: `docs/evidence/pixelization/repaired-candidate-comparison/ASSESSMENT.md`.

### Remaining R&D/human gate

Owner/device review is required for beauty, edge-detail tradeoff, zoomed number readability, and paint feel. No paintable default should be enabled before that review and a real mobile/WebKit memory gate.

## RECOVERY-P1B — creation preview

The creator now offers on-demand actual converter previews for 192, 512, 1024, and 1200. Each preview shows a bounded real 12×12 numbered crop, palette, received metrics, readability/effort hints, and a clear warning that 1200 is not automatically better. Only the selected full cell map is retained; tile packing happens lazily on save. The preview kernel is the same converter contract used for the selected result.

Exact-save Chromium evidence decodes the real preview PNG, samples pixels against the submitted palette/cells, and compares the stored tile. Resolution race protection and 192 tiled save/open pass. Mobile 390/430 visual screenshots are under `docs/evidence/creator-preview-recovery/`.

Focused preview/worker tests: 23/23 before integration and 39/39 combined pixel/preview/evaluator after repair. Targeted creator E2E (`6a`, `6b`, `6c`): 3/3. The full creator Chromium suite is now 23/23, including explicit opening of a completed artwork from Gallery into the completion overlay.

Preview is kernel/style configurable and does not claim a paintable artistic winner. A paintable request above 512 must be surfaced as unavailable/limited; classic remains the high-resolution fallback.

## RECOVERY-P1C — Special Cells simplification

### Eligibility

The original pity path accepted any non-empty target, so it could direct the player to a one-cell Spark. Eligibility now follows the actual connected Smart target. A one-cell target is painted normally and persisted as `skipped`, with no offer, effect, or interruption. Larger target distributions are instrumented in bins (`1`, `2–3`, `4–12`, `13–32`, `33–50`, `51–200`, `200+`) without inventing a threshold unsupported by telemetry.

### Interaction model

Spark no longer asks A/B, confirm, or skip when there is no meaningful choice: the treatment auto-uses the server-authoritative Spark action. Legacy persisted A/B offers still auto-select the persisted first/default option for compatibility; non-Spark choices retain their existing decision path. Transient legacy action failure is retryable without reload. Control guidance rejects forged `SPECIAL_TARGETS` requests and does not leak special metadata.

### Evidence and limitation

- Focused corrective suite: 62/62.
- Updated Chromium `e2e/special-cells.spec.js`: 5/5.
- CAS, replay, duplicate-use, stale-offer, reload, control-cohort, and one-cell regressions are covered.
- Synthetic distribution data proves one-cell targets exist; it does not prove any threshold above one.
- Visual spectacle/payoff and “automatic Spark feels better” remain owner/device gates.

## Goals / HUD

The session-goal card and its 250 ms timer loop are hidden by default in core feel. An explicit control query can expose the card only outside core-feel; `?sessionGoals=control` cannot bypass core-feel suppression. Contextual painting guidance remains available and is not incorrectly described as removed. Backend progression/save contracts remain intact.

Evidence includes goal gate unit coverage 18/18, combined-query E2E 1/1, and the existing session-goals Chromium suite 6/6.

## RECOVERY-P3 — product surface cleanup

The public UI no longer presents “Продать набор”, showcase/витрина promises, or production-looking premium purchase paths. Premium catalog entries are hidden from normal Collections/Profile surfaces; direct locked-state data is retained but rendered as unavailable rather than a fake purchase/progress promise. Creator, manual editor, and free collections remain.

Stars payments, ledger/payment endpoints, and future business architecture were **not implemented or deleted**. They remain future PRODUCT-PHASE-5 scope.

## Files, branches, and commits

Integrated branch: `codex/splint-recovery-quality`, current commit `03e586f`, based on `5d21fd6`; code checkpoint `c814856` closes the explicit completed-artwork Gallery route regression found during final audit.

Recovery commits in order:

`4034dfa`, `9790e10`, `9a6d384`, `110f136`, `8dc0399`, `5b0df5a`, `f24c047`, `6041393`, `a03d27f`, `3e8facc`, `af4a631`, `568e468`, `d73c40a`, `bf4a83a`, `c814856`.

Supporting worktrees remain available and were not pushed:

- `codex/recovery-p0-state` — `75b8c06`, `C:\Users\misa\Desktop\Splint-Recovery-State`
- `codex/recovery-p1a-pixelization` — `551fe72`, `C:\Users\misa\Desktop\Splint-Recovery-Pixel` (untracked Sol-check corpus intentionally preserved)
- `codex/recovery-p1a-evaluation` — `7666e12`, `C:\Users\misa\Desktop\Splint-Recovery-Eval`
- `codex/recovery-p1b-preview` — `58295d5`, `C:\Users\misa\Desktop\Splint-Recovery-Preview`
- `codex/recovery-p1c-gameplay` — `c189df3`, `C:\Users\misa\Desktop\Splint-Recovery-Gameplay`
- `codex/recovery-p1c-hud` — `9c43938`, `C:\Users\misa\Desktop\Splint-Recovery-Hud`
- `codex/recovery-p3-surface` — `6089bfa`, `C:\Users\misa\Desktop\Splint-Recovery-Surface`

The original dirty worktree `C:\Users\misa\Desktop\Splint-Gemini` on `codex/concurrent-special-cells-audit-2026-08-12` was not modified by this integration.

## Verification summary

- Integrated `npm test`: **394/394 PASS**.
- Pixel/preview/evaluator focused: **39/39 PASS**.
- Specials focused: **62/62 PASS**; browser: **5/5 PASS**.
- Creator exact-path E2E: **3/3 PASS**; mobile visual checks were 2/2 in the preview worktree.
- Full creator Chromium E2E: **23/23 PASS**.
- Build: PASS; main bundle warning remains (`>500 KB`).
- Lint: PASS within existing warning budget (`97/100` at final integration); no recovery claim treats warnings as zero.
- `git diff --check`: PASS.
- Human/device gates remain explicitly open where listed above.

## GitHub checkpoint / PR plan

`origin` is `https://github.com/michaelyosta/splint-pixel-studio.git`. The recovery branch is local-only, has no upstream tracking, is 45 commits ahead of `origin/main` and 1 commit behind it at this checkpoint. Do not merge `main` automatically and do not push this branch without owner approval.

Recommended checkpoint:

1. Owner reviews this handoff and the committed visual panels/screenshots.
2. Run the Safari standalone and human pixel/paint gates.
3. Push `codex/splint-recovery-quality` as a review branch, or create slice PRs from the existing recovery commits if review size requires it.
4. Keep P0, pixel/preview, Specials, HUD, and surface commits identifiable; avoid a blind squash.
5. Rebase/merge `origin/main` only after an explicit owner decision, resolving the single-base divergence with a fresh test run.

## Owner decisions returned

- Is the 512 paintable tradeoff visually preferable to classic on the representative corpus?
- Should classic remain the production default while paintable stays an opt-in experiment?
- Does automatic Spark create enough spectacle/relief to justify the zero-decision flow?
- Does Safari standalone restore the exact artwork/camera after backgrounding, BFCache return, and process eviction?
- Is the completed-artwork completion overlay behavior acceptable on the owner’s device, in addition to the now-passing Chromium regression proof?

No PRODUCT-PHASE-2 work was started. After owner review, this recovery thread should stop and hand decisions back to the main Product chat.
