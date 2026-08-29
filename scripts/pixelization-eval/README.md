# Independent pixelization evaluation

This harness measures the raster produced by a pixelization adapter. It is intentionally outside `src/lib/creatorQuality.js` and does not modify or import the scoring logic used by the product. The same metric contract is used for the current converter and a future candidate.

## Run

From the repository root:

```text
node scripts/pixelization-eval/run.mjs --sizes=32,160,512 --colors=10
```

Run the independent real-photo/non-pixel corpus against the current classic pipeline:

```text
node scripts/pixelization-eval/run.mjs --manifest=scripts/pixelization-eval/corpus/representative-corpus.json --adapter=classic --output-dir=docs/evidence/pixelization/representative-classic-baseline
```

Run an identical paired comparison after a candidate commit is present:

```text
node scripts/pixelization-eval/run.mjs --manifest=scripts/pixelization-eval/corpus/representative-corpus.json --adapters=classic,paintable --output-dir=docs/evidence/pixelization/representative-candidate-comparison
```

Use `corpus/representative-candidate-corpus.json` for the recovery acceptance matrix. It adds 1024/1200 probes for portrait, landscape and simple illustration. A bounded candidate that deliberately rejects those logical sizes must remain a recorded adapter warning/unavailable pair; do not silently upscale a 512 result and score it as 1200.

The runner starts a local Vite page, invokes the browser/Canvas adapter, computes source means with the same fit/crop dimensions, writes `summary.json`, `summary.csv`, a run README, and PNG panels under `docs/evidence/pixelization/current-baseline/`. Use `--skip-panels` for a fast metric-only run. `--adapter=path/to/adapter.mjs` runs a candidate without changing this harness.

The default app-asset corpus is local and deterministic. The separately maintained `corpus/representative-corpus.json` adds real photographic portrait, animal, landscape, object, gradient and strong-silhouette cases plus a simple non-pixel illustration. Its evaluation-only derivatives have explicit Public Domain/CC0 provenance in `corpus/SOURCES.md`. Before browser startup the runner rejects a path outside the repository, recomputes every source SHA-256, and fails if a pinned hash differs. Exact per-run crop/options, source hashes, output hashes and runtimes are recorded in the generated README and summary.

## Adapter contract

An adapter exports `id` and `run({ page, sourceUrl, options })`. `run` returns:

```js
{
  width: Number,
  height: Number,
  palette: Array<string | [number, number, number]>,
  cells: Array<number>
}
```

`cells.length` must equal `width * height`, and every cell must reference the returned palette. `previewDataUrl` and other implementation-specific fields are ignored by the evaluator. The runner hashes the dimensions, palette, and cells so a claimed comparison cannot silently reuse a different output.

## Metric vector

- `regions4` and `regions8`: same-palette connected components under 4- and 8-neighbor connectivity. Both raw counts and counts per 10,000 cells are recorded.
- `sizeDistributions`: raw component size percentiles plus fixed cell-size and area-share histograms. Area-share histograms make a shape comparable across logical resolutions; fixed `<=2` cell counts are deliberately not treated as a quality score.
- `isolatedAndContrast`: singleton/tiny counts and area ratios, with tiny components split into high-contrast, medium, and low-contrast boundary groups. A high-contrast singleton is evidence to review, not an automatic defect.
- `fragmentation`: boundary transitions, transition ratio, boundary contrast, per-component boundary load, compactness, perimeter/area, and color-pair histogram.
- `palette`: used/unused colors, area shares, entropy, and pairwise Lab distance distribution.
- `sourceComparison`: mean/median/p90/max DeltaE between source cell means and palette output; source-edge precision/recall/F1 use adjacent-cell source DeltaE >=18. These fields are `null` when source means are unavailable.
- `predictedEffort`: structural lower bounds for region taps, color switches, boundary transitions, diagonal merging, and conservative manual taps. These are not a claim about the Smart Director or a player’s exact stroke count.
- `numberReadability`: preview cell size, label geometry proxy, foreground contrast, digit coverage, and whether labels are potentially legible. It is not a substitute for a mobile screenshot or human playtest.

## Anti-gaming fixtures

`fixtures.mjs` and `test/pixelizationEvaluation.test.js` cover uniform output, checkerboard fragmentation, oversegmentation, an intentional high-contrast accent, a blurred output that erases a source edge, and the same structure at multiple logical resolutions. The tests protect against optimizing only one scalar such as region count, fixed-size tiny-cell ratio, or palette count.

## Visual protocol

Each panel contains the same source image, the output raster, and a number-grid preview. At small cell sizes labels are intentionally hidden when they cannot be honest; at larger sizes labels are drawn with a contrast-aware foreground. The fourth panel area reports metric evidence and explicitly states that no winner is declared. Review panels side-by-side across categories and sizes, then inspect mobile rendering and painting behavior separately.

The current product converter uses an analysis cap of 384 pixels and a fixed 512-pixel pixel preview. The harness reports logical resolution, not a presumption that 1200 is a quality mode. A candidate may choose a logical pixel-art resolution independent of render resolution, but its adapter must return the actual paintable raster that will be compared.

## Interpretation guardrails

Automated metrics establish structural evidence and regression signals. They do not prove that an image is beautiful, that a palette is artistically coherent, or that painting feels good. Do not declare a winner from this harness alone. Luna B and the owner must review representative panels, runtime, paintability, and device evidence before selecting an algorithm.

## Binary evidence policy

Full panel matrices are reproducible generated output and may be kept locally. Commit the JSON/CSV/README measurement snapshot plus only a bounded set of review panels that covers decisive regressions, improvements, unavailable metrics and corpus strata. Record the exact generation command and do not substitute hand-edited images. Corpus inputs are committed because their hashes define the experiment; application assets are not modified.
