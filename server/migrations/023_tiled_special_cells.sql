BEGIN;

CREATE TABLE IF NOT EXISTS coloring_special_cells (
  template_id TEXT NOT NULL REFERENCES coloring_templates(id) ON DELETE CASCADE,
  special_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind='spark'),
  cell_index INTEGER NOT NULL,
  tile_x INTEGER NOT NULL,
  tile_y INTEGER NOT NULL,
  local_index INTEGER NOT NULL,
  generation_version INTEGER NOT NULL,
  PRIMARY KEY (template_id, special_id),
  UNIQUE (template_id, cell_index)
);

CREATE INDEX IF NOT EXISTS idx_coloring_special_cells_tile
  ON coloring_special_cells(template_id, tile_x, tile_y);

CREATE TABLE IF NOT EXISTS coloring_special_progress (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  template_id TEXT NOT NULL REFERENCES coloring_templates(id) ON DELETE CASCADE,
  special_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('unseen','offered','consumed','skipped')),
  offer_revision INTEGER,
  offer_token_hash TEXT,
  updated_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (user_id, template_id, special_id),
  FOREIGN KEY (template_id, special_id)
    REFERENCES coloring_special_cells(template_id, special_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_coloring_special_progress_offer
  ON coloring_special_progress(user_id, template_id, status);

COMMIT;
