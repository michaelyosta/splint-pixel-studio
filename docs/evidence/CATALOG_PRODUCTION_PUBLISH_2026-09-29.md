# Catalog production publish — 2026-09-29

Status: dated evidence, not a product decision. Canonical procedure:
[../catalog-publishing.md](../catalog-publishing.md).

## Preconditions verified before publish

- Canonical manifest `content/catalog-manifest.json`: 320 entries, 48 covers,
  ingestion pass 368/368, runtime_catalog_count 320.
- Owner visual approval record: `CATALOG_PIXEL_GRID_APPROVAL_2026-09-25.md`
  (`Status: OWNER-APPROVED FOR CATALOG`).
- R2 media verification (`--verify-assets --restore-check`): 1056 checked,
  0 missing, 0 mismatched, restore samples match.
- R2 grid verification (`--verify-grid-assets --restore-check-grid-assets`):
  320 checked, 0 missing, 0 mismatched, 3 restore samples match.
- Production credentials were supplied by the owner at publish time and used
  only as process environment for the publish run. No secret is recorded here.

## Publish result (production database)

- `production_catalog_count`: 320
- `production_collections`: 16, `production_albums`: 32
- `production_free`: 172, `production_premium`: 148
- `tiled_templates_published`: 320
- `tiled_grid_source_bytes`: 26302486
- `tiled_tile_color_index_bytes`: 7698800
- `tiled_map_tiles_indexed`: 384940
- `database_template_tile_rows_written`: 0
- `retired_stale_catalog_rows`: 6 (demo-seed rows retired; active status and
  visibility preserved per the publisher contract, so saved progress,
  favorites/history, and resume access continue to work)
- `managed_stale_catalog_rows`: 0
- `user_progress_touched`: false
- `ownership_touched`: false
- `stars_semantics_touched`: false

## Still required (human)

- Open Каталог in the production Telegram Mini App and confirm the 320-item
  catalog, 16 collections, and 32 albums are visible.
- Record that observation; only then rewrite the Content section of
  `CURRENT_STATE.md`.
