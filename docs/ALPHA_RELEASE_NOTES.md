# Splint — Closed Alpha Release Notes

Candidate: `codex/alpha-rc-1` (see `docs/RELEASE_RUN_STATE.md` for the exact SHA).
Audience: closed-alpha participants and the release owner. This is a product
summary, not a Git changelog.

## What Splint is (alpha scope)

Splint is a calm, player-authored pixel-painting Mini App for Telegram. You
pick an artwork, paint its fragments by hand, and slowly reveal the picture.
There are no timers, no energy, and no social pressure loops in this alpha.

## What works in this alpha

- **Player-authored painting.** Manual cell-by-cell painting on classic
  artworks and fragment-based painting on large tiled canvases (up to 1200×1200
  with minimap navigation). Strokes follow the finger; wrong-color taps are
  gently rejected.
- **Smart Director.** The next meaningful fragment is always visible
  («Следующий участок»), with bounded guidance — the game leads, you paint.
- **Special moments (baseline).** Rare positive events: a Spark offer you can
  claim and use to auto-reveal a chosen fragment, and passive Artifact
  discovery. The provisional baseline is `spark_choice`. Fuse/Hazard/Choice
  events stay disabled.
- **Gallery & collection-first progression.** Finished artworks live in your
  Gallery; the Home screen always offers the latest unfinished artwork as the
  reason to come back.
- **Resume.** Close the app mid-artwork, come back later — the exact fragment
  and progress are restored (server-authoritative progress with conflict-safe
  saves).
- **Creator (vertical slice).** Upload an image, preview the exact coloring
  result, convert it to a paintable artwork, and play your own creation.
  Private by default.
- **Content metadata.** Honest duration/complexity labels (e.g. «Средняя ·
  около 4 мин · Детальная») so you know what you start.
- **Premium pack slice + Store.** One showcase premium pack with explicit
  free/owned/paid states. **Payments are disabled in this alpha** — the pack is
  visible, purchasing is intentionally refused (503) until Stars are enabled in
  a later, separate release decision.
- **Share/deep links.** Artwork links open the correct artwork for a fresh
  user; share always points at a concrete artwork, never a generic home screen.

## What is intentionally disabled

- **Real Telegram Stars payments** (`PAYMENTS_MODE=disabled`, fail-closed;
  production boots refuse `telegram_stars` and `internal_credits`).
- **Dev auth, QA cohort overrides, E2E seed hooks, demo seeding, diagnostics**
  — all throw at boot in production configuration.
- Special event variants beyond the Spark/Artifact baseline.
- Public social feed growth features beyond the basic slice.

## Known limitations

- The bundle is a single ~657 kB chunk (gzip ≈199 kB) — first load on slow
  networks is not optimized yet.
- Server logs classify errors but do not yet include full messages/stacks for
  every 500 — diagnosing a Creator failure may require a reproduction.
- The default rate limit (100 req/min per IP) must be sized deliberately for
  the alpha cohort; Telegram users behind shared NATs can look like one IP.
- Some long-journey visual evidence tests are timing-sensitive in CI-like
  environments (pass uncontended).

## Out of scope for this alpha (already tracked as validation debt)

- Physical Telegram Android/iOS device sign-off (automated emulation only).
- Real Stars round-trip: invoices, refunds, provider webhooks, support drill.
- Final artistic verdicts (Pixelization style, Spark vs Bomb preference).
- Public-scale abuse telemetry and cost dashboards.

See `docs/VALIDATION_DEBT.md` for the full ledger.
