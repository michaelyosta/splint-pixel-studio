# Independent assessment of repaired paintable candidate

## Decision

`paintable-v1` is materially more paintable by structural effort metrics at 512, and its repaired producer evidence now matches the final cells. It is **not yet safe to select as the universal creator default**: strong-edge recall regresses in most 512 cases, two 192 cases increase manual effort, and the candidate deliberately rejects 1024/1200 logical grids. Beauty, number readability and paint feel remain owner/device human gates.

This is not a composite-score winner. The result supports an owner review of a 512-logical-resolution paintable mode, not automatic replacement of classic at every requested resolution.

## Reproducible matrix

- Inputs: seven exact Public Domain/CC0 derivatives pinned by SHA-256 in `scripts/pixelization-eval/corpus/representative-candidate-corpus.json`.
- Paired sizes: every stratum at 192 and 512; 14 classic/paintable comparisons.
- Capability probes: portrait, landscape and simple illustration at 1024 and 1200.
- Options: 10 colors, identical center crop, `yieldEvery=96`, whole-art 320×320 number-readability proxy.
- Evidence: 34 metric rows, 14 paired panels, stable final-cell SHA-256 output hashes, conversion runtimes and 7 adversarial fixtures.
- Reproducibility check: the 14 classic 192/512 hashes exactly match the earlier independent baseline.

Run:

```text
node --max-old-space-size=4096 scripts/pixelization-eval/run.mjs --manifest=scripts/pixelization-eval/corpus/representative-candidate-corpus.json --adapters=classic,paintable --output-dir=docs/evidence/pixelization/repaired-candidate-comparison
```

## Evidence by resolution

| Guardrail | 192 (7 pairs) | 512 (7 pairs) |
| --- | ---: | ---: |
| Lower effort than classic | 5/7 | 7/7 |
| Effort improvement greater than 10% | 4/7 | 7/7 |
| Effort regression greater than 5% | 2/7 | 0/7 |
| Median effort change | -17.9% | -51.1% |
| Lower tiny-cell area | 7/7 | 7/7 |
| Lower source mean DeltaE | 6/7 | 5/7 |
| Edge recall down more than 3 points | 3/7 | 5/7 |
| Edge recall up more than 3 points | 3/7 | 1/7 |
| Median runtime change | -7.6% | -7.0% |

Counterexamples matter:

- At 192 the real iguana rises from 170 to 239 effort lower-bound taps (+40.6%), and the isolated cup from 49 to 60 (+22.4%).
- At 512 the candidate reduces effort in every case, including portrait 3929→1230 and iguana 3729→1112, but portrait edge recall falls 0.732→0.611 and iguana 0.351→0.254.
- Landscape at 512 is the clean positive control: effort 307→150, mean DeltaE 5.128→4.742 and edge recall 0.444→0.491.
- Silhouette at 512 exposes the tradeoff: effort 1201→426 and mean DeltaE 2.429→1.796, while edge recall falls 0.807→0.699.

## Repaired evidence contract

- All 14 paintable producer metric vectors match the independent final-cell evaluator exactly for 4-connected region count, <=2-cell area ratio and minimum manual-stroke lower bound.
- All 14 paintable rows contain distinct typed/delimited `px128-…` result fingerprints and separate `rgba128-…` preview-pixel fingerprints. Independent SHA-256 output hashes are also unique across the run.
- No runtime guardrail fired. Runtime measurements are local Chromium conversion timings, not mobile-device performance proof.
- Six 1024/1200 paintable probes fail explicitly with `PAINTABLE_RESOLUTION_LIMIT`; classic completes all six. This is an honest capability boundary, not a flaky test and not evidence that a 512 raster has 1200 logical detail.

## Visual and human gates

All fourteen paired panels were visually inspected for correct source/crop, side-by-side outputs, grid-proxy state and unclipped metric flags. The six unedited panels in `review-panels/` retain decisive positive and negative cases; the complete 14-panel matrix is reproducible and ignored in Git to avoid redundant binaries.

The whole-art 320-pixel preview gives only 1.927 pixels per logical cell at 192 and 0.723 at 512, so neither mode can honestly display cell numbers at that scale. Number readability must be judged using the creation preview's bounded zoomed grid and on a mobile device. Owner review must also decide whether the observed edge-detail reduction is an acceptable artistic simplification.

## Recommendation

Keep `classic` as fallback and keep `paintable` non-default until owner review. The evidence supports testing a distinct 512-logical paintable mode with render resolution separated from logical pixel-art resolution. Do not label 1024/1200 as higher-quality paintable modes unless the product explicitly routes them through a different pipeline or renders a bounded logical raster larger.
