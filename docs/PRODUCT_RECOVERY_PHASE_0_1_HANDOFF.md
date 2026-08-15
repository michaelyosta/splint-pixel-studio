# Splint Product Recovery — Phase 0/1 Handoff

## Status

**READY FOR CORE FEEL PLAYTEST**, subject to the physical Telegram checks listed in `CORE_FEEL_PLAYTEST.md`.

This status means the experiment is technically ready to put in players' hands. It does not mean that core enjoyment has been proven.

## Before

The opening experience routed a player through product surfaces and broad meta systems before the basic painting action had earned attention. In the player, cell fills, Smart Engine routing, progress, XP, zone rewards, goals, Special Cells, and navigation competed in one hierarchy. Target completion could immediately move the camera, reducing the time in which the player could notice and claim the result.

## Reference slice

The controlled slice uses the existing 28×28 **Astro Whale** (`color_astro-whale`). Its first authored sequence is:

1. `Контур головы` — color 3, 26 cells, including a continuous 7-cell horizontal run;
2. `Лицо кита` — color 4, 55 cells;
3. `Свет в глазах` — color 9, 9 cells.

It was selected because the first gesture starts immediately, reveals a recognizable contour in tens of seconds, and points naturally to a second visual fragment. No new production content pipeline was introduced.

## First-minute contract

The gated URL cohort opens directly into Astro Whale. It shows one contextual line before the first paint, then gets out of the way. In the experiment:

- catalog/home/profile loads and navigation do not compete with the opening;
- onboarding modal, session goal, progress ring, palette/dock, menu, XP notices, zone reward, streak and achievement messaging are suppressed;
- Special Cells are forced to control/no-offer and remain untouched in production code;
- backend reward/progression infrastructure remains intact, but rewards are not rendered or applied to the experimental feedback hierarchy;
- the canvas and the artwork remain the dominant visual surface.

The experiment is unavailable in production unless `VITE_CORE_FEEL_EXPERIMENT_ENABLED=true`. Development comparison uses `?coreFeel=control|a|b|c`.

## Stroke feel variants

All variants share the existing Stroke Engine and bounded Canvas path. Pointer movement only draws newly rasterized cells and does not set React state.

| Variant | Stroke | Fragment reveal | Camera | Haptic tone |
| --- | --- | --- | --- | --- |
| Control | existing inset fill | none | existing automatic behavior | existing |
| A | joined full-cell fill, crisp top settle | edge settle | ownership pause | quiet |
| B | joined soft material response | tonal breathe | ownership breathe | balanced |
| C | joined luminous edge | luminous edge resolve | ownership pause | expressive |

Sound is optional and off by default. Single-cell taps rely on direct visual feedback; a calm stroke cue is reserved for multi-cell gestures and rate-limited. Fragment completion has a separate, stronger cue. Unsupported audio/haptics fail silently.

## Player-authored reveal

Completing the authored fragment now:

1. resolves the filled shape on the artwork;
2. applies a variant-specific, bounded reveal treatment around the actual fragment bounds;
3. attenuates motion when `prefers-reduced-motion` is active;
4. disables painting during the ownership pause;
5. offers `Следующий фрагмент` and `Остановиться здесь`;
6. moves to the next authored beat only after the player's explicit choice.

The Smart Engine is retained as routing infrastructure, but acts as a director: it proposes the next curated fragment and performs a smooth opt-in focus after selection. Manual pinch/pan pauses guidance without forfeiting the eventual authored reveal.

## Measurement

The cohort emits only experiment open, first/resume manual action, manual reveal, next selection, and stop. Reveal payloads include variant, fragment, time to reveal, cell count, and `assisted_cells: 0`. Generic per-stroke, XP, milestone, and camera analytics are not used to judge the experiment.

## Technical verification summary

Final local verification on 2026-08-14:

- client unit suite: **351 passed, 0 failed**;
- server suite: **354 passed, 65 configuration-gated skips, 0 failed**; the new analytics allowlist cases passed;
- lint: **PASS at the existing warning budget (98/100)**, with no new warning added by this slice;
- production build: **PASS**, 1,862 modules transformed; the existing chunk-size advisory remains;
- core-feel E2E: **17 passed, 1 explicitly skipped** across Chromium, emulated iPhone, and emulated Pixel; the skip is the WebKit/CDP multi-touch helper limitation, not an assertion retry;
- existing input/pointer-capture/bfcache/stabilization regression suites: **35/35 passed** when run as their four intended suites (6 + 4 + 7 + 18);
- `git diff --check`: **PASS**;
- visual review at 390×844: the opening contains only artwork, one contextual instruction, and fragment status; the completed state exposes the painted contour before an explicit next/stop choice and does not reveal the variant label.

The Stroke Engine guardrail held. On the 1,200×1,200 quick benchmark, representative tiled totals moved from 0.288 ms to 0.224 ms for tap, 0.689 ms to 0.454 ms for a 100-cell stroke, 1.042 ms to 0.757 ms for a 250-cell fast stroke, and 0.659 ms to 0.477 ms cross-tile. Finalization p95 max moved from 1.359 ms to 0.694 ms. These are noisy local benchmark samples, so they demonstrate no measured regression rather than a claimed optimization win.

Automated mobile projects are browser emulation, not real Telegram devices.

## Red-team changes made during integration

The integrator rejected or corrected these early implementations:

- an XP toast appeared over the first reveal — suppressed in the cohort;
- the fragment summary said `0 штрихов` after completion — replaced with a truthful completed state;
- reveal bounds were read from a route object that did not own bounds — derived from the authored fragment;
- the canvas remained paintable during ownership pause — interaction is now disabled until the player decides;
- the stop option initially existed only through Back — added an explicit natural stopping CTA;
- haptic feedback fired on every tap — taps now use visual causality; multi-cell strokes and fragments carry the sensory grammar;
- generic per-stroke/milestone/camera analytics polluted the minimal experiment — removed from the cohort;
- manual camera exploration could prevent the fragment reward — the reveal now remains tied to authored completion, not AUTO state;
- production URLs could opt into the slice implicitly — an explicit deployment flag is now required.
- a visible variant chip would have biased the blinded comparison and competed with the artwork — removed from the player surface;
- a luminous pointer-move implementation allocated a gradient in the hot path — replaced with bounded allocation-free highlight rectangles;
- the iPhone multi-touch verifier depended on Chromium-only CDP — converted into an explicit physical-device gate instead of a misleading automated pass.

The requested independent DeepSeek v4 Flash reviewers were dispatched and retried after integration gates, but the provider returned repeated `429 Too Many Requests`. No review result is represented as completed; the points above are SOL's own red-team integration findings.

## Deliberately not implemented

- no redesign or rebalance of Spark, Bomb, Fuse, Choice, Hazard, or Artifact;
- no XP/progression rewrite;
- no new catalog scale, 1200×1200 product direction, content pipeline, social surface, Stars store, monetization, or backend architecture;
- no claim that the selected variant is fun;
- no Phase 2 work.

## Owner's hands-on decision

The owner should compare Control/A/B/C on a phone and judge:

- whether the joined stroke feels like one authored gesture rather than cell ticks;
- whether the contour becomes perceptibly more recognizable at completion;
- whether the reveal is calm but unmistakable;
- whether the ownership pause feels earned rather than like another HUD interruption;
- whether the next-fragment camera move feels chosen;
- whether stopping feels natural;
- which variant, if any, creates an honest desire to reveal the face next.

Use the randomized 8–12-player protocol in `CORE_FEEL_PLAYTEST.md` before choosing a winner or authorizing Phase 2.
