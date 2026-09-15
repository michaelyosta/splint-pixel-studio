BEGIN;

CREATE TABLE telegram_stars_purchase_gate (
  id TEXT PRIMARY KEY CHECK (id = 'global'),
  mode TEXT NOT NULL CHECK (mode IN ('disabled','controlled','public')),
  version INTEGER NOT NULL CHECK (version > 0),
  reason TEXT NOT NULL,
  actor TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE telegram_stars_purchase_gate_audit (
  id TEXT PRIMARY KEY,
  previous_mode TEXT NOT NULL CHECK (previous_mode IN ('disabled','controlled','public')),
  next_mode TEXT NOT NULL CHECK (next_mode IN ('disabled','controlled','public')),
  version INTEGER NOT NULL,
  reason TEXT NOT NULL,
  actor TEXT NOT NULL,
  changed_at TEXT NOT NULL
);

CREATE TRIGGER trg_telegram_stars_gate_audit_no_update
  BEFORE UPDATE ON telegram_stars_purchase_gate_audit
BEGIN
  SELECT RAISE(ABORT, 'telegram_stars_purchase_gate_audit is append-only');
END;
CREATE TRIGGER trg_telegram_stars_gate_audit_no_delete
  BEFORE DELETE ON telegram_stars_purchase_gate_audit
BEGIN
  SELECT RAISE(ABORT, 'telegram_stars_purchase_gate_audit is append-only');
END;

INSERT INTO telegram_stars_purchase_gate (id,mode,version,reason,actor,updated_at)
VALUES ('global','controlled',1,'migration_preserves_controlled_release','migration',CURRENT_TIMESTAMP)
ON CONFLICT DO NOTHING;

COMMIT;
