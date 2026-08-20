import test from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import {
  createGridDescriptor,
  getTileBounds,
  GRID_LOD_MODE,
  mapPointerToCell,
  resolveGridLodMode,
  selectViewportTiles,
} from '../src/features/coloring/large-grid/gridMath.js';
import { LruTileCache, normalizeTilePayload } from '../src/features/coloring/large-grid/tileCache.js';
import {
  createProgressiveGridClient,
  loadGuidance,
  loadGridManifest,
} from '../src/lib/progressiveGridClient.js';

const WIDTH = 1_200;
const HEIGHT = 1_200;
const TILE_SIZE = 32;

function manifestPayload() {
  return {
    schema_version: 1,
    template_id: 'synthetic-1200',
    content_revision: 'synthetic-revision-1',
    template: {
      id: 'synthetic-1200',
      title: 'Synthetic 1200',
      width: WIDTH,
      height: HEIGHT,
      palette: ['#000000', '#ffffff'],
    },
    grid: {
      width: WIDTH,
      height: HEIGHT,
      tile_size: TILE_SIZE,
      tiles_x: 38,
      tiles_y: 38,
      encoding: 'row-major-palette-index',
    },
    progress: { revision: 0, completed_cells: 0, total_cells: WIDTH * HEIGHT, percent: 0 },
    links: {
      tile: '/colorings/synthetic-1200/tiles/{tile_x}/{tile_y}',
    },
  };
}

function tilePayload(tileX, tileY) {
  const bounds = getTileBounds({ width: WIDTH, height: HEIGHT, tile_size: TILE_SIZE }, tileX, tileY);
  return {
    schema_version: 1,
    template_id: 'synthetic-1200',
    tile: {
      x: tileX,
      y: tileY,
      offset_x: bounds.offsetX,
      offset_y: bounds.offsetY,
      width: bounds.width,
      height: bounds.height,
      cell_count: bounds.cellCount,
    },
    cells: Array.from({ length: bounds.cellCount }, (_, index) => (tileX + tileY + index) % 2),
    filled: Array(bounds.cellCount).fill(-1),
    progress: { revision: 0, completed_cells: 0, percent: 0 },
  };
}

function jsonResponse(payload, { ok = true, status = 200 } = {}) {
  return { ok, status, json: async () => payload };
}

function tileCoordinates(url) {
  const match = String(url).match(/\/tiles\/(\d+)\/(\d+)/);
  return match ? [Number(match[1]), Number(match[2])] : null;
}

test('manifest loader keeps a 1200x1200 manifest metadata-only', async () => {
  const manifest = await loadGridManifest({
    url: '/api/colorings/synthetic-1200/manifest',
    fetchImpl: async () => jsonResponse(manifestPayload()),
  });

  assert.equal(manifest.grid.totalCells, 1_440_000);
  assert.equal(manifest.grid.count, 1_444);
  assert.equal('cells' in manifest, false);
  assert.equal('filled' in manifest, false);
  assert.equal('cells' in manifest.template, false);
  assert.equal(manifest.grid.tileSize, TILE_SIZE);
});

test('guidance client carries the Phase 2 session-game gate to the server', async () => {
  const calls = [];
  const guidance = await loadGuidance({
    url: '/api/colorings/phase2-fixture/guidance',
    templateId: 'phase2-fixture',
    sessionGame: true,
    fetchImpl: async (url) => {
      calls.push(String(url));
      return jsonResponse({
        schema_version: 1,
        template_id: 'phase2-fixture',
        progress_revision: 0,
        reason: 'INITIAL_TARGET',
        selected_color: 0,
        global_remaining_for_color: 8,
        target: {
          tile_x: 0,
          tile_y: 0,
          anchor_x: 2,
          anchor_y: 2,
          bounds: { min_x: 0, min_y: 0, max_x: 4, max_y: 4, width: 5, height: 5 },
          estimated_cells: 8,
          color: 0,
        },
      });
    },
  });
  assert.equal(guidance.target.estimated_cells, 8);
  assert.match(calls[0], /session_game=1/);
});

