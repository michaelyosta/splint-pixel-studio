CREATE TABLE IF NOT EXISTS template_ratings (
  template_id TEXT NOT NULL REFERENCES coloring_templates(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (template_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_template_ratings_template
  ON template_ratings(template_id);
