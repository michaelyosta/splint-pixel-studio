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

## Post-publish observation in the production Mini App (2026-09-29)

Read-only observation through the production bot `@splint_pixel_studio_bot` in
Telegram Web, opening the Menu Button target `https://pixel.showalove.ru`:

- Catalog hero read `321` works, `16` collections, `148` Premium, and the copy
  `321 сцен — от voxel-приключений и неона до спокойных историй`.
- Shelves rendered with populated items: `Популярное` (321 work count),
  `Новинки`/Phase 2 (140), `Бесплатно` (173), `Premium` (148),
  `Игровые миры` (142), `Anime vibes` (20), plus the `Premium Gallery`
  pack block at the server-owned 120 XTR price.
- The served bundle contained the current `main` build, so this is the
  published-catalog path and not a stale preview origin.

This satisfies the previously open human confirmation step for the 320-item
catalog. It is Telegram Web evidence, not physical Telegram iOS evidence, and
it did not open or complete any purchase.
