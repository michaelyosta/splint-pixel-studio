-- Durable evidence independent of order processing. No order FK: unknown captures must survive.
CREATE TABLE telegram_stars_capture_inbox (
  telegram_payment_charge_id TEXT PRIMARY KEY,
  request_fingerprint TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('received','processed','recovery_required','refund_submitted','refunded')),
  error_code TEXT,
  received_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX idx_stars_capture_inbox_recovery ON telegram_stars_capture_inbox(updated_at)
  WHERE status IN ('received','recovery_required','refund_submitted');

CREATE OR REPLACE FUNCTION protect_telegram_stars_capture_inbox()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'telegram_stars_capture_inbox is durable';
  END IF;
  IF OLD.telegram_payment_charge_id <> NEW.telegram_payment_charge_id
     OR OLD.request_fingerprint <> NEW.request_fingerprint
     OR OLD.payload_json <> NEW.payload_json
     OR OLD.received_at <> NEW.received_at THEN
    RAISE EXCEPTION 'telegram_stars_capture_inbox identity is immutable';
  END IF;
  IF OLD.status = 'refunded' AND NEW.status <> 'refunded'
     OR OLD.status = 'refund_submitted' AND NEW.status NOT IN ('refund_submitted','refunded') THEN
    RAISE EXCEPTION 'telegram_stars_capture_inbox status cannot move backwards';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_stars_capture_inbox_update
  BEFORE UPDATE ON telegram_stars_capture_inbox
  FOR EACH ROW EXECUTE FUNCTION protect_telegram_stars_capture_inbox();
CREATE TRIGGER trg_stars_capture_inbox_no_delete
  BEFORE DELETE ON telegram_stars_capture_inbox
  FOR EACH ROW EXECUTE FUNCTION protect_telegram_stars_capture_inbox();
