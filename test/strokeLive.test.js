import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  extendStroke,
  PAINT_STATUS,
  paintStrokeIndex,
} from '../src/features/coloring/large-grid/strokeLive.js';
import { rasterizeStroke } from '../src/features/coloring/engine/strokeRasterizer.js';

const WIDTH = 1200;
const HEIGHT = 1200;
const TILE = 32;

function makeTile(tileX, tileY, { color = 2 } = {}) {
  const offsetX = tileX * TILE;
  const offsetY = tileY * TILE;
  const width = Math.min(TILE, WIDTH - offsetX);
  const height = Math.min(TILE, HEIGHT - offsetY);
  const cellCount = width * height;
  const cells = new Uint16Array(cellCount);
  cells.fill(color);
  const filled = new Int16Array(cellCount);
  filled.fill(-1);
  return {
    key: `${tileX}:${tileY}`,
    tileX,
    tileY,
    offsetX,
    offsetY,
    width,
    height,
    cellCount,
    cells,
    filled,
  };
}

/** A cache of pre-loaded tiles (the READY workset): getTile never touches network. */
function makeWorkset(tileKeys, color = 2) {
  const tiles = new Map();
  for (const key of tileKeys) {
    const [tileX, tileY] = key.split(':').map(Number);
    tiles.set(key, makeTile(tileX, tileY, { color }));
  }
  return {
    getTile: (tileX, tileY) => tiles.get(`${tileX}:${tileY}`) || null,
    tiles,
  };
}

/** Every tile intersecting the cell rectangle [minX..maxX]x[minY..maxY]. */
function worksetForRange(minX, maxX, minY, maxY, color = 2) {
  const keys = [];
  for (let tileY = Math.floor(minY / TILE); tileY <= Math.floor(maxY / TILE); tileY += 1) {
    for (let tileX = Math.floor(minX / TILE); tileX <= Math.floor(maxX / TILE); tileX += 1) {
      keys.push(`${tileX}:${tileY}`);
    }
  }
  return makeWorkset(keys, color);
}

function idx(x, y) {
  return y * WIDTH + x;
}

function makePointer(color = 2) {
  return {
    color,
    lastIndex: null,
    indexSet: new Set(),
    changes: [],
    dirtyTiles: new Set(),
    unloadedCells: [],
    wrongDetected: false,
    wrongCell: null,
    rasterized: 0,
    unique: 0,
  };
}

function makeEnv(workset, mode = 'classic', onOutcome = null) {
  return {
    width: WIDTH,
    height: HEIGHT,
    tileSize: TILE,
    mode,
    getTile: workset.getTile,
    ...(onOutcome ? { onOutcome } : {}),
  };
}

function beginStroke(pointer, x, y, workset, mode = 'classic') {
  const index = idx(x, y);
  pointer.lastIndex = index;
  pointer.indexSet.add(index);
  const outcome = paintStrokeIndex(pointer, index, makeEnv(workset, mode));
  return outcome;
}

test('A — LIVE PAINT: cells are filled during the gesture, before any pointerup', () => {
  const workset = worksetForRange(200, 209, 200, 200);
  const pointer = makePointer();
  beginStroke(pointer, 200, 200, workset);
  const env = makeEnv(workset);
  for (let x = 201; x < 210; x += 1) extendStroke(pointer, idx(x, 200), env);
  const tile = workset.tiles.get('6:6');
  let painted = 0;
  for (let localIndex = 0; localIndex < tile.cellCount; localIndex += 1) {
    if (tile.filled[localIndex] === 2) painted += 1;
  }
  assert.equal(painted, 10, 'all 10 cells must already be painted in the tile');
  assert.equal(pointer.changes.length, 10);
  assert.equal(tile.filled[(200 % 32) + (200 % 32) * 32], 2);
});

