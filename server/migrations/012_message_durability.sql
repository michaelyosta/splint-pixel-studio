BEGIN;

CREATE TABLE IF NOT EXISTS message_request_dedup (
  sender_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  idempotency_key TEXT NOT NULL,
  request_fingerprint TEXT NOT NULL,
  request_id TEXT NOT NULL REFERENCES message_requests(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (sender_id, idempotency_key),
  UNIQUE (request_id)
);

CREATE INDEX IF NOT EXISTS idx_message_requests_expiry ON message_requests(status, updated_at);

COMMIT;
