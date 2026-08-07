import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildColoringManifest,
  buildColoringTile,
  getTileBounds,
  getTileGrid,
  validatePublicGridDimensions,
} from '../services/coloring-chunks.js';
import { persistTiledChanges } from '../services/tiled-coloring.js';

function template(width, height, cells, updatedAt = '2026-08-06T00:00:00.000Z') {
  return {
    id: 'contract-template',
    title: 'Contract fixture',
    description: 'bounded tile fixture',
    category: 'test',
    difficulty: 'easy',
    theme: 'test',
    mood: 'focus',
    width,
    height,
    palette: ['#000000', '#ffffff', '#ff00aa', '#00aaff', '#ffaa00', '#00ff88', '#aa00ff', '#123456'],
    cells,
    preview_url: '/preview.png',
    updated_at: updatedAt,
  };
}

test('initial tiled progress insert conflict stops before tile writes', async () => {
  const statements = [];
  const tx = {
    async run(sql) {
      statements.push(sql);
      return { changes: 0 };
    },
  };
  const result = await persistTiledChanges(tx, {
    userId: 'user-concurrent',
    template: { id: 'tiled-concurrent' },
    existingProgress: null,
    clientRevision: 0,
    now: '2026-08-07T00:00:00.000Z',
    state: {
      completed: false,
      completedCells: 1,
      states: new Map([['0:0', {
        bounds: { tile_x: 0, tile_y: 0, width: 1, height: 1 },
        cells: [0],
        filled: [0],
      }]]),
    },
  });

  assert.deepEqual(result, { conflict: true });
  assert.equal(statements.length, 1);
  assert.match(statements[0], /ON CONFLICT \(user_id,template_id\) DO NOTHING/);
  assert.doesNotMatch(statements[0], /coloring_tiled_progress_tiles/);
});

test('160x160 manifest and edge tile use bounded row-major slices', () => {
  const width = 160;
  const height = 160;
  const cells = Array.from({ length: width * height }, (_, index) => index % 8);
  const filled = Array(width * height).fill(-1);
  filled[(159 * width) + 159] = 7;
  const cellsBefore = [...cells];
  const filledBefore = [...filled];
  const fixture = template(width, height, cells);

  const manifest = buildColoringManifest({
    template: fixture,
    progress: { revision: 4, completed_cells: 1, completed_at: null },
  });
  assert.deepEqual(manifest.grid, {
    width: 160,
    height: 160,
    tile_size: 32,
    tiles_x: 5,
    tiles_y: 5,
    encoding: 'row-major-palette-index',
  });
  assert.equal(manifest.progress.revision, 4);
  assert.equal(Object.hasOwn(manifest, 'cells'), false);
  assert.equal(Object.hasOwn(manifest, 'filled'), false);
  assert.equal(manifest.write_contract.max_changes, 64);
  assert.equal(manifest.write_contract.conflict_status, 409);

  const edge = buildColoringTile({
    template: fixture,
    filled,
    progress: manifest.progress,
    tileX: 4,
    tileY: 4,
  });
  assert.deepEqual(edge.tile, {
    x: 4,
    y: 4,
    offset_x: 128,
    offset_y: 128,
    width: 32,
    height: 32,
    cell_count: 1024,
    tile_size: 32,
    tiles_x: 5,
    tiles_y: 5,
  });
  assert.equal(edge.cells[0], cells[(128 * width) + 128]);
  assert.equal(edge.cells.at(-1), cells[(159 * width) + 159]);
  assert.equal(edge.filled.at(-1), 7);
  assert.deepEqual(cells, cellsBefore, 'tile projection must not mutate legacy cells');
  assert.deepEqual(filled, filledBefore, 'tile projection must not mutate legacy filled map');
});

test('synthetic 1200x1200 tiles are representable, but public dimensions remain gated', () => {
  const width = 1_200;
  const height = 1_200;
  const total = width * height;
  const cells = new Uint8Array(total);
  const filled = new Int16Array(total);
  filled.fill(-1);
  const lastIndex = (height - 1) * width + (width - 1);
  cells[lastIndex] = 7;
  filled[lastIndex] = 2;
  const fixture = template(width, height, cells);

  const grid = getTileGrid(width, height);
  assert.equal(grid.tiles_x, 38);
  assert.equal(grid.tiles_y, 38);
  const edge = buildColoringTile({ template: fixture, filled, tileX: 37, tileY: 37 });
  assert.equal(edge.tile.width, 16);
  assert.equal(edge.tile.height, 16);
  assert.equal(edge.cells.length, 256);
  assert.equal(edge.cells.at(-1), 7);
  assert.equal(edge.filled.at(-1), 2);

  assert.throws(
    () => validatePublicGridDimensions(width, height),
    (error) => error.code === 'INVALID_GRID_DIMENSIONS' && error.status === 422,
  );
});

test('tile coordinates reject negative, fractional, and out-of-range values', () => {
  for (const [tileX, tileY] of [[-1, 0], [0, -1], [5, 0], [0, 5], ['1.5', 0], ['x', 0]]) {
    assert.throws(
      () => getTileBounds({ width: 160, height: 160, tileX, tileY }),
      (error) => error.code === 'INVALID_TILE_COORDINATES' && error.status === 400,
      `${tileX}/${tileY} should be rejected`,
    );
  }
});
