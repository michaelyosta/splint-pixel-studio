# Content quality gate

Status: CANONICAL
Authority: Detailed content-quality and metadata contract.

Navigation: [INDEX.md](INDEX.md) · Current state: [CURRENT_STATE.md](CURRENT_STATE.md)
Overview: [CONTENT_PIPELINE_CONTRACT.md](CONTENT_PIPELINE_CONTRACT.md)

## Decision

The server may expose bounded `content_metadata`, but the client must not
silently reconstruct a duration or complexity promise from legacy
`est_minutes`, `difficulty`, or grid dimensions. Missing or unknown metadata is
an explicit `Метаданные не проверены` state.

The metadata object is expectation-setting information, not a progression
system, reward, entitlement, or editorial approval. Mixed packs must say that
they are mixed rather than presenting a false single promise.

## Quality states

Keep these decisions separate:

```text
SOURCE_APPROVED
→ TECHNICALLY_VALID
→ VISUALLY_APPROVED
→ PUBLISHED
```

Automated `good`/`fair` labels, pixelization metrics, and reproducible reports
are advisory evidence. They cannot create visual approval or publication.

## Required review dimensions

- readable thumbnail and numbers;
- honest duration and complexity labels;
- deliberate first segment and at least three visual beats where the format
  calls for them;
- acceptable small-region/fragmentation burden;
- coherent palette, composition, and final reveal;
- bounded render/storage cost and safe private-source handling.

## Covered projections

The shared `content-metadata.v1` builder is used by the catalog, mine/profile,
recommendation, Director, and collection projections. Collection aggregates
must stay bounded and must not load cell maps merely to display metadata.

The evidence report at
[evidence/content-quality/REPORT.md](evidence/content-quality/REPORT.md) is a
dated audit snapshot. It is not a current publication decision. Current
approval and publication status belongs to [CURRENT_STATE.md](CURRENT_STATE.md).

Human/device review remains required for typography and information density in
Telegram WebView. Do not publish content as part of a documentation change.
