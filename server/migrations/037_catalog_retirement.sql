BEGIN;

-- Retired catalog templates remain directly playable so users can resume
-- existing work, while discovery endpoints can exclude them from the catalog.
ALTER TABLE coloring_templates ADD COLUMN IF NOT EXISTS catalog_retired_at TIMESTAMPTZ;

COMMIT;
