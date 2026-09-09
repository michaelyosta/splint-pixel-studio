# Content and pixelization contract

Status: CANONICAL
Authority: Stable separation of source approval, technical conversion,
pixelization quality, and catalog publication.

Navigation: [INDEX.md](INDEX.md) · Current state: [CURRENT_STATE.md](CURRENT_STATE.md)

## Four separate decisions

Every content item must keep these states distinct:

1. `SOURCE_APPROVED` — the source image is permitted for the intended catalog
   or creator flow.
2. `TECHNICALLY_VALID` — dimensions, palette/cell representation, storage
   payload, and pipeline invariants pass automated validation.
3. `VISUALLY_APPROVED` — a human has reviewed readability, composition,
   effort, fragmentation, and the painting experience.
4. `PUBLISHED` — the item is intentionally exposed in the catalog or another
   product surface.

Technical validity is not visual approval. Visual approval is not publication.
No pipeline result, benchmark, or generated preview may silently promote an
item between these states.

## Creator pipeline

The creator is import-first. The current UI offers 192, 512, 1024, and 1200
logical resolutions, defaults to 512×512 and 16 colours, and converts large
payloads to tiled storage. The client supports `classic-v1` and `paintable-v1`
pipeline versions; `paintable-dither` is a paintable preset variant. An
explicit `VITE_CREATOR_PREVIEW_STYLE_PRESET` may select a preset, but a
candidate is not a production winner merely because it improves one metric.

The server owns upload bounds, authorization, private original storage, and
the canonical completed result. Client preview data is not proof of a
completed artwork; see [RESULT_IMAGE_INTEGRITY.md](RESULT_IMAGE_INTEGRITY.md).

## Quality gate

Quality review considers at least:

- readable thumbnail and numbers;
- honest expected duration and complexity;
- deliberate first segment and multiple visual beats;
- low micro-region/fragmentation burden;
- coherent palette, composition, and final reveal;
- safe storage and bounded render cost.

`good`/`fair` automated quality labels are advisory. Historical pixelization
matrices under `docs/evidence/pixelization/` are reproducible evidence and do
not declare a current winner. Current winner and editorial approval remain
`UNKNOWN` unless fresh direct evidence and an explicit decision say otherwise.

## Catalog publication

Publication requires the relevant content and security gates, server-owned
metadata, and an explicit product decision. This documentation migration does
not generate, approve, or publish catalog content.

The shared metadata contract is documented in
[PHASE4_CONTENT_METADATA_UI.md](PHASE4_CONTENT_METADATA_UI.md); the dated
quality report in [evidence/content-quality/REPORT.md](evidence/content-quality/REPORT.md)
is evidence only.
