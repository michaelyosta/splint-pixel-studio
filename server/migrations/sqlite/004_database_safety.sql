-- Triggers to enforce CHECK constraints on SQLite
-- (ALTER TABLE ADD CONSTRAINT CHECK is not supported in SQLite)

CREATE TRIGGER IF NOT EXISTS trg_users_stars_balance_insert
  BEFORE INSERT ON users
  WHEN NEW.stars_balance < 0
BEGIN
  SELECT RAISE(ABORT, 'users: stars_balance must be >= 0');
END;

CREATE TRIGGER IF NOT EXISTS trg_users_stars_balance_update
  BEFORE UPDATE ON users
  WHEN NEW.stars_balance < 0
BEGIN
  SELECT RAISE(ABORT, 'users: stars_balance must be >= 0');
END;

CREATE TRIGGER IF NOT EXISTS trg_users_price_check_insert
  BEFORE INSERT ON users
  WHEN NEW.price_in_stars < 0
BEGIN
  SELECT RAISE(ABORT, 'users: price_in_stars must be >= 0');
END;

CREATE TRIGGER IF NOT EXISTS trg_users_price_check_update
  BEFORE UPDATE ON users
  WHEN NEW.price_in_stars < 0
BEGIN
  SELECT RAISE(ABORT, 'users: price_in_stars must be >= 0');
END;

CREATE TRIGGER IF NOT EXISTS trg_collections_price_check_insert
  BEFORE INSERT ON collections
  WHEN NEW.price_in_stars < 0
BEGIN
  SELECT RAISE(ABORT, 'collections: price_in_stars must be >= 0');
END;

CREATE TRIGGER IF NOT EXISTS trg_collections_price_check_update
  BEFORE UPDATE ON collections
  WHEN NEW.price_in_stars < 0
BEGIN
  SELECT RAISE(ABORT, 'collections: price_in_stars must be >= 0');
END;

CREATE TRIGGER IF NOT EXISTS trg_messages_price_check_insert
  BEFORE INSERT ON message_requests
  WHEN NEW.price_in_stars < 0
BEGIN
  SELECT RAISE(ABORT, 'message_requests: price_in_stars must be >= 0');
END;

CREATE TRIGGER IF NOT EXISTS trg_messages_price_check_update
  BEFORE UPDATE ON message_requests
  WHEN NEW.price_in_stars < 0
BEGIN
  SELECT RAISE(ABORT, 'message_requests: price_in_stars must be >= 0');
END;

CREATE TRIGGER IF NOT EXISTS trg_messages_status_check_insert
  BEFORE INSERT ON message_requests
  WHEN NEW.status NOT IN ('created','payment_pending','processing','delivered','answered','rejected','cancelled')
BEGIN
  SELECT RAISE(ABORT, 'message_requests: invalid status');
END;

CREATE TRIGGER IF NOT EXISTS trg_messages_status_check_update
  BEFORE UPDATE ON message_requests
  WHEN NEW.status NOT IN ('created','payment_pending','processing','delivered','answered','rejected','cancelled')
BEGIN
  SELECT RAISE(ABORT, 'message_requests: invalid status');
END;
