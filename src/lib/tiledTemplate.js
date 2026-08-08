export const TILED_TILE_SIZE = 32;
export const TILED_MIN_DIMENSION = 161;
export const TILED_MAX_DIMENSION = 1_200;

function assertTiledDimension(value, label) {
  if (!Number.isSafeInteger(value)
    || value < TILED_MIN_DIMENSION
    || value > TILED_MAX_DIMENSION) {
    throw new RangeError(
      `${label} must be an integer between ${TILED_MIN_DIMENSION} and ${TILED_MAX_DIMENSION}`,
    );
  }
}

function assertTemplateInput({ width, height, palette, cells }) {
  assertTiledDimension(width, 'Tiled width');
  assertTiledDimension(height, 'Tiled height');

  if (!Array.isArray(palette) || palette.length === 0) {
    throw new TypeError('Palette must be a non-empty array');
  }
  if (!Array.isArray(cells) || cells.length !== width * height) {
    throw new RangeError(`Cells must contain exactly ${width * height} entries`);
  }
  for (const color of cells) {
    if (!Number.isInteger(color) || color < 0 || color >= palette.length) {
      throw new RangeError('Cells must contain integer palette indices');
    }
  }
}

function jsonByteLength(value) {
  const json = JSON.stringify(value);
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(json).byteLength;

  let bytes = 0;
  for (const character of json) {
    const codePoint = character.codePointAt(0);
    bytes += codePoint <= 0x7f ? 1 : codePoint <= 0x7ff ? 2 : codePoint <= 0xffff ? 3 : 4;
  }
  return bytes;
}

/**
 * Convert a creatorResult-style row-major grid into plain JSON tile records.
 * Tile x/y are zero-based tile coordinates, not cell offsets.
 */
export function createTiledTemplate({ width, height, palette, cells } = {}) {
  assertTemplateInput({ width, height, palette, cells });

  const columns = Math.ceil(width / TILED_TILE_SIZE);
  const rows = Math.ceil(height / TILED_TILE_SIZE);
  const tiles = [];

  for (let y = 0; y < rows; y += 1) {
    const originY = y * TILED_TILE_SIZE;
    const tileHeight = Math.min(TILED_TILE_SIZE, height - originY);
    for (let x = 0; x < columns; x += 1) {
      const originX = x * TILED_TILE_SIZE;
      const tileWidth = Math.min(TILED_TILE_SIZE, width - originX);
      const tileCells = [];

      for (let localY = 0; localY < tileHeight; localY += 1) {
        const rowStart = (originY + localY) * width + originX;
        for (let localX = 0; localX < tileWidth; localX += 1) {
          tileCells.push(cells[rowStart + localX]);
        }
      }

      tiles.push({ x, y, width: tileWidth, height: tileHeight, cells: tileCells });
    }
  }

  const payload = { width, height, palette: [...palette], tiles };
  return {
    ...payload,
    tileCount: tiles.length,
    sizeBytes: jsonByteLength(payload),
  };
}

/**
 * Same contract as createTiledTemplate, but yields to the main thread every
 * `yieldEvery` tile rows so a WebView without Worker support stays
 * responsive while a 1200Г—1200 map is converted.
 */
export async function createTiledTemplateAsync({ width, height, palette, cells } = {}, { yieldEvery = 24 } = {}) {
  assertTemplateInput({ width, height, palette, cells });

  const columns = Math.ceil(width / TILED_TILE_SIZE);
  const rows = Math.ceil(height / TILED_TILE_SIZE);
  const tiles = [];

  for (let y = 0; y < rows; y += 1) {
    if (Number.isInteger(yieldEvery) && yieldEvery > 0 && y % yieldEvery === 0) {
      if (typeof scheduler !== 'undefined' && typeof scheduler.yield === 'function') await scheduler.yield();
      else await new Promise((resolve) => setTimeout(resolve, 0));
    }
    const originY = y * TILED_TILE_SIZE;
    const tileHeight = Math.min(TILED_TILE_SIZE, height - originY);
    for (let x = 0; x < columns; x += 1) {
      const originX = x * TILED_TILE_SIZE;
      const tileWidth = Math.min(TILED_TILE_SIZE, width - originX);
      const tileCells = [];

      for (let localY = 0; localY < tileHeight; localY += 1) {
        const rowStart = (originY + localY) * width + originX;
        for (let localX = 0; localX < tileWidth; localX += 1) {
          tileCells.push(cells[rowStart + localX]);
        }
      }

      tiles.push({ x, y, width: tileWidth, height: tileHeight, cells: tileCells });
    }
  }

  const payload = { width, height, palette: [...palette], tiles };
  return {
    ...payload,
    tileCount: tiles.length,
    sizeBytes: jsonByteLength(payload),
  };
}
