BEGIN;

ALTER TABLE coloring_templates
  DROP CONSTRAINT IF EXISTS coloring_templates_width_check;
ALTER TABLE coloring_templates
  DROP CONSTRAINT IF EXISTS coloring_templates_height_check;
ALTER TABLE coloring_templates
  ADD CONSTRAINT coloring_templates_width_check CHECK (width BETWEEN 8 AND 96);
ALTER TABLE coloring_templates
  ADD CONSTRAINT coloring_templates_height_check CHECK (height BETWEEN 8 AND 96);

CREATE TABLE IF NOT EXISTS template_ratings (
  template_id TEXT NOT NULL REFERENCES coloring_templates(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (template_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_template_ratings_template
  ON template_ratings(template_id);

COMMIT;
