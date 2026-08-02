CREATE TABLE IF NOT EXISTS coloring_progress_batches (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  template_id TEXT NOT NULL REFERENCES coloring_templates(id) ON DELETE CASCADE,
  client_batch_id TEXT NOT NULL,
  changes_hash TEXT NOT NULL,
  revision_before INTEGER NOT NULL,
  revision_after INTEGER NOT NULL,
  response_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (user_id, template_id, client_batch_id)
);

CREATE INDEX IF NOT EXISTS idx_coloring_progress_batches_created ON coloring_progress_batches(created_at);
