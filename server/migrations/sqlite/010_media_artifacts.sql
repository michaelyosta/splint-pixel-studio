ALTER TABLE artworks ADD COLUMN storage_key TEXT;
ALTER TABLE artworks ADD COLUMN thumbnail_key TEXT;
ALTER TABLE artworks ADD COLUMN content_hash TEXT;
ALTER TABLE artworks ADD COLUMN mime_type TEXT;
ALTER TABLE artworks ADD COLUMN width INTEGER;
ALTER TABLE artworks ADD COLUMN height INTEGER;
ALTER TABLE artworks ADD COLUMN byte_size INTEGER;
ALTER TABLE artworks ADD COLUMN render_status TEXT NOT NULL DEFAULT 'ready';
ALTER TABLE artworks ADD COLUMN legacy_source TEXT;

UPDATE artworks SET legacy_source='data_url' WHERE image_url LIKE 'data:image/%' AND legacy_source IS NULL;
CREATE INDEX IF NOT EXISTS idx_artworks_render_status ON artworks(render_status, updated_at);
CREATE INDEX IF NOT EXISTS idx_artworks_content_hash ON artworks(content_hash);
