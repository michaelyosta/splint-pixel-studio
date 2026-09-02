# Product simplification design

## Surface audit

| Surface | Decision | New role |
| --- | --- | --- |
| Home | HIDE | Useful resume/recommendation content belongs in Catalog. |
| Catalog | KEEP + SIMPLIFY | Default discovery surface and marketplace container. |
| CreateHub / Creator | MERGE + SIMPLIFY | Import-first flow with recommended result first. |
| Manual editor | HIDE | Dormant internal implementation; no primary entry point. |
| Profile / Gallery | MERGE | Visual collection, completed works, favorites, and owner controls. |
| Collections | REUSE | Discovery in Catalog; ownership/completion in Profile. |
| Store | MERGE | Premium/locked presentation inside Catalog; payments remain disabled. |
| Feed / Community | REMOVE FROM IA | Existing code remains dormant for public-profile compatibility. |
| Achievements / unlock journey | REMOVE FROM IA | Backend remains dormant; no product-surface progression. |
| Player | KEEP | Only completion copy/navigation is aligned to collection/profile. |

## Profile concepts

| Concept | Visual wow | Mobile | 100+ works | Public profile | Verdict |
| --- | --- | --- | --- | --- | --- |
| Collector Wall | High | High | Medium | High | Strong, but creator identity is secondary. |
| Museum Profile | Very high | Medium | Medium | High | Too editorial and rigid for uneven data. |
| Creator + Collector | High | High | High | High | Selected. Clear showcase plus separate collected/created shelves. |

The selected direction uses a content-led hero, a deterministic featured mosaic (favorites, then completed works), compact content metrics, collection progress, completed works, and an owner-only created shelf with management controls. It avoids a new pinning schema and remains useful when only part of the data is available.
