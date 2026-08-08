BEGIN;

-- 017 introduces a separate tiled storage path. Existing legacy rows remain
-- JSON-backed and are never rewritten by this migration.
ALTER TABLE coloring_templates
  DROP CONSTRAINT IF EXISTS coloring_templates_width_check;
ALTER TABLE coloring_templates
  DROP CONSTRAINT IF EXISTS coloring_templates_height_check;
ALTER TABLE coloring_templates
  ADD CONSTRAINT coloring_templates_width_check CHECK (width BETWEEN 8 AND 1200);
ALTER TABLE coloring_templates
  ADD CONSTRAINT coloring_templates_height_check CHECK (height BETWEEN 8 AND 1200);

ALTER TABLE coloring_templates
  ADD COLUMN IF NOT EXISTS storage_mode TEXT NOT NULL DEFAULT 'legacy';
ALTER TABLE coloring_templates
  ADD COLUMN IF NOT EXISTS tile_size INTEGER NOT NULL DEFAULT 32;
ALTER TABLE coloring_templates
  ADD CONSTRAINT coloring_templates_storage_mode_check
    CHECK (storage_mode IN ('legacy', 'tiled'));
ALTER TABLE coloring_templates
  ADD CONSTRAINT coloring_templates_legacy_dimension_check
    CHECK (storage_mode = 'tiled' OR (width <= 160 AND height <= 160));
ALTER TABLE coloring_templates
  ADD CONSTRAINT coloring_templates_tile_size_check
    CHECK (tile_size BETWEEN 8 AND 128);

CREATE TABLE IF NOT EXISTS coloring_template_tiles (
  template_id TEXT NOT NULL REFERENCES coloring_templates(id) ON DELETE CASCADE,
  tile_x INTEGER NOT NULL CHECK (tile_x >= 0),
  tile_y INTEGER NOT NULL CHECK (tile_y >= 0),
  width INTEGER NOT NULL CHECK (width BETWEEN 1 AND 128),
  height INTEGER NOT NULL CHECK (height BETWEEN 1 AND 128),
  cells_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (template_id, tile_x, tile_y)
);

CREATE TABLE IF NOT EXISTS coloring_tiled_progress (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  template_id TEXT NOT NULL REFERENCES coloring_templates(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  completed_cells INTEGER NOT NULL DEFAULT 0 CHECK (completed_cells >= 0),
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (user_id, template_id)
);

CREATE TABLE IF NOT EXISTS coloring_tiled_progress_tiles (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  template_id TEXT NOT NULL REFERENCES coloring_templates(id) ON DELETE CASCADE,
  tile_x INTEGER NOT NULL CHECK (tile_x >= 0),
  tile_y INTEGER NOT NULL CHECK (tile_y >= 0),
  width INTEGER NOT NULL CHECK (width BETWEEN 1 AND 128),
  height INTEGER NOT NULL CHECK (height BETWEEN 1 AND 128),
  filled_json JSONB NOT NULL,
  completed_cells INTEGER NOT NULL DEFAULT 0 CHECK (completed_cells >= 0),
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (user_id, template_id, tile_x, tile_y)
);

CREATE INDEX IF NOT EXISTS idx_coloring_template_tiles_template
  ON coloring_template_tiles(template_id, tile_y, tile_x);
CREATE INDEX IF NOT EXISTS idx_coloring_tiled_progress_updated
  ON coloring_tiled_progress(user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_coloring_tiled_progress_tiles_template
  ON coloring_tiled_progress_tiles(template_id, user_id, tile_y, tile_x);

COMMIT;
