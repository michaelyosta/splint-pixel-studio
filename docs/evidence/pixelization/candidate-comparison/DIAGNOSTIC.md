# Paintable candidate diagnostic at `7feaf06`

This run is a diagnostic snapshot of the first paintable candidate, not a default recommendation. It used identical inputs, crop/options and final-cell evaluator metrics for `classic` and `paintable`. The production-side metrics/fingerprint of this candidate were separately red-teamed as stale/non-local, so they are not used as evaluation truth here.

The independent final-cell measurements are mixed rather than uniformly favorable:

- Large, edge-heavy scenes generally had fewer 4-connected regions with `paintable`: `retro-arcade` at 1200 fell from 6120 to 2263 and `city-streets` from 6168 to 2973.
- The photographic portrait regressed at higher resolutions: 420 to 645 regions at 1024 and 466 to 603 at 1200.
- `lantern-fox` regressed from 405 to 569 regions at 512; `tea-dragon` from 502 to 550.
- Other cases changed direction with resolution, so an app-asset-only or single-resolution aggregate would conceal counterexamples.

These facts make the candidate content/resolution-dependent. They do not establish artistic quality, paint feel or a safe default. `summary.json` and `comparisons.csv` are the complete diagnostic record; `review-panels/` contains only three unedited generated panels selected to expose both structural improvement and regression. The full 28-panel matrix is reproducible locally and intentionally excluded from Git to avoid committing roughly 16.6 MB of redundant binaries.

Reproduce:

```text
node --max-old-space-size=4096 scripts/pixelization-eval/run.mjs --manifest=scripts/pixelization-eval/candidate-comparison-corpus.json --adapters=classic,paintable --output-dir=docs/evidence/pixelization/candidate-comparison
```

Do not use this snapshot to approve `paintable`. Rerun the independent representative corpus after the repaired candidate commit and require owner visual review before any subjective winner claim.
