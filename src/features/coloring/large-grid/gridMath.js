export const DEFAULT_TILE_SIZE = 32;
export const DEFAULT_CELL_SIZE = 32;
export const MAX_GRID_DIMENSION = 1_200;

// The canvas switches from preview-first drawing to per-cell drawing at five
// screen pixels per cell. Keep one pixel of hysteresis on both sides of that
// renderer boundary so pinch/animated camera movement cannot flap the data
// loading policy around a single zoom value.
export const OVERVIEW_ENTER_CELL_PIXELS = 4;
export const WORK_ENTER_CELL_PIXELS = 6;
export const GRID_LOD_MODE = Object.freeze({
  OVERVIEW: 'overview',
  WORK: 'work',
});

export function resolveGridLodMode(cellPixels, previousMode = GRID_LOD_MODE.OVERVIEW) {
  const pixels = Number(cellPixels);
  if (!Number.isFinite(pixels)) return previousMode;
  if (previousMode === GRID_LOD_MODE.WORK) {
    return pixels < OVERVIEW_ENTER_CELL_PIXELS ? GRID_LOD_MODE.OVERVIEW : GRID_LOD_MODE.WORK;
  }
  return pixels >= WORK_ENTER_CELL_PIXELS ? GRID_LOD_MODE.WORK : GRID_LOD_MODE.OVERVIEW;
}

function asPositiveInteger(value, label) {
  const number = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
  if (!Number.isSafeInteger(number) || number <= 0) {
    throw new RangeError(`${label} must be a positive integer`);
  }
  return number;
}

function asNonNegativeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${label} must be a non-negative integer`);
  }
  return value;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/**
 * Descriptor memo: locateCell/mapPointerToCell re-derive the grid descriptor
 * on every call (per painted cell in a stroke). The descriptor is pure
 * (read-only, derived from the source object), so caching by source identity
 * is safe and removes a per-call allocation from the input hot path.
 */
const gridDescriptorCache = new WeakMap();

export function createGridDescriptor(source = {}) {
  const cached = gridDescriptorCache.get(source);
  if (cached) return cached;
  const grid = source.grid || source;
  const width = asPositiveInteger(grid.width ?? source.template?.width, 'Grid width');
  const height = asPositiveInteger(grid.height ?? source.template?.height, 'Grid height');
  const tileSize = asPositiveInteger(
    grid.tile_size ?? grid.tileSize ?? DEFAULT_TILE_SIZE,
    'Tile size',
  );
  const columns = Math.ceil(width / tileSize);
  const rows = Math.ceil(height / tileSize);
  const count = columns * rows;
  const totalCells = width * height;
  if (!Number.isSafeInteger(totalCells) || !Number.isSafeInteger(count)) {
    throw new RangeError('Grid is too large for safe row-major coordinates');
  }
  const result = {
    width,
    height,
    tileSize,
    tile_size: tileSize,
    columns,
    rows,
    tilesX: columns,
    tilesY: rows,
    tiles_x: columns,
    tiles_y: rows,
    count,
    totalCells,
  };
  gridDescriptorCache.set(source, result);
  return result;
}

export function tileKey(tileX, tileY) {
  return `${tileX}:${tileY}`;
}

export function getTileBounds(gridSource, tileX, tileY) {
  const grid = createGridDescriptor(gridSource);
  const x = asNonNegativeInteger(tileX, 'Tile X');
  const y = asNonNegativeInteger(tileY, 'Tile Y');
  if (x >= grid.columns || y >= grid.rows) {
    throw new RangeError('Tile coordinates are outside the grid');
  }
  const offsetX = x * grid.tileSize;
  const offsetY = y * grid.tileSize;
  const width = Math.min(grid.tileSize, grid.width - offsetX);
  const height = Math.min(grid.tileSize, grid.height - offsetY);
  return {
    key: tileKey(x, y),
    tileX: x,
    tileY: y,
    tile_x: x,
    tile_y: y,
    offsetX,
    offsetY,
    offset_x: offsetX,
    offset_y: offsetY,
    width,
    height,
    cellCount: width * height,
    cell_count: width * height,
    tileSize: grid.tileSize,
    tile_size: grid.tileSize,
  };
}

function emptyCellBounds() {
  return {
    startX: 0,
    endX: -1,
    startY: 0,
    endY: -1,
    width: 0,
    height: 0,
  };
}

export function getViewportCellBounds({
  grid: gridSource,
  camera = { x: 0, y: 0, zoom: 1 },
  viewportWidth,
  viewportHeight,
  cellSize = DEFAULT_CELL_SIZE,
  overscanCells = 0,
} = {}) {
  const grid = createGridDescriptor(gridSource);
  const width = Math.max(0, Number(viewportWidth) || 0);
  const height = Math.max(0, Number(viewportHeight) || 0);
  const worldCellSize = Number(cellSize);
  const zoom = Math.max(0.0001, Number(camera.zoom) || 1);
  const margin = Math.max(0, Math.ceil(Number(overscanCells) || 0));
  if (!Number.isFinite(worldCellSize) || worldCellSize <= 0 || width === 0 || height === 0) {
    return emptyCellBounds();
  }

  const left = (-Number(camera.x || 0) / zoom) / worldCellSize;
  const right = ((width - Number(camera.x || 0)) / zoom) / worldCellSize;
  const top = (-Number(camera.y || 0) / zoom) / worldCellSize;
  const bottom = ((height - Number(camera.y || 0)) / zoom) / worldCellSize;
  const rawStartX = Math.floor(Math.min(left, right));
  const rawEndX = Math.ceil(Math.max(left, right)) - 1;
  const rawStartY = Math.floor(Math.min(top, bottom));
  const rawEndY = Math.ceil(Math.max(top, bottom)) - 1;
  if (rawEndX < 0 || rawStartX > grid.width - 1 || rawEndY < 0 || rawStartY > grid.height - 1) {
    return emptyCellBounds();
  }
  const startX = clamp(rawStartX - margin, 0, grid.width - 1);
  const endX = clamp(rawEndX + margin, 0, grid.width - 1);
  const startY = clamp(rawStartY - margin, 0, grid.height - 1);
  const endY = clamp(rawEndY + margin, 0, grid.height - 1);
  if (endX < startX || endY < startY) return emptyCellBounds();
  return {
    startX,
    endX,
    startY,
    endY,
    width: endX - startX + 1,
    height: endY - startY + 1,
  };
}

function tilesForBounds(gridSource, cellBounds) {
  const grid = createGridDescriptor(gridSource);
  if (!cellBounds || cellBounds.width <= 0 || cellBounds.height <= 0) return [];
  const minTileX = Math.floor(cellBounds.startX / grid.tileSize);
  const maxTileX = Math.floor(cellBounds.endX / grid.tileSize);
  const minTileY = Math.floor(cellBounds.startY / grid.tileSize);
  const maxTileY = Math.floor(cellBounds.endY / grid.tileSize);
  const tiles = [];
  for (let tileY = minTileY; tileY <= maxTileY; tileY += 1) {
    for (let tileX = minTileX; tileX <= maxTileX; tileX += 1) {
      tiles.push(getTileBounds(grid, tileX, tileY));
    }
  }
  return tiles;
}

export function selectViewportTiles({
  grid: gridSource,
  camera,
  viewportWidth,
  viewportHeight,
  cellSize = DEFAULT_CELL_SIZE,
  overscanCells = 0,
  overscanTiles = 1,
} = {}) {
  const grid = createGridDescriptor(gridSource);
  const cellBounds = getViewportCellBounds({
    grid,
    camera,
    viewportWidth,
    viewportHeight,
    cellSize,
    overscanCells,
  });
  const visible = tilesForBounds(grid, cellBounds);
  const visibleKeys = new Set(visible.map((tile) => tile.key));
  if (!visible.length) {
    return {
      grid,
      cellBounds,
      visible,
      prefetch: [],
      all: [],
    };
  }

  const margin = Math.max(0, Math.floor(Number(overscanTiles) || 0));
  const visibleTileXs = visible.map((tile) => tile.tileX);
  const visibleTileYs = visible.map((tile) => tile.tileY);
  const minTileX = Math.max(0, Math.min(...visibleTileXs) - margin);
  const maxTileX = Math.min(grid.columns - 1, Math.max(...visibleTileXs) + margin);
  const minTileY = Math.max(0, Math.min(...visibleTileYs) - margin);
  const maxTileY = Math.min(grid.rows - 1, Math.max(...visibleTileYs) + margin);
  const prefetch = [];
  for (let tileY = minTileY; tileY <= maxTileY; tileY += 1) {
    for (let tileX = minTileX; tileX <= maxTileX; tileX += 1) {
      const tile = getTileBounds(grid, tileX, tileY);
      if (!visibleKeys.has(tile.key)) prefetch.push(tile);
    }
  }
  return {
    grid,
    cellBounds,
    visible,
    prefetch,
    all: [...visible, ...prefetch],
  };
}

export function locateCell(gridSource, x, y) {
  const grid = createGridDescriptor(gridSource);
  const cellX = Number(x);
  const cellY = Number(y);
  if (!Number.isInteger(cellX) || !Number.isInteger(cellY)
    || cellX < 0 || cellX >= grid.width || cellY < 0 || cellY >= grid.height) {
    return null;
  }
  const tileX = Math.floor(cellX / grid.tileSize);
  const tileY = Math.floor(cellY / grid.tileSize);
  const tile = getTileBounds(grid, tileX, tileY);
  const localX = cellX - tile.offsetX;
  const localY = cellY - tile.offsetY;
  return {
    x: cellX,
    y: cellY,
    index: cellY * grid.width + cellX,
    tileX,
    tileY,
    tileKey: tile.key,
    localX,
    localY,
    localIndex: localY * tile.width + localX,
  };
}

export function mapPointerToCell({
  clientX,
  clientY,
  rect = { left: 0, top: 0 },
  camera = { x: 0, y: 0, zoom: 1 },
  cellSize = DEFAULT_CELL_SIZE,
  grid: gridSource,
} = {}) {
  const grid = createGridDescriptor(gridSource);
  const pointX = Number(clientX) - Number(rect.left || 0);
  const pointY = Number(clientY) - Number(rect.top || 0);
  const worldCellSize = Number(cellSize);
  const zoom = Math.max(0.0001, Number(camera.zoom) || 1);
  if (!Number.isFinite(pointX) || !Number.isFinite(pointY)
    || !Number.isFinite(worldCellSize) || worldCellSize <= 0) return null;
  const worldX = (pointX - Number(camera.x || 0)) / zoom;
  const worldY = (pointY - Number(camera.y || 0)) / zoom;
  return locateCell(grid, Math.floor(worldX / worldCellSize), Math.floor(worldY / worldCellSize));
}
