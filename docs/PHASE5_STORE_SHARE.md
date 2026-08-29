# Phase 5 store and Telegram share slice

This slice is a bounded product prototype. It uses the existing
`/meta/collections` and `/unlocks/me` responses and deliberately does not add
an internal social feed or a payment implementation.

## Pack states

`src/lib/packStore.js` normalizes collection metadata into four display
states:

- `free` — a public free collection the player has not opened;
- `owned` — server unlock state says the collection is owned;
- `paid` — one public premium collection with a positive `price_in_stars`;
- `unavailable` — malformed, private, unpublished, or zero-price premium data.

The store renders all eligible free/owned packs and at most one paid showcase.
The paid card remains a preview object while `PAYMENTS_MODE=disabled`; its
copy never claims that a purchase succeeded. A future adapter can enable the
CTA only when it supplies `telegram_stars` and a server-confirmed callback.

The pure checkout reducer covers `pending`, `success`, `cancelled`, `error`,
`retry`, and `restore` transitions. A client callback is not treated as
proof of entitlement; only an explicit adapter result may dispatch success.

## Telegram distribution object

`buildColoringDeepLink(id, { packId })` opens a specific artwork and carries
its pack when available. `buildPackDeepLink(id)` opens the store on one pack.
The completion share uses the artwork link, and the store share uses the pack
link through `shareViaTelegram`, with Web Share/fallback link copy retained.

Real Telegram WebView recipient re-entry, native story/media behavior, and
Stars invoice/webhook/refund/reconciliation remain external validation gates.
