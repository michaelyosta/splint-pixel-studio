# PostgreSQL final service evidence

- Runtime: Node `22.23.2`, npm `10.9.8`
- Service: fresh disposable Docker `postgres:16`
- Database: `splint_test` at `127.0.0.1:5432`
- Migrations: `28 applied / 0 skipped`
- Command: `npm --prefix server run test:postgres`
- Result: `100 pass / 0 fail / 0 skipped`
- Duration: `87.537 s`
- Cleanup: disposable container `splint-e2e-stabilization-postgres` removed;
  no production database was contacted.
