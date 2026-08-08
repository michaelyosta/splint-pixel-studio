# Tiled 1200×1200 checkpoint

Status as of 2026-08-07:

- The creator uses tiled storage for dimensions from 161×161 through 1200×1200, packs the row-major result into 32×32 tiles, and omits the source-image duplicate from large requests.
- Migrations 017 and 018 add tile storage, per-user tiled progress, and a UTC-weekly challenge without rewriting legacy rows.
- Manifest and tile/chunk reads are bounded and do not expose full `cells` or `filled` arrays.
- Tiled progress is chunked into batches of at most 64 changes, uses revision/CAS and idempotency, persists per-tile writes, and applies server-side XP rewards.
- Concurrent first writes now use `INSERT ... ON CONFLICT DO NOTHING` as the initial CAS. Two `revision=0` requests produce exactly one HTTP 200 and one HTTP 409; the losing transaction exits before tile writes or rewards.
- The client uses `Uint16Array`/`Int16Array` tile buffers, an LRU tile cache, viewport/overscan loading, request de-duplication, and explicit offline/error states.
- Tiled levels render through one Canvas and do not create one React/DOM node per cell.
- Large creator previews are now persisted in `preview_url`, rendered under loaded tiles, and shown as a bounded first-contact overview while initial tile requests are in flight.
- `ProgressiveColoringSession` provides adaptive minimap zones (16 for a
  1200x1200 map) and focuses the camera on the selected zone at a tappable
  working scale.
- Completion creates the canonical artwork and thumbnail on the server. The owner-only result endpoint serves the full canonical PNG for viewing/download while the public `/media` route remains publication-gated.
- Weekly progress is counted from server-verified newly correct cells, is idempotent, and awards the weekly XP bonus once per UTC week; the home screen exposes the live progress card.
- The default legacy SQLite database and both preview databases were replayed on temporary copies: `splint.db.bin` applied 12 migrations, `splint-preview.db.bin` applied 2, and the current 18-migration preview applied 0; all ended at migration 018 with `PRAGMA integrity_check = ok`.

Confirmed local verification:

- server tests: 232 total / 176 passed / 56 skipped due to environment;
- product engagement integration passes the weekly challenge lifecycle (0 → 64 → 100 cells, one-time +100 XP reward);
- production build passes;
- lint passes;
- full stabilization E2E passes: 50 passed / 4 skipped across Chromium, Mobile iPhone, and Mobile Pixel; the focused wheel-zoom regression also passes;
- focused tiled integration passes the completion chain: 100% -> canonical artwork -> ready media -> private full result -> preview -> publication -> public media 200.
- focused concurrency coverage passes both the persistence-unit guard and the HTTP two-device initial-write regression; final revision is 1 and exactly one cell is committed.
- focused 1200×1200 E2E passes on Chromium, Mobile iPhone, and Mobile Pixel: creator upload → tiled storage → bounded player/completion path.
- visual evidence is captured at 360, 390, and 430 px for home/catalog/player/profile, plus a 390 px 1200×1200 tiled screenshot; see [`docs/evidence/visual-qa-2026-08-07/`](evidence/visual-qa-2026-08-07/).

Release gates still open: real Telegram WebView/mobile memory, FPS, lifecycle and input validation; production-scale PostgreSQL/S3 topology and IAM; and crash-safe canonical render recovery until migration 019/outbox work is integrated and re-verified.

Fresh disposable infrastructure verification on 2026-08-07:

- PostgreSQL 16 applied migrations 001-018 on a clean volume, then replayed with 0 applied / 18 skipped;
- the full PostgreSQL suite passed 93/93 with no skips, including HTTP CAS and concurrent transaction coverage;
- MinIO/S3 integration passed 2/2 for private originals and deterministic canonical media write/read/delete;
- the Compose project is isolated as `splint-codex-validation`; no production credentials or data were used.
