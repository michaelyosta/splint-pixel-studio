# PostgreSQL restore rehearsal — 2026-09-25

Status: PASS — disposable local PostgreSQL 16 rehearsal. This is not a
production restore and contains no production user data.

## Evidence

- Release source checkout: `codex/catalog-grids-1200`, HEAD
  `102de9fdcd07e17d28f4c7d3f942b27022056769`.
- Started a uniquely named Docker Compose project with PostgreSQL 16 on a
  dedicated local port. The disposable database applied 37 migrations; a
  second `npm --prefix server run migrate:postgres` applied 0 and skipped 37.
- Added one synthetic marker row, made a custom-format `pg_dump` archive,
  created a separate `splint_recovery` database, and restored the archive with
  `pg_restore --no-owner`.
- Recovery verification found 37 `schema_migrations` rows, the synthetic
  marker, `coloring_catalog_grid_sources`, and the `catalog_retired_at`
  column. Archive size: 188,820 bytes. SHA-256:
  `3f83a4b5edee907d84f626fafe675143224b45bc61653dd7f67f163d6ae0ddfc`.
- The first restore invocation used the container's default `root` role and
  failed before restoring anything. The rehearsal then passed with the
  explicit disposable `splint` role.
- The named container, network, and volume were removed after verification.
  No dump or credential was retained in the repository or host filesystem.

## Production backup boundary

During the same release preparation, Neon Backup & Restore showed one manual
snapshot of the production branch, created at `2026-09-25 10:21:40 UTC`.
This snapshot was observed in the dashboard; this rehearsal did not restore or
copy production data. The production database remains unchanged. No recurring
snapshot schedule was configured.

This evidence verifies that the current 37-migration schema and synthetic
state can be restored into a separate disposable PostgreSQL database. It does
not establish production restore completion, production retention policy, or
catalog publication. Those remain separate release/runtime checks.
