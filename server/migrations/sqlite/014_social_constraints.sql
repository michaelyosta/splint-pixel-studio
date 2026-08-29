-- One active publication per artwork. Deleted posts remain available for audit
-- and do not block a later re-publication.
CREATE UNIQUE INDEX IF NOT EXISTS ux_posts_active_artwork
  ON posts (artwork_id)
  WHERE artwork_id IS NOT NULL AND status <> 'deleted';

