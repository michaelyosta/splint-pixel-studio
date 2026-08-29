/**
 * Server-authoritative global guidance for the tiled player.
 *
 * The planner never materializes the full grid. It reads compact per-color
 * totals, bounded per-tile/per-color counters, and at most one actual tile
 * (1024 cells) to build a small actionable window. Guidance is a derived
 * hint: progress and rewards stay authoritative through the existing
 * progress/actions contract, and every plan carries the progress revision
 * it was computed against.
 */

import {
  DEFAULT_TILE_SIZE,
  getTileGrid,
} from './coloring-chunks.js';
import {
  SPARK_PITY_INTERVAL_CELLS,
  describeSpecialTargetEffort,
  isSparkTreatmentUser,
  isSessionGameTargetEligible,
  isSpecialTargetEligible,
  summarizeSpecialEffort,
} from './tiled-specials.js';
import { ensureTiledSpecialCells, readTiledTile } from './tiled-coloring.js';

export const GUIDANCE_SCHEMA_VERSION = 1;
export const ACTIONABLE_WINDOW_SIZE = 12;
export const GUIDANCE_MAX_RECENT = 8;
export const SPECIAL_TARGET_SCAN_LIMIT = 16;

export const GUIDANCE_REASON = Object.freeze({
  INITIAL_TARGET: 'INITIAL_TARGET',
  SAME_COLOR_NEXT: 'SAME_COLOR_NEXT',
  COLOR_COMPLETE: 'COLOR_COMPLETE',
  MANUAL_COLOR: 'MANUAL_COLOR',
  RETURN_TO_TARGET: 'RETURN_TO_TARGET',
  SPECIAL_TARGETS: 'SPECIAL_TARGETS',
  ARTWORK_COMPLETE: 'ARTWORK_COMPLETE',
  NO_ACTIONABLE_CELLS: 'NO_ACTIONABLE_CELLS',
});

class TiledGuidanceError extends Error {
  constructor(message, code, status = 400) {
    super(message);
    this.name = 'TiledGuidanceError';
    this.code = code;
    this.status = status;
  }
}

function asSafeInteger(value, code, label) {
  const numeric = typeof value === 'string' && /^-?\d+$/.test(value) ? Number(value) : value;
  if (!Number.isSafeInteger(numeric)) {
    throw new TiledGuidanceError(`${label} must be a safe integer`, code, 400);
  }
  return numeric;
}

function parseColor(value, paletteLength) {
  const color = asSafeInteger(value, 'INVALID_SELECTED_COLOR', 'selected_color');
  if (color < 0 || color >= paletteLength) {
    throw new TiledGuidanceError('selected_color is outside the palette', 'INVALID_SELECTED_COLOR', 400);
  }
  return color;
}

