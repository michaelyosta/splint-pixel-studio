# Production catalog API/media smoke — 2026-09-25

Status: the initial media 404 was from an outdated backend revision; a later
post-merge check served an existing catalog preview successfully. Neither
check establishes publication of the 320-item catalog.

## Read-only checks

Against the existing production API `https://splint-api.onrender.com`:

- `GET /health` returned HTTP 200.
- `GET /ready` returned HTTP 200 with `ready: true` and database,
  object-storage, and configuration checks all `ok`.
- A HEAD request to the production `/media/catalog/previews/<verified-inventory-key>`
  route for an existing preview object returned HTTP 404.

The readiness result verifies the API's reported database/configuration checks
and bucket availability. Read-only inspection of the Render service showed its
last successful deployment is `5a829a746431502fbdd8f32239cb3d5e4dc8400b`
(PR #47), while current `main` is `623ad03afb1236327b93a4e326e7fb601c617518`
(14 commits ahead). In the deployed revision, `server/routes/media.js` only
allows `artworks/` and `thumbnails/` keys, so `catalog/previews/*` is rejected
with 404 before an R2 object read. Current `main` adds catalog preview and
non-source cover delivery. The verified R2 object is therefore not the cause
of this 404; the serving backend is stale. Render is configured for
`After CI Checks Pass` and no successful deployment beyond `5a829a7` was
observed. The push CI run for `623ad03` has one failed release-critical iPhone
job, which is consistent with the configured deployment hold, but no Render
event directly linking that check to the absent deployment was available.
No credentials were created or changed during these checks.

## Boundaries and interpretation

These checks did not call the production catalog publisher, query or mutate
catalog rows, open an authenticated user profile, or alter user progress,
ownership, payments, or entitlements. No Telegram identity payload was sent in
this smoke. The earlier authorized read-only Telegram catalog observation of
7 works and 0 collections remains the most recent user-visible catalog count.

The R2 migration remains independently verified for all 1,056 objects by size
and SHA-256, with three representative restore checks, as documented in
[CATALOG_R2_MIGRATION_2026-09-24.md](CATALOG_R2_MIGRATION_2026-09-24.md).
The code-version diagnosis supersedes the earlier uncertainty about whether
the specific preview key exists or whether R2 reads fail. Successful bucket
readiness still does not make the current production media route capable of
serving catalog previews.

The candidate map dimensions (maximum 1200 pixels per side, aspect ratio
preserved) are supported by the catalog tiled-map path. The separate
public-import visibility budget is not the catalog publishing limit. The owner
approved the 320 candidate grids and their effort/detail tradeoff on
2026-09-25; approval is distinct from production publication.

## Post-merge follow-up — 2026-09-25

After PR #54 merged as `79bdd75f6e03df4597382c8965da2df1d8fce270` and its main
CI run `36063168677` passed, a bounded, read-only direct API recheck returned:

- `GET /health`: HTTP 200.
- `GET /ready`: HTTP 200, `ready: true`, database/object-storage/configuration
  checks `ok`.
- HEAD `/media/catalog/previews/autumn-cozy_coffee-rain_01-pixel.png`: HTTP
  200, `image/png`, 6,953 bytes, `public, max-age=31536000, immutable`.

This establishes delivery of that already-verified R2 preview through the
current API route. It does not verify the new 1200-pixel preview set or any
candidate grids. The latest authorized read-only Neon aggregate query observed
6 active catalog templates, 0 published collections and 0 albums;
`catalog:publish` has not been run. A post-merge Telegram Mini App smoke at the
320-item target remains outstanding. No database, user, payment, ownership,
progress, or R2 object was changed by this follow-up.