test('overview zoom uses the preview contract and does not request detail tiles', async () => {
  const calls = [];
  const client = createProgressiveGridClient({
    templateId: 'synthetic-1200',
    maxTiles: 12,
    fetchImpl: async (url) => {
      calls.push(String(url));
      if (String(url).endsWith('/manifest')) return jsonResponse(manifestPayload());
      const coordinates = tileCoordinates(url);
      assert.ok(coordinates, `unexpected tile URL: ${url}`);
      return jsonResponse(tilePayload(...coordinates));
    },
  });

  // Whole-grid overview camera: at this zoom every one of the 1444 tiles is
  // "visible". The client must fetch only a bounded centre-neighbourhood.
  const result = await client.loadViewport({
    camera: { x: 0, y: 0, zoom: 0.08 },
    viewportWidth: 390,
    viewportHeight: 800,
    cellSize: TILE_SIZE,
    mode: GRID_LOD_MODE.OVERVIEW,
    overscanTiles: 0,
    maxPrefetchTiles: 4,
  });

  const tileCalls = calls.filter((url) => url.includes('/tiles/'));
  assert.equal(tileCalls.length, 0, 'overview must not request detail tiles');
  assert.equal(result.mode, GRID_LOD_MODE.OVERVIEW);
  assert.equal(result.visible.length, 0);
  assert.equal(result.errors.length, 0);
  assert.equal(result.cache.tiles, 0, 'overview does not populate the detail cache');
  assert.equal(client.getNetworkStats().overviewPlans, 1);
});

test('LOD hysteresis keeps pinch near the renderer boundary in one mode', () => {
  assert.equal(resolveGridLodMode(3.9, GRID_LOD_MODE.OVERVIEW), GRID_LOD_MODE.OVERVIEW);
  assert.equal(resolveGridLodMode(6, GRID_LOD_MODE.OVERVIEW), GRID_LOD_MODE.WORK);
  assert.equal(resolveGridLodMode(5, GRID_LOD_MODE.WORK), GRID_LOD_MODE.WORK);
  assert.equal(resolveGridLodMode(3.99, GRID_LOD_MODE.WORK), GRID_LOD_MODE.OVERVIEW);
});

test('synthetic 1200x1200 viewport loads visible and overscan tiles into typed bounded storage', async () => {
  const calls = [];
  const client = createProgressiveGridClient({
    templateId: 'synthetic-1200',
    maxTiles: 12,
    fetchImpl: async (url) => {
      calls.push(String(url));
      if (String(url).endsWith('/manifest')) return jsonResponse(manifestPayload());
      const coordinates = tileCoordinates(url);
      assert.ok(coordinates, `unexpected tile URL: ${url}`);
      return jsonResponse(tilePayload(...coordinates));
    },
  });

  const startedAt = performance.now();
  const result = await client.loadViewport({
    camera: { x: -20 * TILE_SIZE, y: -10 * TILE_SIZE, zoom: 1 },
    viewportWidth: 390,
    viewportHeight: 800,
    cellSize: TILE_SIZE,
    overscanTiles: 1,
    maxPrefetchTiles: 8,
  });
  const elapsedMs = performance.now() - startedAt;

  assert.equal(result.errors.length, 0);
  assert.equal(result.visible.length, 4);
  assert.equal(result.prefetched.length, 5);
  assert.equal(result.plan.all.length, 9);
  assert.ok(result.plan.all.length < 38 * 38, 'only the viewport neighbourhood is requested');
  assert.ok(result.cache.tiles <= 12, 'cache remains bounded');
  assert.equal(calls.filter((url) => url.endsWith('/manifest')).length, 1);
  assert.equal(calls.filter((url) => url.includes('/tiles/')).length, 9);

  const loadedCell = client.getCell(20, 10);
  assert.equal(loadedCell.loaded, true);
  assert.equal(loadedCell.target, 0);
  assert.equal(loadedCell.filled, -1);
  assert.equal(Array.isArray(result.visible[0].cells), false);
  assert.equal(result.visible[0].cells instanceof Uint16Array, true);
  assert.equal(result.visible[0].filled instanceof Int16Array, true);
  assert.ok(result.cache.cells <= 12 * TILE_SIZE * TILE_SIZE);
  assert.ok(elapsedMs < 500, `synthetic tile selection should stay bounded (${elapsedMs.toFixed(2)}ms)`);

  console.log(
    `[progressive-grid benchmark] grid=${WIDTH}x${HEIGHT} cells=${WIDTH * HEIGHT} `
    + `visibleTiles=${result.visible.length} prefetchedTiles=${result.prefetched.length} `
    + `cachedTiles=${result.cache.tiles}/${result.cache.maxTiles} `
    + `typedBytes=${result.cache.bytes} elapsedMs=${elapsedMs.toFixed(2)}`,
  );
  client.destroy();
});

test('resident tile cache can reconcile acknowledged journal changes after reload', async () => {
  const client = createProgressiveGridClient({
    templateId: 'synthetic-1200',
    maxTiles: 4,
    fetchImpl: async (url) => {
      if (String(url).endsWith('/manifest')) return jsonResponse(manifestPayload());
      const coordinates = tileCoordinates(url);
      return jsonResponse(tilePayload(...coordinates));
    },
  });

  await client.loadManifest();
  await client.fetchTile(0, 0);
  assert.equal(client.getCell(3, 2).filled, -1);

  // This is the post-reload path: the server has acknowledged a durable
  // journal batch, but the renderer already has the pre-replay tile resident.
  assert.equal(client.updateFilled(3, 2, 1), true);
  assert.equal(client.getCell(3, 2).filled, 1);
  client.destroy();
});

