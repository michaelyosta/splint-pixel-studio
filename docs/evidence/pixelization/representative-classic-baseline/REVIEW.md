# Independent representative classic baseline review

This snapshot establishes the classic converter baseline on seven hash-pinned, evaluation-only Public Domain/CC0 inputs: a real portrait, animal, landscape, isolated object, gradient-heavy photo, simple non-pixel illustration and strong photographic silhouette.

The run completed 14 measurements at 192 and 512 with no adapter/source warnings. Visual inspection confirmed that every generated panel contains the intended source, converter output, number-grid preview and metric vector. Labels are honestly hidden at these whole-art preview scales because a 320-pixel preview gives less than two pixels per logical cell at 192; number readability therefore remains a zoom/mobile human gate rather than a panel PASS.

Baseline observations are descriptive, not verdicts:

- `portrait-jessica-meir` rose from 701 to 3920 4-connected regions between 192 and 512.
- `animal-iguana-venezuela` rose from 161 to 3720; fine photographic texture is highly resolution-sensitive.
- `object-palm-wine-cup` stayed comparatively simple at 40 to 126 regions.
- `landscape-utah-dunes` stayed at 84 to 298, while retaining large coherent bands.
- The simple illustration still produced 533 to 1703 regions, exposing antialiased-outline fragmentation that a flat-art fixture alone would miss.

The seven 192 panels are retained in `review-panels/` to cover every corpus stratum. The complete 14-panel matrix is reproducible and intentionally ignored in Git to avoid another roughly 10.4 MB of generated binaries. Machine-readable measurements and hashes remain in `summary.json`/`summary.csv`.

Reproduce:

```text
node --max-old-space-size=4096 scripts/pixelization-eval/run.mjs --manifest=scripts/pixelization-eval/corpus/representative-corpus.json --adapter=classic --output-dir=docs/evidence/pixelization/representative-classic-baseline
```
