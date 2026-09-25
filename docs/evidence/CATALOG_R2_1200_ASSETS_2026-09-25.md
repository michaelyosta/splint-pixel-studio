# Catalog 1200-pixel R2 asset verification — 2026-09-25

Status: candidate previews and grids are durably stored and verified in R2.
Production catalog publication and Telegram delivery remain separate and are
not established by this evidence.

## Scope and result

The visually approved classic-v1 candidates preserve each artwork's aspect
ratio and cap the long side at 1200 pixels. All commands used the existing
`splint-originals` bucket and inventories whose keys are exclusively under
`catalog/`.

| Inventory | Objects | Bytes | Uploaded now | Verified existing | Verification |
| --- | ---: | ---: | ---: | ---: | --- |
| Catalog media | 1,056 | 2,169,798,572 | 320 | 736 | 1,056 checked; 0 missing; 0 mismatched |
| Catalog grids | 320 | 26,302,486 | 320 | 0 | 320 checked; 0 missing; 0 mismatched |

The media inventory includes canonical masters, full images, lightweight
1200-pixel previews, and collection covers. The 320 newly uploaded media
objects are the approved lightweight previews; the 736 matching master/full/
cover objects were immutable-match verified and not overwritten. All 320 grid
maps were uploaded under content-addressed `catalog/grids/` keys.

Three media restore samples (master, full image, and 1200-pixel preview) and
three grid samples (first, middle, and last manifest entries) were downloaded
and matched their inventory byte counts and SHA-256 values. Exact per-object
records are in [catalog-r2-inventory.json](catalog-r2-inventory.json) and
[catalog-grids-r2-inventory.json](catalog-grids-r2-inventory.json).

The candidate grids are covered by the owner approval in
[CATALOG_PIXEL_GRID_APPROVAL_2026-09-25.md](CATALOG_PIXEL_GRID_APPROVAL_2026-09-25.md).
This R2 check does not publish database rows or prove that a production player
can retrieve the new works.

## Credential and data boundaries

A temporary 24-hour `Object Read & Write` token was scoped to the existing
`splint-originals` bucket. Since Cloudflare's token scope is bucket-level, the
upload and verification commands were constrained to the checked inventories;
every key was validated to start with `catalog/`. The token was deleted after
checksum and restore verification. No key under `originals/` was read, written,
overwritten, or deleted.

No production database, user progress, ownership, payment, or entitlement data
was changed. Git binaries remain until production publication and runtime
delivery are directly verified.
