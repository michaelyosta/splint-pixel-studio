import { createGridDescriptor, getTileBounds, locateCell, tileKey } from './gridMath.js';

export const UNFILLED_CELL = -1;

function isSharedArrayBuffer(value) {
  return typeof SharedArrayBuffer !== 'undefined' && value instanceof SharedArrayBuffer;
}

function isBuffer(value) {
  return value instanceof ArrayBuffer || isSharedArrayBuffer(value);
}

function toTypedArray(values, ArrayType, expectedLength, label, fillValue) {
  if (values === undefined || values === null) {
    const empty = new ArrayType(expectedLength);
    empty.fill(fillValue);
    return empty;
  }

  let output;
  if (isBuffer(values)) {
    if (values.byteLength % ArrayType.BYTES_PER_ELEMENT !== 0) {
      throw new TypeError(`${label} buffer is not aligned`);
    }
    output = new ArrayType(values);
  } else if (ArrayBuffer.isView(values)) {
    if (values.byteLength % ArrayType.BYTES_PER_ELEMENT !== 0) {
      throw new TypeError(`${label} buffer is not aligned`);
    }
    output = new ArrayType(values.buffer, values.byteOffset, values.byteLength / ArrayType.BYTES_PER_ELEMENT);
    output = new ArrayType(output);
  } else if (Array.isArray(values)) {
    output = new ArrayType(values);
  } else {
    throw new TypeError(`${label} must be an array or typed buffer`);
  }

  if (output.length !== expectedLength) {
    throw new RangeError(`${label} must contain exactly ${expectedLength} cells`);
  }
  return output;
}

function validateCellRange(values, { min, max, label }) {
  for (const value of values) {
    if (!Number.isInteger(value) || value < min || value > max) {
      throw new RangeError(`${label} contains a value outside the supported range`);
    }
  }
}

function readTileCoordinate(tile, longName, shortName) {
  const value = tile?.[longName] ?? tile?.[shortName];
  if (!Number.isInteger(value) && !(typeof value === 'string' && /^\d+$/.test(value))) {
    throw new TypeError(`Tile is missing ${longName}`);
  }
  return Number(value);
}

export function normalizeTilePayload(payload, { grid: gridSource, templateId } = {}) {
  if (!payload || typeof payload !== 'object' || !payload.tile) {
    throw new TypeError('Tile response is missing tile metadata');
  }
  const grid = createGridDescriptor(gridSource);
  if (templateId && payload.template_id && String(payload.template_id) !== String(templateId)) {
    throw new Error('Tile belongs to a different template');
  }
  const tileX = readTileCoordinate(payload.tile, 'x', 'tile_x');
  const tileY = readTileCoordinate(payload.tile, 'y', 'tile_y');
  const bounds = getTileBounds(grid, tileX, tileY);
  const declaredWidth = payload.tile.width;
  const declaredHeight = payload.tile.height;
  const declaredCount = payload.tile.cell_count;
  if (declaredWidth !== undefined && Number(declaredWidth) !== bounds.width) {
    throw new RangeError('Tile width does not match manifest bounds');
  }
  if (declaredHeight !== undefined && Number(declaredHeight) !== bounds.height) {
    throw new RangeError('Tile height does not match manifest bounds');
  }
  if (declaredCount !== undefined && Number(declaredCount) !== bounds.cellCount) {
    throw new RangeError('Tile cell count does not match manifest bounds');
  }

  const cells = toTypedArray(payload.cells, Uint16Array, bounds.cellCount, 'cells', 0);
  const filled = toTypedArray(payload.filled, Int16Array, bounds.cellCount, 'filled', UNFILLED_CELL);
  validateCellRange(cells, { min: 0, max: 65_535, label: 'cells' });
  validateCellRange(filled, { min: -1, max: 32_767, label: 'filled' });
  return {
    key: bounds.key,
    tileX: bounds.tileX,
    tileY: bounds.tileY,
    tile_x: bounds.tile_x,
    tile_y: bounds.tile_y,
    offsetX: bounds.offsetX,
    offsetY: bounds.offsetY,
    offset_x: bounds.offset_x,
    offset_y: bounds.offset_y,
    width: bounds.width,
    height: bounds.height,
    cellCount: bounds.cellCount,
    cell_count: bounds.cell_count,
    cells,
    filled,
    progress: payload.progress ? { ...payload.progress } : null,
    contentRevision: payload.content_revision ?? null,
    bytes: cells.byteLength + filled.byteLength,
  };
}

