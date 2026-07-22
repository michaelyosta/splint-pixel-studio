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

The database layer provides a unified API for both SQLite and PostgreSQL backends. All operations are automatically routed through the active transaction when one is present.

```js
import { withDbTransaction, run, get, all } from './db.js';

// Explicit transaction — all helpers inside use the same tx
await withDbTransaction(async (tx) => {
  const row = await tx.get('SELECT * FROM users WHERE id=?', [id]);
  await tx.run('UPDATE users SET stars_balance=stars_balance-? WHERE id=?', [amount, id]);
  await tx.run('UPDATE users SET stars_balance=stars_balance+? WHERE id=?', [amount, receiverId]);
});

// Global helpers inside transaction automatically route through tx
await withDbTransaction(async (tx) => {
  await helperThatUsesGlobalRun(); // calls run() from db.js — uses tx
});
```

### Transaction Runtime Context (AsyncLocalStorage)

The runtime context uses `node:async_hooks.AsyncLocalStorage` to track active transactions:

```js
// server/database/runtime-context.js
const storage = new AsyncLocalStorage();

// Context stored during transaction: { mode, databaseIdentity, tx }
```

**Properties:**
- Context exists only inside the transaction callback
- AsyncLocalStorage correctly propagates across async/await boundaries
- Helper functions inside callbacks automatically see the current tx
- Context is cleaned up after callback returns (even on throw)
- Independent async operations do NOT inherit transaction context
- `databaseIdentity` validation prevents cross-database routing

### SQLite Scheduler

All operations on a single SQLite instance are serialized through a unified FIFO queue using `WeakMap<sqliteDatabase, SqliteRuntimeState>`:

| Operation | Behavior |
|-----------|----------|
| `run()` | Queued, holds lock for SQL execution + `persist()` |
| `get()` / `all()` | Queued, holds lock for query duration |
| `withDbTransaction()` | Holds lock from `BEGIN IMMEDIATE` to `COMMIT`/`ROLLBACK` |

**Guarantees:**
- External `run()` cannot execute during an active transaction (waits in queue)
- External `get()`/`all()` cannot read dirty uncommitted data
- Rollback does not affect external operations that queued after the transaction
- Queue recovers after rejected operations (lock always released)
- Different SQLite instances use separate queues — no cross-instance blocking
- FIFO ordering ensures predictable execution

### Global DB Helpers Route Through Active Transaction

Global `run()`, `get()`, `all()` functions in `server/db.js` check for an active transaction context before performing operations:

1. Check `getTransactionContext()` from AsyncLocalStorage
2. If context exists AND databaseIdentity matches → use `tx` adapter methods
3. If no context → use global pool (PostgreSQL) or scheduler (SQLite)

Inside a transaction:
- Global `run()` does NOT call intermediate `persist()` 
- Global `get()` sees previously written (uncommitted) data within the same transaction
- Global operations do NOT re-enter the SQLite scheduler (avoids deadlock)

### SQLite persist() Semantics

| Scenario | persist() calls |
|----------|----------------|
| Global `run()` outside transaction | Once, immediately after SQL execution |
| `tx.run()` inside transaction | Never |
| Global `run()` routed through tx inside transaction | Never |
| After transaction `COMMIT` | Exactly once |
| After transaction `ROLLBACK` | Never |

### Transaction run() Result

`tx.run()` and global `run()` both return `{ changes: number }`:

```js
// SQLite: sqlite.getRowsModified()
// PostgreSQL: result.rowCount
const result = await run('UPDATE coloring_progress SET revision=? WHERE id=?', [3, id]);
if (result.changes === 0) {
  // No rows matched — CAS conflict
}
```

### Placeholder Conversion

The PostgreSQL adapter automatically converts `?` placeholders to `$1, $2, ...`:

```js
// Works on both SQLite and PostgreSQL
await tx.run('UPDATE users SET nickname=? WHERE id=?', ['Alice', userId]);
// PostgreSQL executes: UPDATE users SET nickname=$1 WHERE id=$2
```

Native `$1, $2` placeholders are NOT corrupted by the converter.

### SQLite transactions

- Uses `BEGIN IMMEDIATE` / `COMMIT` / `ROLLBACK`
- Entire transaction holds the scheduler lock (serialized)
- `persist()` is called exactly once after `COMMIT`
- No intermediate `persist()` during transaction
- After `ROLLBACK`, database stays in previous consistent state
- Nested transactions are **rejected** with `NestedTransactionError` (checked via AsyncLocalStorage context)

### PostgreSQL transactions

- Uses `pool.connect()` for a dedicated client
- `BEGIN` / `COMMIT` / `ROLLBACK` on that client
- Client is always released in `finally`
- All queries within callback use the same client
- Nested transactions are **rejected** with `NestedTransactionError`

### Transaction adapter lifecycle

- Methods: `tx.get()`, `tx.all()`, `tx.run()`
- After the callback returns, the adapter is marked closed
- Using a closed adapter throws `TransactionClosedError`

## Optimistic Locking for Progress

The `PUT /colorings/:id/progress` endpoint uses atomic Compare-And-Set (CAS):

```
clientRevision MUST equal serverRevision for updates
clientRevision MUST be 0 for new progress
```

**CAS update:**
```sql
UPDATE coloring_progress
SET filled_json=?, revision=?, completed_at=?, updated_at=?
WHERE user_id=? AND template_id=? AND revision=?
```

If `result.changes === 0`, the CAS failed — return 409 with current server progress.

**CAS insert:**
```sql
INSERT INTO coloring_progress (...) VALUES (...)
```
Unique conflict on `(user_id, template_id)` converts to 409.

**Revision semantics:**
- revision 0 = no progress yet (only for initial save)
- Equal revision = accepted, server increments to revision+1
- Old revision (client < server) = rejected with 409
- Future revision (client > server) = rejected with 409
- Two concurrent saves with same revision → exactly one succeeds

**Client 409 handling:**
- On 409: update revision reference to server's value
- Do NOT replace local filled/history with server data
- Retry once with the same local snapshot and new server revision
- Max 1 automatic retry per snapshot — no infinite loops
- Show error notification on conflict, keep local state visible

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

## Stars Transactions (Migration 005)

Added atomic financial infrastructure:

| Table | Purpose |
|-------|---------|
| `stars_operations` | Immutable record of each financial operation |
| `stars_ledger_entries` | Append-only ledger of balance changes |
| `collection_ownerships` | Explicit ownership tracking (free/premium/legacy) |

### stars_operations

- `operation_type`: `message_payment` or `collection_purchase`
- `reference_key`: Canonical natural reference (e.g., `message_request:123`)
- `UNIQUE(operation_type, reference_key)` prevents double-processing
- `idempotency_key`: Client-supplied key with UNIQUE constraint
- `request_fingerprint`: Server-computed fingerprint for replay detection
- UPDATE/DELETE blocked by database triggers

### stars_ledger_entries

- Append-only (UPDATE/DELETE blocked by triggers)
- `UNIQUE(operation_id, user_id, entry_type)` prevents duplicate entries
- `delta <> 0` and `balance_after >= 0` enforced by CHECK constraints

### collection_ownerships

- `PRIMARY KEY(user_id, collection_id)` ensures one ownership per user+collection
- Legacy ownership backfilled from existing artworks (no financial records created)

See [docs/stars-transactions.md](stars-transactions.md) for complete financial integrity guarantees.

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
