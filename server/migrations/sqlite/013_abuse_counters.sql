CREATE TABLE IF NOT EXISTS abuse_counters (
  scope TEXT NOT NULL,
  actor_key TEXT NOT NULL,
  bucket_start INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  PRIMARY KEY (scope, actor_key, bucket_start)
);

CREATE INDEX IF NOT EXISTS idx_abuse_counters_expiry
  ON abuse_counters (bucket_start);
