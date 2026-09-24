# Production catalog API/media smoke — 2026-09-25

Status: API readiness passes, but the production catalog media 404 is explained
by an outdated backend revision. This is dated operational evidence and does
not authorize content publication.

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
public-import visibility budget is not the catalog publishing limit. Candidate
visual/effort approval remains a distinct content decision.
