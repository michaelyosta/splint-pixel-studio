# Canonical catalog publication

Status: OPERATIONAL CONTRACT

The production catalog is the canonical `content/catalog-manifest.json` plus
the runtime grid definitions in `server/catalog-templates.json`. Legacy
templates may keep an inline `cells` array. Large templates use a tiled
descriptor with `storage_mode: "tiled"`, `tile_size`, `cell_map_asset`, and
`cell_map_sha256`; the referenced `.u8.gz` file contains one row-major palette
index byte per logical cell. The publisher verifies its checksum, expanded
size, and palette indices before writing tiles to
`coloring_template_tiles`. Both dimensions may be up to 1200; aspect ratio is
preserved by using each artwork's own width and height, not by forcing a square.
Tiled templates store an empty legacy `cells_json` and do not receive legacy
zones. The publisher expects exactly 320 artworks, 16 collections, 32 albums,
172 free artworks, and 148 premium artworks. The phase-2 draft manifest is not
a production catalog input.

## Separate the three operations

1. `npm run catalog:build` creates or refreshes local generated assets.
2. `npm run catalog:publish -- --upload-assets --write-inventory` uploads the
   canonical masters, full-size assets, lightweight previews, and covers to
   the existing R2/S3-compatible bucket. Objects are immutable: an existing
   object with a different size or SHA-256 is a hard failure, never an
   overwrite.
3. `npm run catalog:publish` publishes catalog metadata and runtime grids to
   the configured database. It is explicit and must be run after the asset
   upload has passed verification.

Use `npm run catalog:publish -- --check` before any external mutation. After
upload, run `npm run catalog:publish -- --verify-assets --restore-check`.
Verification checks object size and the SHA-256 sidecar metadata, then reads a
master, full-size asset, and pixel preview back from storage.

The publisher does not call demo seeding and never edits progress or ownership
tables or changes Stars pricing, invoices, refunds, entitlements, or
reconciliation. Before replacing a grid, it checks legacy progress, tiled
progress, progress batches, and special-cell progress. A changed map with any
such state fails the whole transaction; an identical map is idempotent and
keeps that state intact. Existing rows marked `catalog_managed` and their
stored grids are preserved. Manifest-owned album rows are upserted on later
publishes, while existing albums default to `editor_managed` and remain
unchanged until the canonical publisher first creates them. A published admin
edit permanently opts that album out of manifest synchronization. Stale
non-managed catalog rows are hidden rather than deleted.

The legacy base-manifest generator fails closed once Phase 2 IDs are present;
the Phase-2 promotion script is the only supported path for continuing a
completed catalog. This prevents a later base regeneration from silently
dropping the Phase-2 collection and album hierarchy.

## Public delivery paths

Set `CATALOG_ASSET_BASE_URL=/media/catalog` to serve private R2 objects through
the existing API, or set it to an existing public R2/CDN base whose path is the
`catalog/` prefix. Do not put credentials in this variable. Runtime card and
collection surfaces use `catalog/previews/` and `catalog/covers/`; the API
route deliberately permits only those two delivery prefixes. Masters and
full-size assets remain storage objects and are not runtime preview URLs.

The production database and object-store environment must be supplied by the
normal deployment operator. Never enable `SEED_DEMO_DATA` to publish the
canonical catalog, and never delete repository binaries or storage objects
until the object inventory and restore check have passed.

## Recovery evidence

Keep the generated `content/catalog-r2-inventory.json` outside the deploy
commit or in the approved evidence location. It records each object key,
source asset, byte count, and SHA-256. Use the existing backup/restore
runbooks for a full bucket backup; the publisher's restore check is a
targeted post-upload validation, not a replacement for backup.

The audit found eight unreferenced pre-frame history masters (about 27.18 MiB)
under `content/generated/masters/history/`. They are retained pending an
R2-backed checksum/restore decision; new history snapshots are ignored so the
repository cannot grow this class of binary again.
