export const DEFAULT_TILE_SIZE = 64;
export const DEFAULT_CELL_SIZE = 32;
export const UNFILLED_CELL = -1;
// Legacy templates may carry a full row-major cells array. Above this
// dimension the row-major model is unsafe for the player, so anything larger
// must be served and rendered through the chunked tiled contract.
export const LEGACY_GRID_LIMIT = 160;

export function isLargeGridTemplate(template = {}) {
  return template?.storage_mode === 'tiled'
    || Number(template?.width) > LEGACY_GRID_LIMIT
    || Number(template?.height) > LEGACY_GRID_LIMIT;
}

const BUFFER_TYPES = {
  int8: Int8Array,
  uint8: Uint8Array,
  int16: Int16Array,
  uint16: Uint16Array,
  int32: Int32Array,
  uint32: Uint32Array,
};

function resolveBufferType(type) {
  const ArrayType = BUFFER_TYPES[type];
  if (!ArrayType) throw new RangeError(`Unsupported cell buffer type: ${type}`);
  return ArrayType;
}

function assertGridSize(width, height) {
  if (!Number.isInteger(width) || width <= 0) throw new RangeError('Grid width must be a positive integer');
  if (!Number.isInteger(height) || height <= 0) throw new RangeError('Grid height must be a positive integer');
}

function assertTileSize(tileSize) {
  if (!Number.isInteger(tileSize) || tileSize <= 0) throw new RangeError('Tile size must be a positive integer');
}

export function toTypedCellBuffer(values, {
  type = 'int16',
  length = values?.length || 0,
  fillValue = UNFILLED_CELL,
  copy = false,
} = {}) {
  const ArrayType = resolveBufferType(type);
  if (!Number.isInteger(length) || length < 0) throw new RangeError('Buffer length must be a non-negative integer');
  if (!copy && values instanceof ArrayType && values.length === length) return values;

  const source = values || [];
  const output = new ArrayType(length);
  output.fill(fillValue);
  const copyLength = Math.min(source.length || 0, length);
  for (let index = 0; index < copyLength; index += 1) {
    const value = source[index];
    if (value != null && Number.isFinite(Number(value))) output[index] = value;
  }
  return output;
}

export function encodeCellBuffer(values, options = {}) {
  const typed = toTypedCellBuffer(values, { ...options, copy: false });
  return typed.buffer.slice(typed.byteOffset, typed.byteOffset + typed.byteLength);
}

export function decodeCellBuffer(buffer, { type = 'int16', copy = true } = {}) {
  const ArrayType = resolveBufferType(type);
  const source = buffer instanceof ArrayBuffer || typeof SharedArrayBuffer !== 'undefined' && buffer instanceof SharedArrayBuffer
    ? buffer
    : buffer?.buffer;
  const byteOffset = buffer instanceof ArrayBuffer || typeof SharedArrayBuffer !== 'undefined' && buffer instanceof SharedArrayBuffer
    ? 0
    : buffer?.byteOffset;
  if (!source || !Number.isInteger(byteOffset)) throw new TypeError('Cell buffer must be an ArrayBuffer or typed array');
  if (source.byteLength % ArrayType.BYTES_PER_ELEMENT !== 0) throw new RangeError('Cell buffer byte length is not aligned');
  const view = new ArrayType(source, byteOffset, source.byteLength / ArrayType.BYTES_PER_ELEMENT);
  return copy ? new ArrayType(view) : view;
}

export function getTileGridDimensions(width, height, tileSize = DEFAULT_TILE_SIZE) {
  assertGridSize(width, height);
  assertTileSize(tileSize);
  const columns = Math.ceil(width / tileSize);
  const rows = Math.ceil(height / tileSize);
  return { columns, rows, count: columns * rows };
}

export function tileKey(tileX, tileY) {
  return `${tileX}:${tileY}`;
}

export function getTileBounds(tileX, tileY, width, height, tileSize = DEFAULT_TILE_SIZE) {
  assertGridSize(width, height);
  assertTileSize(tileSize);
  const { columns, rows } = getTileGridDimensions(width, height, tileSize);
  if (!Number.isInteger(tileX) || tileX < 0 || tileX >= columns) throw new RangeError('Tile X is outside the grid');
  if (!Number.isInteger(tileY) || tileY < 0 || tileY >= rows) throw new RangeError('Tile Y is outside the grid');
  const minX = tileX * tileSize;
  const minY = tileY * tileSize;
  const maxX = Math.min(width - 1, minX + tileSize - 1);
  const maxY = Math.min(height - 1, minY + tileSize - 1);
  return {
    key: tileKey(tileX, tileY),
    tileX,
    tileY,
    minX,
    minY,
    maxX,
    maxY,
    width: maxX - minX + 1,
    height: maxY - minY + 1,
  };
}

