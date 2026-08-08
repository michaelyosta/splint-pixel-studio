/**
 * Test-only seeding hooks for e2e runs. Mounted ONLY when
 * E2E_SEED_HOOKS=true (see server/index.js); never in production.
 *
 * These endpoints simulate data states the public API cannot produce, so the
 * regression suite can exercise real migration/upgrade scenarios:
 *  - a tiled template as it exists in a PRE-021 database (tiles + progress,
 *    but no static guidance index rows and no index marker),
 *  - simulated broken guidance indexes (partial rows without a marker).
 */
import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import { withDbTransaction } from '../db.js';
import { authMiddleware } from '../middleware/auth.js';
import { asyncRoute } from '../middleware/asyncRoute.js';
import { insertTiledTemplate } from '../services/tiled-coloring.js';
import { getTileGrid } from '../services/coloring-chunks.js';

const router = Router();

const DEFAULT_PALETTE = ['#101820', '#ffffff', '#ff6b6b', '#3ecf8e', '#f7c948', '#8ab4f8'];

function buildTiles(width, height, tileSize, paletteLength) {
  const grid = getTileGrid(width, height, tileSize);
  const tiles = [];
  for (let tileY = 0; tileY < grid.tiles_y; tileY += 1) {
    for (let tileX = 0; tileX < grid.tiles_x; tileX += 1) {
      // Edge tiles are partial: the last column/row is narrower/shorter.
      const tileWidth = tileX === grid.tiles_x - 1 ? width - tileX * tileSize : tileSize;
      const tileHeight = tileY === grid.tiles_y - 1 ? height - tileY * tileSize : tileSize;
      const cells = [];
      for (let y = 0; y < tileHeight; y += 1) {
        for (let x = 0; x < tileWidth; x += 1) {
          cells.push((tileX * 3 + tileY * 5 + x + y * 2) % paletteLength);
        }
      }
      tiles.push({ tile_x: tileX, tile_y: tileY, width: tileWidth, height: tileHeight, cells });
    }
  }
  return { grid, tiles };
}

/**
 * POST /__e2e/seed-pre021-template
 * Body: { width?, height?, tileSize?, palette?, progress? }
 *   progress: { color: number, cells: number, tile?: {x,y} }
 *
 * Creates a tiled template exactly like a pre-021 database would hold it:
 * coloring_templates + coloring_template_tiles + coloring_tiled_progress
 * rows, and NOTHING in the guidance index tables. The public create flow
 * builds the index at creation, so this endpoint inserts through the same
 * validation path and then removes the index rows to simulate the upgrade.
 */
router.post('/seed-pre021-template', authMiddleware, asyncRoute(async (req, res) => {
  const width = Number(req.body?.width || 1200);
  const height = Number(req.body?.height || 1200);
  const tileSize = Number(req.body?.tileSize || 32);
  const palette = Array.isArray(req.body?.palette) && req.body.palette.length >= 2
    ? req.body.palette
    : DEFAULT_PALETTE;
  const progressColor = Number(req.body?.progress?.color ?? 1);
  const progressCells = Number(req.body?.progress?.cells ?? 0);
  const progressTileX = Number(req.body?.progress?.tile?.x ?? 0);
  const progressTileY = Number(req.body?.progress?.tile?.y ?? 0);

  const id = `tpl_pre021_e2e_${uuid().slice(0, 8)}`;
  const now = new Date().toISOString();
  const { tiles } = buildTiles(width, height, tileSize, palette.length);

  const created = await withDbTransaction(async (tx) => {
    await insertTiledTemplate(tx, {
      id,
      ownerId: req.userId,
      title: `Pre-021 e2e ${id}`,
      description: 'e2e fixture: template created before migration 021',
      width,
      height,
      palette,
      createdAt: now,
      updatedAt: now,
      tileSize,
      tiles,
    });

    // Simulate a pre-021 database: strip the static index the modern create
    // flow built, and drop the completion marker.
    await tx.run('DELETE FROM coloring_template_tile_color_counts WHERE template_id=?', [id]);
    await tx.run('DELETE FROM coloring_template_color_counts WHERE template_id=?', [id]);
    await tx.run('DELETE FROM coloring_template_guidance_index_meta WHERE template_id=?', [id]);

    if (progressCells > 0) {
      const targetTile = tiles.find((tile) => tile.tile_x === progressTileX && tile.tile_y === progressTileY) || tiles[0];
      let painted = 0;
      const filled = targetTile.cells.map((color) => {
        if (color === progressColor && painted < progressCells) {
          painted += 1;
          return progressColor;
        }
        return -1;
      });
      const completedInTile = filled.reduce((count, value, index) => (
        count + (value === targetTile.cells[index] ? 1 : 0)
      ), 0);
      await tx.run(
        `INSERT INTO coloring_tiled_progress
          (user_id,template_id,revision,completed_cells,completed_at,created_at,updated_at)
          VALUES (?,?,?,?,?,?,?)`,
        [req.userId, id, 5, completedInTile, null, now, now],
      );
      await tx.run(
        `INSERT INTO coloring_tiled_progress_tiles
          (user_id,template_id,tile_x,tile_y,width,height,filled_json,completed_cells,created_at,updated_at)
          VALUES (?,?,?,?,?,?,?,?,?,?)`,
        [req.userId, id, targetTile.tile_x, targetTile.tile_y, targetTile.width, targetTile.height,
          JSON.stringify(filled), completedInTile, now, now],
      );
    }
    return { id, width, height, tileSize, tilesX: Math.ceil(width / tileSize), tilesY: Math.ceil(height / tileSize) };
  });

  return res.status(201).json({ id, ...created, pre021: true });
}));

/**
 * POST /__e2e/corrupt-guidance-index
 * Body: { id }
 *
 * Leaves a partial index (some color counts, no marker) — the exact state an
 * interrupted pre-021 lazy build produced. Guidance must repair it via the
 * delete+rebuild path instead of trusting partial rows.
 */
router.post('/corrupt-guidance-index', authMiddleware, asyncRoute(async (req, res) => {
  const id = String(req.body?.id || '');
  if (!id) return res.status(400).json({ error: 'id is required' });
  await withDbTransaction(async (tx) => {
    await tx.run(
      `INSERT INTO coloring_template_color_counts (template_id,color_index,total_count)
        VALUES (?,0,1) ON CONFLICT(template_id,color_index) DO UPDATE SET total_count=excluded.total_count`,
      [id],
    );
    await tx.run('DELETE FROM coloring_template_guidance_index_meta WHERE template_id=?', [id]);
  });
  return res.json({ id, corrupted: true });
}));

export default router;
