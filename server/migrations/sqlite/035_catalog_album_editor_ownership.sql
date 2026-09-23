BEGIN;

-- Existing albums may contain editorial changes from the merchandising UI.
-- Preserve those rows by default. The canonical publisher opts new rows into
-- manifest synchronization, and the editor opts edited rows out.
ALTER TABLE catalog_albums ADD COLUMN editor_managed INTEGER NOT NULL DEFAULT 1;

COMMIT;
