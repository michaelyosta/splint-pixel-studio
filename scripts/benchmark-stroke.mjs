/**
 * Stroke engine benchmark — LEGACY vs TILED (before/after) on the real
 * production modules. Pure node, no DOM: measures the algorithmic hot path
 * exactly as the players run it per pointer event.
 *
 *   node scripts/benchmark-stroke.mjs [--after] [--quick]
 *
 * --after  : benchmark the post-fix pipeline (Set dedupe + live mutation +
 *            batched guide refresh) instead of the pre-fix pipeline
 *            (array-includes dedupe + deferred commit + per-cell tile rescan).
 * --quick  : fewer iterations (CI-friendly).
 *
 * Scenarios: tap, 5/20/50/100/250-cell, zig-zag, self-intersection,
 * horizontal, diagonal, cross-tile.
 *
 * Metrics per scenario:
 *   events        pointermove events delivered
 *   cells         rasterized cells (path length)
 *   unique        deduped unique cells
 *   valid         cells that pass color/loaded validation
 *   perEvent p50/p95  JS time per pointer event
 *   stroke total  whole-gesture JS time (events + finalization)
 *   finalize      pointerup finalization time
 *   guideTime     guide index update time
 */
import { performance } from 'node:perf_hooks';
import { rasterizeStroke } from '../src/features/coloring/engine/strokeRasterizer.js';
import { TileGuideIndex } from '../src/features/coloring/large-grid/guide.js';
import { LruTileCache, TileCellStore } from '../src/features/coloring/large-grid/tileCache.js';
import { createGridDescriptor, getTileBounds, locateCell } from '../src/features/coloring/large-grid/gridMath.js';

const WIDTH = 1200;
const HEIGHT = 1200;
const TILE = 32;
const PALETTE_LENGTH = 8;
const MAX_TILES = 48;

const args = new Set(process.argv.slice(2));
const AFTER = args.has('--after');
const QUICK = args.has('--quick');
const ITERATIONS = QUICK ? 4 : 14;

// Legacy comparison grid: the <=160-player the task anchors on.
const LEGACY_WIDTH = 128;
const LEGACY_HEIGHT = 128;

const grid = createGridDescriptor({ width: WIDTH, height: HEIGHT, tile_size: TILE });

function buildZones() {
  const rows = 4;
  const columns = 4;
  const zoneWidth = Math.ceil(WIDTH / columns);
  const zoneHeight = Math.ceil(HEIGHT / rows);
  return Array.from({ length: rows * columns }, (_, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    return {
      id: index,
      x: column * zoneWidth,
      y: row * zoneHeight,
      width: Math.min(zoneWidth, WIDTH - column * zoneWidth),
      height: Math.min(zoneHeight, HEIGHT - row * zoneHeight),
    };
  });
}

const zones = buildZones();

/** Build a client cache with the given tile keys resident (32x32, all cells
 *  target color `color`, unfilled), plus enough neighbours for cross-tile. */
function buildCache(color, tileKeys) {
  const cache = new LruTileCache({ maxTiles: MAX_TILES });
  for (const key of tileKeys) {
    const [tileX, tileY] = key.split(':').map(Number);
    const bounds = getTileBounds(grid, tileX, tileY);
    const cells = new Uint16Array(bounds.cellCount);
    cells.fill(color);
    const filled = new Int16Array(bounds.cellCount);
    filled.fill(-1);
    cache.set(key, { ...bounds, cells, filled, bytes: cells.byteLength + filled.byteLength });
  }
  return cache;
}

function buildStore(cache) {
  return new TileCellStore({ grid, cache });
}

/** Cells to cover: the union of tiles touching [minX..maxX]x[minY..maxY] */
function tileKeysForRect(minX, minY, maxX, maxY) {
  const keys = new Set();
  for (let tileY = Math.floor(minY / TILE); tileY <= Math.floor(maxY / TILE); tileY += 1) {
    for (let tileX = Math.floor(minX / TILE); tileX <= Math.floor(maxX / TILE); tileX += 1) {
      keys.add(`${tileX}:${tileY}`);
    }
  }
  return [...keys];
}

