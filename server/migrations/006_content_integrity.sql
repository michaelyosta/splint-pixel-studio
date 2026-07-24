BEGIN;

ALTER TABLE artworks ADD COLUMN IF NOT EXISTS template_id TEXT;

UPDATE artworks a
SET template_id = t.id,
    collection_id = t.collection_id
FROM coloring_templates t
WHERE a.collection_id = t.id
  AND a.source_type IN ('coloring', 'showcase')
  AND a.template_id IS NULL;

UPDATE artworks a
SET collection_id = NULL
WHERE collection_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM collections c WHERE c.id = a.collection_id);

DELETE FROM reports newer
USING reports older
WHERE newer.reporter_id = older.reporter_id
  AND newer.target_type = older.target_type
  AND newer.target_id = older.target_id
  AND (newer.created_at, newer.id) > (older.created_at, older.id);

ALTER TABLE artworks
  ADD CONSTRAINT artworks_template_id_fkey
  FOREIGN KEY (template_id) REFERENCES coloring_templates(id) ON DELETE SET NULL;

ALTER TABLE artworks
  ADD CONSTRAINT artworks_collection_id_fkey
  FOREIGN KEY (collection_id) REFERENCES collections(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_artworks_template ON artworks(template_id);
CREATE INDEX IF NOT EXISTS idx_artworks_collection ON artworks(collection_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_reports_unique_reporter_target
  ON reports(reporter_id, target_type, target_id);

CREATE TABLE IF NOT EXISTS moderation_actions (
  id TEXT PRIMARY KEY,
  actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  reason TEXT,
  previous_state TEXT,
  new_state TEXT,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_moderation_actions_target
  ON moderation_actions(target_type, target_id, created_at DESC);

INSERT INTO collection_ownerships (user_id, collection_id, acquisition_type, price_paid, stars_operation_id, created_at)
SELECT a.owner_id, a.collection_id, 'legacy', 0, NULL, MIN(a.created_at)
FROM artworks a
JOIN collections c ON c.id = a.collection_id
WHERE a.collection_id IS NOT NULL
GROUP BY a.owner_id, a.collection_id
ON CONFLICT (user_id, collection_id) DO NOTHING;

COMMIT;
