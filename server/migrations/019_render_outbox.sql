BEGIN;

-- Durable canonical render outbox. Completion transactions enqueue one row
-- per artwork; the row is the only source of truth for rendering recovery.
CREATE TABLE IF NOT EXISTS render_outbox (
  id TEXT PRIMARY KEY,
  artwork_id TEXT NOT NULL UNIQUE REFERENCES artworks(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  template_id TEXT NOT NULL,
  render_mode TEXT NOT NULL CHECK (render_mode IN ('legacy', 'tiled')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'retry', 'ready', 'dead')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  max_attempts INTEGER NOT NULL DEFAULT 6 CHECK (max_attempts >= 1),
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  lease_owner TEXT,
  lease_expires_at TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_render_outbox_claim
  ON render_outbox(status, next_attempt_at, lease_expires_at);

COMMIT;