test('LRU cache evicts the least recently used unpinned tile and stays bounded', () => {
  const evicted = [];
  const cache = new LruTileCache({ maxTiles: 2, onEvict: (key) => evicted.push(key) });
  cache.set('0:0', { cellCount: 1, bytes: 4 });
  cache.set('1:0', { cellCount: 1, bytes: 4 });
  assert.equal(cache.get('0:0').cellCount, 1);
  cache.set('2:0', { cellCount: 1, bytes: 4 });

  assert.deepEqual(cache.keys(), ['0:0', '2:0']);
  assert.deepEqual(evicted, ['1:0']);
  assert.equal(cache.size, 2);

  cache.setPinnedKeys(['0:0']);
  cache.set('3:0', { cellCount: 1, bytes: 4 });
  assert.equal(cache.has('0:0'), true, 'retained viewport tile is protected while another tile can evict');
  assert.equal(cache.size, 2);
});

test('pinned visible tiles are a hard invariant and are never evicted', () => {
  const evicted = [];
  const cache = new LruTileCache({ maxTiles: 2, onEvict: (key) => evicted.push(key) });
  // Simulate an overview of a 1200x1200 map where the visible set (55 tiles)
  // exceeds the nominal cache limit (2 here).
  const pinnedKeys = [];
  for (let index = 0; index < 5; index += 1) pinnedKeys.push(`${index}:0`);
  cache.setPinnedKeys(pinnedKeys);
  for (const key of pinnedKeys) cache.set(key, { cellCount: 1, bytes: 4 });
  assert.equal(cache.size, 5);

  // Adding an unpinned tile cannot grow the cache beyond pinned capacity:
  // the only eviction candidate is the unpinned tile itself, and pinned
  // visible tiles must survive.
  cache.set('9:9', { cellCount: 1, bytes: 4 });
  assert.equal(cache.has('9:9'), false);
  assert.equal(cache.size, 5);
  assert.deepEqual(evicted, ['9:9']);
  for (const key of pinnedKeys) {
    assert.equal(cache.has(key), true, `pinned tile ${key} must survive pressure`);
  }

  // Releasing the pins returns the cache to the nominal bound.
  cache.setPinnedKeys([]);
  assert.equal(cache.size, 2);
  assert.equal(evicted.length, 4);
});

test('concurrent tile requests are deduplicated and one aborted consumer does not poison another', async () => {
  let tileCalls = 0;
  let releaseTile;
  const client = createProgressiveGridClient({
    templateId: 'synthetic-1200',
    fetchImpl: async (url, { signal } = {}) => {
      if (String(url).endsWith('/manifest')) return jsonResponse(manifestPayload());
      tileCalls += 1;
      return new Promise((resolve, reject) => {
        releaseTile = () => resolve(jsonResponse(tilePayload(0, 0)));
        signal?.addEventListener('abort', () => {
          const error = new Error('aborted');
          error.name = 'AbortError';
          reject(error);
        }, { once: true });
      });
    },
  });
  await client.loadManifest();

  const firstController = new AbortController();
  const first = client.fetchTile(0, 0, { signal: firstController.signal });
  const second = client.fetchTile(0, 0);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(tileCalls, 1);

  firstController.abort();
  await assert.rejects(first, (error) => error.name === 'AbortError');
  releaseTile();
  const tile = await second;
  assert.equal(tile.key, '0:0');
  assert.equal(tileCalls, 1, 'the second consumer reused the first request');
  assert.equal(client.getCell(0, 0).loaded, true);
  client.destroy();
});

test('one tile HTTP 502 stays recoverable and retry restores only that tile', async () => {
  let tileAttempts = 0;
  const client = createProgressiveGridClient({
    templateId: 'synthetic-1200',
    fetchImpl: async (url) => {
      if (String(url).endsWith('/manifest')) return jsonResponse(manifestPayload());
      tileAttempts += 1;
      if (tileAttempts === 1) return jsonResponse({ error: 'temporary tile failure' }, { ok: false, status: 502 });
      return jsonResponse(tilePayload(0, 0));
    },
  });

  const failed = await client.loadViewport({
    camera: { x: 0, y: 0, zoom: 1 },
    viewportWidth: 32,
    viewportHeight: 32,
    cellSize: TILE_SIZE,
    overscanTiles: 0,
    maxPrefetchTiles: 0,
  });
  assert.equal(failed.errors.length, 1);
  assert.equal(client.getSnapshot().status, 'ready');
  assert.equal(client.getSnapshot().tileErrors['0:0'].status, 502);

  const tile = await client.retryTile(0, 0);
  assert.equal(tile.key, '0:0');
  assert.equal(client.getSnapshot().tileErrors['0:0'], undefined);
  assert.equal(client.getSnapshot().status, 'ready');
  client.destroy();
});

