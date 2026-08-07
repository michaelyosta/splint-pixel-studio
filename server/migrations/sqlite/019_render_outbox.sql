CREATE TABLE IF NOT EXISTS render_outbox (
  id TEXT PRIMARY KEY,
  artwork_id TEXT NOT NULL UNIQUE REFERENCES artworks(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  template_id TEXT NOT NULL,
  render_mode TEXT NOT NULL CHECK (render_mode IN ('legacy', 'tiled')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'retry', 'ready', 'dead')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  max_attempts INTEGER NOT NULL DEFAULT 6 CHECK (max_attempts >= 1),
  next_attempt_at TEXT NOT NULL,
  lease_owner TEXT,
  lease_expires_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_render_outbox_claim
  ON render_outbox(status, next_attempt_at, lease_expires_at);
