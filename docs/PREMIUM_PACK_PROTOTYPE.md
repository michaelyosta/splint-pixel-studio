# Premium showcase pack prototype

Status: bounded product prototype. The default public-alpha payment posture
remains `PAYMENTS_MODE=disabled`.

## What is in scope

The catalog now exposes one curated showcase pack, **Ночная орбита**, with two
previewable scenes backed by the existing premium template IDs:

- `color_premium_whale` — `Звёздный кит`;
- `color_premium_dragon` — `Чайный дракон`.

The pack is intentionally a client-side product surface. A preview can be
opened from the catalog or from the existing premium locked screen, scenes
remain preview-only until the server reports a real collection entitlement,
and “save desire” records a local intent only. No Stars request, balance
change, ledger entry, ownership insert, or payment callback was added.

## State contract

`src/lib/premiumPack.js` owns the small state machine:

| State | Meaning | Primary action |
| --- | --- | --- |
| `preview` | Entitlement snapshot is still loading | Save desire |
| `free` | Pack is explicitly free | Open free pack |
| `owned` | Server returned a collection/template entitlement | Open a scene |
| `paid` | A payment mode could offer the pack | Record access intent; never claims purchase |
| `locked` | A configured free prerequisite is incomplete | Continue free route |
| `unavailable` | Payments are disabled or curation is invalid | Save desire |

Only `owned: true` or a server `state: "owned"` can resolve to `owned`.
The default `disabled` payment mode resolves this showcase to
`unavailable`, so the public alpha stays fail-closed.

## Content-quality gate

Each preview carries the existing creator raster-quality result (`good` or
`fair`) plus the editorial gates from the product audit: readable thumbnail,
honest duration (1–20 minutes), deliberate first segment, at least three
visual beats, low micro-region ratio, final reveal, and coherent pack/creator
identity. If a full template payload is available, `assessQuality` is run
directly; previews use the bounded editorial result and do not ship cell maps.

The focused checks live in `src/lib/premiumPack.test.js` and cover the pack
gate, noisy-item rejection, every state, entitlement lookup, and the rule that
a payment intent cannot manufacture ownership.

## Pilot signals

The prototype is designed to measure intent without pretending to sell:

- showcase card and preview opens;
- saved-wish count (local prototype signal only);
- free-pack completion and return-to-preview rate;
- qualitative “want this pack” feedback before enabling Stars.

Real payment activation remains a separate release decision requiring the
existing ADR-001 webhook, support, refund, reconciliation, and replay gates.

