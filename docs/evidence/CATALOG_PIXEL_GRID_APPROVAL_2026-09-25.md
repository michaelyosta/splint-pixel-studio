# Catalog pixel-grid visual approval — 2026-09-25

Status: OWNER-APPROVED FOR CATALOG

## Decision

The owner visually reviewed `catalog-review-1200.html` and approved all 320
classic-v1 catalog candidates for promotion. The owner accepted the resulting
painting-effort tradeoff and directed that the higher-resolution set be used.
This decision applies to this exact 320-item catalog set; it does not change
the creator's defaults or declare a universal pixelization winner.

The candidate generator uses the application's existing `buildColoringFromImage`
pipeline, keeps each source aspect ratio, and limits the longer side to 1200
logical cells. Delivery previews remain separate lightweight card images with
a 16 KiB maximum; the player and server use the high-resolution tiled map.

## Reviewed evidence

- 320 of 320 candidate maps were present in the review gallery.
- Automated advisory quality levels: 319 good, 1 fair, 0 noisy.
- Median four-connected color regions: 12,691 versus 60 in the previous maps
  (about 212×); this is a meaningful increase in painting effort, explicitly
  accepted by the owner.
- Median cells in regions of size at most two: 0.816%; maximum: 2.666%.
- Median singleton-cell ratio: 0.458%.
- Compressed grid payload: 26,302,486 bytes; decompressed cell maps:
  386,640,000 bytes.
- Candidate set retains the canonical 320 IDs and the 16 collection / 32
  album hierarchy. Expected access split is 172 free / 148 premium.

The exact generated candidate report and review gallery are local ignored
build artifacts, not Git inputs. Promotion requires those artifacts plus this
checked-in approval record and re-verifies every map and delivery-preview
checksum before updating canonical manifest/runtime metadata. This approval
does not itself publish content to production.

## Product-contract migration

- OLD: 320 catalog works used lower-resolution maps, with a median of 60
  four-connected same-color regions.
- NEW: the same 320 works use classic-v1 aspect-preserving maps with a maximum
  side of 1200, with a median of 12,691 regions.
- WHY INTENTIONAL: the owner identified insufficient pixel count as the
  quality issue, requested 1200-cell grids, reviewed the full candidate set,
  and explicitly accepted the increased painting burden.
- TESTED: dimensions/aspect preservation, exact compressed-map checksums and
  palettes, R2 tile reads including partial edges, server-side wrong-color
  rejection, preview size/checksum budget, and idempotent catalog publishing.
- UNCHANGED: painting/progress/reopen contracts, server-authoritative cell
  validation, access levels, ownership, and all Stars/payment semantics.
