/**
 * Versioned read contract for progressively loading coloring grids.
 *
 * The database still stores the legacy row-major JSON arrays. This module
 * only projects those arrays into bounded tiles; it does not introduce a
 * second persistence format or mutate the source arrays.
 */

export const CHUNK_SCHEMA_VERSION = 1;
export const DEFAULT_TILE_SIZE = 32;
export const PUBLIC_GRID_MIN_DIMENSION = 8;
export const PUBLIC_GRID_MAX_DIMENSION = 160;
export const CHUNK_FORMAT_MAX_DIMENSION = 1_200;

class ColoringChunkContractError extends Error {
  constructor(message, code, status = 400) {
    super(message);
    this.name = 'ColoringChunkContractError';
    this.code = code;
    this.status = status;
  }
}

function asSafeInteger(value, code, label) {
  const numeric = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
  if (!Number.isSafeInteger(numeric)) {
    throw new ColoringChunkContractError(`${label} must be a safe integer`, code, 400);
  }
  return numeric;
}

function validateGridShape(width, height, { min = 1, max = CHUNK_FORMAT_MAX_DIMENSION } = {}) {
  const parsedWidth = asSafeInteger(width, 'INVALID_GRID_DIMENSIONS', 'width');
  const parsedHeight = asSafeInteger(height, 'INVALID_GRID_DIMENSIONS', 'height');
  if (parsedWidth < min || parsedHeight < min || parsedWidth > max || parsedHeight > max) {
    throw new ColoringChunkContractError('Grid dimensions are outside the supported contract range', 'INVALID_GRID_DIMENSIONS', 422);
  }
  const totalCells = parsedWidth * parsedHeight;
  if (!Number.isSafeInteger(totalCells)) {
    throw new ColoringChunkContractError('Grid is too large for a safe row-major contract', 'GRID_TOO_LARGE', 422);
  }
  return { width: parsedWidth, height: parsedHeight, totalCells };
}

export function validatePublicGridDimensions(width, height) {
  return validateGridShape(width, height, {
    min: PUBLIC_GRID_MIN_DIMENSION,
    max: PUBLIC_GRID_MAX_DIMENSION,
  });
}

function assertTileSize(tileSize) {
  const parsed = asSafeInteger(tileSize, 'INVALID_TILE_SIZE', 'tile_size');
  if (parsed < 1 || parsed > 128) {
    throw new ColoringChunkContractError('tile_size must be between 1 and 128', 'INVALID_TILE_SIZE', 400);
  }
  return parsed;
}

export function getTileGrid(width, height, tileSize = DEFAULT_TILE_SIZE) {
  const grid = validateGridShape(width, height);
  const size = assertTileSize(tileSize);
  return {
    ...grid,
    tile_size: size,
    tiles_x: Math.ceil(grid.width / size),
    tiles_y: Math.ceil(grid.height / size),
  };
}

export function getTileBounds({ width, height, tileX, tileY, tileSize = DEFAULT_TILE_SIZE }) {
  const grid = getTileGrid(width, height, tileSize);
  const x = asSafeInteger(tileX, 'INVALID_TILE_COORDINATES', 'tile_x');
  const y = asSafeInteger(tileY, 'INVALID_TILE_COORDINATES', 'tile_y');
  if (x < 0 || y < 0 || x >= grid.tiles_x || y >= grid.tiles_y) {
    throw new ColoringChunkContractError('Tile coordinates are outside the grid', 'INVALID_TILE_COORDINATES', 400);
  }
  const offsetX = x * grid.tile_size;
  const offsetY = y * grid.tile_size;
  return {
    tile_x: x,
    tile_y: y,
    offset_x: offsetX,
    offset_y: offsetY,
    width: Math.min(grid.tile_size, grid.width - offsetX),
    height: Math.min(grid.tile_size, grid.height - offsetY),
    cell_count: Math.min(grid.tile_size, grid.width - offsetX) * Math.min(grid.tile_size, grid.height - offsetY),
    tile_size: grid.tile_size,
    tiles_x: grid.tiles_x,
    tiles_y: grid.tiles_y,
  };
}

function isArrayLike(value) {
  return Array.isArray(value) || ArrayBuffer.isView(value);
}

function requireGridArray(value, expectedLength, code, label) {
  if (!isArrayLike(value) || value.length !== expectedLength) {
    throw new ColoringChunkContractError(`${label} must contain exactly ${expectedLength} cells`, code, 422);
  }
  return value;
}

export function sliceTileRowMajor(values, { width, height }, bounds, { fill = undefined, code = 'INVALID_GRID_DATA', label = 'cells' } = {}) {
  const expectedLength = width * height;
  const source = values === undefined || values === null
    ? Array(expectedLength).fill(fill)
    : requireGridArray(values, expectedLength, code, label);
  const result = new Array(bounds.cell_count);
  let cursor = 0;
  for (let row = 0; row < bounds.height; row += 1) {
    const start = (bounds.offset_y + row) * width + bounds.offset_x;
    for (let column = 0; column < bounds.width; column += 1) {
      result[cursor] = source[start + column];
      cursor += 1;
    }
  }
  return result;
}

