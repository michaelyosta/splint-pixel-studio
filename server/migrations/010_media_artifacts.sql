BEGIN;

ALTER TABLE artworks ADD COLUMN IF NOT EXISTS storage_key TEXT;
ALTER TABLE artworks ADD COLUMN IF NOT EXISTS thumbnail_key TEXT;
ALTER TABLE artworks ADD COLUMN IF NOT EXISTS content_hash TEXT;
ALTER TABLE artworks ADD COLUMN IF NOT EXISTS mime_type TEXT;
ALTER TABLE artworks ADD COLUMN IF NOT EXISTS width INTEGER;
ALTER TABLE artworks ADD COLUMN IF NOT EXISTS height INTEGER;
ALTER TABLE artworks ADD COLUMN IF NOT EXISTS byte_size INTEGER;
ALTER TABLE artworks ADD COLUMN IF NOT EXISTS render_status TEXT NOT NULL DEFAULT 'ready';
ALTER TABLE artworks ADD COLUMN IF NOT EXISTS legacy_source TEXT;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'artworks_render_status_check'
      AND conrelid = 'artworks'::regclass
  ) THEN
    ALTER TABLE artworks ADD CONSTRAINT artworks_render_status_check
      CHECK (render_status IN ('pending','ready','failed','retrying'));
  END IF;
END $$;

UPDATE artworks SET legacy_source='data_url' WHERE image_url LIKE 'data:image/%' AND legacy_source IS NULL;
UPDATE artworks SET render_status='ready' WHERE render_status IS NULL;

CREATE INDEX IF NOT EXISTS idx_artworks_render_status ON artworks(render_status, updated_at);
CREATE INDEX IF NOT EXISTS idx_artworks_content_hash ON artworks(content_hash);

COMMIT;
