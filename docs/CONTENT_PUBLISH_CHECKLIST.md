# Content publish checklist

Status: CANONICAL
Authority: Operational gate procedure for catalog publication decisions.

Navigation: [INDEX.md](INDEX.md) · Current state: [CURRENT_STATE.md](CURRENT_STATE.md)
Content boundary: [CONTENT_PIPELINE_CONTRACT.md](CONTENT_PIPELINE_CONTRACT.md)
Metadata contract: [PHASE4_CONTENT_METADATA_UI.md](PHASE4_CONTENT_METADATA_UI.md)

Technical validity is not visual approval. Visual approval is not
publication. No pipeline result, benchmark, or generated preview may
silently promote an item between states.

## The four states (unchanged)

1. `SOURCE_APPROVED` — source image permitted for the intended flow.
2. `TECHNICALLY_VALID` — automated validation passes (dimensions,
   palette/cell representation, storage payload, pipeline invariants).
3. `VISUALLY_APPROVED` — a named human reviewed readability, composition,
   effort, fragmentation, and painting experience on a dated record.
4. `PUBLISHED` — intentionally exposed in the catalog or another surface
   by an explicit product decision.

## Per-batch publish checklist

For every catalog batch, record all of the following before publication:

- [ ] Each item reached `TECHNICALLY_VALID` through the automated pipeline
      (report reference, SHA, date).
- [ ] Each item reached `VISUALLY_APPROVED` by a named reviewer with a
      dated record covering: readable thumbnail and numbers, honest
      duration/complexity, deliberate first segment and visual beats, low
      micro-region burden, coherent palette/composition/final reveal.
- [ ] Server-owned metadata present per
      [PHASE4_CONTENT_METADATA_UI.md](PHASE4_CONTENT_METADATA_UI.md);
      content and security gates passed.
- [ ] Explicit product decision names the batch, the target surface, and
      the publisher. Approval status `UNKNOWN` blocks publication.
- [ ] Pixelization algorithm unchanged: current production winner status
      is `UNKNOWN` unless fresh direct evidence and an explicit decision
      say otherwise. Do not replace the production algorithm because one
      metric or candidate looks better.

## Forbidden promotions

- `TECHNICALLY_VALID` → published without `VISUALLY_APPROVED`.
- Benchmark win or single-metric improvement → production algorithm change.
- Generated preview existing → approval assumed.
- Catalog builder output present in a branch → production catalog published.

## What this checklist does NOT change

- [CONTENT_PIPELINE_CONTRACT.md](CONTENT_PIPELINE_CONTRACT.md) keeps the
  four-state separation and the quality gate. This document only makes the
  per-batch evidence explicit.
- This change generates, approves, or publishes no catalog content.