/**
 * Resident workset for a scenario: all tiles in the stroke rect plus a
 * one-tile halo, padded to the cache bound (48) with nearest neighbours so
 * minimap scans see a realistic resident set.
 */
function worksetKeys(rect) {
  const [minX, minY, maxX, maxY] = rect;
  const keys = new Set(tileKeysForRect(
    Math.max(0, minX - TILE),
    Math.max(0, minY - TILE),
    Math.min(WIDTH - 1, maxX + TILE),
    Math.min(HEIGHT - 1, maxY + TILE),
  ));
  const centerTileX = Math.floor((minX + maxX) / 2 / TILE);
  const centerTileY = Math.floor((minY + maxY) / 2 / TILE);
  let r = 1;
  while (keys.size < MAX_TILES && r < 40) {
    for (let ty = Math.max(0, centerTileY - r); ty <= centerTileY + r; ty += 1) {
      for (let tx = Math.max(0, centerTileX - r); tx <= centerTileX + r; tx += 1) {
        if (tx >= grid.columns || ty >= grid.rows) continue;
        keys.add(`${tx}:${ty}`);
        if (keys.size >= MAX_TILES) break;
      }
      if (keys.size >= MAX_TILES) break;
    }
    r += 1;
  }
  return [...keys].slice(0, MAX_TILES);
}

/** Simulated rebuildMinimapBase(): every resident tile, per-cell filled check. */
function minimapScanCost(cache) {
  const start = performance.now();
  let painted = 0;
  for (const tile of cache.values()) {
    for (let localIndex = 0; localIndex < tile.cellCount; localIndex += 1) {
      if (tile.filled[localIndex] !== -1) painted += 1;
    }
  }
  return performance.now() - start;
}

/**
 * Generate pointer samples for a stroke. Slow strokes sample every cell;
 * fast strokes sample every `step` cells (rasterization fills the gaps).
 */
function sampleLine(x0, y0, x1, y1, step = 1) {
  const points = [];
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  let cx = x0;
  let cy = y0;
  let n = 0;
  while (true) {
    if (n % step === 0) points.push({ x: cx, y: cy });
    if (cx === x1 && cy === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; cx += sx; }
    if (e2 <= dx) { err += dx; cy += sy; }
    n += 1;
  }
  if (points[points.length - 1].x !== x1 || points[points.length - 1].y !== y1) points.push({ x: x1, y: y1 });
  return points;
}

function zigZag(x0, y0, length, amplitude, step = 1) {
  const points = [];
  for (let i = 0; i <= length; i += step) {
    const x = x0 + i;
    const y = y0 + ((i % (amplitude * 2)) < amplitude ? i % amplitude : amplitude - (i % amplitude));
    points.push({ x, y });
  }
  return points;
}

function idx(x, y) { return y * WIDTH + x; }

const SCENARIOS = {
  '1-tap': {
    samples: [{ x: 200, y: 200 }],
    rect: [200, 200, 201, 201],
  },
  '5-cell-slow': {
    samples: sampleLine(200, 200, 204, 200, 1),
    rect: [200, 200, 205, 201],
  },
  '20-cell': {
    samples: sampleLine(200, 200, 219, 200, 1),
    rect: [200, 200, 220, 201],
  },
  '50-cell': {
    samples: sampleLine(200, 200, 249, 200, 1),
    rect: [200, 200, 250, 201],
  },
  '100-cell': {
    samples: sampleLine(200, 200, 299, 200, 1),
    rect: [200, 200, 300, 201],
  },
  '250-cell-fast': {
    samples: sampleLine(200, 200, 449, 200, 5),
    rect: [200, 200, 450, 201],
  },
  'zig-zag': {
    samples: zigZag(200, 200, 100, 8, 1),
    rect: [200, 200, 301, 209],
  },
  'self-intersection': {
    samples: [
      ...sampleLine(200, 200, 260, 260, 1),
      ...sampleLine(260, 260, 200, 200, 1),
    ],
    rect: [200, 200, 261, 261],
  },
  'horizontal-100': {
    samples: sampleLine(100, 300, 199, 300, 2),
    rect: [100, 300, 200, 301],
  },
  'diagonal-100': {
    samples: sampleLine(100, 100, 199, 199, 2),
    rect: [100, 100, 200, 200],
  },
  'cross-tile': {
    samples: sampleLine(300, 300, 460, 300, 2),
    rect: [300, 300, 461, 301],
  },
};

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function percentile(values, p) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index];
}

