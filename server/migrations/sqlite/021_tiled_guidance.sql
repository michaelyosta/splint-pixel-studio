BEGIN;

CREATE TABLE IF NOT EXISTS coloring_template_tile_color_counts (
  template_id TEXT NOT NULL REFERENCES coloring_templates(id) ON DELETE CASCADE,
  tile_x INTEGER NOT NULL CHECK (tile_x >= 0),
  tile_y INTEGER NOT NULL CHECK (tile_y >= 0),
  color_index INTEGER NOT NULL CHECK (color_index >= 0),
  total_count INTEGER NOT NULL CHECK (total_count > 0),
  PRIMARY KEY (template_id, tile_x, tile_y, color_index)
);

CREATE INDEX IF NOT EXISTS idx_template_tile_color_counts_color
  ON coloring_template_tile_color_counts(template_id, color_index, tile_y, tile_x);

CREATE TABLE IF NOT EXISTS coloring_template_color_counts (
  template_id TEXT NOT NULL REFERENCES coloring_templates(id) ON DELETE CASCADE,
  color_index INTEGER NOT NULL CHECK (color_index >= 0),
  total_count INTEGER NOT NULL CHECK (total_count > 0),
  PRIMARY KEY (template_id, color_index)
);

CREATE TABLE IF NOT EXISTS coloring_tiled_progress_tile_colors (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  template_id TEXT NOT NULL REFERENCES coloring_templates(id) ON DELETE CASCADE,
  tile_x INTEGER NOT NULL CHECK (tile_x >= 0),
  tile_y INTEGER NOT NULL CHECK (tile_y >= 0),
  color_index INTEGER NOT NULL CHECK (color_index >= 0),
  remaining_count INTEGER NOT NULL CHECK (remaining_count >= 0),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, template_id, tile_x, tile_y, color_index)
);

CREATE INDEX IF NOT EXISTS idx_progress_tile_colors_remaining
  ON coloring_tiled_progress_tile_colors(user_id, template_id, color_index, remaining_count, tile_y, tile_x);

CREATE TABLE IF NOT EXISTS coloring_tiled_progress_colors (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  template_id TEXT NOT NULL REFERENCES coloring_templates(id) ON DELETE CASCADE,
  color_index INTEGER NOT NULL CHECK (color_index >= 0),
  remaining_count INTEGER NOT NULL CHECK (remaining_count >= 0),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, template_id, color_index)
);

COMMIT;
