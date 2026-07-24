ALTER TABLE artworks ADD COLUMN template_id TEXT REFERENCES coloring_templates(id) ON DELETE SET NULL;

UPDATE artworks
SET template_id = collection_id,
    collection_id = (
      SELECT t.collection_id
      FROM coloring_templates t
      WHERE t.id = artworks.collection_id
    )
WHERE EXISTS (
  SELECT 1 FROM coloring_templates t WHERE t.id = artworks.collection_id
)
  AND source_type IN ('coloring', 'showcase');

UPDATE artworks
SET collection_id = NULL
WHERE collection_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM collections c WHERE c.id = artworks.collection_id);

DELETE FROM reports
WHERE id NOT IN (
  SELECT MIN(id) FROM reports GROUP BY reporter_id, target_type, target_id
);

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
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_moderation_actions_target
  ON moderation_actions(target_type, target_id, created_at);

INSERT OR IGNORE INTO collection_ownerships (user_id, collection_id, acquisition_type, price_paid, stars_operation_id, created_at)
SELECT a.owner_id, a.collection_id, 'legacy', 0, NULL, MIN(a.created_at)
FROM artworks a
JOIN collections c ON c.id = a.collection_id
WHERE a.collection_id IS NOT NULL
GROUP BY a.owner_id, a.collection_id;