export class LruTileCache {
  constructor({ maxTiles = 24, onEvict } = {}) {
    if (!Number.isInteger(maxTiles) || maxTiles < 1) {
      throw new RangeError('maxTiles must be a positive integer');
    }
    this.maxTiles = maxTiles;
    this.onEvict = typeof onEvict === 'function' ? onEvict : null;
    this.entries = new Map();
    this.pinned = new Set();
  }

  get size() {
    return this.entries.size;
  }

  has(key) {
    return this.entries.has(key);
  }

  get(key) {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }

  peek(key) {
    return this.entries.get(key)?.value;
  }

  set(key, value, { pin = false } = {}) {
    if (this.entries.has(key)) this.entries.delete(key);
    this.entries.set(key, { value });
    if (pin) this.pinned.add(key);
    this.evictIfNeeded();
    return value;
  }

  delete(key) {
    const entry = this.entries.get(key);
    if (!entry) return false;
    this.entries.delete(key);
    this.pinned.delete(key);
    this.notifyEviction(key, entry.value);
    return true;
  }

  clear() {
    for (const [key, entry] of this.entries) this.notifyEviction(key, entry.value);
    this.entries.clear();
    this.pinned.clear();
  }

  keys() {
    return [...this.entries.keys()];
  }

  values() {
    return [...this.entries.values()].map((entry) => entry.value);
  }

  setPinnedKeys(keys = []) {
    this.pinned = new Set(keys);
    this.evictIfNeeded();
  }

  pin(key) {
    if (this.entries.has(key)) this.pinned.add(key);
    this.evictIfNeeded();
  }

  unpin(key) {
    this.pinned.delete(key);
  }

  stats() {
    let cells = 0;
    let bytes = 0;
    for (const entry of this.entries.values()) {
      cells += Number(entry.value.cellCount || entry.value.cell_count || 0);
      bytes += Number(entry.value.bytes || 0);
    }
    return {
      tiles: this.size,
      maxTiles: this.maxTiles,
      cells,
      bytes,
      pinnedTiles: [...this.pinned].filter((key) => this.entries.has(key)).length,
    };
  }

  evictIfNeeded() {
    while (this.entries.size > this.maxTiles) {
      let candidateKey;
      for (const key of this.entries.keys()) {
        if (!this.pinned.has(key)) {
          candidateKey = key;
          break;
        }
      }
      // Pinned (visible) tiles are a hard invariant: they must never be
      // evicted to satisfy the soft cache bound. The cache may temporarily
      // grow above maxTiles while the pinned set itself exceeds the limit.
      if (candidateKey === undefined) break;
      const entry = this.entries.get(candidateKey);
      this.entries.delete(candidateKey);
      this.pinned.delete(candidateKey);
      this.notifyEviction(candidateKey, entry.value);
    }
  }

  notifyEviction(key, value) {
    try {
      this.onEvict?.(key, value);
    } catch {
      // Cache eviction must not break the caller that is enforcing the bound.
    }
  }
}

export class TileCellStore {
  constructor({ grid, cache } = {}) {
    this.grid = createGridDescriptor(grid);
    this.cache = cache || new LruTileCache();
  }

  setTile(tile) {
    if (!tile || !tile.key) throw new TypeError('TileCellStore requires a normalized tile');
    this.cache.set(tile.key, tile);
    return tile;
  }

  getTile(tileX, tileY) {
    return this.cache.get(tileKey(tileX, tileY));
  }

  getCell(x, y) {
    const location = locateCell(this.grid, x, y);
    if (!location) return null;
    const tile = this.cache.get(location.tileKey);
    if (!tile) return { ...location, loaded: false, target: null, filled: null };
    return {
      ...location,
      loaded: true,
      target: tile.cells[location.localIndex],
      filled: tile.filled[location.localIndex],
    };
  }

  updateFilled(x, y, value) {
    if (!Number.isInteger(value) || value < -1 || value > 32_767) {
      throw new RangeError('Filled cell value is outside the supported range');
    }
    const location = locateCell(this.grid, x, y);
    if (!location) return false;
    const tile = this.cache.get(location.tileKey);
    if (!tile) return false;
    tile.filled[location.localIndex] = value;
    return true;
  }

  stats() {
    return this.cache.stats();
  }
}
