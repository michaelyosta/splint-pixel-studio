BEGIN;

-- 022 adds a completion marker for the tiled guidance static index.
--
-- The index tables from 021 are built from coloring_template_tiles. Templates
-- created before 021 have no rows, and an interrupted lazy build could leave a
-- partial index that 021's "COUNT(*) > 0" guard would never repair. A marker
-- row makes the build idempotent, restartable and observable: a template is
-- considered indexed only when its marker exists, and the backfill rebuilds
-- (delete + recreate) any template without a marker.
CREATE TABLE IF NOT EXISTS coloring_template_guidance_index_meta (
  template_id TEXT NOT NULL REFERENCES coloring_templates(id) ON DELETE CASCADE,
  colors INTEGER NOT NULL CHECK (colors >= 0),
  tiles INTEGER NOT NULL CHECK (tiles >= 0),
  built_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (template_id)
);

COMMIT;
