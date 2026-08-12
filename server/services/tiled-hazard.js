import { createHash } from 'node:crypto';
import { DEFAULT_TILE_SIZE, getTileBounds } from './coloring-chunks.js';
import {
  SPECIAL_EVENT_MAX_CELLS,
  SPECIAL_TILE_METADATA_LIMIT,
  capSpecialsPerTile,
  generateSparkCells,
  HAZARD_KIND,
} from './tiled-specials.js';

export const HAZARD_GENERATION_VERSION = 4;
export const HAZARD_REWARD_MAX_CELLS = 16;
export const HAZARD_MISS_PENALTY_CELLS = 2;
export const HAZARD_NEIGHBOR_RADIUS = 3;

function parseJsonArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string') return null;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function hashString(value) {
  return createHash('sha256').update(String(value)).digest();
}

/**
 * Bounded reward derivation for a deliberate hazard disarm. It only returns
 * exact correct cells from the hazard marker's local window and never emits a
 * cell that would remove already-painted progress.
 */
export function deriveHazardDisarmChanges({
  cells,
  filled,
  width,
  height,
  specialIndex,
  maxChanges = HAZARD_REWARD_MAX_CELLS,
  radius = HAZARD_NEIGHBOR_RADIUS,
} = {}) {
  const parsedCells = Array.isArray(cells) ? cells : (parseJsonArray(cells) || []);
  const parsedFilled = Array.isArray(filled) ? filled : (parseJsonArray(filled) || []);
  const safeWidth = Number(width);
  const safeHeight = Number(height);
  const anchorIndex = Number(specialIndex);
  const anchorX = anchorIndex % safeWidth;
  const anchorY = Math.floor(anchorIndex / safeWidth);
  const changes = [];
  for (let y = Math.max(0, anchorY - radius); y <= Math.min(safeHeight - 1, anchorY + radius); y += 1) {
    for (let x = Math.max(0, anchorX - radius); x <= Math.min(safeWidth - 1, anchorX + radius); x += 1) {
      if (changes.length >= maxChanges) break;
      const index = y * safeWidth + x;
      const color = Number(parsedCells[index]);
      if (parsedFilled[index] === -1 && Number.isInteger(color) && color >= 0) {
        changes.push({ index, color });
      }
    }
  }
  return changes;
}

/** Tiled variant: read only the tiles around the hazard marker. */
export async function deriveTiledHazardDisarmChanges(db, {
  userId,
  template,
  special,
  maxChanges = HAZARD_REWARD_MAX_CELLS,
} = {}) {
  const width = Number(template.width);
  const height = Number(template.height);
  const tileSize = Number(template.tile_size || DEFAULT_TILE_SIZE);
  const anchorIndex = Number(special?.cell_index);
  const anchorX = anchorIndex % width;
  const anchorY = Math.floor(anchorIndex / width);
  const radius = HAZARD_NEIGHBOR_RADIUS;
  const minX = Math.max(0, anchorX - radius);
  const minY = Math.max(0, anchorY - radius);
  const maxX = Math.min(width - 1, anchorX + radius);
  const maxY = Math.min(height - 1, anchorY + radius);
  const tileKeys = new Set();
  for (let candidateY = minY; candidateY <= maxY; candidateY += 1) {
    for (let candidateX = minX; candidateX <= maxX; candidateX += 1) {
      tileKeys.add(`${Math.floor(candidateX / tileSize)}:${Math.floor(candidateY / tileSize)}`);
    }
  }
  const tileState = new Map();
  for (const key of tileKeys) {
    const [tileX, tileY] = key.split(':').map(Number);
    const bounds = getTileBounds({ width, height, tileSize, tileX, tileY });
    const row = await db.get(
      'SELECT cells_json FROM coloring_template_tiles WHERE template_id=? AND tile_x=? AND tile_y=?',
      [template.id, bounds.tile_x, bounds.tile_y],
    );
    if (!row) continue;
    const progress = await db.get(
      'SELECT filled_json FROM coloring_tiled_progress_tiles WHERE user_id=? AND template_id=? AND tile_x=? AND tile_y=?',
      [userId, template.id, bounds.tile_x, bounds.tile_y],
    );
    tileState.set(key, {
      bounds,
      cells: parseJsonArray(row.cells_json) || [],
      filled: parseJsonArray(progress?.filled_json) || Array(bounds.cell_count).fill(-1),
    });
  }
  const changes = [];
  for (let candidateY = minY; candidateY <= maxY && changes.length < maxChanges; candidateY += 1) {
    for (let candidateX = minX; candidateX <= maxX && changes.length < maxChanges; candidateX += 1) {
      const tileX = Math.floor(candidateX / tileSize);
      const tileY = Math.floor(candidateY / tileSize);
      const state = tileState.get(`${tileX}:${tileY}`);
      if (!state) continue;
      const localX = candidateX - state.bounds.offset_x;
      const localY = candidateY - state.bounds.offset_y;
      const localIndex = localY * state.bounds.width + localX;
      const color = Number(state.cells[localIndex]);
      if (state.filled[localIndex] === -1 && Number.isInteger(color) && color >= 0) {
        changes.push({ index: candidateY * width + candidateX, color });
      }
    }
  }
  return changes;
}

