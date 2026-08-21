# Phase 4 content metadata UI contract

## Decision

Phase 4 surfaces must display the bounded `content_metadata` object produced by
the server's content-quality service. The UI may render the labels as supplied,
but must not silently reconstruct a duration or complexity promise from legacy
`est_minutes`, `difficulty`, or grid dimensions.

The client presentation helper in `src/lib/contentMetadata.js` treats a missing
or unknown schema as an explicit `Метаданные не проверены` state. This keeps old
fixtures and synthetic previews honest while the server data catches up.

## Covered surfaces

- Catalog artwork cards, quick picks, and the editorial card.
- Gallery rows, completed collection objects, and the next-reveal resume shelf.
- Home's primary resume/start card and secondary session choices.
- Premium pack teaser, pack metadata, and individual preview cards.
- Store pack cards and selected pack detail.
- Artwork detail/player context and completion ceremony.

The `/colorings`, `/colorings/:id`, `/colorings/mine`, recommendations, Director,
and `/meta/collections` projections now carry `content_metadata` using the same
`content-metadata.v1` builder. Collection metadata is a bounded aggregate of at
most 48 active templates and never loads cell maps.

## Product guardrails

- Artwork remains the primary object; metadata is a compact expectation-setting
  aid, not a new progression system.
- Mixed packs explicitly say `Смешанная · разные сессии` or
  `Смешанная сложность` rather than presenting a false single promise.
- Static premium previews carry editorial metadata and remain in preview-only
  payment posture. No checkout, Stars, entitlement, or payment operation was
  changed by this slice.
- Missing pixelization evidence remains visible as review/unassessed state; it
  is not converted into an implied paintable quality claim.

## Evidence

- Client helper tests cover authoritative labels, missing-schema fallback, and
  mixed pack aggregation.
- Gallery and premium pack tests verify metadata is preserved and rendered from
  the shared contract.
- Server content-quality, Director, recommendations, `/colorings/mine`, and
  API integration tests verify the schema is present, bounded, and available to
  return surfaces.

Human/device validation is still required for typography and information
density in Telegram WebView; that is validation debt, not a reason to invent a
second metadata source.
