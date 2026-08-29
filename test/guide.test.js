import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeLoadedGuide,
  TileGuideIndex,
  pickColorWithMostRemaining,
  pickNextZoneWithCells,
} from '../src/features/coloring/large-grid/guide.js';

function makeTile({ offsetX, offsetY, cells, filled }) {
  const width = cells[0].length;
  const height = cells.length;
  return {
    key: `${offsetX}:${offsetY}`,
    offsetX,
    offsetY,
    width,
    height,
    cellCount: width * height,
    cells: new Uint16Array(cells.flat()),
    filled: new Int16Array(filled.flat()),
  };
}

const zones = [
  { id: 0, x: 0, y: 0, width: 600, height: 400 },
  { id: 1, x: 600, y: 0, width: 600, height: 400 },
  { id: 2, x: 0, y: 400, width: 600, height: 400 },
  { id: 3, x: 600, y: 400, width: 600, height: 400 },
  { id: 4, x: 0, y: 800, width: 600, height: 400 },
  { id: 5, x: 600, y: 800, width: 600, height: 400 },
];

const template = { width: 1200, height: 1200 };

test('computeLoadedGuide counts only unfilled matching cells and tracks first cell per zone', () => {
  const tiles = [
    makeTile({
      offsetX: 0,
      offsetY: 0,
      cells: [[1, 0], [2, 1]],
      filled: [[-1, -1], [1, -1]],
    }),
    makeTile({
      offsetX: 600,
      offsetY: 0,
      cells: [[0, 0], [0, 0]],
      filled: [[-1, 2], [-1, -1]],
    }),
  ];
  const guide = computeLoadedGuide({ tiles, template, selectedColor: 0, zones });
  assert.equal(guide.remaining, 4);
  assert.equal(guide.remainingByZone[0], 1);
  assert.equal(guide.remainingByZone[1], 3);
  assert.deepEqual(guide.firstCellByZone[0], { x: 1, y: 0, index: 1 });
  assert.deepEqual(guide.firstCellByZone[1], { x: 600, y: 0, index: 600 });
});

test('computeLoadedGuide counts all unfilled cells in reveal mode', () => {
  const tiles = [
    makeTile({
      offsetX: 0,
      offsetY: 0,
      cells: [[1, 0]],
      filled: [[-1, 2]],
    }),
  ];
  const guide = computeLoadedGuide({ tiles, template, selectedColor: null, zones });
  assert.equal(guide.remaining, 1);
});

test('pickNextZoneWithCells wraps around and skips zones without cells', () => {
  const remainingByZone = { 0: 5, 3: 2 };
  assert.equal(pickNextZoneWithCells(zones, 0, remainingByZone).id, 3);
  assert.equal(pickNextZoneWithCells(zones, 3, remainingByZone).id, 0);
  assert.equal(pickNextZoneWithCells(zones, 4, remainingByZone).id, 0);
  assert.equal(pickNextZoneWithCells(zones, 0, {}), null);
});

test('pickColorWithMostRemaining picks the largest unfilled color count', () => {
  const tiles = [
    makeTile({
      offsetX: 0,
      offsetY: 0,
      cells: [[0, 1, 2, 1]],
      filled: [[-1, -1, 2, -1]],
    }),
  ];
  assert.equal(pickColorWithMostRemaining(tiles, 3), 1);
});

test('TileGuideIndex tracks counts and first cells incrementally', () => {
  const index = new TileGuideIndex({ zones, paletteLength: 3, template });
  const first = makeTile({
    offsetX: 0,
    offsetY: 0,
    cells: [[1, 0], [2, 1]],
    filled: [[-1, -1], [1, -1]],
  });
  const second = makeTile({
    offsetX: 600,
    offsetY: 0,
    cells: [[0, 0], [0, 0]],
    filled: [[-1, 2], [-1, -1]],
  });
  index.addTile(first);
  index.addTile(second);

  let guide = index.snapshot(0);
  assert.equal(guide.remaining, 4);
  assert.equal(guide.remainingByZone[0], 1);
  assert.equal(guide.remainingByZone[1], 3);
  assert.deepEqual(guide.firstCellByZone[0], { x: 1, y: 0, index: 1 });
  assert.deepEqual(guide.firstCellByZone[1], { x: 600, y: 0, index: 600 });

  // Painting the first cell of color 0 in zone 1 moves the zone's first cell
  // to the next unfilled cell without rescanning unrelated tiles.
  first.filled[1] = 0;
  index.refreshTile(first);
  guide = index.snapshot(0);
  assert.equal(guide.remaining, 3);
  assert.equal(guide.remainingByZone[0] || 0, 0);
  assert.equal(guide.remainingByZone[1], 3);
  assert.deepEqual(guide.firstCellByZone[1], { x: 600, y: 0, index: 600 });

  // Eviction removes the tile from the counts.
  index.removeTile(second);
  guide = index.snapshot(0);
  assert.equal(guide.remaining, 0);
  assert.deepEqual(guide.remainingByZone, {});

  // Reveal mode counts every unfilled cell across colors.
  index.addTile(second);
  guide = index.snapshot(null);
  assert.equal(guide.remaining, 5);
  assert.equal(guide.remainingByZone[1], 3);
});
