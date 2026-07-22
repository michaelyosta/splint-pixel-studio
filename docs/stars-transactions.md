# Stars Transactions

## Transaction Boundaries

All financial operations (message payment, collection purchase) execute within a single database transaction
via `withDbTransaction()`. Inside the transaction callback, all DB access uses explicit `tx.get()`, `tx.all()`,
and `tx.run()` methods — global helpers from `db.js` are not used inside financial transaction callbacks
to keep the transaction boundary explicitly visible.

```js
await withDbTransaction(async (tx) => {
  const mr = await tx.get('SELECT * FROM message_requests WHERE id=? FOR UPDATE', [requestId]);
  await tx.run('UPDATE users SET stars_balance=stars_balance-? WHERE id=? AND stars_balance>=?', [price, userId, price]);
  // ... rest of atomic operations
});
```

## Row-Locking Strategy

### PostgreSQL

- **Message request**: `SELECT ... FOR UPDATE` on the request row
- **User rows**: Locked via `SELECT ... FROM users WHERE id IN (?,?) ORDER BY id FOR UPDATE`
- User lock ordering is deterministic (ORDER BY id) to prevent deadlocks from cross-payments (A→B and B→A)

### SQLite

- `BEGIN IMMEDIATE` starts each transaction, holding the unified scheduler lock until COMMIT/ROLLBACK
- The scheduler (FIFO queue via `WeakMap`) serialises all operations on a single SQLite instance
- No `FOR UPDATE` syntax is used in SQLite SQL
- External operations cannot read dirty data or execute during an active transaction

## Conditional Debit

Every debit uses a conditional UPDATE:

```sql
UPDATE users
SET stars_balance = stars_balance - ?
WHERE id = ? AND stars_balance >= ?
```

The application checks `result.changes === 1`. If 0, the debit fails with `INSUFFICIENT_STARS` (HTTP 402),
and the entire transaction rolls back.

This prevents:
- Negative balances (enforced at DB level by CHECK constraint / trigger)
- Race conditions (the WHERE clause acts as a row-level CAS)

## Message Status CAS

Transitions use Compare-And-Set (CAS) semantics:

```sql
-- payment_pending → processing
UPDATE message_requests SET status='processing', updated_at=?
WHERE id=? AND sender_id=? AND status='payment_pending'

-- processing → delivered
UPDATE message_requests SET status='delivered', updated_at=?
WHERE id=? AND status='processing'
```

`result.changes === 1` is verified after each transition. If a status has already been changed
by a concurrent request, the transition fails and the transaction rolls back.

## Payout and Platform Fee

```
payout = Math.floor(price * 80 / 100)  // 80% to receiver
fee    = price - payout                 // 20% platform fee (integer remainder)
```

The fee is stored in `stars_operations.fee_amount`. No credit is issued to a platform account — the fee
is purely informational for audit purposes.

## Idempotency Contract

### Header

```
Idempotency-Key: <string>
```

### Validation
- Length: 8-128 characters
- Characters: printable ASCII only (`[\x21-\x7E]`)
- Invalid format → HTTP 400

### Fallback

If no header is provided, a deterministic fallback key is generated:
- Message payment: `message-payment:<userId>:<requestId>`
- Collection purchase: `collection-purchase:<userId>:<collectionId>`

### Request Fingerprint

Computed server-side from operation type, authenticated user, natural reference, and server-controlled amount.
Client-supplied prices are never included in the fingerprint.

### Behaviors

| Scenario | Response |
|----------|----------|
| Same key + same fingerprint (after success) | HTTP 200, `idempotent: true`, no new effects |
| Same key + different fingerprint | HTTP 409, `code: IDEMPOTENCY_KEY_REUSED` |
| Different key + already processed reference | HTTP 409, `code: ALREADY_PROCESSED` |
| First successful operation | `idempotent: false` |

## Natural Operation Reference

Each financial operation has a canonical reference key:

- Message payment: `message_request:<requestId>`
- Collection purchase: `collection:<userId>:<collectionId>`

These have a UNIQUE constraint on `stars_operations(operation_type, reference_key)`,
preventing the same natural operation from being executed twice (even with different
idempotency keys).

## Immutable Ledger

### stars_operations

Append-only. UPDATE and DELETE are blocked by database-level triggers.

### stars_ledger_entries

Append-only. Each entry records:
- `operation_id` — links to `stars_operations`
- `user_id` — affected user
- `entry_type` — `message_debit`, `message_credit`, or `collection_debit`
- `delta` — non-zero amount
- `balance_after` — user's balance after the entry

The unique constraint `UNIQUE(operation_id, user_id, entry_type)` prevents duplicate entries
for the same operation and user.

### Enforcement

**PostgreSQL:**
- `BEFORE UPDATE` trigger → exception
- `BEFORE DELETE` trigger → exception

**SQLite:**
- `BEFORE UPDATE` trigger → `RAISE(ABORT, ...)`
- `BEFORE DELETE` trigger → `RAISE(ABORT, ...)`

Test cleanup is done via transaction rollback, not by deleting from these tables.

## Collection Ownership

Explicit ownership tracking via `collection_ownerships` table:

| Column | Description |
|--------|-------------|
| user_id, collection_id | Composite primary key |
| acquisition_type | `free`, `premium`, or `legacy` |
| price_paid | Actual price charged |
| stars_operation_id | Links to financial operation (NULL for free/legacy) |

### Legacy backfill

Migration 005 backfills ownership from existing artworks:
- One ownership per `(owner_id, collection_id)` pair where collection_id IS NOT NULL
- `acquisition_type = 'legacy'`
- `price_paid = 0`
- `stars_operation_id = NULL`
- `created_at` from the earliest artwork for that owner+collection

No fictional ledger entries are created for legacy purchases.

## Replay Responses

| Request | Response Body |
|---------|--------------|
| Normal success | `{ success: true, idempotent: false, stars_balance, ... }` |
| Idempotent replay | `{ success: true, idempotent: true, stars_balance, ... }` |
| Insufficient balance | `{ error: "Недостаточно Stars", code: "INSUFFICIENT_STARS" }` (402) |
| Key reused | `{ error: "...", code: "IDEMPOTENCY_KEY_REUSED" }` (409) |
| Already processed | `{ error: "...", code: "ALREADY_PROCESSED" }` (409) |

## Rollback Guarantees

If any operation after a successful debit fails (credit, ledger insert, status transition),
the entire transaction rolls back via `BEGIN IMMEDIATE` / `ROLLBACK` (SQLite) or
`BEGIN` / `ROLLBACK` (PostgreSQL).

After rollback:
- Sender balance is restored
- Receiver balance is unchanged
- Message status remains `payment_pending`
- No `stars_operations` or `stars_ledger_entries` records exist

## Limitations

- No real Telegram payment webhook integration
- No refund mechanism
- No withdrawal to real currency
- No admin balance management UI
- Platform fee is not credited to any account (informational only)
- Collection purchase creates exactly 1 artwork (matches current behavior)
- Free collections: artwork count matches existing product behavior
- No cross-collection pricing logic (price is per-collection only)
