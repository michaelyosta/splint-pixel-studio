PRAGMA foreign_keys=OFF;

DROP INDEX IF EXISTS idx_coloring_special_cells_tile;
DROP INDEX IF EXISTS idx_coloring_special_progress_offer;

ALTER TABLE coloring_special_progress RENAME TO coloring_special_progress_v2;
ALTER TABLE coloring_special_cells RENAME TO coloring_special_cells_v2;

CREATE TABLE coloring_special_cells (
  template_id TEXT NOT NULL REFERENCES coloring_templates(id) ON DELETE CASCADE,
  special_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('spark','bomb','fuse','choice','artifact','hazard')),
  cell_index INTEGER NOT NULL,
  tile_x INTEGER NOT NULL,
  tile_y INTEGER NOT NULL,
  local_index INTEGER NOT NULL,
  generation_version INTEGER NOT NULL,
  PRIMARY KEY (template_id, special_id),
  UNIQUE (template_id, cell_index)
);

INSERT INTO coloring_special_cells
  (template_id,special_id,kind,cell_index,tile_x,tile_y,local_index,generation_version)
SELECT template_id,special_id,kind,cell_index,tile_x,tile_y,local_index,generation_version
  FROM coloring_special_cells_v2;

CREATE TABLE coloring_special_progress (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  template_id TEXT NOT NULL REFERENCES coloring_templates(id) ON DELETE CASCADE,
  special_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('unseen','offered','consumed','skipped')),
  offer_revision INTEGER,
  offer_token_hash TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, template_id, special_id),
  FOREIGN KEY (template_id, special_id)
    REFERENCES coloring_special_cells(template_id, special_id) ON DELETE CASCADE
);

INSERT INTO coloring_special_progress
  (user_id,template_id,special_id,status,offer_revision,offer_token_hash,updated_at)
SELECT user_id,template_id,special_id,status,offer_revision,offer_token_hash,updated_at
  FROM coloring_special_progress_v2;

DROP TABLE coloring_special_progress_v2;
DROP TABLE coloring_special_cells_v2;

CREATE INDEX idx_coloring_special_cells_tile
  ON coloring_special_cells(template_id, tile_x, tile_y);
CREATE INDEX idx_coloring_special_progress_offer
  ON coloring_special_progress(user_id, template_id, status);

PRAGMA foreign_keys=ON;
