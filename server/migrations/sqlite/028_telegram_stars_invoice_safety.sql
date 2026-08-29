-- Durable invoice lease, expiry, and catalog snapshot for the bounded XTR
-- vertical slice. The lease prevents concurrent provider invoice creation;
-- expiry prevents a stale checkout from being approved against an old
-- catalog state. Captures may still be accepted after expiry because money
-- received from the provider must remain auditable and refundable.
ALTER TABLE telegram_stars_orders ADD COLUMN invoice_expires_at TEXT;
ALTER TABLE telegram_stars_orders ADD COLUMN catalog_snapshot_json TEXT;
ALTER TABLE telegram_stars_orders ADD COLUMN invoice_lease_token TEXT;
ALTER TABLE telegram_stars_orders ADD COLUMN invoice_lease_until TEXT;

CREATE INDEX IF NOT EXISTS idx_telegram_stars_orders_invoice_lease
  ON telegram_stars_orders(invoice_lease_until);

-- A non-consumable product may have at most one open checkout for a user.
-- Cancelled, refunded, and paid rows remain historical and do not block a
-- legitimate retry/repurchase.
CREATE UNIQUE INDEX IF NOT EXISTS idx_telegram_stars_open_product_user
  ON telegram_stars_orders(user_id, product_id)
  WHERE status IN ('invoice_pending','invoice_issued','checkout_pending');
