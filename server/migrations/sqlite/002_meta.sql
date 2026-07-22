CREATE TABLE IF NOT EXISTS daily_streaks (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  current_streak INTEGER NOT NULL DEFAULT 0,
  longest_streak INTEGER NOT NULL DEFAULT 0,
  total_days INTEGER NOT NULL DEFAULT 0,
  last_active_date TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id)
);
CREATE TABLE IF NOT EXISTS achievements (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'style',
  icon TEXT NOT NULL DEFAULT 'star',
  rarity TEXT NOT NULL DEFAULT 'common',
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS user_achievements (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  achievement_id TEXT NOT NULL REFERENCES achievements(id) ON DELETE CASCADE,
  unlocked_at TEXT NOT NULL,
  PRIMARY KEY (user_id, achievement_id)
);
CREATE TABLE IF NOT EXISTS coloring_zones (
  id TEXT PRIMARY KEY,
  template_id TEXT NOT NULL REFERENCES coloring_templates(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  cell_indices_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS analytics_events (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);
ALTER TABLE coloring_templates ADD COLUMN mood TEXT NOT NULL DEFAULT 'calm';
ALTER TABLE coloring_templates ADD COLUMN theme TEXT NOT NULL DEFAULT 'featured';
ALTER TABLE coloring_templates ADD COLUMN est_minutes INTEGER NOT NULL DEFAULT 3;
ALTER TABLE coloring_templates ADD COLUMN collection_id TEXT;
ALTER TABLE coloring_templates ADD COLUMN zone_count INTEGER NOT NULL DEFAULT 1;
ALTER TABLE coloring_templates ADD COLUMN daily_featured INTEGER NOT NULL DEFAULT 0;
ALTER TABLE coloring_templates ADD COLUMN added_at TEXT;
CREATE INDEX IF NOT EXISTS idx_coloring_zones_template ON coloring_zones(template_id);
CREATE INDEX IF NOT EXISTS idx_analytics_user_event ON analytics_events(user_id, event, created_at);
