BEGIN;

CREATE TABLE IF NOT EXISTS stars_operations (
  id TEXT PRIMARY KEY,
  idempotency_key TEXT NOT NULL UNIQUE,
  request_fingerprint TEXT NOT NULL,
  operation_type TEXT NOT NULL CHECK (operation_type IN ('message_payment', 'collection_purchase')),
  reference_key TEXT NOT NULL,
  actor_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  counterparty_user_id TEXT REFERENCES users(id) ON DELETE RESTRICT,
  gross_amount INTEGER NOT NULL CHECK (gross_amount >= 0),
  fee_amount INTEGER NOT NULL CHECK (fee_amount >= 0 AND fee_amount <= gross_amount),
  created_at TIMESTAMPTZ NOT NULL,
  UNIQUE(operation_type, reference_key)
);

CREATE TABLE IF NOT EXISTS stars_ledger_entries (
  id TEXT PRIMARY KEY,
  operation_id TEXT NOT NULL REFERENCES stars_operations(id) ON DELETE RESTRICT,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  entry_type TEXT NOT NULL CHECK (entry_type IN ('message_debit', 'message_credit', 'collection_debit')),
  delta INTEGER NOT NULL CHECK (delta <> 0),
  balance_after INTEGER NOT NULL CHECK (balance_after >= 0),
  created_at TIMESTAMPTZ NOT NULL,
  UNIQUE(operation_id, user_id, entry_type)
);

CREATE TABLE IF NOT EXISTS collection_ownerships (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  acquisition_type TEXT NOT NULL CHECK (acquisition_type IN ('free', 'premium', 'legacy')),
  price_paid INTEGER NOT NULL CHECK (price_paid >= 0),
  stars_operation_id TEXT REFERENCES stars_operations(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY(user_id, collection_id)
);

-- Append-only enforcement for stars_operations

CREATE OR REPLACE FUNCTION prevent_stars_operations_update()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'stars_operations is append-only: UPDATE is not allowed';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_stars_operations_no_update ON stars_operations;
CREATE TRIGGER trg_stars_operations_no_update
  BEFORE UPDATE ON stars_operations
  FOR EACH ROW EXECUTE FUNCTION prevent_stars_operations_update();

CREATE OR REPLACE FUNCTION prevent_stars_operations_delete()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'stars_operations is append-only: DELETE is not allowed';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_stars_operations_no_delete ON stars_operations;
CREATE TRIGGER trg_stars_operations_no_delete
  BEFORE DELETE ON stars_operations
  FOR EACH ROW EXECUTE FUNCTION prevent_stars_operations_delete();

-- Append-only enforcement for stars_ledger_entries

CREATE OR REPLACE FUNCTION prevent_stars_ledger_update()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'stars_ledger_entries is append-only: UPDATE is not allowed';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_stars_ledger_no_update ON stars_ledger_entries;
CREATE TRIGGER trg_stars_ledger_no_update
  BEFORE UPDATE ON stars_ledger_entries
  FOR EACH ROW EXECUTE FUNCTION prevent_stars_ledger_update();

CREATE OR REPLACE FUNCTION prevent_stars_ledger_delete()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'stars_ledger_entries is append-only: DELETE is not allowed';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_stars_ledger_no_delete ON stars_ledger_entries;
CREATE TRIGGER trg_stars_ledger_no_delete
  BEFORE DELETE ON stars_ledger_entries
  FOR EACH ROW EXECUTE FUNCTION prevent_stars_ledger_delete();

-- Backfill collection_ownerships from existing artworks
INSERT INTO collection_ownerships (user_id, collection_id, acquisition_type, price_paid, stars_operation_id, created_at)
SELECT
  a.owner_id,
  a.collection_id,
  'legacy',
  0,
  NULL,
  MIN(a.created_at)
FROM artworks a
WHERE a.collection_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM collection_ownerships co
    WHERE co.user_id = a.owner_id
      AND co.collection_id = a.collection_id
  )
GROUP BY a.owner_id, a.collection_id;

COMMIT;