test('offline detail failure preserves a resident tile and never becomes global offline', async () => {
  let tileAttempts = 0;
  const client = createProgressiveGridClient({
    templateId: 'synthetic-1200',
    fetchImpl: async (url) => {
      if (String(url).endsWith('/manifest')) return jsonResponse(manifestPayload());
      tileAttempts += 1;
      if (tileAttempts === 1) return jsonResponse(tilePayload(0, 0));
      throw new TypeError('Failed to fetch');
    },
  });

  await client.loadViewport({
    camera: { x: 0, y: 0, zoom: 1 },
    viewportWidth: 32,
    viewportHeight: 32,
    cellSize: TILE_SIZE,
    overscanTiles: 0,
    maxPrefetchTiles: 0,
  });
  const result = await client.loadViewport({
    camera: { x: -(TILE_SIZE * TILE_SIZE), y: 0, zoom: 1 },
    viewportWidth: 32,
    viewportHeight: 32,
    cellSize: TILE_SIZE,
    overscanTiles: 0,
    maxPrefetchTiles: 0,
  });
  assert.equal(result.errors.length, 1);
  assert.equal(client.cache.has('0:0'), true);
  assert.equal(client.getSnapshot().status, 'ready');
  assert.equal(client.getSnapshot().tileErrors['1:0'].kind, 'offline');
  client.destroy();
});

test('pointer mapping returns global row-major and tile-local coordinates', () => {
  const grid = createGridDescriptor({ width: WIDTH, height: HEIGHT, tile_size: TILE_SIZE });
  const cell = mapPointerToCell({
    clientX: 1_102,
    clientY: 1_081,
    rect: { left: 10, top: 20 },
    camera: { x: -64, y: -32, zoom: 1 },
    cellSize: TILE_SIZE,
    grid,
  });

  assert.deepEqual(cell, {
    x: 36,
    y: 34,
    index: 40_836,
    tileX: 1,
    tileY: 1,
    tileKey: '1:1',
    localX: 4,
    localY: 2,
    localIndex: 68,
  });
  assert.equal(mapPointerToCell({
    clientX: -500,
    clientY: -500,
    rect: { left: 0, top: 0 },
    camera: { x: 0, y: 0, zoom: 1 },
    cellSize: TILE_SIZE,
    grid,
  }), null);
});

test('offline and HTTP failures produce explicit recoverable client states', async () => {
  const offlineClient = createProgressiveGridClient({
    templateId: 'synthetic-1200',
    fetchImpl: async () => { throw new TypeError('Failed to fetch'); },
  });
  await assert.rejects(offlineClient.loadManifest(), (error) => error.kind === 'offline');
  assert.equal(offlineClient.getSnapshot().status, 'offline');

  const errorClient = createProgressiveGridClient({
    templateId: 'synthetic-1200',
    fetchImpl: async () => jsonResponse({ error: 'temporary server failure' }, { ok: false, status: 503 }),
  });
  await assert.rejects(errorClient.loadManifest(), (error) => error.kind === 'http' && error.status === 503);
  assert.equal(errorClient.getSnapshot().status, 'error');
  offlineClient.destroy();
  errorClient.destroy();
});

test('tile payload conversion rejects full-size mismatches and keeps typed storage tile-bounded', () => {
  const grid = createGridDescriptor({ width: WIDTH, height: HEIGHT, tile_size: TILE_SIZE });
  const tile = normalizeTilePayload(tilePayload(37, 37), { grid, templateId: 'synthetic-1200' });
  assert.equal(tile.width, 16);
  assert.equal(tile.height, 16);
  assert.equal(tile.cells.length, 16 * 16);
  assert.equal(tile.bytes, (16 * 16) * (Uint16Array.BYTES_PER_ELEMENT + Int16Array.BYTES_PER_ELEMENT));
  assert.throws(
    () => normalizeTilePayload({ ...tilePayload(0, 0), cells: [0] }, { grid, templateId: 'synthetic-1200' }),
    /exactly 1024 cells/,
  );
});

test('viewport selection returns no tiles when the camera is entirely off-grid', () => {
  const selection = selectViewportTiles({
    grid: { width: WIDTH, height: HEIGHT, tile_size: TILE_SIZE },
    camera: { x: -100_000, y: -100_000, zoom: 1 },
    viewportWidth: 390,
    viewportHeight: 844,
    cellSize: TILE_SIZE,
  });
  assert.equal(selection.visible.length, 0);
  assert.equal(selection.prefetch.length, 0);
});
