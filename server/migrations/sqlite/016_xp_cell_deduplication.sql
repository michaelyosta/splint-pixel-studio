-- A cell can contribute painting XP once per user/template. Progress itself
-- remains undoable and rewards do not become an XP farming loop.
CREATE TABLE IF NOT EXISTS user_template_xp_cells (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  template_id TEXT NOT NULL REFERENCES coloring_templates(id) ON DELETE CASCADE,
  cell_index INTEGER NOT NULL CHECK (cell_index >= 0),
  earned_at TEXT NOT NULL,
  PRIMARY KEY (user_id, template_id, cell_index)
);

CREATE INDEX IF NOT EXISTS idx_user_template_xp_cells_template
  ON user_template_xp_cells(template_id, user_id);
