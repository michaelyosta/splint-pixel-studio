BEGIN;

-- Keep catalog maps as immutable R2 objects with a small verified descriptor
-- and compact per-template tile/color index in SQLite.
CREATE TABLE IF NOT EXISTS coloring_catalog_grid_sources (
  template_id TEXT PRIMARY KEY REFERENCES coloring_templates(id) ON DELETE CASCADE,
  object_key TEXT NOT NULL UNIQUE CHECK (object_key LIKE 'catalog/grids/%'),
  sha256 TEXT NOT NULL CHECK (length(sha256) = 64 AND sha256 NOT GLOB '*[^a-f0-9]*'),
  compressed_bytes INTEGER NOT NULL CHECK (compressed_bytes > 0),
  raw_bytes INTEGER NOT NULL CHECK (raw_bytes > 0),
  tile_color_counts BLOB NOT NULL,
  tile_color_counts_sha256 TEXT NOT NULL CHECK (length(tile_color_counts_sha256) = 64 AND tile_color_counts_sha256 NOT GLOB '*[^a-f0-9]*'),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

COMMIT;