function progressSummary(progress, totalCells) {
  const revision = Number.isSafeInteger(Number(progress?.revision)) && Number(progress.revision) >= 0
    ? Number(progress.revision)
    : 0;
  const completedCells = Number.isSafeInteger(Number(progress?.completed_cells))
    ? Math.max(0, Math.min(totalCells, Number(progress.completed_cells)))
    : 0;
  return {
    revision,
    completed_cells: completedCells,
    total_cells: totalCells,
    percent: Math.round((completedCells / totalCells) * 100),
    completed_at: progress?.completed_at ?? null,
  };
}

function safeTemplateMetadata(template, grid) {
  const metadata = {
    id: String(template.id),
    title: String(template.title || ''),
    description: String(template.description || ''),
    category: template.category || null,
    difficulty: template.difficulty || null,
    theme: template.theme || null,
    mood: template.mood || null,
    collection_id: template.collection_id || null,
    width: grid.width,
    height: grid.height,
    palette: Array.isArray(template.palette) ? [...template.palette] : [],
    preview_url: template.preview_url || null,
  };
  if (template.storage_mode === 'tiled') {
    metadata.storage_mode = 'tiled';
    metadata.tile_size = Number(template.tile_size || grid.tile_size);
  }
  return metadata;
}

export function buildColoringManifest({ template, progress = null, tileSize = DEFAULT_TILE_SIZE, basePath } = {}) {
  const resolvedTileSize = template?.tile_size || tileSize;
  const grid = getTileGrid(template?.width, template?.height, resolvedTileSize);
  const id = String(template?.id || '');
  const path = basePath || `/colorings/${encodeURIComponent(id)}`;
  const manifest = {
    schema_version: CHUNK_SCHEMA_VERSION,
    template_id: id,
    content_revision: template?.updated_at || null,
    template: safeTemplateMetadata(template, grid),
    grid: {
      width: grid.width,
      height: grid.height,
      tile_size: grid.tile_size,
      tiles_x: grid.tiles_x,
      tiles_y: grid.tiles_y,
      encoding: 'row-major-palette-index',
    },
    progress: progressSummary(progress, grid.totalCells),
    links: {
      tile: `${path}/tiles/{tile_x}/{tile_y}`,
      chunk: `${path}/chunks/{tile_x}/{tile_y}`,
      progress: `${path}/progress`,
      progress_actions: `${path}/progress/actions`,
    },
    write_contract: {
      method: 'POST',
      path: `${path}/progress/actions`,
      revision_field: 'revision',
      change_shape: { index: 'global row-major cell index', color: 'palette index or -1 to clear' },
      max_changes: 64,
      idempotency: {
        body_field: 'clientBatchId',
        header: 'Idempotency-Key',
        replay: 'same key and payload returns idempotent=true',
      },
      conflict_status: 409,
    },
  };
  if (template.storage_mode === 'tiled') manifest.grid.storage_mode = 'tiled';
  return manifest;
}

export function buildColoringTile({ template, filled, progress = null, tileX, tileY, tileSize = DEFAULT_TILE_SIZE } = {}) {
  const grid = getTileGrid(template?.width, template?.height, tileSize);
  const bounds = getTileBounds({ ...grid, tileX, tileY, tileSize: grid.tile_size });
  const cells = requireGridArray(template?.cells, grid.totalCells, 'INVALID_TEMPLATE_CELLS', 'template.cells');
  const filledSource = filled === undefined || filled === null
    ? Array(grid.totalCells).fill(-1)
    : isArrayLike(filled) && filled.length === grid.totalCells
      ? filled
      : Array(grid.totalCells).fill(-1);
  const path = `/colorings/${encodeURIComponent(String(template?.id || ''))}`;
  return {
    schema_version: CHUNK_SCHEMA_VERSION,
    template_id: String(template?.id || ''),
    content_revision: template?.updated_at || null,
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
    cells: sliceTileRowMajor(cells, grid, bounds, { code: 'INVALID_TEMPLATE_CELLS', label: 'template.cells' }),
    filled: sliceTileRowMajor(filledSource, grid, bounds, { fill: -1, code: 'INVALID_PROGRESS_DATA', label: 'progress.filled' }),
    progress: progressSummary(progress, grid.totalCells),
    links: {
      manifest: `${path}/manifest`,
      progress_actions: `${path}/progress/actions`,
    },
  };
}

export function isColoringChunkContractError(error) {
  return error instanceof ColoringChunkContractError;
}

export { ColoringChunkContractError };
