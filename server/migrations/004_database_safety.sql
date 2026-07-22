-- Financial constraints on users
ALTER TABLE users ADD CONSTRAINT users_stars_balance_check CHECK (stars_balance >= 0);
ALTER TABLE users ADD CONSTRAINT users_price_in_stars_check CHECK (price_in_stars >= 0);

-- Price constraints on related tables
ALTER TABLE collections ADD CONSTRAINT collections_price_in_stars_check CHECK (price_in_stars >= 0);
ALTER TABLE message_requests ADD CONSTRAINT message_requests_price_in_stars_check CHECK (price_in_stars >= 0);

-- Message request status constraint
ALTER TABLE message_requests ADD CONSTRAINT message_requests_status_check
  CHECK (status IN ('created', 'payment_pending', 'processing', 'delivered', 'answered', 'rejected', 'cancelled'));
