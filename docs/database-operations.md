# Database Operations

## Running SQLite (default)

```bash
cd server
npm start
```

The server uses SQLite by default. The database file is `server/splint.db.bin` (configurable via `SQLITE_DB_PATH` env var).

## Running PostgreSQL

```bash
cd server
cp ../.env.example .env
# Edit .env with your PostgreSQL connection details
npm run start:postgres
```

Required env var: `DATABASE_URL=postgresql://user:password@localhost:5432/dbname`

## Migrations

Migrations are applied automatically on server startup via `initDb()`. You can also run them manually:

```bash
# SQLite
npm run migrate

# PostgreSQL
npm run migrate:postgres
```

### Migration files

- `server/migrations/` — PostgreSQL migrations (files `001_*.sql` through `004_*.sql`)
- `server/migrations/sqlite/` — SQLite-specific equivalents

Each backend has its own migration files with the same version numbers. Checksums are computed separately per backend.

### Migration runner

The unified runner (`server/database/migrations.js`):

1. Discovers migrations by numeric prefix (`001_`, `002_`, etc.)
2. Sorts them numerically
3. Rejects duplicate version numbers
4. Creates `schema_migrations` table to track applied migrations
5. Computes SHA-256 checksum of each migration file
6. Applies new migrations in transactions
7. Records version, name, checksum, and timestamp
8. Detects checksum mismatches on already-applied migrations
9. Rolls back entire migration on error
10. Never marks a failed migration as applied

### schema_migrations table

```sql
CREATE TABLE schema_migrations (
  version TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  checksum TEXT NOT NULL,
  applied_at TIMESTAMPTZ NOT NULL
);
```

### Legacy database upgrade

Databases created before the migration runner was introduced:

1. The runner detects existing tables without `schema_migrations`
2. It records current migrations (001-003) as pre-applied
3. Only new migrations (004+) are applied
4. No data loss occurs

### Checksum protection

Once a migration is applied, its file must not be modified. The runner verifies the stored checksum against the current file content on every run. A mismatch causes an immediate error:

```
Checksum mismatch for applied migration 001 ("initial").
  Stored:  abc123...
  Current: def456...
Applied migration files must not be modified.
```

## System Bootstrap

```bash
npm run bootstrap:system
```

Loads idempotent system data:
- Achievement definitions
- Coloring catalog templates
- Collection definitions
- Coloring zones

This command is safe to run repeatedly — it uses `ON CONFLICT` upserts and never duplicates data.

## Demo Seed

```bash
npm run seed:demo
```

Creates demo data:
- 4 demo users (user_pixelhunter, user_lenaart, user_artvibe, user_splintmod)
- 3 showcase posts
- Demo artworks

For test/development server startup:

```env
SEED_DEMO_DATA=true
```

The seed is idempotent:
- Repeat runs do not create duplicate users
- Repeat runs do not increase balances or likes
- Uses `ON CONFLICT` upserts for users, `ON CONFLICT DO NOTHING` for posts

## Demo Reset

```bash
npm run reset:demo
```

Removes only records belonging to known demo users:
- Deletes users: user_pixelhunter, user_lenaart, user_artvibe, user_splintmod
- Deletes their posts, artworks, likes, comments, follows, messages, reports
- Does NOT delete tg_* users or any non-demo data

For PostgreSQL, destructive reset requires:

```bash
ALLOW_DESTRUCTIVE_DB_RESET=true npm run reset:demo -- --yes
```

## Destructive Flags

| Environment | Flag | Effect |
|------------|------|--------|
| Development | `SEED_DEMO_DATA=true` | Seeds demo data on server start |
| Production | `SEED_DEMO_DATA=true` | **Error** — Blocked |
| Production | Any reset | **Error** — Blocked |
| PostgreSQL | `ALLOW_DESTRUCTIVE_DB_RESET=true` + `--yes` | Required for reset |
| Any | None | Safe by default |

## Transaction API

```js
import { withDbTransaction } from './db.js';

await withDbTransaction(async (tx) => {
  const row = await tx.get('SELECT * FROM users WHERE id=?', [id]);
  await tx.run('UPDATE users SET stars_balance=stars_balance-? WHERE id=?', [amount, id]);
  await tx.run('UPDATE users SET stars_balance=stars_balance+? WHERE id=?', [amount, receiverId]);
});
```

### SQLite transactions

- Uses `BEGIN IMMEDIATE` / `COMMIT` / `ROLLBACK`
- Mutex-serialized (no concurrent transactions)
- `persist()` is called exactly once after `COMMIT`
- No intermediate `persist()` during transaction
- After `ROLLBACK`, database stays in previous consistent state
- Nested transactions are **rejected** with `NestedTransactionError`

### PostgreSQL transactions

- Uses `pool.connect()` for a dedicated client
- `BEGIN` / `COMMIT` / `ROLLBACK` on that client
- Client is always released in `finally`
- All queries within callback use the same connection

### Transaction adapter lifecycle

- Methods: `tx.get()`, `tx.all()`, `tx.run()`
- After the callback returns, the adapter is marked closed
- Using a closed adapter throws `TransactionClosedError`

## Financial Constraints (Migration 004)

Added at database level:

| Table | Constraint |
|-------|-----------|
| users | `CHECK (stars_balance >= 0)` |
| users | `CHECK (price_in_stars >= 0)` |
| collections | `CHECK (price_in_stars >= 0)` |
| message_requests | `CHECK (price_in_stars >= 0)` |
| message_requests | Valid statuses only |

Valid message_requests statuses:
`created`, `payment_pending`, `processing`, `delivered`, `answered`, `rejected`, `cancelled`

For SQLite, these constraints are enforced via `BEFORE INSERT/UPDATE` triggers
(since `ALTER TABLE ADD CONSTRAINT CHECK` is not supported).

### Pre-validation

Before applying migration 004, the runner checks existing data:

- Negative `stars_balance` → blocked with count
- Negative `price_in_stars` → blocked with count
- Unknown message status → blocked with count

Error messages contain counts but never personal data.

## Recovery from Failed Migration

If a migration fails:
1. The transaction is rolled back (ROLLBACK for failed migration)
2. No entry is written to `schema_migrations`
3. Fix the underlying issue
4. Re-run migrations — the failed migration will be retried

## Editing Applied Migrations

**Do not edit migration files that have been applied.** Create a new migration instead.
The checksum check will prevent the server from starting if an applied migration is modified.
