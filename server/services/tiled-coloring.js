import {
  DEFAULT_TILE_SIZE,
  getTileBounds,
  getTileGrid,
} from './coloring-chunks.js';
import { ensureStaticGuidanceIndex, persistStaticGuidanceCounts } from './tiled-guidance.js';
import {
  HAZARD_KIND,
  SPECIAL_GAMEPLAY_GENERATION_VERSION,
  SPARK_TARGET_MAX_CELLS,
  generateSpecialCells,
  persistSparkCells,
  readTileSpecials,
} from './tiled-specials.js';
import {
  generateHazardCells,
  persistHazardCells,
} from './tiled-hazard.js';

export const TILED_STORAGE_MODE = 'tiled';
export const TILED_MAX_DIMENSION = 1_200;
export const TILED_MAX_CHANGES = 64;

class TiledColoringError extends Error {
  constructor(message, code, status = 400) {
    super(message);
    this.name = 'TiledColoringError';
    this.code = code;
    this.status = status;
  }
}

function asSafeInteger(value, code, label) {
  const numeric = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
  if (!Number.isSafeInteger(numeric)) {
    throw new TiledColoringError(`${label} must be a safe integer`, code, 400);
  }
  return numeric;
}

function parseJsonArray(value) {
  if (Array.isArray(value)) return value;
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
  return null;
}

function requireArray(value, length, code, label) {
  const parsed = parseJsonArray(value);
  if (!parsed || parsed.length !== length) {
    throw new TiledColoringError(`${label} must contain exactly ${length} cells`, code, 500);
  }
  return parsed;
}

function normalizeTileSize(value) {
  const tileSize = value === undefined || value === null
    ? DEFAULT_TILE_SIZE
    : asSafeInteger(value, 'INVALID_TILE_SIZE', 'tile_size');
  if (tileSize < 8 || tileSize > 128) {
    throw new TiledColoringError('tile_size must be between 8 and 128', 'INVALID_TILE_SIZE', 400);
  }
  return tileSize;
}

export function isTiledTemplate(template) {
  return template?.storage_mode === TILED_STORAGE_MODE;
}

export function validateTiledGridDimensions(width, height, tileSize = DEFAULT_TILE_SIZE) {
  let grid;
  try {
    grid = getTileGrid(width, height, normalizeTileSize(tileSize));
  } catch (error) {
    throw new TiledColoringError(error.message, 'INVALID_GRID_DIMENSIONS', 422);
  }
  if (grid.width > TILED_MAX_DIMENSION || grid.height > TILED_MAX_DIMENSION) {
    throw new TiledColoringError('Tiled grid dimensions exceed the 1200×1200 contract', 'INVALID_GRID_DIMENSIONS', 422);
  }
  return grid;
}

