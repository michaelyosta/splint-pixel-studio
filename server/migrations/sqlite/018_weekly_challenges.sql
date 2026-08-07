CREATE TABLE IF NOT EXISTS weekly_challenges (
  period_key TEXT PRIMARY KEY,
  target_cells INTEGER NOT NULL CHECK (target_cells > 0),
  xp_reward INTEGER NOT NULL CHECK (xp_reward > 0),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS weekly_challenge_progress (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  period_key TEXT NOT NULL REFERENCES weekly_challenges(period_key) ON DELETE CASCADE,
  progress_cells INTEGER NOT NULL DEFAULT 0 CHECK (progress_cells >= 0),
  completed_at TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, period_key)
);

CREATE INDEX IF NOT EXISTS idx_weekly_challenge_progress_user
  ON weekly_challenge_progress(user_id, period_key);
