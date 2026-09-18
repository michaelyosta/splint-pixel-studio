BEGIN;

-- Closed merchandising control plane. Access is granted only through the
-- server-resolved admin_acl row; no client-provided role or user id is used.
ALTER TABLE collections ADD COLUMN IF NOT EXISTS catalog_managed BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE coloring_templates ADD COLUMN IF NOT EXISTS catalog_managed BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS admin_acl (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('owner', 'admin')),
  permissions_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS admin_audit_log (
  id TEXT PRIMARY KEY,
  actor_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  actor_telegram_id BIGINT,
  actor_role TEXT NOT NULL CHECK (actor_role IN ('owner', 'admin')),
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  before_json JSONB,
  after_json JSONB,
  correlation_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_admin_audit_created ON admin_audit_log(created_at DESC, id);
CREATE INDEX IF NOT EXISTS idx_admin_audit_entity ON admin_audit_log(entity_type, entity_id, created_at DESC);

CREATE TABLE IF NOT EXISTS merchandising_drafts (
  id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('collection', 'album', 'coloring', 'shelf', 'product')),
  entity_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('draft', 'preview', 'published', 'archived')),
  payload_json JSONB NOT NULL,
  base_version INTEGER NOT NULL DEFAULT 0,
  created_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  previewed_at TIMESTAMPTZ,
  published_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_merch_drafts_entity ON merchandising_drafts(entity_type, entity_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_merch_drafts_status ON merchandising_drafts(status, updated_at DESC);

CREATE TABLE IF NOT EXISTS catalog_albums (
  id TEXT PRIMARY KEY,
  collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE RESTRICT,
  slug TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  visibility TEXT NOT NULL DEFAULT 'public' CHECK (visibility IN ('public', 'private')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'hidden', 'archived')),
  cover_url TEXT,
  sort_rank INTEGER NOT NULL DEFAULT 1000,
  featured BOOLEAN NOT NULL DEFAULT FALSE,
  is_new BOOLEAN NOT NULL DEFAULT FALSE,
  tags_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  UNIQUE(collection_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_catalog_albums_collection ON catalog_albums(collection_id, status, visibility, sort_rank, title);

CREATE TABLE IF NOT EXISTS catalog_shelves (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  filter_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'hidden', 'archived')),
  sort_rank INTEGER NOT NULL DEFAULT 1000,
  cover_url TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS catalog_product_prices (
  product_id TEXT PRIMARY KEY REFERENCES collections(id) ON DELETE RESTRICT,
  price_xtr INTEGER NOT NULL CHECK (price_xtr > 0),
  price_version INTEGER NOT NULL CHECK (price_version > 0),
  updated_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

-- The order snapshot is immutable in application code and retains the exact
-- price version used to issue an invoice. Existing invoices are backfilled
-- from their already durable amount and receive version 1.
ALTER TABLE telegram_stars_orders ADD COLUMN IF NOT EXISTS price_xtr INTEGER;
ALTER TABLE telegram_stars_orders ADD COLUMN IF NOT EXISTS price_version INTEGER;
ALTER TABLE telegram_stars_orders ADD COLUMN IF NOT EXISTS invoice_created_at TIMESTAMPTZ;

-- Extend the existing order identity guard to cover the explicit price
-- snapshot columns introduced here.
CREATE OR REPLACE FUNCTION prevent_telegram_stars_order_identity_update()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.product_id IS DISTINCT FROM OLD.product_id
     OR NEW.currency IS DISTINCT FROM OLD.currency
     OR NEW.amount_xtr IS DISTINCT FROM OLD.amount_xtr
     OR NEW.price_xtr IS DISTINCT FROM OLD.price_xtr
     OR NEW.price_version IS DISTINCT FROM OLD.price_version
     OR NEW.invoice_created_at IS DISTINCT FROM OLD.invoice_created_at
     OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
     OR NEW.request_fingerprint IS DISTINCT FROM OLD.request_fingerprint
     OR NEW.invoice_payload IS DISTINCT FROM OLD.invoice_payload THEN
    RAISE EXCEPTION 'telegram_stars_orders identity is immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_telegram_stars_orders_identity ON telegram_stars_orders;
CREATE TRIGGER trg_telegram_stars_orders_identity
  BEFORE UPDATE ON telegram_stars_orders
  FOR EACH ROW EXECUTE FUNCTION prevent_telegram_stars_order_identity_update();

INSERT INTO catalog_product_prices (product_id, price_xtr, price_version, updated_at)
SELECT id, price_in_stars, 1, CURRENT_TIMESTAMP
  FROM collections
 WHERE id = 'col_premium-gallery' AND price_in_stars > 0
ON CONFLICT (product_id) DO NOTHING;

UPDATE telegram_stars_orders
   SET price_xtr = amount_xtr,
       price_version = COALESCE(price_version, 1),
       invoice_created_at = COALESCE(invoice_created_at, created_at)
 WHERE price_xtr IS NULL OR price_version IS NULL OR invoice_created_at IS NULL;

CREATE OR REPLACE FUNCTION prevent_admin_audit_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'admin_audit_log is append-only';
END;
$$;

DROP TRIGGER IF EXISTS trg_admin_audit_no_update ON admin_audit_log;
CREATE TRIGGER trg_admin_audit_no_update BEFORE UPDATE ON admin_audit_log
FOR EACH ROW EXECUTE FUNCTION prevent_admin_audit_mutation();
DROP TRIGGER IF EXISTS trg_admin_audit_no_delete ON admin_audit_log;
CREATE TRIGGER trg_admin_audit_no_delete BEFORE DELETE ON admin_audit_log
FOR EACH ROW EXECUTE FUNCTION prevent_admin_audit_mutation();

COMMIT;
