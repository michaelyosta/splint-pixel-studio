BEGIN;

-- Catalog card and player surfaces must load the lightweight pixelized
-- preview (~7KB) instead of the full-resolution optimized master (~1.8MB).
-- New seeds already write the pixel variant (see db.js). This rewrites rows
-- seeded before that change. The transform is deterministic and reversible
-- by stripping the '-pixel' infix. Only generated catalog previews match
-- while user uploads, cover art and other assets are untouched. The
-- preview_url column has existed since the initial schema, so every real
-- database carries it.
UPDATE coloring_templates
   SET preview_url = REPLACE(preview_url, '.png', '-pixel.png')
 WHERE preview_url LIKE '/assets/catalog/generated/%.png'
   AND preview_url NOT LIKE '%-pixel.png'
   AND preview_url NOT LIKE '%/covers/%';

COMMIT;
