import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import {
  DEFAULT_TILE_SIZE,
  decodeCellBuffer,
  encodeCellBuffer,
  getTileBounds,
  getTileGridDimensions,
  isLargeGridTemplate,
  LEGACY_GRID_LIMIT,
  selectVisibleTiles,
  toTypedCellBuffer,
} from '../src/lib/tileGrid.js';

test('large grids always route through the tiled contract', () => {
  assert.equal(isLargeGridTemplate({ storage_mode: 'tiled', width: 32, height: 32 }), true);
  assert.equal(isLargeGridTemplate({ width: LEGACY_GRID_LIMIT + 1, height: 32 }), true);
  assert.equal(isLargeGridTemplate({ width: 32, height: LEGACY_GRID_LIMIT + 1 }), true);
  assert.equal(isLargeGridTemplate({ width: 1200, height: 1200 }), true);
  assert.equal(isLargeGridTemplate({ width: 160, height: 160 }), false);
  assert.equal(isLargeGridTemplate({ width: 32, height: 32 }), false);
  assert.equal(isLargeGridTemplate(null), false);
});

test('tile grid coordinates cover a 1200x1200 grid without oversized edge tiles', () => {
  const grid = getTileGridDimensions(1200, 1200, DEFAULT_TILE_SIZE);
  assert.deepEqual(grid, { columns: 19, rows: 19, count: 361 });

  const lastTile = getTileBounds(18, 18, 1200, 1200, DEFAULT_TILE_SIZE);
  assert.deepEqual(
    { minX: lastTile.minX, minY: lastTile.minY, maxX: lastTile.maxX, maxY: lastTile.maxY },
    { minX: 1152, minY: 1152, maxX: 1199, maxY: 1199 },
  );
  assert.equal(lastTile.width * lastTile.height, 48 * 48);
});

test('visible tile selection clips each tile to the viewport cell bounds', () => {
  const selection = selectVisibleTiles({
    width: 1200,
    height: 1200,
    tileSize: 64,
    cellSize: 32,
    camera: { x: -1900, y: -1900, zoom: 1 },
    viewportWidth: 390,
    viewportHeight: 844,
    overscanCells: 1,
  });

  assert.ok(selection.visibleTileCount > 0);
  assert.ok(selection.visibleTileCount < selection.count);
  assert.equal(selection.visibleCellCount, selection.cellBounds.width * selection.cellBounds.height);
  assert.ok(selection.tiles.every((tile) => (
    tile.visibleBounds.minX >= selection.cellBounds.startX
    && tile.visibleBounds.maxX <= selection.cellBounds.endX
    && tile.visibleBounds.minY >= selection.cellBounds.startY
    && tile.visibleBounds.maxY <= selection.cellBounds.endY
  )));
  assert.equal(new Set(selection.tiles.map((tile) => tile.key)).size, selection.visibleTileCount);
});

test('fully off-grid camera selects no cells or tiles', () => {
  const selection = selectVisibleTiles({
    width: 1200,
    height: 1200,
    camera: { x: -100000, y: -100000, zoom: 1 },
    viewportWidth: 390,
    viewportHeight: 844,
  });
  assert.equal(selection.visibleTileCount, 0);
  assert.equal(selection.visibleCellCount, 0);
});

test('cell buffers round-trip through compact typed encoding', () => {
  const values = [-1, 0, 3, 32767];
  const buffer = encodeCellBuffer(values, { type: 'int16' });
  const decoded = decodeCellBuffer(buffer, { type: 'int16' });

  assert.equal(buffer.byteLength, values.length * Int16Array.BYTES_PER_ELEMENT);
  assert.deepEqual([...decoded], values);
  decoded[0] = 99;
  assert.deepEqual(values, [-1, 0, 3, 32767]);
});

test('1200x1200 synthetic render foundation is typed and tile-bounded', () => {
  const width = 1200;
  const height = 1200;
  const cellCount = width * height;
  const startedAt = performance.now();
  // Use the same ordinary-array shape currently supplied by the session so the
  // timing includes the conversion cost paid by the Canvas boundary.
  const target = new Array(cellCount).fill(0);
  const filled = new Array(cellCount).fill(-1);
  const targetBuffer = toTypedCellBuffer(target, { type: 'uint16', length: cellCount });
  const filledBuffer = toTypedCellBuffer(filled, { type: 'int16', length: cellCount });
  const encodedFilled = encodeCellBuffer(filledBuffer, { type: 'int16' });
  const decodedFilled = decodeCellBuffer(encodedFilled, { type: 'int16' });
  const selection = selectVisibleTiles({
    width,
    height,
    tileSize: DEFAULT_TILE_SIZE,
    cellSize: 32,
    camera: { x: -1900, y: -1900, zoom: 1 },
    viewportWidth: 390,
    viewportHeight: 844,
    overscanCells: 1,
  });
  const elapsedMs = performance.now() - startedAt;

  assert.equal(targetBuffer.length, cellCount);
  assert.equal(decodedFilled.length, cellCount);
  assert.equal(encodedFilled.byteLength, cellCount * Int16Array.BYTES_PER_ELEMENT);
  assert.ok(selection.visibleTileCount < selection.count);
  assert.ok(selection.visibleCellCount < cellCount);
  assert.ok(selection.tiles.length * DEFAULT_TILE_SIZE * DEFAULT_TILE_SIZE < cellCount);
  // Keep the architectural invariant executable: the cell model is drawn through
  // one canvas and is not expanded into per-cell JSX nodes.
  const canvasSource = readFileSync(new URL('../src/features/coloring/ColoringCanvas.jsx', import.meta.url), 'utf8');
  const canvasNodeCount = (canvasSource.match(/<canvas\b/g) || []).length;
  const perCellMarkup = /(?:template\.cells|filled|targetCells)\.map\s*\(/.test(canvasSource);
  const domNodeBudget = canvasNodeCount;
  assert.equal(canvasNodeCount, 1);
  assert.equal(perCellMarkup, false);

  console.log(
    `[tileGrid benchmark] 1200x1200 cells=${cellCount} `
    + `typedBytes=${targetBuffer.byteLength + filledBuffer.byteLength} `
    + `encodedFilledBytes=${encodedFilled.byteLength} `
    + `visibleTiles=${selection.visibleTileCount}/${selection.count} `
    + `visibleCells=${selection.visibleCellCount}/${cellCount} `
    + `domNodes=${domNodeBudget} elapsedMs=${elapsedMs.toFixed(2)}`,
  );
});