export function getVisibleCellBounds({
  width,
  height,
  cellSize = DEFAULT_CELL_SIZE,
  camera = { x: 0, y: 0, zoom: 1 },
  viewportWidth,
  viewportHeight,
  overscanCells = 1,
} = {}) {
  assertGridSize(width, height);
  if (!Number.isFinite(cellSize) || cellSize <= 0) throw new RangeError('Cell size must be positive');
  const viewWidth = Math.max(0, Number(viewportWidth) || 0);
  const viewHeight = Math.max(0, Number(viewportHeight) || 0);
  const zoom = Math.max(0.001, Number(camera.zoom) || 1);
  const margin = Math.max(0, Math.ceil(Number(overscanCells) || 0));
  if (viewWidth === 0 || viewHeight === 0) {
    return { startX: 0, endX: -1, startY: 0, endY: -1, width: 0, height: 0 };
  }
  const left = (-Number(camera.x || 0) / zoom) / cellSize;
  const right = ((viewWidth - Number(camera.x || 0)) / zoom) / cellSize;
  const top = (-Number(camera.y || 0) / zoom) / cellSize;
  const bottom = ((viewHeight - Number(camera.y || 0)) / zoom) / cellSize;
  const startX = Math.max(0, Math.floor(Math.min(left, right)) - margin);
  const endX = Math.min(width - 1, Math.ceil(Math.max(left, right)) + margin);
  const startY = Math.max(0, Math.floor(Math.min(top, bottom)) - margin);
  const endY = Math.min(height - 1, Math.ceil(Math.max(top, bottom)) + margin);
  return {
    startX,
    endX,
    startY,
    endY,
    width: Math.max(0, endX - startX + 1),
    height: Math.max(0, endY - startY + 1),
  };
}

export function selectVisibleTiles({
  width,
  height,
  tileSize = DEFAULT_TILE_SIZE,
  cellSize = DEFAULT_CELL_SIZE,
  camera,
  viewportWidth,
  viewportHeight,
  overscanCells = 1,
} = {}) {
  assertGridSize(width, height);
  assertTileSize(tileSize);
  const grid = getTileGridDimensions(width, height, tileSize);
  const cellBounds = getVisibleCellBounds({
    width,
    height,
    cellSize,
    camera,
    viewportWidth,
    viewportHeight,
    overscanCells,
  });
  if (cellBounds.width === 0 || cellBounds.height === 0) {
    return {
      ...grid,
      tileSize,
      cellBounds,
      tiles: [],
      visibleTileCount: 0,
      visibleCellCount: 0,
    };
  }

  const minTileX = Math.floor(cellBounds.startX / tileSize);
  const maxTileX = Math.floor(cellBounds.endX / tileSize);
  const minTileY = Math.floor(cellBounds.startY / tileSize);
  const maxTileY = Math.floor(cellBounds.endY / tileSize);
  const tiles = [];
  let visibleCellCount = 0;
  for (let tileY = minTileY; tileY <= maxTileY; tileY += 1) {
    for (let tileX = minTileX; tileX <= maxTileX; tileX += 1) {
      const bounds = getTileBounds(tileX, tileY, width, height, tileSize);
      const visibleBounds = {
        minX: Math.max(bounds.minX, cellBounds.startX),
        minY: Math.max(bounds.minY, cellBounds.startY),
        maxX: Math.min(bounds.maxX, cellBounds.endX),
        maxY: Math.min(bounds.maxY, cellBounds.endY),
      };
      visibleCellCount += (visibleBounds.maxX - visibleBounds.minX + 1)
        * (visibleBounds.maxY - visibleBounds.minY + 1);
      tiles.push({ ...bounds, visibleBounds });
    }
  }
  return {
    ...grid,
    tileSize,
    cellBounds,
    tiles,
    visibleTileCount: tiles.length,
    visibleCellCount,
  };
}