// performance.now() returns milliseconds with sub-ms precision.
function formatUs(ms) {
  return `${(ms * 1000).toFixed(1)}µs`;
}

function formatMs(ms) {
  return `${ms.toFixed(3)}ms`;
}

/* ------------------------------------------------------------------ */
/* LEGACY pipeline — exactly ColoringCanvas.jsx per-event logic        */
/* (128x128 grid: the <=160 player the acceptance test anchors on)     */
/* ------------------------------------------------------------------ */
function runLegacy(samples) {
  const color = 2;
  const filled = new Int16Array(LEGACY_WIDTH * LEGACY_HEIGHT);
  filled.fill(-1);
  const targets = new Uint16Array(LEGACY_WIDTH * LEGACY_HEIGHT);
  targets.fill(color);
  const legacyIdx = (x, y) => y * LEGACY_WIDTH + x;

  const perEvent = [];
  const start = performance.now();
  const stroke = {
    color,
    indices: [legacyIdx(samples[0].x, samples[0].y)],
    indexSet: new Set([legacyIdx(samples[0].x, samples[0].y)]),
    lastCell: legacyIdx(samples[0].x, samples[0].y),
  };
  let previewCells = 1;
  for (let s = 1; s < samples.length; s += 1) {
    const eventStart = performance.now();
    const index = legacyIdx(samples[s].x, samples[s].y);
    if (stroke.lastCell === index) continue;
    const cells = rasterizeStroke(stroke.lastCell, index, LEGACY_WIDTH, LEGACY_HEIGHT);
    stroke.lastCell = index;
    let added = 0;
    for (const ci of cells) {
      if (stroke.indexSet.has(ci)) continue;
      if (filled[ci] !== -1) continue;
      if (targets[ci] !== stroke.color) continue;
      stroke.indexSet.add(ci);
      stroke.indices.push(ci);
      added += 1;
    }
    previewCells += added;
    perEvent.push(performance.now() - eventStart);
  }
  // pointerup finalization: applyStroke copy + reducer + save queue enqueue
  const finalizeStart = performance.now();
  const next = [...filled];
  for (const ci of stroke.indices) next[ci] = stroke.color;
  const finalizeTime = performance.now() - finalizeStart;
  const total = performance.now() - start;
  return { perEvent, total, finalize: finalizeTime, painted: previewCells, guideTime: 0, minimapTime: 0 };
}

