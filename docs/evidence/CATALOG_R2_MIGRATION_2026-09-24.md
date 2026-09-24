# Catalog R2 migration evidence — 2026-09-24

Status: verified object migration; production catalog publication is separate
and remains pending.

## Scope and result

The canonical manifest preflight reports 320 artworks, 16 collections, 32
albums, 172 free and 148 premium artworks. The migration transferred the
manifest's 1,056 master/source/runtime image assets to the existing
`splint-originals` bucket under `catalog/`; it did not publish catalog rows to
production.

| Asset kind | Objects | Bytes | Result |
| --- | ---: | ---: | --- |
| Canonical masters | 320 | 1,323,713,038 | Uploaded and checksum-verified |
| Full images | 320 | 617,129,326 | Uploaded and checksum-verified |
| Pixel previews | 320 | 2,213,582 | Uploaded and checksum-verified |
| Source collection covers | 48 | 187,131,142 | Uploaded and checksum-verified |
| Optimized collection covers | 48 | 37,156,928 | Uploaded and checksum-verified |
| **Total** | **1,056** | **2,167,344,016** | **Complete** |

`docs/evidence/catalog-r2-inventory.json` contains the per-object keys, source
paths, byte counts and SHA-256 values. Its SHA-256 is
`0350e6afaecdb51ff4f85a43d95496a8d13f72350308119d4e80a7a5c8b7c871`. The
1,056 unique inventory paths exactly cover the 1,056 non-history tracked
catalog binaries. Eight unreferenced pre-frame history masters (28,498,751
bytes) were deliberately excluded and remain in Git.

The upload report was `uploaded=1056`, `verified_existing=0`. A subsequent
read-only verification checked all 1,056 objects with no missing or mismatched
keys. Three representative objects (one master, one full image, one preview)
were downloaded to a temporary restore location; each restored byte count and
SHA-256 matched its inventory row. This is a targeted restore check, not a full
bucket backup.

## Credential and data boundaries

The user-approved temporary Object Read & Write parent token was restricted to
the existing `splint-originals` bucket. Because Cloudflare does not restrict
that parent token by prefix, the temporary child session was limited to
`catalog/`; the parent token was revoked immediately after transfer and
verification, which also invalidated the child. The existing Render R2 token
was not changed. The bucket's existing `originals/` objects were not read,
overwritten or deleted.

No production database, user progress, ownership, payment, or entitlement state
was changed. No catalog `--publish` run occurred. The latest authorized
read-only Telegram catalog smoke observed 7 works and 0 collections; the
320-item production state is not verified. Candidate 1200-pixel maps remain
unapproved and are not in this migration inventory.

## Repository impact and follow-up

At migration time the shared Git object pack was 2.09 GiB. The 1,056 uploaded
catalog binaries occupied 2,167,344,016 bytes in the tree; the eight retained
history masters occupied another 28,498,751 bytes. The repository now ignores
new files at the generated master, source-cover and public generated-media
paths. Existing tracked binaries still require a separate approved removal
commit after catalog publication and runtime delivery are directly proven.
Deleting them from `main` will not reclaim historical Git blobs. History
rewriting remains a separate operation and must not be done by force-pushing
`main`.

The tiled-grid capability PR #53 was merged as `623ad03` and its PR run reported
33 checks passed. It did not publish the candidate maps or prove a production
deployment. A production media route request was still showing Render's
service-wakeup page during this evidence capture, so no claim of live R2 media
delivery is made here.
