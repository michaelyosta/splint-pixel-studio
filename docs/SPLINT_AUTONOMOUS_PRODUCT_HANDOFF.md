# Splint Autonomous Product Handoff

Status: **SUCCESS_WITH_VALIDATION_DEBT**

This handoff covers the autonomous Phase 2 session slice, bounded Phase 3
reveal-ceremony slice, gallery/content Phase 4 slice, and bounded Phase 5
product-preparation slice. It does not claim that human enjoyment, retention,
real Telegram payment delivery, or the final Special-event winner has been
proven.

## 1. Phases completed

- Product Recovery Phase 0/1: preserved as the core manual-reveal contract.
- Product Phase 2: one positive event plus passive Artifact, effort-aware server
  guidance, first-manual-reveal gate, event variants, session simulator, and
  measurement hooks.
- Bounded Product Phase 3: Canvas-first fragment/Special/artwork reveal
  ceremony with reduced-motion fallback.
- Product Phase 4: collection-first Gallery, curated showcase journey, honest
  content metadata, resume/closure contracts, and bounded sharing groundwork.
- Bounded Product Phase 5: one premium pack, disabled-by-default Stars/XTR
  provider contract, server entitlement hardening, Store state model, artwork
  deep links, and P0/P1 upload/render safeguards.

No production payment, marketplace, internal currency, social feed, or new
Special Cell was added.

## 2. Decisions now in force

- Player-authored painting remains the primary reward.
- `spark_choice` remains the agency-safe provisional treatment baseline.
- `spark_auto` and `bomb` remain reversible query-gated comparison variants.
- Artifact is passive discovery; it does not create an inventory economy.
- Fuse, Hazard, and Choice remain excluded from the Phase 2 cohort.
- Smart Director proposes the next beat; it does not teleport through an offer.
- A persisted offer preloads one bounded target tile before its panel is shown.
- A Phase 3 ceremony belongs to the Canvas and is bounded by the active fragment.

The event review is intentionally unresolved: the scorecard favours Choice for
agency, while visual red-team favours Automatic Spark because the current Choice
options are visually too similar. See `docs/VALIDATION_DEBT.md`.

## 3. Mechanics KEEP / CUT / REDESIGN

| Mechanic | Current decision | Reason |
| --- | --- | --- |
| Manual painting | KEEP | North-star player-authored reveal beat. |
| Smart Director | KEEP / IMPROVE | Bounded proposal and resume utility; no solver framing. |
| Spark choice | KEEP provisionally | Safest agency baseline, but current choice can be fake. |
| Spark auto | EXPERIMENT ONLY | Stronger continuity, higher passenger risk. |
| Bomb | EXPERIMENT ONLY / REDESIGN | Spatial metaphor is clear; payoff is currently weak. |
| Artifact | KEEP / IMPROVE | Rare passive discovery with ownership potential. |
| Fuse, Hazard, Choice | CUT from cohort | Interaction cost is not justified in this slice. |
| XP/streak/session goals | HIDDEN / DEFER | They compete with Canvas reveal. |

## 4. Smart Director and pacing

The session now follows: manual stroke -> bounded fragment reveal -> optional
rare event -> Canvas response -> explicit continue or stop. The deterministic
simulator covers 30-second, 3-minute, and 15-minute windows. It reports first
reveal, event cadence, manual/assisted ratio, camera transitions, interruptions,
and natural stop opportunities. These are pacing contracts, not enjoyment proof.

## 5. Visual and pixelization status

Phase 3 added one restrained visual language: a frame/scan/ownership copy for a
fragment, a quieter Special version, and a warmer artwork-completion version.
Reduced motion removes animation and shortens the duration. No generic particle
layer or HUD reward was added.

Pixelization R&D remains conservative: the deterministic matrix has 28 metric
rows and 14 comparisons; only two 192/512 candidates are provisional positives,
while the rest fall back to classic plus human review. 1024/1200 paintable
recommendations remain unavailable by design.

## 6. Progression, content, and business

Gallery/collection-first progression and one curated showcase pack now exist as
bounded product surfaces. The XTR implementation is mock/provider-shaped and
disabled by default; it does not launch payments or add a currency economy.
Content quality remains metadata-gated, with `classic` Pixelization as the safe
default and two exact-resolution provisional routes. See
`docs/PRODUCT_PHASE_5_HANDOFF.md` for the complete Phase 5 contract.

## 7. Verification evidence

- Earlier Phase 2/3 snapshot: root **417 passed / 0 failed** and server
  **363 passed / 65 skipped / 0 failed**; current Phase 5 counts are maintained
  in `docs/PRODUCT_PHASE_5_HANDOFF.md`.
- Reveal ceremony unit tests: **4 passed**.
- Fresh Phase 2 Chromium slice: **4 passed / 0 failed**, including the manual
  first-reveal page-error guard and ceremony assertion.
- Build: **PASS**; existing >500 kB main-chunk warning remains.
- Lint: **PASS**, warning budget **94/100**, no lint errors.
- `git diff --check`: **PASS**.
- Reduced-motion and sound-off branches remain covered at code level.

The full Chromium suite was not claimed as green: an unrelated accessibility
fixture attempts to fill `18` into an input whose current range is `0..3`. That
isolated harness mismatch is recorded rather than masked.

## 8. Performance and safety

No changes were made to the pointermove hot path, Stroke Engine, tile-bounded
cache, LOD, offline save queue, revision contract, or server-authoritative
progress. The ceremony is DOM/CSS-only, does not move the camera, and does not
request full-grid data.

## 9. Git / checkpoint

- Integration branch: `codex/product-phase-2-autonomous`.
- Main user checkout was not modified; its dirty evidence files remain intact.
- Integration worktree is clean after the final documentation commit.
- Feature branch is intended for review/PR, not automatic merge to `main`.
- Logical commits include the Phase 2 event slice, simulator, pixelization
  routing diagnostic, runtime gate fixes, and the two Phase 3 ceremony commits.
- Remote checkpoint: push `codex/product-phase-2-autonomous` after the final
  documentation commit; do not merge without a release decision.

## 10. Validation debt and useful human checks

Open debt is tracked in `docs/VALIDATION_DEBT.md`:

- 8–12 real players comparing control/treatment;
- perceived authorship, calmness, spectacle, and want-again;
- physical Telegram Android/iOS WebView, safe areas, background/resume,
  haptics, and reduced motion;
- final Choice versus Automatic Spark decision;
- artistic preference for pixelization recommendations.

Human checks should use one identical tiled artwork and record: time to first
manual action, time to first reveal, whether the Canvas or HUD owns attention,
whether the next beat feels optional, and whether stopping after 30 seconds feels
complete rather than abandoned.

## 11. What required the owner

Only Level 3 evidence and the final high-cost event default require the owner:
real-device taste, observed player authorship, and the decision to lock one
positive-event treatment. No owner action is needed to reproduce route, reload,
input, build, or E2E checks.

## 12. Next recommended milestone

Run the bounded human/device and provider-sandbox review on the current preview
when the owner is ready. Do not enable production Stars, choose a final price,
or start a new functional phase until those release decisions are explicit.
