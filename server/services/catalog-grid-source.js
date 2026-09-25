import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { getTileBounds, getTileGrid } from './coloring-chunks.js';
import { readMediaObject } from './media-storage.js';

const DEFAULT_RAW_CACHE_BYTES = 8 * 1024 * 1024;
const GRID_KEY_PATTERN = /^catalog\/grids\/([a-z0-9_-]+)\.([a-f0-9]{64})\.u8\.gz$/;

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function gridError(code, message) {
  const error = new Error(message);
  error.name = 'CatalogGridSourceError';
  error.code = code;
  error.status = 503;
  return error;
}

function normalizeBytes(value) {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  return null;
}

function dimensions(template) {
  const width = Number(template?.width);
  const height = Number(template?.height);
  const tileSize = Number(template?.tile_size || 32);
  const paletteLength = Array.isArray(template?.palette) ? template.palette.length : 0;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 8 || height < 8
    || width > 1200 || height > 1200 || !Number.isInteger(tileSize) || tileSize < 8 || tileSize > 128
    || paletteLength < 2 || paletteLength > 32) {
    throw gridError('CATALOG_GRID_DIMENSIONS_INVALID', `Catalog grid dimensions are invalid: ${template?.id || 'unknown'}`);
  }
  return { width, height, tileSize, paletteLength };
}

export function buildCatalogTileColorCountVector(template, rawCells) {
  const { width, height, tileSize, paletteLength } = dimensions(template);
  const cells = normalizeBytes(rawCells);
  if (!cells || cells.length !== width * height) {
    throw gridError('CATALOG_GRID_SIZE_MISMATCH', `Catalog grid cell count is invalid: ${template.id}`);
  }
  const grid = getTileGrid(width, height, tileSize);
  const vector = Buffer.alloc(grid.tiles_x * grid.tiles_y * paletteLength * 2);
  let cursor = 0;
  for (let tileY = 0; tileY < grid.tiles_y; tileY += 1) {
    for (let tileX = 0; tileX < grid.tiles_x; tileX += 1) {
      const bounds = getTileBounds({ ...grid, tileX, tileY, tileSize });
      const counts = new Uint16Array(paletteLength);
      for (let y = 0; y < bounds.height; y += 1) {
        const rowOffset = (bounds.offset_y + y) * width + bounds.offset_x;
        for (let x = 0; x < bounds.width; x += 1) {
          const color = cells[rowOffset + x];
          if (color >= paletteLength) {
            throw gridError('CATALOG_GRID_PALETTE_INDEX_INVALID', `Catalog grid palette index is invalid: ${template.id}`);
          }
          counts[color] += 1;
        }
      }
      for (let color = 0; color < paletteLength; color += 1) {
        vector.writeUInt16LE(counts[color], cursor);
        cursor += 2;
      }
    }
  }
  return vector;
}

export function validateCatalogGridSourceDescriptor(source, template) {
  const { width, height, tileSize, paletteLength } = dimensions(template);
  const key = String(source?.object_key || '');
  const keyMatch = GRID_KEY_PATTERN.exec(key);
  const expectedRawBytes = width * height;
  const compressedBytes = Number(source?.compressed_bytes);
  const rawBytes = Number(source?.raw_bytes);
  const sourceSha = String(source?.sha256 || '').toLowerCase();
  if (!keyMatch || keyMatch[1] !== String(template.id) || keyMatch[2] !== sourceSha
    || !/^[a-f0-9]{64}$/.test(sourceSha)
    || !Number.isSafeInteger(compressedBytes) || compressedBytes < 1
    || compressedBytes > expectedRawBytes + 65_536 || rawBytes !== expectedRawBytes) {
    throw gridError('CATALOG_GRID_DESCRIPTOR_INVALID', `Catalog grid source metadata is invalid: ${template.id}`);
  }

  const tileCounts = normalizeBytes(source.tile_color_counts);
  const grid = getTileGrid(width, height, tileSize);
  const expectedCountBytes = grid.tiles_x * grid.tiles_y * paletteLength * 2;
  const countSha = String(source?.tile_color_counts_sha256 || '').toLowerCase();
  if (!tileCounts || tileCounts.length !== expectedCountBytes
    || !/^[a-f0-9]{64}$/.test(countSha) || sha256(tileCounts) !== countSha) {
    throw gridError('CATALOG_GRID_INDEX_INVALID', `Catalog grid tile-count index is invalid: ${template.id}`);
  }
  return { ...source, object_key: key, sha256: sourceSha, tile_color_counts: tileCounts, grid };
}

