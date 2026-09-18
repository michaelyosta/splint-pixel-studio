# Phase 2 pixelization pipeline

Pixelization is part of normal Splint catalog processing, not a per-image
artistic acceptance gate. Generation prompts carry the pixelization-first art
direction before ImageGen. After download, ingestion only verifies the asset
technically, builds the runtime grid, and writes the catalog derivatives.

## Runtime reference

Catalog ingestion normalizes every coloring master to the manifest dimensions,
then samples it into the logical cell map stored in
`server/catalog-templates.json`. Phase 2 uses these actual player grids:

| Orientation | Master | Logical grid | Player cell size |
| --- | ---: | ---: | ---: |
| Portrait | 1600×2000 | 64×80 | 32 CSS px |
| Square | 1600×1600 | 64×64 | 32 CSS px |
| Landscape | 2000×1500 | 80×60 | 32 CSS px |

These dimensions use the classic cell renderer. The player colors cells from
`template.cells` and `template.palette`; the high-resolution master is only the
source for normal processing.

## Automated technical gate

Ingestion regenerates the normalized master, optimized asset, exact logical-grid
preview, and runtime catalog entry. It regenerates only for technical failures:

- missing/unreadable or truncated PNG;
- unsupported PNG encoding;
- normalized dimensions mismatch;
- effectively empty or non-color artwork;
- missing manifest path, duplicate ID/slot, or broken catalog integration.

Region counts and pixel appearance are not used to reject individual assets.
The logical grid may still be collapsed to the configured runtime region budget
as part of the existing player-processing pipeline.

## Spot checks

Optional 3–5 asset spot checks may be used to detect a systemic pipeline issue.
They are not required per asset and do not trigger regeneration for ordinary
detail, background complexity, or subjective taste. If a systemic technical
problem is found, fix the pipeline or future prompt generation and preserve
already integrated assets unless a concrete technical defect requires repair.
