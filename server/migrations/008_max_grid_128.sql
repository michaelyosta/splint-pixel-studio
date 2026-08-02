BEGIN;

ALTER TABLE coloring_templates
  DROP CONSTRAINT IF EXISTS coloring_templates_width_check;
ALTER TABLE coloring_templates
  DROP CONSTRAINT IF EXISTS coloring_templates_height_check;
ALTER TABLE coloring_templates
  ADD CONSTRAINT coloring_templates_width_check CHECK (width BETWEEN 8 AND 128);
ALTER TABLE coloring_templates
  ADD CONSTRAINT coloring_templates_height_check CHECK (height BETWEEN 8 AND 128);

COMMIT;