export function catalogGridTileColorCountsFromSource(source, template, tileX, tileY) {
  const { width, height, tileSize, paletteLength } = dimensions(template);
  const grid = source?.grid || getTileGrid(width, height, tileSize);
  const bounds = getTileBounds({ ...grid, tileX, tileY, tileSize });
  const vector = normalizeBytes(source?.tile_color_counts);
  const expectedBytes = grid.tiles_x * grid.tiles_y * paletteLength * 2;
  if (!vector || vector.length !== expectedBytes) {
    throw gridError('CATALOG_GRID_INDEX_INVALID', `Catalog grid tile-count index is invalid: ${template.id}`);
  }
  const tileOrdinal = bounds.tile_y * grid.tiles_x + bounds.tile_x;
  const offset = tileOrdinal * paletteLength * 2;
  const counts = new Map();
  let total = 0;
  for (let color = 0; color < paletteLength; color += 1) {
    const count = vector.readUInt16LE(offset + color * 2);
    if (count) counts.set(color, count);
    total += count;
  }
  if (total !== bounds.cell_count) {
    throw gridError('CATALOG_GRID_INDEX_INVALID', `Catalog grid tile-count totals do not match: ${template.id}:${bounds.tile_x}:${bounds.tile_y}`);
  }
  return { bounds, counts };
}