test('B — NO QUADRATIC DEDUPE: every cell is processed exactly once per stroke', () => {
  const workset = worksetForRange(200, 449, 200, 200);
  const pointer = makePointer();
  beginStroke(pointer, 200, 200, workset);
  const outcomes = [];
  const env = makeEnv(workset, 'classic', (outcome) => outcomes.push(outcome));
  for (let x = 201; x <= 449; x += 1) extendStroke(pointer, idx(x, 200), env);
  for (let x = 448; x >= 200; x -= 1) extendStroke(pointer, idx(x, 200), env);
  assert.equal(pointer.changes.length, 250, 'each cell painted exactly once');
  assert.equal(
    outcomes.length,
    249,
    'paintStrokeIndex ran once per NEW unique cell (linear, not quadratic)',
  );
  const indexSet = new Set(pointer.changes.map((c) => c.index));
  assert.equal(indexSet.size, 250, 'no duplicate indices in changes');
});

test('C — GUIDE UPDATE: 100 cells in one tile produce ONE dirty tile (one refresh)', () => {
  const workset = worksetForRange(200, 209, 200, 209);
  const pointer = makePointer();
  beginStroke(pointer, 200, 200, workset);
  const env = makeEnv(workset);
  // A 10x10 zig-zag confined to tile 6:6 (cells x,y in 200..209).
  for (let y = 200; y < 210; y += 1) {
    if (y > 200) extendStroke(pointer, idx(200, y), env);
    for (let x = 201; x < 210; x += 1) extendStroke(pointer, idx(x, y), env);
  }
  assert.equal(pointer.changes.length, 100);
  assert.equal(pointer.dirtyTiles.size, 1, 'finalization refreshes the tile once, not 100 times');
});

test('D — MULTI TILE: a stroke across 3 tiles paints every valid cell with no network', () => {
  const workset = worksetForRange(300, 380, 300, 300);
  const pointer = makePointer();
  beginStroke(pointer, 300, 300, workset);
  const env = makeEnv(workset);
  for (let x = 301; x <= 380; x += 1) extendStroke(pointer, idx(x, 300), env);
  assert.equal(pointer.changes.length, 81);
  assert.deepEqual([...pointer.dirtyTiles].sort(), ['10:9', '11:9', '9:9']);
  for (let x = 300; x <= 380; x += 1) {
    const tileX = Math.floor(x / TILE);
    const tile = workset.tiles.get(`${tileX}:9`);
    const localIndex = (300 % TILE) * tile.width + (x % TILE);
    assert.equal(tile.filled[localIndex], 2, `cell x=${x} painted`);
  }
});

test('E — FAST SWIPE: sparse samples still produce a contiguous rasterized path', () => {
  const workset = worksetForRange(200, 260, 200, 200);
  const pointer = makePointer();
  beginStroke(pointer, 200, 200, workset);
  const env = makeEnv(workset);
  // Only 2 move samples for a 60-cell swipe: rasterization must fill gaps.
  extendStroke(pointer, idx(230, 200), env);
  extendStroke(pointer, idx(260, 200), env);
  const line = rasterizeStroke(idx(200, 200), idx(260, 200), WIDTH, HEIGHT);
  const painted = new Set(pointer.changes.map((c) => c.index));
  for (const index of line) {
    assert.equal(painted.has(index), true, `no hole at index ${index}`);
  }
  assert.equal(pointer.changes.length, line.length, 'every rasterized cell painted once');
});

test('F — SELF INTERSECTION: cell painted once, no duplicate changes', () => {
  const workset = worksetForRange(200, 240, 200, 240);
  const pointer = makePointer();
  beginStroke(pointer, 200, 200, workset);
  const env = makeEnv(workset);
  for (let step = 1; step <= 40; step += 1) extendStroke(pointer, idx(200 + step, 200 + step), env);
  for (let step = 39; step >= 1; step -= 1) extendStroke(pointer, idx(200 + step, 200 + step), env);
  assert.equal(pointer.changes.length, 41);
  const seen = new Set();
  for (const change of pointer.changes) {
    assert.equal(seen.has(change.index), false, 'duplicate change');
    seen.add(change.index);
  }
});

