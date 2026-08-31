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
import { get, withDbTransaction } from '../db.js';
import { authMiddleware } from '../middleware/auth.js';
import { asyncRoute } from '../middleware/asyncRoute.js';
import { insertTiledTemplate } from '../services/tiled-coloring.js';
import { getTileGrid } from '../services/coloring-chunks.js';
import {
  generateLegacySparkCells,
  isSparkTreatmentUser,
  persistSparkCells,
} from '../services/tiled-specials.js';
import {
  generateLegacyHazardCells,
  persistHazardCells,
} from '../services/tiled-hazard.js';

const router = Router();

const DEFAULT_PALETTE = ['#101820', '#ffffff', '#ff6b6b', '#3ecf8e', '#f7c948', '#8ab4f8'];
const COHORT_FIXTURE_MAX_ATTEMPTS = 64;
const COHORT_FIXTURE_TEMPLATE_PREFIX = 'tpl_cohort_e2e_';
const ALPHA_GLYPH_FIXTURE = 'alpha-glyph-kinds';
const ALPHA_GLYPH_LEGACY_SEED = 'e2e-special-glyph-v2';
const LEGACY_SIZES = Object.freeze([
  { width: 28, height: 28 },
  { width: 96, height: 96 },
  { width: 160, height: 160 },
]);
const TILED_SIZES = Object.freeze([
  { width: 64, height: 64 },
  { width: 160, height: 160 },
  { width: 1200, height: 1200 },
]);

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

function deterministicCohortTemplateId(userId, cohort, attempt, size, fixture = '') {
  const fixtureSuffix = fixture ? `_${fixture}` : '';
  return `${COHORT_FIXTURE_TEMPLATE_PREFIX}${String(userId).slice(0, 24)}_${cohort}_${attempt}_${size.width}x${size.height}${fixtureSuffix}`;
}

/**
 * Find a deterministic template seed whose real production assignment matches
 * the requested cohort. Only `getSparkExperimentGroup`/`isSparkTreatmentUser`
 * are used; no override is persisted or consulted.
 */
function findCohortTemplateId(userId, cohort, size, fixture = '') {
  const requested = String(cohort).toLowerCase() === 'control' ? 'control' : 'treatment';
  for (let attempt = 0; attempt < COHORT_FIXTURE_MAX_ATTEMPTS; attempt += 1) {
    const id = deterministicCohortTemplateId(userId, requested, attempt, size, fixture);
    // The fixture must represent the real deterministic production
    // assignment. A QA override in the current process would otherwise make
    // the same id flip cohorts after insertion.
    const deterministic = isSparkTreatmentUser(userId, id) ? 'treatment' : 'control';
    if (deterministic === requested) return id;
  }
  throw new Error(
    `Could not find a deterministic ${requested} cohort template id for user ${String(userId).slice(0, 24)} at ${size.width}x${size.height}`,
  );
}

function tiledPayload(width, height, tileSize = 32) {
  const result = [];
  for (let tileY = 0; tileY < Math.ceil(height / tileSize); tileY += 1) {
    for (let tileX = 0; tileX < Math.ceil(width / tileSize); tileX += 1) {
      const tileWidth = Math.min(tileSize, width - tileX * tileSize);
      const tileHeight = Math.min(tileSize, height - tileY * tileSize);
      result.push({
        tile_x: tileX,
        tile_y: tileY,
        width: tileWidth,
        height: tileHeight,
        cells: Array(tileWidth * tileHeight).fill(0),
      });
    }
  }
  return result;
}

function findSize(size, allowed) {
  if (!size || typeof size !== 'object') return allowed[0];
  const width = Number(size.width);
  const height = Number(size.height);
  return allowed.find((candidate) => (
    candidate.width === width && candidate.height === height
  )) || allowed[0];
}

async function resetCohortProgress(tx, userId, templateId) {
  // Cohort fixture ids are deterministic by design, so a repeated test run
  // can legitimately find the template already present. Reset every
  // user-scoped mutable row before returning it; otherwise a retry, browser
  // project, or same-worker ordering can inherit progress from an earlier
  // test while the fixture still looks "ready".
  await tx.run('DELETE FROM coloring_progress_batches WHERE user_id=? AND template_id=?', [userId, templateId]);
  await tx.run('DELETE FROM coloring_special_progress WHERE user_id=? AND template_id=?', [userId, templateId]);
  await tx.run('DELETE FROM coloring_progress WHERE user_id=? AND template_id=?', [userId, templateId]);
  await tx.run('DELETE FROM coloring_tiled_progress_tile_colors WHERE user_id=? AND template_id=?', [userId, templateId]);
  await tx.run('DELETE FROM coloring_tiled_progress_colors WHERE user_id=? AND template_id=?', [userId, templateId]);
  await tx.run('DELETE FROM coloring_tiled_progress_tiles WHERE user_id=? AND template_id=?', [userId, templateId]);
  await tx.run('DELETE FROM coloring_tiled_progress WHERE user_id=? AND template_id=?', [userId, templateId]);
}

