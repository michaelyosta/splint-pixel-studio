# Canonical catalog publication

Status: OPERATIONAL CONTRACT

The production catalog is the canonical `content/catalog-manifest.json` plus
the runtime grid definitions in `server/catalog-templates.json`. Legacy
templates may keep an inline `cells` array. Large catalog templates use a
tiled descriptor with `storage_mode: "tiled"`, `tile_size`, `cell_map_asset`,
`cell_map_r2_key`, compressed/raw byte counts, and `cell_map_sha256`. The
immutable content-addressed R2 object (`catalog/grids/<id>.<sha256>.u8.gz`)
contains one row-major palette-index byte per logical cell. Both dimensions
may be up to 1200 and aspect ratio is preserved rather than forcing a square.

For catalog templates, R2 is the authoritative grid source. Neon stores one
small `coloring_catalog_grid_sources` descriptor per work and a compact
checksummed Uint16LE per-tile/per-color count vector, plus global color totals
and the guidance-index marker. It does not store catalog cells in
`coloring_template_tiles` or duplicate the vector into
`coloring_template_tile_color_counts`. User-created tiled templates continue
to use the existing tile-row representation. The server verifies the R2
object's checksum, expanded size, and palette indices, then uses that same
source for tile delivery, cell validation, guidance, special effects, and
completed-artwork rendering. Catalog templates keep empty legacy `cells_json`
and do not receive legacy zones.

The publisher expects exactly 320 artworks, 16 collections, 32 albums, 172
free artworks, and 148 premium artworks. The Phase-2 draft manifest is not a
production catalog input. The 320 1200-max classic-v1 catalog candidates were
visually approved on 2026-09-25; the scoped approval and effort tradeoff are
recorded in [evidence/CATALOG_PIXEL_GRID_APPROVAL_2026-09-25.md](evidence/CATALOG_PIXEL_GRID_APPROVAL_2026-09-25.md).

## Separate the three operations

1. `npm run catalog:build` creates or refreshes local generated grid
   candidates and quality evidence; it never changes canonical catalog files.
2. Visually approved candidates are promoted with
   `npm run catalog:promote -- --apply`. Promotion requires the checked-in
   owner approval record, verifies all 320 compressed grids and lightweight
   preview checksums, and updates only the canonical manifest/runtime JSON.
3. `npm run catalog:publish -- --upload-assets --write-inventory` uploads the
   canonical masters, full-size assets, lightweight previews, and covers to
   existing R2. Objects are immutable: an existing object with a different
   size or SHA-256 is a hard failure, never an overwrite.
4. `npm run catalog:publish -- --upload-grid-assets --write-grid-inventory`
   uploads and records the content-addressed cell maps. Grid and media asset
   inventories are separate and each is checked against the exact canonical
   asset set.
5. Verify media with `npm run catalog:publish -- --verify-assets
   --restore-check` and grids with `npm run catalog:publish --
   --verify-grid-assets --restore-check-grid-assets`. Only after both
   inventories, checksums, and restore samples pass may the production-safe
   database publisher run.
6. `npm run catalog:publish` verifies the R2 inventory/object metadata before
   upserting catalog metadata and grid descriptors to the configured DB. It
   does not require the master or grid binaries to be committed in Git.

Before uploading a promoted set, run
`npm run catalog:prepare-r2-inventories`. It reuses the prior verified
master/full/cover inventory, hashes the new local delivery previews and grids,
and writes ignored candidate inventories under
`content/generated/catalog-grids/`. Pass those paths explicitly to upload and
verification:

```sh
npm run catalog:publish -- --upload-assets --write-inventory --inventory content/generated/catalog-grids/catalog-r2-inventory.candidate.json
npm run catalog:publish -- --upload-grid-assets --write-grid-inventory --grid-inventory content/generated/catalog-grids/catalog-grids-r2-inventory.candidate.json
npm run catalog:publish -- --verify-assets --restore-check --inventory content/generated/catalog-grids/catalog-r2-inventory.candidate.json
npm run catalog:publish -- --verify-grid-assets --restore-check-grid-assets --grid-inventory content/generated/catalog-grids/catalog-grids-r2-inventory.candidate.json
```

Only after verification succeeds, copy the two inventories to the canonical
`docs/evidence/` inventory paths. Those paths are the publisher defaults used
by the production DB command.

Use `npm run catalog:publish -- --check` before any external mutation.
Verification checks object size and SHA-256 sidecar metadata, then restores
representative image and grid objects and verifies their bytes locally.

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
`catalog/` prefix. Do not put credentials in this variable. Generated pixel
previews map to `catalog/previews/{filename}` and optimized cover images map to
`catalog/covers/{filename}`. The API route deliberately permits only those two
delivery prefixes. Masters and full-size assets remain storage objects and are
not runtime preview URLs.

The production database and object-store environment must be supplied by the
normal deployment operator. Never enable `SEED_DEMO_DATA` to publish the
canonical catalog, and never delete repository binaries or storage objects
until the object inventory and restore check have passed.

Catalog pixel previews are budgeted at 16 KiB per artwork. CI validates the
complete R2 inventory against the canonical asset set, rejects missing or
duplicate object keys, and fails if any preview exceeds this delivery budget.
Listing records use only pixel-preview URLs; the media route rejects master,
full-size, and source-cover keys.

The publisher accepts the optional `S3_SESSION_TOKEN` for short-lived R2
credentials. Cloudflare R2 credentials may be bucket-scoped rather than
prefix-scoped; if such credentials are used, the operator must constrain the
commands and inventory to `catalog/` keys and must not touch `originals/`.

## Recovery evidence

Keep the generated inventory outside the deploy commit or in the approved
evidence location. The verified migration inventory is
`docs/evidence/catalog-r2-inventory.json`; it records each object key, source
asset, byte count, and SHA-256. When tracked binaries are absent, pass that
inventory to `--upload-assets --inventory <path>`: matching remote objects are
verified without local source files; a missing remote object still requires a
matching local source and fails closed otherwise. Use the existing
backup/restore runbooks for a full bucket backup; the publisher's restore check
is a targeted post-upload validation, not a replacement for backup.

The audit found eight unreferenced pre-frame history masters (about 27.18 MiB)
under `content/generated/masters/history/`. They are retained pending an
R2-backed checksum/restore decision; new history snapshots are ignored so the
repository cannot grow this class of binary again. Do not remove any tracked
master/full/cover binary until the exact inventory has 1:1 R2 checksum and
size coverage plus restore evidence.
