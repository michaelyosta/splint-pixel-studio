BEGIN;

-- A Telegram Stars product is non-consumable in this bounded slice. A user
-- may repurchase only after a full refund/revocation, never through a second
-- active order created with a different idempotency key.
CREATE UNIQUE INDEX IF NOT EXISTS idx_telegram_stars_active_product_user
  ON telegram_stars_entitlements(user_id, product_id)
  WHERE status = 'active';

COMMIT;