async function insertLegacyCohortTemplate(tx, {
  id,
  ownerId,
  width,
  height,
  now,
  specialSeed,
}) {
  const cells = Array(width * height).fill(0);
  await tx.run(`INSERT INTO coloring_templates (id,owner_id,title,description,category,difficulty,width,height,palette_json,cells_json,preview_url,original_media_key,source_type,visibility,status,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  [id, ownerId, `Cohort fixture ${id}`, 'e2e deterministic cohort fixture', 'custom', 'custom', width, height, JSON.stringify(DEFAULT_PALETTE), JSON.stringify(cells), null, null, 'user', 'private', 'active', now, now]);
  const generated = generateLegacySparkCells({
    templateId: id,
    seed: specialSeed || id,
    width,
    height,
    cells,
  });
  await persistSparkCells(tx, { templateId: id, cells: generated });
  await persistHazardCells(tx, {
    templateId: id,
    cells: generateLegacyHazardCells({
      templateId: id,
      width,
      height,
      cells,
      occupiedIndices: generated.map((cell) => cell.cell_index),
    }),
  });
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
 * POST /__e2e/seed-cohort-template
 * Body: { cohort: 'treatment'|'control', storage: 'legacy'|'tiled', size? }
 *   size: { width, height } restricted to the supported fixture sizes below.
 *
 * Creates a deterministic template whose real production cohort assignment
 * matches the requested cohort for the authenticated user. The template id is
 * derived from (user, cohort, attempt, size), so repeated calls are
 * idempotent: the same id is returned and the existing template is reused.
 * The cohort is never persisted or overridden; the server's ordinary
 * `getSparkExperimentGroup` continues to own assignment.
 *
 * This hook is mounted only when E2E_SEED_HOOKS=true and never accepts a
 * progressUser/other-user id.
 */
router.post('/seed-cohort-template', authMiddleware, asyncRoute(async (req, res) => {
  const cohort = String(req.body?.cohort || '').toLowerCase();
  const storage = String(req.body?.storage || 'tiled').toLowerCase();
  const fixture = String(req.body?.fixture || '').toLowerCase();
  if (!['treatment', 'control'].includes(cohort)) {
    return res.status(400).json({ error: 'cohort must be treatment or control' });
  }
  if (fixture && fixture !== ALPHA_GLYPH_FIXTURE) {
    return res.status(400).json({ error: `Unsupported cohort fixture: ${fixture}` });
  }
  const allowedSizes = storage === 'legacy' ? LEGACY_SIZES : TILED_SIZES;
  const size = findSize(req.body?.size, allowedSizes);
  const tileSize = 32;
  const id = findCohortTemplateId(req.userId, cohort, size, fixture);
  const now = new Date().toISOString();

  const existing = await get('SELECT id, owner_id, storage_mode FROM coloring_templates WHERE id=?', [id]);
  if (!existing) {
    if (storage === 'legacy') {
      await withDbTransaction((tx) => insertLegacyCohortTemplate(tx, {
        id,
        ownerId: req.userId,
        width: size.width,
        height: size.height,
        now,
        specialSeed: fixture === ALPHA_GLYPH_FIXTURE ? ALPHA_GLYPH_LEGACY_SEED : undefined,
      }));
    } else {
      const tiles = tiledPayload(size.width, size.height, tileSize);
      await withDbTransaction(async (tx) => {
        await insertTiledTemplate(tx, {
          id,
          ownerId: req.userId,
          title: `Cohort ${cohort} fixture`,
          description: 'e2e deterministic cohort fixture',
          width: size.width,
          height: size.height,
          palette: DEFAULT_PALETTE,
          createdAt: now,
          updatedAt: now,
          tileSize,
          tiles,
        });
      });
    }
  } else {
    await withDbTransaction((tx) => resetCohortProgress(tx, req.userId, id));
  }

  // The fixture contract is the deterministic production assignment. The
  // running process QA override may flip `getSparkExperimentGroup`, so it
  // must not be used for the fixture check or response.
  const deterministic = isSparkTreatmentUser(req.userId, id) ? 'treatment' : 'control';
  if (deterministic !== cohort) {
    return res.status(500).json({
      error: `Deterministic cohort mismatch: requested ${cohort}, got ${deterministic}`,
      code: 'COHORT_FIXTURE_MISMATCH',
    });
  }
  if (existing && existing.owner_id !== req.userId) {
    return res.status(409).json({
      error: 'Fixture already exists for another user',
      code: 'COHORT_FIXTURE_OWNER_COLLISION',
    });
  }
  return res.status(201).json({
    id,
    cohort,
    storage,
    size,
    tileSize,
    user_id: req.userId,
    specials_experiment_group: deterministic,
    deterministic_seed: id,
    reused: Boolean(existing),
  });
}));

/**
 * POST /__e2e/seed-preexisting-special-template
 * Body: { width?, height?, tileSize?, palette?, specialMode? }
 *   specialMode: 'none' | 'v3-no-hazard' | 'v3-no-hazard-empty'
 *
 * Creates a normal tiled template (including static guidance rows), then
 * simulates a template created before the special-cell migration:
 *   - 'none' removes every special row, so the first guidance request must
 *     materialize deterministic shared + Hazard rows transactionally;
 *   - both v3 modes remove Hazard and stamp shared rows as generation v3;
 *     `v3-no-hazard` adds one owner-scoped consumed row, while the `-empty`
 *     variant proves an untouched v3 template can rebuild to the current mix.
 */
router.post('/seed-preexisting-special-template', authMiddleware, asyncRoute(async (req, res) => {
  const width = Number(req.body?.width || 1200);
  const height = Number(req.body?.height || 1200);
  const tileSize = Number(req.body?.tileSize || 32);
  const palette = Array.isArray(req.body?.palette) && req.body.palette.length >= 2
    ? req.body.palette
    : DEFAULT_PALETTE;
  const specialMode = String(req.body?.specialMode || 'none');
  // Keep the hook owner-scoped even in the gated e2e runtime. The fixture
  // only needs progress for the authenticated requester; an arbitrary
  // progressUser would let one test user mutate another user's progress.
  const progressUser = req.userId;

  const id = `tpl_prespecial_e2e_${uuid().slice(0, 8)}`;
  const now = new Date().toISOString();
  const { tiles } = buildTiles(width, height, tileSize, palette.length);

  const created = await withDbTransaction(async (tx) => {
    await insertTiledTemplate(tx, {
      id,
      ownerId: req.userId,
      title: `Pre-special e2e ${id}`,
      description: 'e2e fixture: template created before special-cell delivery fix',
      width,
      height,
      palette,
      createdAt: now,
      updatedAt: now,
      tileSize,
      tiles,
    });
    const rows = await tx.all(
      `SELECT special_id, kind, cell_index, tile_x, tile_y, local_index, generation_version
         FROM coloring_special_cells
        WHERE template_id=?
        ORDER BY cell_index`,
      [id],
    );
    if (specialMode === 'v3-no-hazard' || specialMode === 'v3-no-hazard-empty') {
      await tx.run('DELETE FROM coloring_special_cells WHERE template_id=? AND kind=?', [id, 'hazard']);
      await tx.run('UPDATE coloring_special_cells SET generation_version=3 WHERE template_id=?', [id]);
      const shared = rows.filter((row) => row.kind !== 'hazard');
      if (specialMode === 'v3-no-hazard' && progressUser && shared[0]) {
        await tx.run(
          `INSERT INTO coloring_special_progress
            (user_id,template_id,special_id,status,offer_revision,offer_token_hash,updated_at)
            VALUES (?,?,?,?,?,?,?)`,
          [progressUser, id, shared[0].special_id, 'consumed', 1, null, now],
        );
      }
    } else {
      await tx.run('DELETE FROM coloring_special_cells WHERE template_id=?', [id]);
    }
    return {
      id,
      width,
      height,
      tileSize,
      tilesX: Math.ceil(width / tileSize),
      tilesY: Math.ceil(height / tileSize),
      specialMode,
      rowsBefore: rows.length,
      sharedRows: specialMode === 'v3-no-hazard' || specialMode === 'v3-no-hazard-empty'
        ? rows.filter((row) => row.kind !== 'hazard').map((row) => ({
          special_id: String(row.special_id),
          kind: String(row.kind),
          cell_index: Number(row.cell_index),
          tile_x: Number(row.tile_x),
          tile_y: Number(row.tile_y),
          local_index: Number(row.local_index),
          generation_version: 3,
        }))
        : [],
    };
  });

  return res.status(201).json(created);
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
