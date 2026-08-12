BEGIN;

ALTER TABLE coloring_special_cells
  DROP CONSTRAINT IF EXISTS coloring_special_cells_kind_check;

ALTER TABLE coloring_special_cells
  ADD CONSTRAINT coloring_special_cells_kind_check
  CHECK (kind IN ('spark', 'bomb', 'fuse', 'choice', 'artifact', 'hazard'));

COMMIT;
