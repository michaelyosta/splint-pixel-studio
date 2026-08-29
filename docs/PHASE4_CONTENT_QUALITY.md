# Phase 4 content quality slice

Status: **bounded diagnostic / advisory metadata**

This slice supports the collection-first Phase 4 direction without expanding
the catalog or changing the creator converter. Catalog and collection API
summaries now expose a small `content_metadata` object with three questions:

1. How long is one artwork likely to feel, and is it a quick, standard, or
   segmented long-form session?
2. How much concentration does the artwork require, using measured structure
   where a bounded raster is available and editorial/dimension signals for
   tiled maps?
3. Is there exact pixelization evidence for this artwork at this logical
   resolution, or should it remain on the safe classic fallback?

## Contract

`content_metadata.schema_version` is `content-metadata.v1`.

- `duration` is a coarse session promise, not a completion-time guarantee.
  Rows above 25,600 logical cells in tiled storage are labelled
  `Длинная · по сегментам`, even if an old editorial row still says `3` in
  `est_minutes`.
- `complexity` is a bounded label (`Спокойная`, `Сосредоточенная`, or
  `Детальная`) with a score and evidence source. Legacy rasters up to the
  existing 25,600-cell public budget may be measured. Tiled maps do not load a
  full grid merely to produce a card label.
- `style` is exact-resolution scoped. An explicit recommendation can expose a
  provisional `paintable` route, but unknown rows stay on `classic` with
  `unassessed` status.
- `quality_gate` is advisory and never blocks catalog display. `review` means
  the row is not ready to be treated as an automatically approved curated
  content candidate.

This is intentionally separate from creator preview/final parity. The
converter, preview cache identity, result fingerprints, and save contract are
unchanged. No style preset is silently changed by this metadata.

## Pixelization evidence used

The current routing snapshot is
`docs/evidence/pixelization/automatic-recommendation/current-recommendation.json`
under policy `pixelization-routing-v1`. It has 28 metric rows / 14 paired
comparisons, with only two provisional positives:

- `illustration-paint-brush` at 192×192;
- `landscape-utah-dunes` at 512×512.

The remaining rows conservatively fall back to classic and/or require human
review. The existing six catalog fixtures have no explicit corpus source id,
so the audit deliberately attaches zero paintable recommendations to them.
This is a content-pipeline gap, not a reason to infer a style match from a
title or preview URL.

## Reproduce the report

```text
node scripts/content-quality-audit.mjs --output=docs/evidence/content-quality/current-catalog.json
node scripts/content-quality-audit.mjs --format=markdown --output=docs/evidence/content-quality/REPORT.md
node --test server/test/content-quality.test.js test/contentQualityAudit.test.js
```

The generated report is a diagnostic snapshot. It does not rewrite
`server/catalog-templates.json` and does not add content.

## Phase 4 use

The first consumer should use these fields to make pack cards honest:

- quick pack: `duration.band=short` and no complexity hold;
- standard pack: `duration.band=medium` with a clear focus label;
- long-form pilot: `duration.session_mode=segmented`, with explicit resume
  milestones rather than a single completion promise;
- style route: do not expose `paintable` unless exact evidence is attached and
  still valid for the selected logical resolution.

The metadata does not itself create a pack, purchase, XP, streak, or social
feed. A future curated content pass should attach stable source ids and run
the same report before publishing a thematic set.

