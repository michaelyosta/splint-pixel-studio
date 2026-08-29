BEGIN;

-- Telegram Stars (XTR) is intentionally isolated from the existing internal
-- credits ledger.  These tables are a future-provider boundary: the order is
-- server-priced, payment capture is provider-authoritative, and entitlements
-- are granted only from a verified successful_payment update.
CREATE TABLE IF NOT EXISTS telegram_stars_orders (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  product_id TEXT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'XTR' CHECK (currency = 'XTR'),
  amount_xtr INTEGER NOT NULL CHECK (amount_xtr > 0),
  idempotency_key TEXT NOT NULL,
  request_fingerprint TEXT NOT NULL,
  invoice_payload TEXT NOT NULL UNIQUE,
  invoice_url TEXT,
  provider_invoice_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('invoice_pending','invoice_issued','checkout_pending','paid','cancelled','partially_refunded','refunded')),
  pre_checkout_query_id TEXT,
  checkout_approved_at TIMESTAMPTZ,
  paid_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  paid_after_cancelled BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  UNIQUE(user_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_telegram_stars_orders_user_created
  ON telegram_stars_orders(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_telegram_stars_orders_status
  ON telegram_stars_orders(status, updated_at);

CREATE TABLE IF NOT EXISTS telegram_stars_events (
  id TEXT PRIMARY KEY,
  event_key TEXT NOT NULL UNIQUE,
  event_type TEXT NOT NULL CHECK (event_type IN ('pre_checkout_query','successful_payment','refund')),
  provider_update_id TEXT UNIQUE,
  request_fingerprint TEXT NOT NULL,
  order_id TEXT REFERENCES telegram_stars_orders(id) ON DELETE RESTRICT,
  telegram_payment_charge_id TEXT,
  payload_json TEXT NOT NULL,
  decision_json TEXT,
  status TEXT NOT NULL CHECK (status IN ('received','processed','rejected')),
  received_at TIMESTAMPTZ NOT NULL,
  processed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_telegram_stars_events_order
  ON telegram_stars_events(order_id, received_at);
CREATE INDEX IF NOT EXISTS idx_telegram_stars_events_charge
  ON telegram_stars_events(telegram_payment_charge_id);

CREATE TABLE IF NOT EXISTS telegram_stars_payments (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL UNIQUE REFERENCES telegram_stars_orders(id) ON DELETE RESTRICT,
  telegram_payment_charge_id TEXT NOT NULL UNIQUE,
  provider_payment_charge_id TEXT,
  currency TEXT NOT NULL CHECK (currency = 'XTR'),
  amount_xtr INTEGER NOT NULL CHECK (amount_xtr > 0),
  status TEXT NOT NULL CHECK (status IN ('captured','partially_refunded','refunded')),
  refunded_amount_xtr INTEGER NOT NULL DEFAULT 0 CHECK (refunded_amount_xtr >= 0 AND refunded_amount_xtr <= amount_xtr),
  raw_event_json TEXT NOT NULL,
  captured_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_telegram_stars_payments_status
  ON telegram_stars_payments(status, updated_at);

CREATE TABLE IF NOT EXISTS telegram_stars_entitlements (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL UNIQUE REFERENCES telegram_stars_orders(id) ON DELETE RESTRICT,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  product_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active','revoked')),
  granted_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  revoked_reason TEXT
);

CREATE INDEX IF NOT EXISTS idx_telegram_stars_entitlements_user
  ON telegram_stars_entitlements(user_id, status, granted_at DESC);

CREATE TABLE IF NOT EXISTS telegram_stars_refunds (
  id TEXT PRIMARY KEY,
  payment_id TEXT NOT NULL REFERENCES telegram_stars_payments(id) ON DELETE RESTRICT,
  refund_id TEXT NOT NULL UNIQUE,
  amount_xtr INTEGER NOT NULL CHECK (amount_xtr > 0),
  currency TEXT NOT NULL CHECK (currency = 'XTR'),
  reason TEXT,
  support_case_id TEXT,
  raw_event_json TEXT NOT NULL,
  applied_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_telegram_stars_refunds_payment
  ON telegram_stars_refunds(payment_id, applied_at);

-- A refund request reserves its amount before the provider call. This closes
-- the multi-instance race where two support retries could otherwise both ask
-- Telegram for a refund against the same remaining capture.
CREATE TABLE IF NOT EXISTS telegram_stars_refund_requests (
  id TEXT PRIMARY KEY,
  payment_id TEXT NOT NULL REFERENCES telegram_stars_payments(id) ON DELETE RESTRICT,
  request_key TEXT NOT NULL UNIQUE,
  request_fingerprint TEXT NOT NULL,
  amount_xtr INTEGER NOT NULL CHECK (amount_xtr > 0),
  status TEXT NOT NULL CHECK (status IN ('requested','submitted','applied','failed')),
  provider_refund_id TEXT,
  failure_code TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_telegram_stars_refund_requests_payment
  ON telegram_stars_refund_requests(payment_id, status, created_at);

CREATE TABLE IF NOT EXISTS telegram_stars_reconciliation_runs (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('running','completed','failed')),
  provider_name TEXT NOT NULL DEFAULT 'telegram_stars_mock',
  checked_at TIMESTAMPTZ,
  checked_count INTEGER NOT NULL DEFAULT 0 CHECK (checked_count >= 0),
  issue_count INTEGER NOT NULL DEFAULT 0 CHECK (issue_count >= 0),
  error_message TEXT,
  started_at TIMESTAMPTZ NOT NULL,
  finished_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS telegram_stars_reconciliation_issues (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES telegram_stars_reconciliation_runs(id) ON DELETE CASCADE,
  issue_type TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('warning','critical')),
  fingerprint TEXT NOT NULL,
  order_id TEXT REFERENCES telegram_stars_orders(id) ON DELETE RESTRICT,
  payment_id TEXT REFERENCES telegram_stars_payments(id) ON DELETE RESTRICT,
  details_json TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  resolved_at TIMESTAMPTZ,
  UNIQUE(run_id, fingerprint)
);

CREATE TABLE IF NOT EXISTS telegram_stars_support_cases (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  order_id TEXT REFERENCES telegram_stars_orders(id) ON DELETE RESTRICT,
  telegram_payment_charge_id TEXT,
  idempotency_key TEXT NOT NULL UNIQUE,
  request_fingerprint TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('payment_missing','refund_request','payment_question','other')),
  contact TEXT NOT NULL,
  message TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('open','triaged','resolved')),
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_telegram_stars_support_user
  ON telegram_stars_support_cases(user_id, created_at DESC);

-- Prices, product identity, and Telegram charge IDs are immutable. State and
-- refund counters may change only through the service state machine.
CREATE OR REPLACE FUNCTION prevent_telegram_stars_order_identity_update()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.product_id IS DISTINCT FROM OLD.product_id
     OR NEW.currency IS DISTINCT FROM OLD.currency
     OR NEW.amount_xtr IS DISTINCT FROM OLD.amount_xtr
     OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
     OR NEW.request_fingerprint IS DISTINCT FROM OLD.request_fingerprint
     OR NEW.invoice_payload IS DISTINCT FROM OLD.invoice_payload THEN
    RAISE EXCEPTION 'telegram_stars_orders identity is immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_telegram_stars_orders_identity ON telegram_stars_orders;
CREATE TRIGGER trg_telegram_stars_orders_identity
  BEFORE UPDATE ON telegram_stars_orders
  FOR EACH ROW EXECUTE FUNCTION prevent_telegram_stars_order_identity_update();

CREATE OR REPLACE FUNCTION prevent_telegram_stars_payment_identity_update()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.order_id IS DISTINCT FROM OLD.order_id
     OR NEW.telegram_payment_charge_id IS DISTINCT FROM OLD.telegram_payment_charge_id
     OR NEW.provider_payment_charge_id IS DISTINCT FROM OLD.provider_payment_charge_id
     OR NEW.currency IS DISTINCT FROM OLD.currency
     OR NEW.amount_xtr IS DISTINCT FROM OLD.amount_xtr
     OR NEW.raw_event_json IS DISTINCT FROM OLD.raw_event_json
     OR NEW.captured_at IS DISTINCT FROM OLD.captured_at THEN
    RAISE EXCEPTION 'telegram_stars_payments charge identity is immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_telegram_stars_payments_identity ON telegram_stars_payments;
CREATE TRIGGER trg_telegram_stars_payments_identity
  BEFORE UPDATE ON telegram_stars_payments
  FOR EACH ROW EXECUTE FUNCTION prevent_telegram_stars_payment_identity_update();

CREATE OR REPLACE FUNCTION prevent_telegram_stars_refund_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'telegram_stars_refunds is append-only';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_telegram_stars_refunds_no_update ON telegram_stars_refunds;
CREATE TRIGGER trg_telegram_stars_refunds_no_update
  BEFORE UPDATE ON telegram_stars_refunds
  FOR EACH ROW EXECUTE FUNCTION prevent_telegram_stars_refund_mutation();

DROP TRIGGER IF EXISTS trg_telegram_stars_refunds_no_delete ON telegram_stars_refunds;
CREATE TRIGGER trg_telegram_stars_refunds_no_delete
  BEFORE DELETE ON telegram_stars_refunds
  FOR EACH ROW EXECUTE FUNCTION prevent_telegram_stars_refund_mutation();

COMMIT;
