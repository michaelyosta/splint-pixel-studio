# Production catalog API/media smoke — 2026-09-25

Status: partial API readiness pass; production catalog media delivery is not
verified. This is dated operational evidence and does not authorize content
publication.

## Read-only checks

Against the existing production API `https://splint-api.onrender.com`:

- `GET /health` returned HTTP 200.
- `GET /ready` returned HTTP 200 with `ready: true` and database,
  object-storage, and configuration checks all `ok`.
- A HEAD request to the production `/media/catalog/previews/<verified-inventory-key>`
  route for an existing preview object returned HTTP 404.

The readiness result verifies the API's reported database/configuration checks
and bucket availability; it does not prove that the media route can read this
object. The route currently reports 404 for both a missing object and storage
read errors, so this observation does not identify the cause. Render runtime
configuration/log evidence or a direct production-credential object-read
diagnostic is needed to distinguish those cases. No credentials were created
or changed during these checks.

## Boundaries and interpretation

These checks did not call the production catalog publisher, query or mutate
catalog rows, open an authenticated user profile, or alter user progress,
ownership, payments, or entitlements. No Telegram identity payload was sent in
this smoke. The earlier authorized read-only Telegram catalog observation of
7 works and 0 collections remains the most recent user-visible catalog count.

The R2 migration remains independently verified for all 1,056 objects by size
and SHA-256, with three representative restore checks, as documented in
[CATALOG_R2_MIGRATION_2026-09-24.md](CATALOG_R2_MIGRATION_2026-09-24.md).
Successful bucket readiness does not supersede the failed media-route check.

The candidate map dimensions (maximum 1200 pixels per side, aspect ratio
preserved) are supported by the catalog tiled-map path. The separate
public-import visibility budget is not the catalog publishing limit. Candidate
visual/effort approval remains a distinct content decision.
