BEGIN;

ALTER TABLE collections ADD COLUMN catalog_scope TEXT NOT NULL DEFAULT 'system';
ALTER TABLE collections ADD COLUMN catalog_slug TEXT;
ALTER TABLE collections ADD COLUMN catalog_theme TEXT NOT NULL DEFAULT 'featured';
ALTER TABLE collections ADD COLUMN catalog_mood TEXT NOT NULL DEFAULT 'calm';
ALTER TABLE collections ADD COLUMN catalog_tags_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE collections ADD COLUMN catalog_rank INTEGER NOT NULL DEFAULT 1000;
ALTER TABLE collections ADD COLUMN catalog_cover_url TEXT;

ALTER TABLE coloring_templates ADD COLUMN album_id TEXT;
ALTER TABLE coloring_templates ADD COLUMN album_title TEXT NOT NULL DEFAULT '';
ALTER TABLE coloring_templates ADD COLUMN access_type TEXT NOT NULL DEFAULT 'free';
ALTER TABLE coloring_templates ADD COLUMN tags_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE coloring_templates ADD COLUMN season_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE coloring_templates ADD COLUMN audience_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE coloring_templates ADD COLUMN featured_rank INTEGER NOT NULL DEFAULT 1000;
ALTER TABLE coloring_templates ADD COLUMN is_new INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_collections_catalog_merchandising ON collections(catalog_scope, catalog_rank, title);
CREATE INDEX IF NOT EXISTS idx_templates_merchandising ON coloring_templates(access_type, featured_rank, album_id);
CREATE INDEX IF NOT EXISTS idx_templates_album ON coloring_templates(collection_id, album_id);

COMMIT;
