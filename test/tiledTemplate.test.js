import test from 'node:test';
import assert from 'node:assert/strict';
import { createTiledTemplate } from '../src/lib/tiledTemplate.js';

test('splits row-major cells into compact 32x32 JSON tile records', () => {
  const width = 161;
  const height = 161;
  const cells = Array.from({ length: width * height }, (_, index) => index % 3);
  const result = createTiledTemplate({ width, height, palette: ['#000000', '#ffffff', '#ff0000'], cells });

  assert.equal(result.tileCount, 36);
  assert.deepEqual(Object.keys(result.tiles[0]), ['x', 'y', 'width', 'height', 'cells']);
  assert.deepEqual(
    { x: result.tiles[0].x, y: result.tiles[0].y, width: result.tiles[0].width, height: result.tiles[0].height },
    { x: 0, y: 0, width: 32, height: 32 },
  );
  assert.equal(result.tiles[0].cells.length, 32 * 32);
  assert.deepEqual(result.tiles[0].cells.slice(0, 5), cells.slice(0, 5));
  assert.equal(result.tiles[0].cells[32], cells[width]);

  const edge = result.tiles.at(-1);
  assert.deepEqual({ x: edge.x, y: edge.y, width: edge.width, height: edge.height }, {
    x: 5,
    y: 5,
    width: 1,
    height: 1,
  });
  assert.deepEqual(edge.cells, [cells.at(-1)]);
  assert.ok(result.sizeBytes > 0);
  assert.deepEqual(JSON.parse(JSON.stringify(result.tiles[0])), result.tiles[0]);
});

test('1200x1200 tiled template has 1444 tiles and a 16x16 lower-right edge', () => {
  const width = 1_200;
  const height = 1_200;
  const cells = Array.from({ length: width * height }, (_, index) => index % 2);
  const result = createTiledTemplate({ width, height, palette: ['#000000', '#ffffff'], cells });

  assert.equal(result.tileCount, 1_444);
  assert.equal(result.tiles.length, 1_444);
  const edge = result.tiles.at(-1);
  assert.deepEqual({ x: edge.x, y: edge.y, width: edge.width, height: edge.height }, {
    x: 37,
    y: 37,
    width: 16,
    height: 16,
  });
  assert.equal(edge.cells.length, 16 * 16);
  assert.equal(edge.cells[0], cells[1184 * width + 1184]);
  assert.equal(edge.cells.at(-1), cells.at(-1));
  assert.ok(result.sizeBytes > result.tileCount);
});

test('rejects dimensions outside the tiled range and invalid palette indices', () => {
  const valid = {
    width: 161,
    height: 161,
    palette: ['#000000', '#ffffff'],
    cells: Array(161 * 161).fill(0),
  };

  assert.throws(() => createTiledTemplate({ ...valid, width: 160 }), RangeError);
  assert.throws(() => createTiledTemplate({ ...valid, height: 1_201 }), RangeError);
  assert.throws(() => createTiledTemplate({ ...valid, cells: [...valid.cells.slice(0, -1), 2] }), RangeError);
  assert.throws(() => createTiledTemplate({ ...valid, cells: [...valid.cells.slice(0, -1), 0.5] }), RangeError);
});
