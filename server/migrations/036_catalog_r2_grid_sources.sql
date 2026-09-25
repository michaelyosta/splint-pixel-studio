BEGIN;

-- Catalog cell maps are immutable R2 objects. PostgreSQL stores only the
-- verified object descriptor and a compact Uint16LE tile/color-count vector;
-- it does not duplicate millions of palette indices as JSONB tile rows.
CREATE TABLE IF NOT EXISTS coloring_catalog_grid_sources (
  template_id TEXT PRIMARY KEY REFERENCES coloring_templates(id) ON DELETE CASCADE,
  object_key TEXT NOT NULL UNIQUE CHECK (object_key LIKE 'catalog/grids/%'),
  sha256 TEXT NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  compressed_bytes INTEGER NOT NULL CHECK (compressed_bytes > 0),
  raw_bytes INTEGER NOT NULL CHECK (raw_bytes > 0),
  tile_color_counts BYTEA NOT NULL,
  tile_color_counts_sha256 TEXT NOT NULL CHECK (tile_color_counts_sha256 ~ '^[a-f0-9]{64}$'),
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

COMMIT;
