BEGIN;

-- 020 introduces durable, server-authoritative unlock rules and materialized
-- template entitlements. Rules are data, not UI flags: every gate references
-- facts the server already owns (level/XP, achievements, streak, completed
-- artworks/collections). Collections keep using collection_ownerships as the
-- single entitlement table so paid and progression ownership never diverge.
CREATE TABLE IF NOT EXISTS unlock_rules (
  subject_type TEXT NOT NULL CHECK (subject_type IN ('template', 'collection')),
  subject_id TEXT NOT NULL,
  rule_type TEXT NOT NULL CHECK (rule_type IN (
    'level',
    'xp',
    'achievement',
    'streak',
    'completed_artworks',
    'collection_completion'
  )),
  target_value TEXT NOT NULL,
  rule_order INTEGER NOT NULL DEFAULT 0 CHECK (rule_order >= 0),
  created_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (subject_type, subject_id, rule_type, target_value)
);

CREATE INDEX IF NOT EXISTS idx_unlock_rules_subject
  ON unlock_rules(subject_type, subject_id);

-- Materialized template entitlements. The (user_id, template_id) primary key
-- is the concurrency guard: a losing transaction that reaches the same rule
-- is a no-op instead of a double grant.
CREATE TABLE IF NOT EXISTS template_entitlements (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  template_id TEXT NOT NULL REFERENCES coloring_templates(id) ON DELETE CASCADE,
  source TEXT NOT NULL CHECK (source IN ('progression', 'free', 'purchase')),
  granted_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (user_id, template_id)
);

CREATE INDEX IF NOT EXISTS idx_template_entitlements_user
  ON template_entitlements(user_id, granted_at DESC);

COMMIT;