test('G — >64 CELLS: one gesture keeps one contiguous change list (batching is a network detail)', () => {
  const workset = worksetForRange(200, 300, 200, 200);
  const pointer = makePointer();
  beginStroke(pointer, 200, 200, workset);
  const env = makeEnv(workset);
  for (let x = 201; x <= 300; x += 1) extendStroke(pointer, idx(x, 200), env);
  assert.equal(pointer.changes.length, 101, 'the UI stroke is one unit, not split at 64');
});

test('H — WRONG COLOR MIX: correct cells paint, wrong stay empty, one bounded feedback', () => {
  const workset = worksetForRange(200, 206, 200, 200);
  const tile = workset.tiles.get('6:6');
  // (x=201,y=200) in tile 6:6 → localX=9, localY=8 → localIndex = 8*32+9 = 265.
  const wrongLocal = 8 * 32 + 9;
  tile.cells[wrongLocal] = 5;
  const pointer = makePointer(2);
  beginStroke(pointer, 200, 200, workset);
  const env = makeEnv(workset);
  for (let x = 201; x <= 206; x += 1) extendStroke(pointer, idx(x, 200), env);
  extendStroke(pointer, idx(201, 200), env); // revisit the wrong cell
  assert.equal(pointer.changes.length, 6, 'only correct cells painted');
  assert.equal(tile.filled[wrongLocal], -1, 'wrong cell stays empty');
  assert.equal(pointer.wrongDetected, true);
  assert.deepEqual(pointer.wrongCell, { index: idx(201, 200), target: 5 });
});

test('I — POINTER CANCEL: re-processing painted cells never duplicates changes', () => {
  const workset = worksetForRange(200, 210, 200, 200);
  const pointer = makePointer();
  beginStroke(pointer, 200, 200, workset);
  const env = makeEnv(workset);
  for (let x = 201; x <= 210; x += 1) extendStroke(pointer, idx(x, 200), env);
  const before = pointer.changes.length;
  const outcome = paintStrokeIndex(pointer, idx(205, 200), env);
  assert.equal(outcome.status, PAINT_STATUS.ALREADY_FILLED);
  assert.equal(pointer.changes.length, before, 'no duplicate changes on re-processing');
});

test('reveal mode paints every unfilled cell regardless of stroke color', () => {
  const workset = worksetForRange(200, 204, 200, 200, 3);
  const pointer = makePointer(0); // stroke color irrelevant in reveal mode
  beginStroke(pointer, 200, 200, workset, 'reveal');
  const env = makeEnv(workset, 'reveal');
  for (let x = 201; x <= 204; x += 1) extendStroke(pointer, idx(x, 200), env);
  assert.equal(pointer.changes.length, 5);
  for (const change of pointer.changes) assert.equal(change.to, 3, 'painted with the cell target color');
});

test('unloaded tiles are reported once and do not block painted cells', () => {
  const workset = worksetForRange(200, 223, 200, 200); // only tile 6:6 loaded
  const pointer = makePointer();
  beginStroke(pointer, 200, 200, workset);
  const env = makeEnv(workset);
  for (let x = 201; x <= 220; x += 1) extendStroke(pointer, idx(x, 200), env);
  assert.equal(pointer.changes.length, 21);
  assert.equal(pointer.unloadedCells.length, 0, 'all cells inside the loaded workset');
  // Cross into the unloaded tile 7:6: cells there are collected, loaded ones still paint.
  extendStroke(pointer, idx(230, 200), env); // x=221..230, of which 224..230 unloaded
  assert.equal(pointer.changes.length, 24, 'loaded cells (221..223) still painted');
  assert.ok(pointer.unloadedCells.length >= 7, 'unloaded cells collected once');
});
