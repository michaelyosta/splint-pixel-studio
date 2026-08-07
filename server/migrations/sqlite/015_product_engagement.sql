-- Server-authoritative progression. XP is only ever granted through an
-- append-only event keyed by a server-derived action identity.
ALTER TABLE users ADD COLUMN xp_total INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN level INTEGER NOT NULL DEFAULT 1;

CREATE TABLE IF NOT EXISTS user_xp_events (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  dedupe_key TEXT NOT NULL,
  xp_amount INTEGER NOT NULL CHECK (xp_amount > 0),
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  UNIQUE (user_id, dedupe_key)
);

CREATE INDEX IF NOT EXISTS idx_user_xp_events_user_created
  ON user_xp_events(user_id, created_at);

-- The challenge assignment is persisted per UTC day, so its template and
-- reward cannot change underneath a player during the day.
CREATE TABLE IF NOT EXISTS daily_challenges (
  date_key TEXT PRIMARY KEY,
  template_id TEXT NOT NULL REFERENCES coloring_templates(id) ON DELETE RESTRICT,
  target_cells INTEGER NOT NULL CHECK (target_cells > 0),
  xp_reward INTEGER NOT NULL CHECK (xp_reward > 0),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS daily_challenge_progress (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date_key TEXT NOT NULL REFERENCES daily_challenges(date_key) ON DELETE CASCADE,
  progress_cells INTEGER NOT NULL DEFAULT 0 CHECK (progress_cells >= 0),
  completed_at TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, date_key)
);

CREATE INDEX IF NOT EXISTS idx_daily_challenge_progress_user
  ON daily_challenge_progress(user_id, date_key);

CREATE TABLE IF NOT EXISTS user_favorite_templates (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  template_id TEXT NOT NULL REFERENCES coloring_templates(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (user_id, template_id)
);

CREATE INDEX IF NOT EXISTS idx_user_favorite_templates_recent
  ON user_favorite_templates(user_id, created_at);

CREATE TABLE IF NOT EXISTS user_template_history (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  template_id TEXT NOT NULL REFERENCES coloring_templates(id) ON DELETE CASCADE,
  opened_at TEXT NOT NULL,
  PRIMARY KEY (user_id, template_id)
);

CREATE INDEX IF NOT EXISTS idx_user_template_history_recent
  ON user_template_history(user_id, opened_at);

-- Existing editorial collections stay public/published. User-owned sets use
-- the same stable collection id without enabling prices or payment flows.
ALTER TABLE collections ADD COLUMN owner_id TEXT REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE collections ADD COLUMN status TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('draft', 'published', 'archived'));
ALTER TABLE collections ADD COLUMN visibility TEXT NOT NULL DEFAULT 'public' CHECK (visibility IN ('public', 'private'));
ALTER TABLE collections ADD COLUMN description TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_collections_owner_status
  ON collections(owner_id, status, title);

CREATE TABLE IF NOT EXISTS collection_items (
  collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  template_id TEXT NOT NULL REFERENCES coloring_templates(id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0 CHECK (position >= 0),
  created_at TEXT NOT NULL,
  PRIMARY KEY (collection_id, template_id)
);

CREATE INDEX IF NOT EXISTS idx_collection_items_order
  ON collection_items(collection_id, position, created_at);