export function buildHazardOffer({
  specialId,
  offerToken,
  progressRevision,
  rewardCells = 0,
} = {}) {
  return {
    special_id: String(specialId),
    offer_token: String(offerToken),
    progress_revision: Number(progressRevision),
    kind: HAZARD_KIND,
    disarm: true,
    reward_cells: Math.max(0, Math.min(HAZARD_REWARD_MAX_CELLS, Number(rewardCells) || 0)),
    reward_cap: HAZARD_REWARD_MAX_CELLS,
    penalty: {
      temporary: true,
      cells: HAZARD_MISS_PENALTY_CELLS,
      progress_deleted: 0,
    },
  };
}

/**
 * Missed hazards cost only a small local temporary attention penalty. This
 * descriptor never deletes or reverts painting progress.
 */
export function buildHazardMissPenalty({
  width,
  specialIndex,
  cells = HAZARD_MISS_PENALTY_CELLS,
} = {}) {
  return {
    kind: HAZARD_KIND,
    missed: true,
    temporary: true,
    cells: Math.max(0, Math.min(4, Number(cells) || 0)),
    progress_deleted: 0,
    position: {
      x: Number(specialIndex) % Number(width),
      y: Math.floor(Number(specialIndex) / Number(width)),
    },
  };
}

/**
 * Deterministic hazard fixture used by dev/test templates. Normal template
 * creation keeps the existing Spark/mixed cadence; tests opt in explicitly so
 * the vertical slice can be exercised without changing production pacing.
 */
export function generateHazardFixtureCells({
  templateId,
  width,
  height,
  tileSize = DEFAULT_TILE_SIZE,
  cellIndex = null,
} = {}) {
  const safeWidth = Number(width);
  const safeHeight = Number(height);
  const safeTileSize = Math.max(1, Math.min(DEFAULT_TILE_SIZE, Number(tileSize) || DEFAULT_TILE_SIZE));
  if (!Number.isInteger(safeWidth) || !Number.isInteger(safeHeight) || safeWidth <= 0 || safeHeight <= 0) {
    return [];
  }
  const total = safeWidth * safeHeight;
  const digest = hashString(`hazard-fixture:${templateId}:${safeWidth}:${safeHeight}`);
  const chosen = Number.isInteger(cellIndex) && cellIndex >= 0 && cellIndex < total
    ? cellIndex
    : digest.readUInt32BE(0) % total;
  const x = chosen % safeWidth;
  const y = Math.floor(chosen / safeWidth);
  const bounds = getTileBounds({
    width: safeWidth,
    height: safeHeight,
    tileSize: safeTileSize,
    tileX: Math.floor(x / safeTileSize),
    tileY: Math.floor(y / safeTileSize),
  });
  return [{
    special_id: `hz_${digest.toString('hex').slice(0, 16)}`,
    kind: HAZARD_KIND,
    cell_index: chosen,
    tile_x: bounds.tile_x,
    tile_y: bounds.tile_y,
    local_index: (y - bounds.offset_y) * bounds.width + x - bounds.offset_x,
    generation_version: HAZARD_GENERATION_VERSION,
  }];
}

/**
 * Production hazard placement. Reuses the deterministic Spark placer so hazard
 * coordinates follow the same bounded, tile-aware contract without a second
 * coordinate generator or a Jammer-style effect.
 */