/* ------------------------------------------------------------------ */
/* TILED pipeline                                                      */
/* ------------------------------------------------------------------ */
function runTiledBefore(samples, scenario) {
  const color = 2;
  const cache = buildCache(color, worksetKeys(scenario.rect));
  const store = buildStore(cache);
  const guide = new TileGuideIndex({ zones, paletteLength: PALETTE_LENGTH, template: { width: WIDTH, height: HEIGHT } });
  for (const tile of cache.values()) guide.addTile(tile);

  const perEvent = [];
  const start = performance.now();
  const pointer = { lastIndex: idx(samples[0].x, samples[0].y), indices: [idx(samples[0].x, samples[0].y)] };
  for (let s = 1; s < samples.length; s += 1) {
    const eventStart = performance.now();
    const cellIndex = idx(samples[s].x, samples[s].y);
    if (pointer.lastIndex === cellIndex) continue;
    const path = rasterizeStroke(pointer.lastIndex, cellIndex, WIDTH, HEIGHT);
    pointer.lastIndex = cellIndex;
    for (const index of path) {
      // eslint-disable-next-line no-unused-expressions
      pointer.indices.includes(index) || pointer.indices.push(index);
    }
    perEvent.push(performance.now() - eventStart);
  }
  // pointerup → commitIndices (per-cell guide refreshTile + minimap rebuild)
  const finalizeStart = performance.now();
  const changes = [];
  let guideTime = 0;
  for (const index of pointer.indices) {
    const x = index % WIDTH;
    const y = Math.floor(index / WIDTH);
    const cell = store.getCell(x, y);
    if (!cell || !cell.loaded || cell.filled !== -1) continue;
    if (cell.target !== color) continue;
    store.updateFilled(x, y, color);
    const tile = cache.get(cell.tileKey);
    if (tile) {
      const g0 = performance.now();
      guide.refreshTile(tile);
      guideTime += performance.now() - g0;
    }
    changes.push(index);
  }
  const minimapTime = minimapScanCost(cache);
  const finalizeTime = performance.now() - finalizeStart;
  const total = performance.now() - start;
  return { perEvent, total, finalize: finalizeTime, painted: changes.length, guideTime, minimapTime };
}

function runTiledAfter(samples, scenario) {
  const color = 2;
  const cache = buildCache(color, worksetKeys(scenario.rect));
  const store = buildStore(cache);
  const guide = new TileGuideIndex({ zones, paletteLength: PALETTE_LENGTH, template: { width: WIDTH, height: HEIGHT } });
  for (const tile of cache.values()) guide.addTile(tile);

  const perEvent = [];
  const start = performance.now();
  const pointer = {
    lastIndex: idx(samples[0].x, samples[0].y),
    indices: [idx(samples[0].x, samples[0].y)],
    indexSet: new Set([idx(samples[0].x, samples[0].y)]),
    changes: [],
    dirtyTiles: new Set(),
  };
  const paintIndex = (index) => {
    const x = index % WIDTH;
    const y = Math.floor(index / WIDTH);
    const location = locateCell(grid, x, y);
    const tile = cache.peek(location.tileKey);
    if (!tile) return;
    if (tile.filled[location.localIndex] !== -1) return;
    if (tile.cells[location.localIndex] !== color) return;
    tile.filled[location.localIndex] = color;
    pointer.indices.push(index);
    pointer.changes.push(index);
    pointer.dirtyTiles.add(location.tileKey);
  };
  paintIndex(pointer.lastIndex);
  for (let s = 1; s < samples.length; s += 1) {
    const eventStart = performance.now();
    const cellIndex = idx(samples[s].x, samples[s].y);
    if (pointer.lastIndex === cellIndex) continue;
    const path = rasterizeStroke(pointer.lastIndex, cellIndex, WIDTH, HEIGHT);
    pointer.lastIndex = cellIndex;
    for (const index of path) {
      if (pointer.indexSet.has(index)) continue;
      pointer.indexSet.add(index);
      paintIndex(index);
    }
    perEvent.push(performance.now() - eventStart);
  }
  // pointerup finalize: batch guide refresh per changed tile ONCE
  const finalizeStart = performance.now();
  let guideTime = 0;
  for (const tileKey of pointer.dirtyTiles) {
    const tile = cache.peek(tileKey);
    if (tile) {
      const g0 = performance.now();
      guide.refreshTile(tile);
      guideTime += performance.now() - g0;
    }
  }
  const finalizeTime = performance.now() - finalizeStart;
  const total = performance.now() - start;
  return { perEvent, total, finalize: finalizeTime, painted: pointer.changes.length, guideTime, minimapTime: 0 };
}

/**
 * Map a 1200-grid sample set into the 128x128 legacy grid preserving the
 * gesture's shape: uniform scale+offset into [16,112]^2. Legacy players
 * can't fit a 250-cell stroke at 32px cells in one viewport either, so the
 * proportional shrink mirrors reality.
 */
