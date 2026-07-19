BEGIN;

-- Daily streak tracking per user
CREATE TABLE IF NOT EXISTS daily_streaks (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  current_streak INTEGER NOT NULL DEFAULT 0,
  longest_streak INTEGER NOT NULL DEFAULT 0,
  total_days INTEGER NOT NULL DEFAULT 0,
  last_active_date TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (user_id)
);

-- Achievements definitions (catalog) and unlocked state per user
CREATE TABLE IF NOT EXISTS achievements (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'style',
  icon TEXT NOT NULL DEFAULT 'star',
  rarity TEXT NOT NULL DEFAULT 'common',
  created_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS user_achievements (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  achievement_id TEXT NOT NULL REFERENCES achievements(id) ON DELETE CASCADE,
  unlocked_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (user_id, achievement_id)
);

-- Per-template visual zones (chunks) for the fragmented session loop
CREATE TABLE IF NOT EXISTS coloring_zones (
  id TEXT PRIMARY KEY,
  template_id TEXT NOT NULL REFERENCES coloring_templates(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  cell_indices_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL
);

-- Event analytics (lightweight, always-on)
CREATE TABLE IF NOT EXISTS analytics_events (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event TEXT NOT NULL,
  payload_json JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL
);

-- Editorial catalog metadata on templates
ALTER TABLE coloring_templates ADD COLUMN IF NOT EXISTS mood TEXT NOT NULL DEFAULT 'calm';
ALTER TABLE coloring_templates ADD COLUMN IF NOT EXISTS theme TEXT NOT NULL DEFAULT 'featured';
ALTER TABLE coloring_templates ADD COLUMN IF NOT EXISTS est_minutes INTEGER NOT NULL DEFAULT 3;
ALTER TABLE coloring_templates ADD COLUMN IF NOT EXISTS collection_id TEXT;
ALTER TABLE coloring_templates ADD COLUMN IF NOT EXISTS zone_count INTEGER NOT NULL DEFAULT 1;
ALTER TABLE coloring_templates ADD COLUMN IF NOT EXISTS daily_featured INTEGER NOT NULL DEFAULT 0;
ALTER TABLE coloring_templates ADD COLUMN IF NOT EXISTS added_at TIMESTAMPTZ;

-- Zones indexed for fast lookup per template
CREATE INDEX IF NOT EXISTS idx_coloring_zones_template ON coloring_zones(template_id);
CREATE INDEX IF NOT EXISTS idx_analytics_user_event ON analytics_events(user_id, event, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_coloring_templates_editorial ON coloring_templates(daily_featured, mood, theme, est_minutes);

COMMIT;