export function generateHazardCells({
  templateId,
  seed = templateId,
  width,
  height,
  tileSize = DEFAULT_TILE_SIZE,
  tiles,
  occupiedIndices = [],
} = {}) {
  const safeWidth = Number(width);
  const safeHeight = Number(height);
  if (!Number.isInteger(safeWidth) || !Number.isInteger(safeHeight) || safeWidth <= 0 || safeHeight <= 0) {
    return [];
  }
  const occupied = new Set((occupiedIndices || []).map((index) => Number(index)));
  const occupancy = new Map();
  for (const index of occupied) {
    const tileX = Math.floor((index % safeWidth) / tileSize);
    const tileY = Math.floor(Math.floor(index / safeWidth) / tileSize);
    const key = `${tileX}:${tileY}`;
    occupancy.set(key, (occupancy.get(key) || 0) + 1);
  }
  const hasMetadataRoom = (cell) => (
    (occupancy.get(`${Number(cell.tile_x)}:${Number(cell.tile_y)}`) || 0)
      < SPECIAL_TILE_METADATA_LIMIT
  );
  const buildCandidates = (maxSpecials) => capSpecialsPerTile(generateSparkCells({
    templateId,
    seed,
    width: safeWidth,
    height: safeHeight,
    tileSize,
    tiles,
    densityCells: Math.max(2, Math.ceil((safeWidth * safeHeight) / 200)),
    maxSpecials,
  }));
  // Keep the historical two-candidate pool stable when it already has room.
  // Only when the deterministic candidates land on full tiles do we expand,
  // so an additive hazard backfill can never hide an existing marker.
  let anchor = buildCandidates(2)
    .find((candidate) => !occupied.has(Number(candidate.cell_index)) && hasMetadataRoom(candidate));
  if (!anchor) {
    anchor = buildCandidates(8)
      .find((candidate) => !occupied.has(Number(candidate.cell_index)) && hasMetadataRoom(candidate));
  }
  if (!anchor) {
    const fallback = generateHazardFixtureCells({
      templateId,
      width: safeWidth,
      height: safeHeight,
      tileSize,
    })[0];
    if (!fallback || occupied.has(Number(fallback.cell_index)) || !hasMetadataRoom(fallback)) return [];
    return [{
      ...fallback,
      special_id: `hz_${hashString(`${seed}:hazard:${fallback.cell_index}`).toString('hex').slice(0, 16)}`,
    }];
  }
  return [{
    special_id: `hz_${hashString(`${seed}:hazard:${anchor.cell_index}`).toString('hex').slice(0, 16)}`,
    kind: HAZARD_KIND,
    cell_index: Number(anchor.cell_index),
    tile_x: Number(anchor.tile_x),
    tile_y: Number(anchor.tile_y),
    local_index: Number(anchor.local_index),
    generation_version: HAZARD_GENERATION_VERSION,
  }];
}

/**
 * Legacy twin of generateHazardCells. Legacy templates keep the exact v2
 * 28x28 compatibility fixture, so the shared event mix and Hazard placement
 * are enabled only for larger maps.
 */
export function generateLegacyHazardCells({
  templateId,
  seed = templateId,
  width,
  height,
  cells,
  occupiedIndices = [],
} = {}) {
  const safeWidth = Number(width);
  const safeHeight = Number(height);
  if (!Number.isInteger(safeWidth) || !Number.isInteger(safeHeight)
    || safeWidth <= 0 || safeHeight <= 0
    || safeWidth * safeHeight <= SPECIAL_EVENT_MAX_CELLS) {
    return [];
  }
  const parsedCells = parseJsonArray(cells) || [];
  const tileSize = Math.min(DEFAULT_TILE_SIZE, Math.max(safeWidth, safeHeight));
  const tiles = [];
  for (let tileY = 0; tileY < Math.ceil(safeHeight / tileSize); tileY += 1) {
    for (let tileX = 0; tileX < Math.ceil(safeWidth / tileSize); tileX += 1) {
      const bounds = getTileBounds({
        width: safeWidth,
        height: safeHeight,
        tileSize,
        tileX,
        tileY,
      });
      const tileCells = [];
      for (let y = 0; y < bounds.height; y += 1) {
        const rowStart = (bounds.offset_y + y) * safeWidth + bounds.offset_x;
        tileCells.push(...parsedCells.slice(rowStart, rowStart + bounds.width));
      }
      tiles.push({ tile_x: tileX, tile_y: tileY, cells: tileCells });
    }
  }
  return generateHazardCells({
    templateId,
    seed,
    width: safeWidth,
    height: safeHeight,
    tileSize,
    tiles,
    occupiedIndices,
  });
}

export async function persistHazardCells(tx, { templateId, cells } = {}) {
  for (const cell of cells || []) {
    await tx.run(`INSERT INTO coloring_special_cells
      (template_id,special_id,kind,cell_index,tile_x,tile_y,local_index,generation_version)
      VALUES (?,?,?,?,?,?,?,?)
      ON CONFLICT(template_id,special_id) DO NOTHING`,
    [templateId, cell.special_id, cell.kind, cell.cell_index, cell.tile_x, cell.tile_y,
      cell.local_index, cell.generation_version]);
  }
}