function toLegacySamples(samples) {
  const xs = samples.map((p) => p.x);
  const ys = samples.map((p) => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const spanX = Math.max(1, maxX - minX);
  const spanY = Math.max(1, maxY - minY);
  const scale = Math.min(96 / spanX, 96 / spanY);
  const offsetX = 16 + (96 - spanX * scale) / 2 - minX * scale;
  const offsetY = 16 + (96 - spanY * scale) / 2 - minY * scale;
  return samples.map((p) => ({
    x: Math.round(p.x * scale + offsetX),
    y: Math.round(p.y * scale + offsetY),
  }));
}

function runScenario(name, scenario, run, legacy = false) {
  const samples = legacy ? toLegacySamples(scenario.samples) : scenario.samples;
  const perEventAll = [];
  const totalAll = [];
  const finalizeAll = [];
  const guideAll = [];
  const minimapAll = [];
  let painted = 0;
  for (let i = 0; i < ITERATIONS; i += 1) {
    const result = run(samples, scenario);
    perEventAll.push(...result.perEvent);
    totalAll.push(result.total);
    finalizeAll.push(result.finalize);
    guideAll.push(result.guideTime);
    minimapAll.push(result.minimapTime);
    painted = result.painted;
  }
  return {
    name,
    events: samples.length - 1,
    painted,
    perEventP50: median(perEventAll),
    perEventP95: percentile(perEventAll, 95),
    totalP50: median(totalAll),
    totalP95: percentile(totalAll, 95),
    finalizeP50: median(finalizeAll),
    finalizeP95: percentile(finalizeAll, 95),
    guideP50: median(guideAll),
    minimapP50: median(minimapAll),
  };
}

const pipeline = AFTER ? runTiledAfter : runTiledBefore;

console.log(`\n=== STROKE BENCHMARK — ${AFTER ? 'TILED AFTER (optimized pipeline)' : 'TILED BEFORE (current pipeline)'} ===`);
console.log(`grid ${WIDTH}x${HEIGHT}, tile ${TILE}, ${ITERATIONS} iterations, maxTiles ${MAX_TILES}\n`);
console.log('scenario'.padEnd(22), 'ev'.padEnd(4), 'cells'.padEnd(6), 'evP50'.padEnd(10), 'evP95'.padEnd(10), 'totP50'.padEnd(10), 'finalP50'.padEnd(10), 'finalP95'.padEnd(10), 'guideP50'.padEnd(10), 'miniP50');
const rows = [];
for (const [name, scenario] of Object.entries(SCENARIOS)) {
  const r = runScenario(name, scenario, pipeline);
  rows.push(r);
  console.log(
    r.name.padEnd(22),
    String(r.events).padEnd(4),
    String(r.painted).padEnd(6),
    formatUs(r.perEventP50).padEnd(10),
    formatUs(r.perEventP95).padEnd(10),
    formatMs(r.totalP50).padEnd(10),
    formatMs(r.finalizeP50).padEnd(10),
    formatMs(r.finalizeP95).padEnd(10),
    formatMs(r.guideP50).padEnd(10),
    formatMs(r.minimapP50),
  );
}

console.log('\n=== LEGACY pipeline (128x128, same gestures proportionally) ===');
console.log('scenario'.padEnd(22), 'ev'.padEnd(4), 'cells'.padEnd(6), 'evP50'.padEnd(10), 'evP95'.padEnd(10), 'totP50'.padEnd(10), 'finalP50'.padEnd(10), 'finalP95'.padEnd(10));
const legacyRows = [];
for (const [name, scenario] of Object.entries(SCENARIOS)) {
  const r = runScenario(name, scenario, runLegacy, true);
  legacyRows.push(r);
  console.log(
    r.name.padEnd(22),
    String(r.events).padEnd(4),
    String(r.painted).padEnd(6),
    formatUs(r.perEventP50).padEnd(10),
    formatUs(r.perEventP95).padEnd(10),
    formatMs(r.totalP50).padEnd(10),
    formatMs(r.finalizeP50).padEnd(10),
    formatMs(r.finalizeP95).padEnd(10),
  );
}