export function parseRecentTiles(value) {
  if (value === undefined || value === null || value === '') return [];
  const raw = Array.isArray(value) ? value : String(value).split(',');
  const seen = new Set();
  const result = [];
  for (const entry of raw) {
    const match = String(entry).match(/^(\d+):(\d+)$/);
    if (!match) continue;
    const key = `${Number(match[1])}:${Number(match[2])}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(key);
    if (result.length >= GUIDANCE_MAX_RECENT) break;
  }
  return result;
}

/**
 * Build compact static counts from validated tiled template tiles.
 * Pure and testable: no database access, no full-grid arrays.
 */
export function buildStaticGuidanceCounts(tiles, paletteLength) {
  const colorTotals = new Map();
  const tileTotals = new Map();
  for (const tile of tiles || []) {
    const counts = new Map();
    for (let localIndex = 0; localIndex < tile.cells.length; localIndex += 1) {
      const color = tile.cells[localIndex];
      if (!Number.isInteger(color) || color < 0 || color >= paletteLength) continue;
      counts.set(color, (counts.get(color) || 0) + 1);
    }
    for (const [color, count] of counts) {
      colorTotals.set(color, (colorTotals.get(color) || 0) + count);
    }
    if (counts.size) {
      tileTotals.set(`${tile.tile_x}:${tile.tile_y}`, counts);
    }
  }
  return { colorTotals, tileTotals };
}

/**
 * Count remaining (unfilled target-color) cells per color for one tile.
 */
export function tileRemainingByColor(cells, filled) {
  const counts = new Map();
  for (let index = 0; index < cells.length; index += 1) {
    if (filled[index] !== -1) continue;
    const color = cells[index];
    counts.set(color, (counts.get(color) || 0) + 1);
  }
  return counts;
}

/**
 * Choose a compact window inside one tile. The returned anchor is always an
 * unfilled cell of the requested color, and the bounds stay within the tile,
 * so the client can paint immediately after the camera lands.
 */
export function chooseActionableWindow({
  cells,
  filled,
  width,
  height,
  colorIndex,
  offsetX = 0,
  offsetY = 0,
  cameraCenterX = 0,
  cameraCenterY = 0,
  windowSize = ACTIONABLE_WINDOW_SIZE,
} = {}) {
  if (!cells || !filled || width <= 0 || height <= 0) return null;
  const size = Math.max(1, Math.floor(Number(windowSize) || ACTIONABLE_WINDOW_SIZE));
  const candidates = [];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      if (filled[index] !== -1 || cells[index] !== colorIndex) continue;
      const minX = Math.max(0, x - Math.floor(size / 2));
      const minY = Math.max(0, y - Math.floor(size / 2));
      const maxX = Math.min(width - 1, minX + size - 1);
      const maxY = Math.min(height - 1, minY + size - 1);
      let count = 0;
      for (let wy = minY; wy <= maxY; wy += 1) {
        for (let wx = minX; wx <= maxX; wx += 1) {
          const windowIndex = wy * width + wx;
          if (filled[windowIndex] === -1 && cells[windowIndex] === colorIndex) count += 1;
        }
      }
      const anchorX = offsetX + x;
      const anchorY = offsetY + y;
      const distance = Math.hypot(anchorX - cameraCenterX, anchorY - cameraCenterY);
      candidates.push({
        count,
        distance,
        anchorX,
        anchorY,
        minX: offsetX + minX,
        minY: offsetY + minY,
        maxX: offsetX + maxX,
        maxY: offsetY + maxY,
      });
    }
  }
  if (!candidates.length) return null;
  candidates.sort((first, second) => (
    second.count - first.count
    || first.distance - second.distance
    || first.anchorY - second.anchorY
    || first.anchorX - second.anchorX
  ));
  const best = candidates[0];
  return {
    anchor_x: best.anchorX,
    anchor_y: best.anchorY,
    bounds: {
      min_x: best.minX,
      min_y: best.minY,
      max_x: best.maxX,
      max_y: best.maxY,
      width: best.maxX - best.minX + 1,
      height: best.maxY - best.minY + 1,
    },
    estimated_cells: best.count,
  };
}

export async function persistStaticGuidanceCounts(tx, {
  templateId,
  tiles,
  paletteLength,
  now: _now,
} = {}) {
  const { colorTotals, tileTotals } = buildStaticGuidanceCounts(tiles, paletteLength);
  const colorRows = [];
  for (const [color, total] of colorTotals) {
    colorRows.push([templateId, color, total]);
  }
  const tileRows = [];
  for (const [key, counts] of tileTotals) {
    const [tileX, tileY] = key.split(':').map(Number);
    for (const [color, total] of counts) {
      tileRows.push([templateId, tileX, tileY, color, total]);
    }
  }
  // Batched multi-row upserts: a 1200x1200 template has up to ~8.7k
  // (tile,color) rows; one statement per row is pathological on SQLite
  // (full-database persist per write) and slow on Postgres (round trips).
  await runChunkedUpsert(tx, {
    table: 'coloring_template_color_counts',
    columns: ['template_id', 'color_index', 'total_count'],
    conflictColumns: ['template_id', 'color_index'],
    assignments: ['total_count=excluded.total_count'],
    rows: colorRows,
  });
  await runChunkedUpsert(tx, {
    table: 'coloring_template_tile_color_counts',
    columns: ['template_id', 'tile_x', 'tile_y', 'color_index', 'total_count'],
    conflictColumns: ['template_id', 'tile_x', 'tile_y', 'color_index'],
    assignments: ['total_count=excluded.total_count'],
    rows: tileRows,
  });
  return { colors: colorTotals.size, tiles: tileTotals.size };
}

const UPSERT_CHUNK_SIZE = 250;

async function runChunkedUpsert(db, {
  table,
  columns,
  conflictColumns,
  assignments,
  rows,
} = {}) {
  if (!rows.length) return;
  for (let offset = 0; offset < rows.length; offset += UPSERT_CHUNK_SIZE) {
    const chunk = rows.slice(offset, offset + UPSERT_CHUNK_SIZE);
    const placeholders = chunk.map(() => `(${columns.map(() => '?').join(',')})`).join(',');
    const sql = `INSERT INTO ${table} (${columns.join(',')}) VALUES ${placeholders}
      ON CONFLICT(${conflictColumns.join(',')}) DO UPDATE SET ${assignments.join(', ')}`;
    await db.run(sql, chunk.flat());
  }
}

/**
 * Ensure the static guidance index exists for one tiled template.
 *
 * The index is a derived cache over `coloring_template_tiles`. Templates
 * created before migration 021 have no rows; templates whose build was
 * interrupted could have partial rows. Completion is tracked by an explicit
 * marker (`coloring_template_guidance_index_meta`) so a partial index is
 * always repaired (delete + rebuild) instead of being mistaken for a complete
 * one. The rebuild is bounded to a single template and must run inside a
 * transaction (never call this with the raw scheduled db adapter from a
 * latency-critical request — the caller wraps it in `withDbTransaction`).
 *
 * Returns:
 *   { status: 'ready', colors, tiles }  — marker exists
 *   { status: 'built', colors, tiles }  — rebuilt just now
 *   { status: 'missing' }               — template has no tiles (corrupt);
 *                                         planner must report an explicit
 *                                         diagnostic instead of pretending
 *                                         there is no work left.
 */
export async function ensureStaticGuidanceIndex(db, template) {
  const meta = await db.get?.(
    'SELECT template_id, colors, tiles FROM coloring_template_guidance_index_meta WHERE template_id=?',
    [template.id],
  );
  if (meta) {
    return { status: 'ready', colors: Number(meta.colors), tiles: Number(meta.tiles) };
  }
  const rows = await db.all(
    `SELECT tile_x, tile_y, width, height, cells_json
      FROM coloring_template_tiles WHERE template_id=? ORDER BY tile_y, tile_x`,
    [template.id],
  );
  if (!rows.length) return { status: 'missing' };
  const tiles = rows.map((row) => ({
    tile_x: Number(row.tile_x),
    tile_y: Number(row.tile_y),
    cells: parseJsonArray(row.cells_json) || [],
  }));
  // Remove any partial rows left by an interrupted earlier build.
  await db.run('DELETE FROM coloring_template_tile_color_counts WHERE template_id=?', [template.id]);
  await db.run('DELETE FROM coloring_template_color_counts WHERE template_id=?', [template.id]);
  const built = await persistStaticGuidanceCounts(db, {
    templateId: template.id,
    tiles,
    paletteLength: template.palette.length,
    now: new Date().toISOString(),
  });
  await db.run(
    `INSERT INTO coloring_template_guidance_index_meta (template_id, colors, tiles, built_at)
      VALUES (?,?,?,?)
      ON CONFLICT(template_id) DO UPDATE SET
        colors=excluded.colors, tiles=excluded.tiles, built_at=excluded.built_at`,
    [template.id, built.colors, built.tiles, new Date().toISOString()],
  );
  return { status: 'built', colors: built.colors, tiles: built.tiles };
}

function parseJsonArray(value) {
  if (Array.isArray(value)) return value;
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

async function ensureProgressGuidanceCounters(db, { userId, template }) {
  const rows = await db.all(
    'SELECT color_index FROM coloring_tiled_progress_colors WHERE user_id=? AND template_id=? LIMIT 1',
    [userId, template.id],
  );
  if (rows.length) return;
  const progressTiles = await db.all(
    `SELECT tile_x, tile_y, width, height, filled_json
      FROM coloring_tiled_progress_tiles WHERE user_id=? AND template_id=?`,
    [userId, template.id],
  );
  if (!progressTiles.length) return;

  const templateTileRows = await db.all(
    `SELECT tile_x, tile_y, cells_json
      FROM coloring_template_tiles WHERE template_id=? ORDER BY tile_y, tile_x`,
    [template.id],
  );
  const cellsByKey = new Map();
  for (const row of templateTileRows) {
    cellsByKey.set(`${row.tile_x}:${row.tile_y}`, parseJsonArray(row.cells_json) || []);
  }
  const filledByKey = new Map();
  for (const progressTile of progressTiles) {
    filledByKey.set(`${progressTile.tile_x}:${progressTile.tile_y}`, parseJsonArray(progressTile.filled_json) || []);
  }
  const staticColorRows = await db.all(
    'SELECT color_index, total_count FROM coloring_template_color_counts WHERE template_id=?',
    [template.id],
  );
  const staticColorTotals = new Map(
    staticColorRows.map((row) => [Number(row.color_index), Number(row.total_count)]),
  );
  const staticTileRows = await db.all(
    'SELECT tile_x, tile_y, color_index, total_count FROM coloring_template_tile_color_counts WHERE template_id=?',
    [template.id],
  );
  const staticTileTotals = new Map(
    staticTileRows.map((row) => [
      `${row.tile_x}:${row.tile_y}:${row.color_index}`,
      Number(row.total_count),
    ]),
  );
  const colorRemaining = new Map();
  const tileColorRemaining = new Map();
  const paintedByColor = new Map();
  for (const [key, filled] of filledByKey) {
    const cells = cellsByKey.get(key);
    if (!cells) continue;
    const counts = tileRemainingByColor(cells, filled);
    // Iterate every color present in the tile, not only colors with remaining
    // cells: a fully painted color must still subtract its painted cells from
    // the global total. The old loop dropped fully painted colors, which
    // overstated global remaining and let a completed tile look "fully
    // remaining" again.
    const colorsInTile = new Set(counts.keys());
    for (let index = 0; index < cells.length; index += 1) {
      const color = cells[index];
      if (Number.isInteger(color) && color >= 0) colorsInTile.add(color);
    }
    for (const color of colorsInTile) {
      const remaining = counts.get(color) || 0;
      const staticTotal = staticTileTotals.get(`${key}:${color}`) ?? remaining;
      tileColorRemaining.set(`${key}:${color}`, remaining);
      paintedByColor.set(color, (paintedByColor.get(color) || 0) + Math.max(0, staticTotal - remaining));
    }
  }

  const now = new Date().toISOString();
  for (const [color, staticTotal] of staticColorTotals) {
    const remaining = Math.max(0, staticTotal - (paintedByColor.get(color) || 0));
    colorRemaining.set(color, remaining);
    await db.run(
      `INSERT INTO coloring_tiled_progress_colors
        (user_id,template_id,color_index,remaining_count,updated_at)
        VALUES (?,?,?,?,?)
        ON CONFLICT(user_id,template_id,color_index)
          DO UPDATE SET remaining_count=excluded.remaining_count, updated_at=excluded.updated_at`,
      [userId, template.id, color, remaining, now],
    );
  }
  for (const [key, remaining] of tileColorRemaining) {
    const [tileX, tileY, color] = key.split(':');
    await db.run(
      `INSERT INTO coloring_tiled_progress_tile_colors
        (user_id,template_id,tile_x,tile_y,color_index,remaining_count,updated_at)
        VALUES (?,?,?,?,?,?,?)
        ON CONFLICT(user_id,template_id,tile_x,tile_y,color_index)
          DO UPDATE SET remaining_count=excluded.remaining_count, updated_at=excluded.updated_at`,
      [userId, template.id, Number(tileX), Number(tileY), Number(color), remaining, now],
    );
  }
}

async function readColorTotals(db, { userId, template }) {
  const index = await ensureStaticGuidanceIndex(db, template);
  if (index.status === 'missing') {
    // A tiled template with no tiles is corrupt or not yet imported. The
    // planner must report an explicit diagnostic instead of pretending the
    // artwork has no remaining work.
    throw new TiledGuidanceError(
      'Static guidance index is missing for this template',
      'GUIDANCE_INDEX_MISSING',
      503,
    );
  }
  await ensureProgressGuidanceCounters(db, { userId, template });
  const staticRows = await db.all(
    'SELECT color_index, total_count FROM coloring_template_color_counts WHERE template_id=? ORDER BY color_index',
    [template.id],
  );
  const totals = new Map(staticRows.map((row) => [Number(row.color_index), Number(row.total_count)]));
  const progressRows = await db.all(
    'SELECT color_index, remaining_count FROM coloring_tiled_progress_colors WHERE user_id=? AND template_id=? ORDER BY color_index',
    [userId, template.id],
  );
  for (const row of progressRows) {
    totals.set(Number(row.color_index), Number(row.remaining_count));
  }
  return totals;
}

async function findTileCandidates(db, { userId, template, colorIndex, recentKeys }) {
  const rows = await db.all(
    `SELECT tile_x, tile_y, remaining FROM (
      SELECT p.tile_x, p.tile_y, p.remaining_count AS remaining
      FROM coloring_tiled_progress_tile_colors p
      WHERE p.user_id=? AND p.template_id=? AND p.color_index=? AND p.remaining_count>0
      UNION
      SELECT s.tile_x, s.tile_y, s.total_count AS remaining
      FROM coloring_template_tile_color_counts s
      WHERE s.template_id=? AND s.color_index=? AND s.total_count>0
        AND NOT EXISTS (
          SELECT 1 FROM coloring_tiled_progress_tile_colors p2
          WHERE p2.user_id=? AND p2.template_id=? AND p2.tile_x=s.tile_x
            AND p2.tile_y=s.tile_y AND p2.color_index=s.color_index AND p2.remaining_count>0
        )
    ) ORDER BY tile_y, tile_x`,
    [userId, template.id, colorIndex, template.id, colorIndex, userId, template.id],
  );
  const blocked = new Set(recentKeys || []);
  return rows
    .map((row) => ({
      tileX: Number(row.tile_x),
      tileY: Number(row.tile_y),
      key: `${row.tile_x}:${row.tile_y}`,
      remaining: Number(row.remaining),
    }))
    .filter((candidate) => !blocked.has(candidate.key));
}

function scoreCandidates(candidates, cameraCenter, previousKey, tileSize = 32) {
  const center = cameraCenter || { x: 0, y: 0 };
  const size = Math.max(1, Number(tileSize) || 32);
  return candidates.map((candidate) => {
    const tileCenterX = candidate.tileX * size + size / 2;
    const tileCenterY = candidate.tileY * size + size / 2;
    const distance = Math.hypot(tileCenterX - center.x, tileCenterY - center.y);
    let score = -distance;
    score += Math.min(candidate.remaining, 512) * 0.05;
    if (previousKey && candidate.key === previousKey) score += 2;
    return { ...candidate, score, distance };
  }).sort((first, second) => second.score - first.score);
}

async function targetForTile(db, {
  userId,
  template,
  colorIndex,
  tileX,
  tileY,
  cameraCenter,
  progress,
}) {
  const tile = await readTiledTile(db, {
    template,
    userId,
    tileX,
    tileY,
    progress,
  });
  const windowTarget = chooseActionableWindow({
    cells: tile.cells,
    filled: tile.filled,
    width: tile.bounds.width,
    height: tile.bounds.height,
    colorIndex,
    offsetX: tile.bounds.offset_x,
    offsetY: tile.bounds.offset_y,
    cameraCenterX: cameraCenter?.x,
    cameraCenterY: cameraCenter?.y,
  });
  if (!windowTarget) return null;
  windowTarget.tile_x = tile.bounds.tile_x;
  windowTarget.tile_y = tile.bounds.tile_y;
  return windowTarget;
}

export function targetForSpecialCell(tile, special) {
  const localX = Number(special.local_index) % tile.bounds.width;
  const localY = Math.floor(Number(special.local_index) / tile.bounds.width);
  const minLocalX = Math.max(0, localX - 6);
  const minLocalY = Math.max(0, localY - 6);
  const maxLocalX = Math.min(tile.bounds.width - 1, minLocalX + 11);
  const maxLocalY = Math.min(tile.bounds.height - 1, minLocalY + 11);
  const color = Number(tile.cells[special.local_index]);
  let estimatedCells = 0;
  for (let y = minLocalY; y <= maxLocalY; y += 1) {
    for (let x = minLocalX; x <= maxLocalX; x += 1) {
      const index = y * tile.bounds.width + x;
      if (tile.filled[index] === -1 && tile.cells[index] === color) estimatedCells += 1;
    }
  }
  return {
    tile_x: tile.bounds.tile_x,
    tile_y: tile.bounds.tile_y,
    color,
    anchor_x: tile.bounds.offset_x + localX,
    anchor_y: tile.bounds.offset_y + localY,
    bounds: {
      min_x: tile.bounds.offset_x + minLocalX,
      min_y: tile.bounds.offset_y + minLocalY,
      max_x: tile.bounds.offset_x + maxLocalX,
      max_y: tile.bounds.offset_y + maxLocalY,
      width: maxLocalX - minLocalX + 1,
      height: maxLocalY - minLocalY + 1,
    },
    estimated_cells: estimatedCells,
  };
}

async function findPitySpark(db, {
  userId,
  template,
  progress,
  earlyEligible = false,
} = {}) {
  const completedCells = Number(progress?.completed_cells || 0);
  const events = await db.get(
    `SELECT COUNT(*) AS count,
            SUM(CASE WHEN status='offered' THEN 1 ELSE 0 END) AS offered_count
       FROM coloring_special_progress p
       JOIN coloring_special_cells c
         ON c.template_id=p.template_id AND c.special_id=p.special_id
      WHERE p.user_id=? AND p.template_id=? AND c.kind='spark'
        AND p.status IN ('offered','consumed','skipped')`,
    [userId, template.id],
  );
  const offeredCount = Number(events?.offered_count || 0);
  const eventCount = Math.max(0, Number(events?.count || 0) - offeredCount);
  // Keep the first-event guarantee across reloads and sessions where the
  // player painted elsewhere before reaching the deterministic early Spark.
  // Filled and already handled candidates are filtered below, so this does
  // not resurrect a consumed event or point at an already-painted cell.
  const earlyDue = earlyEligible && eventCount === 0 && offeredCount === 0 && !progress?.completed_at;
  const intervalDue = completedCells >= (eventCount + 1) * SPARK_PITY_INTERVAL_CELLS;
  if (offeredCount > 0 || (!earlyDue && !intervalDue)) return null;

  const candidates = await db.all(`
    SELECT c.*
      FROM coloring_special_cells c
      LEFT JOIN coloring_special_progress p
        ON p.user_id=? AND p.template_id=c.template_id AND p.special_id=c.special_id
     WHERE c.template_id=? AND c.kind='spark'
       AND (p.status IS NULL OR p.status='unseen')
     ORDER BY CASE WHEN c.special_id LIKE 'sc_early_%' THEN 0 ELSE 1 END,
              c.cell_index`,
  [userId, template.id]);
  for (const special of candidates) {
    const tile = await readTiledTile(db, {
      template,
      userId,
      tileX: Number(special.tile_x),
      tileY: Number(special.tile_y),
    });
    if (tile.filled[Number(special.local_index)] !== -1) continue;
    const target = targetForSpecialCell(tile, special);
    if (!isSpecialTargetEligible(target)) continue;
    return {
      specialId: String(special.special_id),
      target,
    };
  }
  return null;
}

async function resolveTarget(db, {
  userId,
  template,
  colorIndex,
  cameraCenter,
  recentKeys,
  preferredTileKey = null,
  progress,
}) {
  if (preferredTileKey) {
    const [tileX, tileY] = preferredTileKey.split(':').map(Number);
    const preferred = await targetForTile(db, {
      userId,
      template,
      colorIndex,
      tileX,
      tileY,
      cameraCenter,
      progress,
    });
    if (preferred) return { target: preferred, tileKey: preferredTileKey };
  }
  const candidates = await findTileCandidates(db, { userId, template, colorIndex, recentKeys });
  const ranked = scoreCandidates(candidates, cameraCenter, preferredTileKey, template.tile_size);
  for (const candidate of ranked) {
    const target = await targetForTile(db, {
      userId,
      template,
      colorIndex,
      tileX: candidate.tileX,
      tileY: candidate.tileY,
      cameraCenter,
      progress,
    });
    if (target) return { target, tileKey: candidate.key };
  }
  return null;
}

async function resolveTargets(db, options) {
  const {
    userId, template, colorIndex, cameraCenter, recentKeys, progress, limit = 1,
    sessionGame = false,
  } = options;
  const candidates = await findTileCandidates(db, { userId, template, colorIndex, recentKeys });
  const ranked = scoreCandidates(candidates, cameraCenter, null, template.tile_size)
    .sort((first, second) => second.remaining - first.remaining
      || second.score - first.score
      || first.tileY - second.tileY
      || first.tileX - second.tileX);
  const targets = [];
  const seenTiles = new Set();
  for (const candidate of ranked.slice(0, SPECIAL_TARGET_SCAN_LIMIT)) {
    if (seenTiles.has(candidate.key)) continue;
    const target = await targetForTile(db, {
      userId,
      template,
      colorIndex,
      tileX: candidate.tileX,
      tileY: candidate.tileY,
      cameraCenter,
      progress,
    });
    if (!isSpecialTargetEligible(target)) continue;
    seenTiles.add(candidate.key);
    targets.push({ ...target, color: colorIndex });
  }
  const effortAwareTargets = sessionGame
    ? targets.filter((target) => isSessionGameTargetEligible(target, targets))
    : targets;
  return effortAwareTargets
    .sort((first, second) => second.estimated_cells - first.estimated_cells
      || first.tile_y - second.tile_y
      || first.tile_x - second.tile_x
      || first.anchor_y - second.anchor_y
      || first.anchor_x - second.anchor_x)
    .slice(0, Math.max(1, Math.min(2, Number(limit) || 1)));
}

export function guidanceErrorPayload(error) {
  return {
    error: error.message,
    code: error.code || 'GUIDANCE_ERROR',
  };
}

export async function buildGuidancePlan({
  db,
  userId,
  template,
  selectedColor = null,
  reason = GUIDANCE_REASON.INITIAL_TARGET,
  cameraCenter = null,
  recentKeys = [],
  preferredTileKey = null,
  targetColor = null,
  specialId = null,
  sparkTreatment = null,
  sessionGame = false,
} = {}) {
  if (!db || !template) {
    throw new TiledGuidanceError('Guidance requires a database and template', 'INVALID_GUIDANCE_INPUT', 500);
  }
  const grid = getTileGrid(template.width, template.height, template.tile_size || DEFAULT_TILE_SIZE);
  const paletteLength = template.palette?.length || 0;
  if (paletteLength < 2) {
    throw new TiledGuidanceError('Tiled template has an invalid palette', 'INVALID_TILED_TEMPLATE', 500);
  }
  const progress = await db.get(
    'SELECT * FROM coloring_tiled_progress WHERE user_id=? AND template_id=?',
    [userId, template.id],
  );
  // Materialize deterministic special rows before pity/INITIAL_TARGET lookup.
  // Existing tiled templates created before the special-cell migration have
  // zero rows and must not depend on a later tile GET to lazily generate them.
  await ensureTiledSpecialCells(db, template);
  const isTreatment = sparkTreatment == null
    ? isSparkTreatmentUser(userId, template.id)
    : Boolean(sparkTreatment);
  // An offered special event owns the next player decision. Claim/use routes
  // already enforce this invariant, but guidance must enforce it too or a
  // stale auto-advance can issue an ordinary target while Bomb/Fuse/Choice is
  // waiting in the HUD. The only permitted guidance request is the
  // special-target lookup for that same offer.
  const activeSpecialOffer = await db.get(
    `SELECT p.special_id, c.kind
       FROM coloring_special_progress p
       JOIN coloring_special_cells c
         ON c.template_id=p.template_id AND c.special_id=p.special_id
      WHERE p.user_id=? AND p.template_id=? AND p.status='offered'
      LIMIT 1`,
    [userId, template.id],
  );
  if (reason === GUIDANCE_REASON.SPECIAL_TARGETS && !isTreatment) {
    throw new TiledGuidanceError(
      'Special target guidance is unavailable for this cohort',
      'SPECIAL_TARGETS_CONTROL',
      403,
    );
  }
  if (reason === GUIDANCE_REASON.SPECIAL_TARGETS
    && (!activeSpecialOffer
      || String(specialId || '') !== String(activeSpecialOffer.special_id))) {
    throw new TiledGuidanceError(
      'Special target guidance requires the matching persisted offer',
      'SPECIAL_TARGET_OFFER_REQUIRED',
      409,
    );
  }
  if (activeSpecialOffer && reason !== GUIDANCE_REASON.SPECIAL_TARGETS) {
    throw new TiledGuidanceError(
      'Resolve the current special event first',
      'SPECIAL_ACTIVE_OFFER',
      409,
    );
  }
  const progressRevision = Number(progress?.revision || 0);
  const center = cameraCenter
    || { x: grid.width / 2, y: grid.height / 2 };
  const totals = await readColorTotals(db, { userId, template });
  const remainingColors = [...totals.entries()]
    .filter(([_color, remaining]) => remaining > 0)
    .sort((first, second) => second[1] - first[1] || first[0] - second[0]);
  if (!remainingColors.length) {
    return {
      schema_version: GUIDANCE_SCHEMA_VERSION,
      template_id: template.id,
      progress_revision: progressRevision,
      mode: 'auto',
      reason: GUIDANCE_REASON.ARTWORK_COMPLETE,
      selected_color: null,
      global_remaining_for_color: 0,
      next_color: null,
      color_complete: false,
      artwork_complete: true,
      target: null,
    };
  }

  const requestedColor = targetColor != null
    ? parseColor(targetColor, paletteLength)
    : selectedColor == null ? null : parseColor(selectedColor, paletteLength);
  let colorIndex;
  let finalReason = reason;
  let nextColor = null;
  let colorComplete = false;

  if (requestedColor == null || !totals.has(requestedColor) || (totals.get(requestedColor) || 0) <= 0) {
    colorComplete = requestedColor != null;
    finalReason = colorComplete ? GUIDANCE_REASON.COLOR_COMPLETE : GUIDANCE_REASON.INITIAL_TARGET;
    nextColor = remainingColors[0]?.[0] ?? null;
    if (nextColor == null) {
      return {
        schema_version: GUIDANCE_SCHEMA_VERSION,
        template_id: template.id,
        progress_revision: progressRevision,
        mode: 'auto',
        reason: finalReason,
        selected_color: requestedColor,
        global_remaining_for_color: requestedColor == null ? 0 : (totals.get(requestedColor) || 0),
        next_color: null,
        color_complete: colorComplete,
        artwork_complete: true,
        target: null,
      };
    }
    colorIndex = nextColor;
  } else {
    colorIndex = requestedColor;
  }

  const pityAllowed = isTreatment
    && !sessionGame
    && reason !== GUIDANCE_REASON.SPECIAL_TARGETS
    && reason !== GUIDANCE_REASON.MANUAL_COLOR
    && reason !== GUIDANCE_REASON.RETURN_TO_TARGET;
  if (pityAllowed) {
    const pity = await findPitySpark(db, {
      userId,
      template,
      progress,
      earlyEligible: reason === GUIDANCE_REASON.INITIAL_TARGET,
    });
    if (pity) {
      return {
        schema_version: GUIDANCE_SCHEMA_VERSION,
        template_id: template.id,
        progress_revision: progressRevision,
        mode: 'auto',
        reason,
        special_id: pity.specialId,
        special_pity: true,
        selected_color: pity.target.color,
        global_remaining_for_color: totals.get(pity.target.color) || 0,
        next_color: nextColor,
        color_complete: false,
        artwork_complete: false,
        target: pity.target,
      };
    }
  }

  const resolved = await resolveTarget(db, {
    userId,
    template,
    colorIndex,
    cameraCenter: center,
    recentKeys,
    preferredTileKey: reason === GUIDANCE_REASON.RETURN_TO_TARGET ? preferredTileKey : null,
    progress,
  });
  if (!resolved) {
    return {
      schema_version: GUIDANCE_SCHEMA_VERSION,
      template_id: template.id,
      progress_revision: progressRevision,
      mode: 'auto',
      reason: GUIDANCE_REASON.NO_ACTIONABLE_CELLS,
      selected_color: colorIndex,
      global_remaining_for_color: totals.get(colorIndex) || 0,
      next_color: null,
      color_complete: false,
      artwork_complete: false,
      target: null,
    };
  }

  if (reason === GUIDANCE_REASON.SPECIAL_TARGETS) {
    const targetOptions = await resolveTargets(db, {
      userId,
      template,
      colorIndex,
      cameraCenter: center,
      recentKeys,
      progress,
      specialId,
      limit: sessionGame ? 2 : 1,
      sessionGame,
    });
    const annotatedOptions = targetOptions.map((target, index) => ({
      ...target,
      option_id: sessionGame
        ? (index === 0 ? 'scene' : 'nearby')
        : (index === 0 ? 'default' : `option_${index + 1}`),
      ...(sessionGame ? {
        label: index === 0 ? 'Крупный фрагмент' : 'Другой фрагмент',
        description: index === 0
          ? `${target.estimated_cells} клеток · заметный шаг картины`
          : `${target.estimated_cells} клеток · продолжить в другой части`,
      } : {}),
      target_effort: describeSpecialTargetEffort(target),
    }));
    return {
      schema_version: GUIDANCE_SCHEMA_VERSION,
      template_id: template.id,
      progress_revision: progressRevision,
      mode: 'auto',
      reason,
      special_id: specialId,
      selected_color: colorIndex,
      global_remaining_for_color: totals.get(colorIndex) || 0,
      next_color: nextColor,
      color_complete: colorComplete,
      artwork_complete: false,
      target: annotatedOptions[0] || null,
      target_options: annotatedOptions,
      default_option_id: annotatedOptions[0]?.option_id || null,
      target_effort_distribution: summarizeSpecialEffort(
        annotatedOptions.map((target) => target.estimated_cells),
      ),
    };
  }

  return {
    schema_version: GUIDANCE_SCHEMA_VERSION,
    template_id: template.id,
    progress_revision: progressRevision,
    mode: 'auto',
    reason: finalReason,
    selected_color: colorIndex,
    global_remaining_for_color: totals.get(colorIndex) || 0,
    next_color: nextColor,
    color_complete: colorComplete,
    artwork_complete: false,
    target: {
      ...resolved.target,
      color: colorIndex,
    },
  };
}

export function isTiledGuidanceError(error) {
  return error instanceof TiledGuidanceError;
}

export { TiledGuidanceError };