function validatePalette(palette) {
  if (!Array.isArray(palette) || palette.length < 2 || palette.length > 32
    || palette.some((color) => typeof color !== 'string' || !/^#[0-9a-f]{6}$/i.test(color))) {
    throw new TiledColoringError('Palette must contain 2–32 HEX colors', 'INVALID_PALETTE', 400);
  }
}

function tileCoordinates(tile) {
  const tileX = tile?.tile_x ?? tile?.tileX ?? tile?.x;
  const tileY = tile?.tile_y ?? tile?.tileY ?? tile?.y;
  return {
    tile_x: asSafeInteger(tileX, 'INVALID_TILE_COORDINATES', 'tile_x'),
    tile_y: asSafeInteger(tileY, 'INVALID_TILE_COORDINATES', 'tile_y'),
  };
}

/**
 * Validate a complete tiled template payload without constructing a full
 * row-major cells array. Every tile is required exactly once so a tiled row
 * can never silently fall back to legacy storage.
 */
export function validateTiledTemplateInput({ width, height, palette, tiles, tileSize = DEFAULT_TILE_SIZE } = {}) {
  validatePalette(palette);
  const grid = validateTiledGridDimensions(width, height, tileSize);
  if (!Array.isArray(tiles) || tiles.length !== grid.tiles_x * grid.tiles_y) {
    throw new TiledColoringError(
      `Tiled template must provide exactly ${grid.tiles_x * grid.tiles_y} tiles`,
      'INCOMPLETE_TILED_TEMPLATE',
      422,
    );
  }

  const seen = new Set();
  const normalized = [];
  for (const tile of tiles) {
    const coordinates = tileCoordinates(tile);
    const bounds = getTileBounds({
      ...grid,
      tileX: coordinates.tile_x,
      tileY: coordinates.tile_y,
      tileSize: grid.tile_size,
    });
    const key = `${bounds.tile_x}:${bounds.tile_y}`;
    if (seen.has(key)) {
      throw new TiledColoringError('Duplicate tiled template coordinates', 'DUPLICATE_TILE', 422);
    }
    seen.add(key);
    const cells = parseJsonArray(tile?.cells);
    if (!cells || cells.length !== bounds.cell_count || cells.some((color) => (
      !Number.isInteger(color) || color < 0 || color >= palette.length
    ))) {
      throw new TiledColoringError(
        `Tile ${key} must contain ${bounds.cell_count} valid palette indices`,
        'INVALID_TILE_DATA',
        422,
      );
    }
    if (tile.width !== undefined && Number(tile.width) !== bounds.width) {
      throw new TiledColoringError(`Tile ${key} has an invalid width`, 'INVALID_TILE_DATA', 422);
    }
    if (tile.height !== undefined && Number(tile.height) !== bounds.height) {
      throw new TiledColoringError(`Tile ${key} has an invalid height`, 'INVALID_TILE_DATA', 422);
    }
    normalized.push({
      tile_x: bounds.tile_x,
      tile_y: bounds.tile_y,
      width: bounds.width,
      height: bounds.height,
      cells,
    });
  }

  if (seen.size !== grid.tiles_x * grid.tiles_y) {
    throw new TiledColoringError('Tiled template is missing one or more coordinates', 'INCOMPLETE_TILED_TEMPLATE', 422);
  }
  normalized.sort((a, b) => a.tile_y - b.tile_y || a.tile_x - b.tile_x);
  return { grid, tiles: normalized };
}

export function validateTiledChanges(changes, {
  width,
  height,
  tileSize = DEFAULT_TILE_SIZE,
  paletteLength,
  maxChanges = TILED_MAX_CHANGES,
} = {}) {
  const grid = validateTiledGridDimensions(width, height, tileSize);
  const safeMaxChanges = Math.max(
    1,
    Math.min(SPARK_TARGET_MAX_CELLS, Number(maxChanges) || TILED_MAX_CHANGES),
  );
  if (!Array.isArray(changes) || changes.length < 1 || changes.length > safeMaxChanges) {
    throw new TiledColoringError(`A tiled batch must contain between 1 and ${safeMaxChanges} changes`, 'INVALID_TILED_CHANGES', 400);
  }
  const seen = new Set();
  const normalized = [];
  for (const change of changes) {
    if (!change || !Number.isInteger(change.index) || !Number.isInteger(change.color)) {
      throw new TiledColoringError('Tiled changes require integer index and color', 'INVALID_TILED_CHANGES', 400);
    }
    if (change.index < 0 || change.index >= grid.totalCells) {
      throw new TiledColoringError('Tiled change index is outside the grid', 'INVALID_COORDINATES', 400);
    }
    if (change.color < -1 || change.color >= paletteLength) {
      throw new TiledColoringError('Tiled change color is outside the palette', 'INVALID_COLOR', 400);
    }
    if (seen.has(change.index)) {
      throw new TiledColoringError('Tiled batch cannot contain duplicate coordinates', 'INVALID_COORDINATES', 400);
    }
    seen.add(change.index);
    const x = change.index % grid.width;
    const y = Math.floor(change.index / grid.width);
    const tile_x = Math.floor(x / grid.tile_size);
    const tile_y = Math.floor(y / grid.tile_size);
    const bounds = getTileBounds({ ...grid, tileX: tile_x, tileY: tile_y, tileSize: grid.tile_size });
    const local_x = x - bounds.offset_x;
    const local_y = y - bounds.offset_y;
    normalized.push({
      index: change.index,
      color: change.color,
      tile_x,
      tile_y,
      local_index: local_y * bounds.width + local_x,
    });
  }
  return { grid, changes: normalized };
}

function storedTileCells(row, expectedLength, label) {
  return requireArray(row?.cells_json, expectedLength, 'CORRUPT_TILED_TEMPLATE', label);
}

function storedFilled(row, expectedLength, label) {
  const filled = row ? parseJsonArray(row.filled_json) : null;
  if (!row) return Array(expectedLength).fill(-1);
  if (!filled || filled.length !== expectedLength || filled.some((color) => !Number.isInteger(color) || color < -1)) {
    throw new TiledColoringError(`${label} is corrupt`, 'CORRUPT_TILED_PROGRESS', 500);
  }
  return filled;
}

function unfilledByColor(cells, filled) {
  const counts = new Map();
  for (let index = 0; index < cells.length; index += 1) {
    if (filled[index] !== -1) continue;
    const color = cells[index];
    counts.set(color, (counts.get(color) || 0) + 1);
  }
  return counts;
}

/**
 * Keep bounded per-tile/per-color remaining counters in sync after a paint
 * batch. Only tiles touched by the batch are rewritten; a zero counter stays
 * explicit so a missing row can always mean "static count still remaining".
 */
export async function syncProgressColorCounters(tx, {
  userId,
  template,
  states,
  now,
} = {}) {
  if (!states?.size) return;
  const paletteLength = template.palette?.length || 0;
  if (paletteLength < 1) return;
  await ensureStaticGuidanceIndex(tx, template);
  const staticTileCounts = new Map();
  for (const stateTile of states.values()) {
    const key = `${stateTile.bounds.tile_x}:${stateTile.bounds.tile_y}`;
    const rows = await tx.all(
      `SELECT color_index, total_count FROM coloring_template_tile_color_counts
        WHERE template_id=? AND tile_x=? AND tile_y=?`,
      [template.id, stateTile.bounds.tile_x, stateTile.bounds.tile_y],
    );
    staticTileCounts.set(key, new Map(rows.map((row) => [Number(row.color_index), Number(row.total_count)])));
  }

  const staticColorRows = await tx.all(
    'SELECT color_index, total_count FROM coloring_template_color_counts WHERE template_id=?',
    [template.id],
  );
  const staticColorTotals = new Map(
    staticColorRows.map((row) => [Number(row.color_index), Number(row.total_count)]),
  );
  const progressColorRows = await tx.all(
    'SELECT color_index, remaining_count FROM coloring_tiled_progress_colors WHERE user_id=? AND template_id=?',
    [userId, template.id],
  );
  const globalBefore = new Map(
    progressColorRows.map((row) => [Number(row.color_index), Number(row.remaining_count)]),
  );
  const globalDelta = new Map();

  for (const stateTile of states.values()) {
    const key = `${stateTile.bounds.tile_x}:${stateTile.bounds.tile_y}`;
    const staticCounts = staticTileCounts.get(key) || new Map();
    const before = unfilledByColor(stateTile.cells, stateTile.previousFilled || stateTile.filled);
    const after = unfilledByColor(stateTile.cells, stateTile.filled);
    const colors = new Set([...before.keys(), ...after.keys(), ...staticCounts.keys()]);
    for (const color of colors) {
      const previous = stateTile.progressTile
        ? (before.get(color) || 0)
        : (staticCounts.get(color) || 0);
      const next = after.get(color) || 0;
      const delta = next - previous;
      globalDelta.set(color, (globalDelta.get(color) || 0) + delta);
      await tx.run(
        `INSERT INTO coloring_tiled_progress_tile_colors
          (user_id,template_id,tile_x,tile_y,color_index,remaining_count,updated_at)
          VALUES (?,?,?,?,?,?,?)
          ON CONFLICT(user_id,template_id,tile_x,tile_y,color_index)
            DO UPDATE SET remaining_count=excluded.remaining_count, updated_at=excluded.updated_at`,
        [userId, template.id, stateTile.bounds.tile_x, stateTile.bounds.tile_y, color, next, now],
      );
    }
  }

  const affectedColors = new Set([
    ...globalDelta.keys(),
    ...globalBefore.keys(),
    ...staticColorTotals.keys(),
  ]);
  for (const color of affectedColors) {
    const previousGlobal = globalBefore.has(color)
      ? globalBefore.get(color)
      : (staticColorTotals.get(color) || 0);
    const nextGlobal = Math.max(0, previousGlobal + (globalDelta.get(color) || 0));
    await tx.run(
      `INSERT INTO coloring_tiled_progress_colors
        (user_id,template_id,color_index,remaining_count,updated_at)
        VALUES (?,?,?,?,?)
        ON CONFLICT(user_id,template_id,color_index)
          DO UPDATE SET remaining_count=excluded.remaining_count, updated_at=excluded.updated_at`,
      [userId, template.id, color, nextGlobal, now],
    );
  }
}

export function tiledProgressPayload(template, row, artworkId = null) {
  const totalCells = Number(template.width) * Number(template.height);
  const completedCells = Math.max(0, Math.min(totalCells, Number(row?.completed_cells || 0)));
  return {
    template_id: template.id,
    storage_mode: TILED_STORAGE_MODE,
    tile_size: Number(template.tile_size || DEFAULT_TILE_SIZE),
    revision: Number(row?.revision || 0),
    completed_cells: completedCells,
    total_cells: totalCells,
    percent: Math.round((completedCells / totalCells) * 100),
    completed_at: row?.completed_at || null,
    artwork_id: artworkId,
  };
}

export async function readTiledTile(db, { template, userId, tileX, tileY, progress = null } = {}) {
  const grid = validateTiledGridDimensions(template.width, template.height, template.tile_size);
  const bounds = getTileBounds({ ...grid, tileX, tileY, tileSize: grid.tile_size });
  const tile = await db.get(
    'SELECT * FROM coloring_template_tiles WHERE template_id=? AND tile_x=? AND tile_y=?',
    [template.id, bounds.tile_x, bounds.tile_y],
  );
  if (!tile) throw new TiledColoringError('Tiled template tile is missing', 'MISSING_TILED_TILE', 500);
  const cells = storedTileCells(tile, bounds.cell_count, `tile ${bounds.tile_x}:${bounds.tile_y}`);
  const progressTile = await db.get(
    `SELECT * FROM coloring_tiled_progress_tiles
      WHERE user_id=? AND template_id=? AND tile_x=? AND tile_y=?`,
    [userId, template.id, bounds.tile_x, bounds.tile_y],
  );
  const filled = storedFilled(progressTile, bounds.cell_count, `progress tile ${bounds.tile_x}:${bounds.tile_y}`);
  const specials = await readTileSpecials(db, {
    templateId: template.id,
    userId,
    tileX: bounds.tile_x,
    tileY: bounds.tile_y,
  });
  return {
    bounds,
    cells,
    filled,
    specials,
    progress,
  };
}

export async function readTiledTemplateTiles(db, { template } = {}) {
  const grid = validateTiledGridDimensions(template.width, template.height, template.tile_size);
  const rows = await db.all(
    `SELECT tile_x, tile_y, width, height, cells_json
      FROM coloring_template_tiles
      WHERE template_id=?
      ORDER BY tile_y, tile_x`,
    [template.id],
  );
  if (rows.length !== grid.tiles_x * grid.tiles_y) {
    throw new TiledColoringError('Tiled template is missing one or more tiles', 'CORRUPT_TILED_TEMPLATE', 500);
  }
  return rows.map((row) => {
    const bounds = getTileBounds({ ...grid, tileX: row.tile_x, tileY: row.tile_y, tileSize: grid.tile_size });
    return {
      tile_x: bounds.tile_x,
      tile_y: bounds.tile_y,
      width: bounds.width,
      height: bounds.height,
      cells: storedTileCells(row, bounds.cell_count, `tile ${bounds.tile_x}:${bounds.tile_y}`),
    };
  });
}

/**
 * Pre-021 fixtures stored every tile as a full tileSize x tileSize block,
 * including partial edge tiles. Special placement only needs the real
 * top-left submatrix for those edge rows, so this reader tolerates that
 * legacy shape instead of treating a 1200x1200 upgrade database as corrupt.
 */
export async function readTiledTemplateTilesForSpecials(db, { template } = {}) {
  const grid = validateTiledGridDimensions(template.width, template.height, template.tile_size);
  const rows = await db.all(
    `SELECT tile_x, tile_y, width, height, cells_json
      FROM coloring_template_tiles
      WHERE template_id=?
      ORDER BY tile_y, tile_x`,
    [template.id],
  );
  if (rows.length !== grid.tiles_x * grid.tiles_y) {
    throw new TiledColoringError('Tiled template is missing one or more tiles', 'CORRUPT_TILED_TEMPLATE', 500);
  }
  return rows.map((row) => {
    const bounds = getTileBounds({ ...grid, tileX: row.tile_x, tileY: row.tile_y, tileSize: grid.tile_size });
    const label = `tile ${bounds.tile_x}:${bounds.tile_y}`;
    const cells = parseJsonArray(row?.cells_json);
    const storedWidth = Number(row?.width || bounds.tile_size);
    const storedHeight = Number(row?.height || bounds.tile_size);
    if (!cells) {
      throw new TiledColoringError(`${label} must contain exactly ${bounds.cell_count} cells`, 'CORRUPT_TILED_TEMPLATE', 500);
    }
    if (cells.length === bounds.cell_count) {
      return {
        tile_x: bounds.tile_x,
        tile_y: bounds.tile_y,
        width: bounds.width,
        height: bounds.height,
        cells,
      };
    }
    if (storedWidth === bounds.tile_size && storedHeight === bounds.tile_size
      && cells.length === bounds.tile_size * bounds.tile_size) {
      const sliced = [];
      for (let y = 0; y < bounds.height; y += 1) {
        sliced.push(...cells.slice(y * storedWidth, y * storedWidth + bounds.width));
      }
      return {
        tile_x: bounds.tile_x,
        tile_y: bounds.tile_y,
        width: bounds.width,
        height: bounds.height,
        cells: sliced,
      };
    }
    throw new TiledColoringError(`${label} must contain exactly ${bounds.cell_count} cells`, 'CORRUPT_TILED_TEMPLATE', 500);
  });
}

const specialGenerationLocks = new Map();

async function withSpecialGenerationLock(templateId, fn) {
  while (specialGenerationLocks.has(templateId)) {
    await specialGenerationLocks.get(templateId);
  }
  let release;
  const lock = new Promise((resolve) => {
    release = resolve;
  });
  specialGenerationLocks.set(templateId, lock);
  try {
    return await fn();
  } finally {
    specialGenerationLocks.delete(templateId);
    release();
  }
}

/**
 * Transactional, idempotent special-cell delivery for tiled templates.
 *
 * This is the single place that materializes special rows for existing tiled
 * templates. Guidance and tile reads call it before they look at specials so
 * a pre-existing 1200x1200 template receives the same deterministic first
 * target as a freshly created one. Existing rows are never moved: rows older
 * than v3 with no special progress are rebuilt to the frozen mixed v3
 * placement, and any existing template missing its separate Hazard row gets
 * exactly one deterministic Hazard backfilled into a tile with metadata room.
 */
export async function ensureTiledSpecialCells(db, template, { diagnostics = null } = {}) {
  if (!isTiledTemplate(template)) {
    return { status: 'skipped', action: 'skipped', special_count: 0, generation_version: 0, elapsed_ms: 0 };
  }
  return withSpecialGenerationLock(template.id, async () => {
    const startedAt = performance.now();
    const result = await ensureTiledSpecialCellsUnlocked(db, template);
    const elapsedMs = Math.round(performance.now() - startedAt);
    const payload = { ...result, elapsed_ms: elapsedMs };
    if (result.action === 'built' || result.action === 'rebuilt' || result.action === 'hazard_backfilled') {
      console.log(
        `[tiled-specials] ${result.action} template=${template.id} count=${result.special_count} version=${result.generation_version} elapsed_ms=${elapsedMs}`,
      );
    }
    if (diagnostics) {
      diagnostics.generation_action = result.action;
      diagnostics.generation_elapsed_ms = elapsedMs;
      diagnostics.generation_count = result.special_count;
      diagnostics.generation_version = result.generation_version;
    }
    return payload;
  });
}

async function ensureTiledSpecialCellsUnlocked(db, template) {
  const grid = validateTiledGridDimensions(template.width, template.height, template.tile_size);
  const summary = await db.get(
    `SELECT COUNT(*) AS count,
            MIN(generation_version) AS min_version,
            SUM(CASE WHEN kind=? THEN 1 ELSE 0 END) AS hazard_count
       FROM coloring_special_cells
      WHERE template_id=?`,
    [HAZARD_KIND, template.id],
  );
  const specialCount = Math.max(0, Number(summary?.count || 0));
  const generationVersion = Number(summary?.min_version || 0);
  const hazardCount = Math.max(0, Number(summary?.hazard_count || 0));

  if (specialCount > 0 && hazardCount > 0
    && generationVersion >= SPECIAL_GAMEPLAY_GENERATION_VERSION) {
    return {
      status: 'ready',
      action: 'ready',
      special_count: specialCount,
      generation_version: generationVersion,
    };
  }

  const tiles = await readTiledTemplateTilesForSpecials(db, { template });
  const tileCells = tiles.map((tile) => ({
    tile_x: tile.tile_x,
    tile_y: tile.tile_y,
    cells: tile.cells,
  }));

  const generateAndPersist = async ({ occupiedIndices }) => {
    const generated = generateSpecialCells({
      templateId: template.id,
      width: grid.width,
      height: grid.height,
      tileSize: grid.tile_size,
      tiles: tileCells,
    });
    const hazard = generateHazardCells({
      templateId: template.id,
      width: grid.width,
      height: grid.height,
      tileSize: grid.tile_size,
      tiles: tileCells,
      occupiedIndices: occupiedIndices || generated.map((cell) => cell.cell_index),
    });
    await persistSparkCells(db, { templateId: template.id, cells: generated });
    await persistHazardCells(db, { templateId: template.id, cells: hazard });
    return {
      special_count: generated.length + hazard.length,
      generation_version: SPECIAL_GAMEPLAY_GENERATION_VERSION,
    };
  };

  if (specialCount === 0) {
    const built = await generateAndPersist({});
    return { status: 'built', action: 'built', ...built };
  }

  // Older shared rows with no special progress are rebuilt onto the current
  // deterministic kind mix. Coordinates remain generated by the same placer;
  // rows with any user state are grandfathered so an offered/consumed event
  // never changes kind underneath the player.
  if (generationVersion < SPECIAL_GAMEPLAY_GENERATION_VERSION) {
    const progressSummary = await db.get(
      'SELECT COUNT(*) AS count FROM coloring_special_progress WHERE template_id=?',
      [template.id],
    );
    if (Number(progressSummary?.count || 0) === 0) {
      await db.run('DELETE FROM coloring_special_cells WHERE template_id=?', [template.id]);
      const rebuilt = await generateAndPersist({});
      return { status: 'rebuilt', action: 'rebuilt', ...rebuilt };
    }
    if (hazardCount > 0) {
      return {
        status: 'preserved',
        action: 'preserved',
        special_count: specialCount,
        generation_version: generationVersion,
      };
    }
  }

  const existingRows = await db.all(
    'SELECT cell_index FROM coloring_special_cells WHERE template_id=?',
    [template.id],
  );
  const hazard = generateHazardCells({
    templateId: template.id,
    width: grid.width,
    height: grid.height,
    tileSize: grid.tile_size,
    tiles: tileCells,
    occupiedIndices: existingRows.map((row) => Number(row.cell_index)),
  });
  if (hazard.length) {
    await persistHazardCells(db, { templateId: template.id, cells: hazard });
  }
  const after = await db.get(
    'SELECT COUNT(*) AS count, MIN(generation_version) AS min_version FROM coloring_special_cells WHERE template_id=?',
    [template.id],
  );
  return {
    status: hazard.length ? 'hazard_backfilled' : 'hazard_unavailable',
    action: hazard.length ? 'hazard_backfilled' : 'hazard_unavailable',
    special_count: Math.max(0, Number(after?.count || 0)),
    generation_version: Number(after?.min_version || 0),
    hazard_added: hazard.length,
  };
}

export function tiledTilePayload({ template, tile, progress }) {
  const { bounds } = tile;
  return {
    schema_version: 1,
    template_id: template.id,
    storage_mode: TILED_STORAGE_MODE,
    content_revision: template.updated_at || null,
    tile: {
      x: bounds.tile_x,
      y: bounds.tile_y,
      offset_x: bounds.offset_x,
      offset_y: bounds.offset_y,
      width: bounds.width,
      height: bounds.height,
      cell_count: bounds.cell_count,
      tile_size: bounds.tile_size,
      tiles_x: bounds.tiles_x,
      tiles_y: bounds.tiles_y,
    },
    encoding: 'row-major-palette-index',
    cells: tile.cells,
    filled: tile.filled,
    specials: tile.specials || [],
    progress,
    links: {
      manifest: `/colorings/${encodeURIComponent(String(template.id))}/manifest`,
      progress_actions: `/colorings/${encodeURIComponent(String(template.id))}/progress/actions`,
    },
  };
}

/**
 * Apply a bounded action to only the affected tile rows. Completion is
 * derived from the aggregate counter; no 1200×1200 filled array is built.
 */
export async function applyTiledChanges(tx, {
  userId,
  template,
  existingProgress,
  changes,
  maxChanges = TILED_MAX_CHANGES,
} = {}) {
  const validated = validateTiledChanges(changes, {
    width: template.width,
    height: template.height,
    tileSize: template.tile_size,
    paletteLength: template.palette.length,
    maxChanges,
  });
  const states = new Map();

  for (const change of validated.changes) {
    const key = `${change.tile_x}:${change.tile_y}`;
    if (states.has(key)) continue;
    const bounds = getTileBounds({
      ...validated.grid,
      tileX: change.tile_x,
      tileY: change.tile_y,
      tileSize: validated.grid.tile_size,
    });
    const tile = await tx.get(
      'SELECT * FROM coloring_template_tiles WHERE template_id=? AND tile_x=? AND tile_y=?',
      [template.id, bounds.tile_x, bounds.tile_y],
    );
    if (!tile) throw new TiledColoringError('Tiled template tile is missing', 'MISSING_TILED_TILE', 500);
    const cells = storedTileCells(tile, bounds.cell_count, `tile ${key}`);
    const progressTile = await tx.get(
      `SELECT * FROM coloring_tiled_progress_tiles
        WHERE user_id=? AND template_id=? AND tile_x=? AND tile_y=?`,
      [userId, template.id, bounds.tile_x, bounds.tile_y],
    );
    const filled = storedFilled(progressTile, bounds.cell_count, `progress tile ${key}`);
    states.set(key, { bounds, cells, progressTile, filled, previousFilled: [...filled], delta: 0 });
  }

  const newlyCorrectIndices = [];
  for (const change of validated.changes) {
    const state = states.get(`${change.tile_x}:${change.tile_y}`);
    const current = state.filled[change.local_index];
    const target = state.cells[change.local_index];
    if (current !== -1 && current !== target) {
      throw new TiledColoringError('Tiled progress contains an invalid color', 'CORRUPT_TILED_PROGRESS', 500);
    }
    if (change.color !== -1 && change.color !== target) {
      throw new TiledColoringError('Server rejected a color that does not match the tile', 'INVALID_COLOR_FOR_CELL', 400);
    }
    if (current !== target && change.color === target) {
      state.delta += 1;
      newlyCorrectIndices.push(change.index);
    } else if (current === target && change.color === -1) {
      state.delta -= 1;
    }
    state.filled[change.local_index] = change.color;
  }

  const totalCells = validated.grid.totalCells;
  const previousCompletedCells = Math.max(0, Math.min(totalCells, Number(existingProgress?.completed_cells || 0)));
  const completedCells = previousCompletedCells + [...states.values()].reduce((sum, state) => sum + state.delta, 0);
  if (completedCells < 0 || completedCells > totalCells) {
    throw new TiledColoringError('Tiled progress aggregate is inconsistent', 'CORRUPT_TILED_PROGRESS', 500);
  }
  const completed = completedCells === totalCells;
  const justCompleted = completed && !existingProgress?.completed_at;
  return {
    grid: validated.grid,
    changes: validated.changes,
    states,
    newlyCorrectIndices,
    previousCompletedCells,
    completedCells,
    completed,
    justCompleted,
    painted: validated.changes.some((change) => change.color !== -1),
  };
}

export async function persistTiledChanges(tx, {
  userId,
  template,
  existingProgress,
  clientRevision,
  now,
  state,
} = {}) {
  const completedAt = state.completed
    ? (existingProgress?.completed_at || now)
    : null;
  const nextRevision = clientRevision + 1;
  if (existingProgress) {
    const updated = await tx.run(
      `UPDATE coloring_tiled_progress
        SET revision=?, completed_cells=?, completed_at=?, updated_at=?
        WHERE user_id=? AND template_id=? AND revision=?`,
      [nextRevision, state.completedCells, completedAt, now, userId, template.id, clientRevision],
    );
    if (!updated.changes) return { conflict: true };
  } else {
    const inserted = await tx.run(
      `INSERT INTO coloring_tiled_progress
        (user_id,template_id,revision,completed_cells,completed_at,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?)
        ON CONFLICT (user_id,template_id) DO NOTHING`,
      [userId, template.id, nextRevision, state.completedCells, completedAt, now, now],
    );
    if (!inserted.changes) return { conflict: true };
  }

  for (const stateTile of state.states.values()) {
    const { bounds, filled } = stateTile;
    const tileCompletedCells = filled.reduce((count, color, index) => count + (color === stateTile.cells[index] ? 1 : 0), 0);
    const allEmpty = filled.every((color) => color === -1);
    if (allEmpty) {
      await tx.run(
        `DELETE FROM coloring_tiled_progress_tiles
          WHERE user_id=? AND template_id=? AND tile_x=? AND tile_y=?`,
        [userId, template.id, bounds.tile_x, bounds.tile_y],
      );
      continue;
    }
    await tx.run(
      `INSERT INTO coloring_tiled_progress_tiles
        (user_id,template_id,tile_x,tile_y,width,height,filled_json,completed_cells,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT (user_id,template_id,tile_x,tile_y) DO UPDATE SET
          width=excluded.width, height=excluded.height, filled_json=excluded.filled_json,
          completed_cells=excluded.completed_cells, updated_at=excluded.updated_at`,
      [userId, template.id, bounds.tile_x, bounds.tile_y, bounds.width, bounds.height, JSON.stringify(filled), tileCompletedCells, now, now],
    );
  }
  await syncProgressColorCounters(tx, {
    userId,
    template,
    states: state.states,
    now,
  });
  return { conflict: false, revision: nextRevision, completedAt };
}

export async function insertTiledTemplate(tx, {
  id,
  ownerId,
  title,
  description,
  width,
  height,
  palette,
  previewUrl = null,
  originalMediaKey = null,
  category = 'custom',
  difficulty = 'custom',
  visibility = 'private',
  status = 'active',
  createdAt,
  updatedAt,
  tileSize = DEFAULT_TILE_SIZE,
  tiles,
} = {}) {
  const validated = validateTiledTemplateInput({ width, height, palette, tiles, tileSize });
  await tx.run(`INSERT INTO coloring_templates
    (id,owner_id,title,description,category,difficulty,width,height,palette_json,cells_json,preview_url,original_media_key,source_type,visibility,status,created_at,updated_at,storage_mode,tile_size)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  [id, ownerId, title, description, category, difficulty, validated.grid.width, validated.grid.height,
    JSON.stringify(palette), JSON.stringify([]), previewUrl, originalMediaKey, 'user', visibility, status,
    createdAt, updatedAt, TILED_STORAGE_MODE, validated.grid.tile_size]);

  for (const tile of validated.tiles) {
    await tx.run(`INSERT INTO coloring_template_tiles
      (template_id,tile_x,tile_y,width,height,cells_json,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?)`,
    [id, tile.tile_x, tile.tile_y, tile.width, tile.height, JSON.stringify(tile.cells), createdAt, updatedAt]);
  }
  await persistStaticGuidanceCounts(tx, {
    templateId: id,
    tiles: validated.tiles,
    paletteLength: palette.length,
    now: updatedAt,
  });
  const generated = generateSpecialCells({
    templateId: id,
    width: validated.grid.width,
    height: validated.grid.height,
    tileSize: validated.grid.tile_size,
    tiles: validated.tiles,
  });
  await persistSparkCells(tx, { templateId: id, cells: generated });
  await persistHazardCells(tx, {
    templateId: id,
    cells: generateHazardCells({
      templateId: id,
      width: validated.grid.width,
      height: validated.grid.height,
      tileSize: validated.grid.tile_size,
      tiles: validated.tiles,
      occupiedIndices: generated.map((cell) => cell.cell_index),
    }),
  });
  return { grid: validated.grid, tileCount: validated.tiles.length };
}

export function isTiledColoringError(error) {
  return error instanceof TiledColoringError;
}

export { TiledColoringError };
