-- Cross-instance abuse budgets. Counters are bounded by time bucket and can
-- be garbage-collected without touching user/content records.
CREATE TABLE IF NOT EXISTS abuse_counters (
  scope TEXT NOT NULL,
  actor_key TEXT NOT NULL,
  bucket_start BIGINT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (scope, actor_key, bucket_start),
  CHECK (attempts >= 0)
);

CREATE INDEX IF NOT EXISTS idx_abuse_counters_expiry
  ON abuse_counters (bucket_start);
