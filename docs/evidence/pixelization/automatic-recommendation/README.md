# Automatic pixelization routing diagnostic

This evidence-only stream turns the existing paired pixelization matrix into a
conservative per-artwork/per-logical-resolution routing suggestion. It does
not change `src/lib/pixelColoring.js`, the creator default, or the painting
runtime.

## Reproduce

From the repository root:

```text
node scripts/pixelization-eval/recommend.mjs --input=docs/evidence/pixelization/repaired-candidate-comparison/summary.json --output=docs/evidence/pixelization/automatic-recommendation/summary.json
node scripts/pixelization-eval/recommend.mjs --input=docs/evidence/pixelization/repaired-candidate-comparison/summary.json --output=docs/evidence/pixelization/automatic-recommendation/REPORT.md --format=markdown
node --test test/pixelizationRecommendation.test.js
```

The fresh source matrix in `current-matrix/` was generated on 2026-08-20 from
Phase 2 commit `091a9c683919a1a0808f1af6d58cb9d9b6272b28`. It covers the
paired 192×192 and 512×512 rows. The existing repaired-candidate evidence in
`docs/evidence/pixelization/repaired-candidate-comparison/summary.json` also
records the 1024/1200 capability probes and their explicit
`PAINTABLE_RESOLUTION_LIMIT` warnings. Re-run the independent evaluator first
when the pixelization pipeline changes; this diagnostic must not be treated as
fresher than its source summary.

## Decision contract

- The unit of choice is the exact logical raster size, not a display size.
- `paintable` is provisional-positive only when the structural effort lower
  bound improves by at least 10% and no guardrail regresses.
- Any effort, edge-recall, edge-precision, source-error, tiny-region or
  transition regression falls back to `classic` and is marked `human-review`.
- A missing paintable result (including the honest 1024/1200 limit) is an
  explicit `classic`/`unavailable` entry. It is never silently upscaled.
- Preview/render dimensions are reported separately. A 512×512 preview does
  not make a 512×512 logical raster more detailed, and a 1200×1200 preview
  does not make a 512×512 raster a 1200×1200 paintable grid.

## Interpretation of this snapshot

The fresh paired matrix routes only two rows to provisional `paintable`:

- simple illustration at 192×192;
- Utah dunes landscape at 512×512.

Twelve paired rows remain classic with `human-review` because effort gains are
paired with an edge/fragmentation regression. The repaired-candidate
high-resolution probes keep 1024×1024/1200×1200 on classic because the
paintable candidate is unavailable at those logical sizes. This is a useful
routing hypothesis, not an artistic winner claim; visual review, number
readability and physical-device painting remain validation debt.