export function createCatalogGridSource({
  readObject = readMediaObject,
  maxRawCacheBytes = DEFAULT_RAW_CACHE_BYTES,
} = {}) {
  const rawCache = new Map();
  const inFlight = new Map();
  let cachedBytes = 0;

  async function loadDescriptor(db, template) {
    if (template?.source_type !== 'catalog') return null;
    if (typeof db?.get !== 'function') throw new TypeError('Catalog grid source requires db.get');
    const row = await db.get(
      `SELECT object_key, sha256, compressed_bytes, raw_bytes,
              tile_color_counts, tile_color_counts_sha256
         FROM coloring_catalog_grid_sources WHERE template_id=?`,
      [template.id],
    );
    return row ? validateCatalogGridSourceDescriptor(row, template) : null;
  }

  async function loadRaw(source, template) {
    const identity = `${source.object_key}:${source.sha256}`;
    const cached = rawCache.get(identity);
    if (cached) {
      rawCache.delete(identity);
      rawCache.set(identity, cached);
      return cached;
    }
    if (inFlight.has(identity)) return inFlight.get(identity);
    const pending = (async () => {
      const compressedValue = await readObject(source.object_key);
      const compressed = normalizeBytes(compressedValue);
      if (!compressed || compressed.length !== Number(source.compressed_bytes)
        || sha256(compressed) !== source.sha256) {
        throw gridError('CATALOG_GRID_OBJECT_CHECKSUM_MISMATCH', `Catalog grid object failed checksum validation: ${template.id}`);
      }
      let raw;
      try {
        raw = gunzipSync(compressed, { maxOutputLength: Number(source.raw_bytes) });
      } catch {
        throw gridError('CATALOG_GRID_OBJECT_INVALID', `Catalog grid object cannot be decoded: ${template.id}`);
      }
      const { paletteLength } = dimensions(template);
      if (raw.length !== Number(source.raw_bytes) || raw.some((color) => color >= paletteLength)) {
        throw gridError('CATALOG_GRID_OBJECT_INVALID', `Catalog grid object has invalid cells: ${template.id}`);
      }
      if (raw.length <= maxRawCacheBytes) {
        while (cachedBytes + raw.length > maxRawCacheBytes && rawCache.size) {
          const [oldestKey, oldest] = rawCache.entries().next().value;
          rawCache.delete(oldestKey);
          cachedBytes -= oldest.length;
        }
        rawCache.set(identity, raw);
        cachedBytes += raw.length;
      }
      return raw;
    })();
    inFlight.set(identity, pending);
    try {
      return await pending;
    } finally {
      inFlight.delete(identity);
    }
  }

  async function readTileFromSource(source, template, tileX, tileY) {
    const { width, height, tileSize } = dimensions(template);
    const grid = getTileGrid(width, height, tileSize);
    const bounds = getTileBounds({ ...grid, tileX, tileY, tileSize });
    const raw = await loadRaw(source, template);
    const cells = new Array(bounds.cell_count);
    for (let y = 0; y < bounds.height; y += 1) {
      const sourceOffset = (bounds.offset_y + y) * width + bounds.offset_x;
      const targetOffset = y * bounds.width;
      for (let x = 0; x < bounds.width; x += 1) cells[targetOffset + x] = raw[sourceOffset + x];
    }
    return { bounds, cells };
  }

  function buildTilesFromRaw(template, raw) {
    const { width, height, tileSize } = dimensions(template);
    const grid = getTileGrid(width, height, tileSize);
    const tiles = [];
    for (let tileY = 0; tileY < grid.tiles_y; tileY += 1) {
      for (let tileX = 0; tileX < grid.tiles_x; tileX += 1) {
        const { bounds, cells } = readTileFromRaw(raw, template, tileX, tileY);
        tiles.push({ tile_x: bounds.tile_x, tile_y: bounds.tile_y, width: bounds.width, height: bounds.height, cells });
      }
    }
    return tiles;
  }

  function readTileFromRaw(raw, template, tileX, tileY) {
    const { width, height, tileSize } = dimensions(template);
    const grid = getTileGrid(width, height, tileSize);
    const bounds = getTileBounds({ ...grid, tileX, tileY, tileSize });
    const cells = new Array(bounds.cell_count);
    for (let y = 0; y < bounds.height; y += 1) {
      const sourceOffset = (bounds.offset_y + y) * width + bounds.offset_x;
      const targetOffset = y * bounds.width;
      for (let x = 0; x < bounds.width; x += 1) cells[targetOffset + x] = raw[sourceOffset + x];
    }
    return { bounds, cells };
  }

  return Object.freeze({
    loadDescriptor,
    loadRaw,
    readTileFromSource,
    buildTilesFromRaw,
    readTileFromRaw,
    async readTile(db, template, tileX, tileY) {
      const source = await loadDescriptor(db, template);
      return source ? readTileFromSource(source, template, tileX, tileY) : null;
    },
    async readTiles(db, template) {
      const source = await loadDescriptor(db, template);
      if (!source) return null;
      const raw = await loadRaw(source, template);
      return buildTilesFromRaw(template, raw);
    },
    async readTileColorCounts(db, template, tileX, tileY) {
      const source = await loadDescriptor(db, template);
      if (!source) return null;
      return catalogGridTileColorCountsFromSource(source, template, tileX, tileY);
    },
  });
}

const catalogGridSource = createCatalogGridSource();

export const readCatalogGridSourceDescriptor = (...args) => catalogGridSource.loadDescriptor(...args);
export const readCatalogGridTile = (...args) => catalogGridSource.readTile(...args);
export const readCatalogGridTiles = (...args) => catalogGridSource.readTiles(...args);
export const readCatalogGridTileColorCounts = (...args) => catalogGridSource.readTileColorCounts(...args);
export const readCatalogGridTileFromSource = (...args) => catalogGridSource.readTileFromSource(...args);
export const readCatalogGridTilesFromRaw = (...args) => catalogGridSource.buildTilesFromRaw(...args);
