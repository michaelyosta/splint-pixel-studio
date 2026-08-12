import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BOMB_RADIUS,
  SPECIAL_MAX_DERIVED_CHANGES,
  deriveBombChanges,
  deriveLegacyBombChanges,
} from '../services/tiled-specials.js';

function tileCells(width, height, fill = 0) {
  return Array(width * height).fill(fill);
}

function filledCellMap(width, height, indices) {
  const filled = Array(width * height).fill(-1);
  for (const index of indices) filled[index] = 0;
  return filled;
}

test('legacy Bomb derivation is bounded, exact-color, and skips filled cells', () => {
  const width = 20;
  const height = 20;
  const cells = tileCells(width, height);
  cells[5 * width + 5] = 1;
  const filledIndex = 9 * width + 9;
  const filled = filledCellMap(width, height, [filledIndex]);
  const specialIndex = 10 * width + 10;

  const changes = deriveLegacyBombChanges({
    cells,
    filled,
    width,
    height,
    specialIndex,
    centerX: 10,
    centerY: 10,
  });

  assert.ok(changes.length > 0);
  assert.ok(changes.length <= SPECIAL_MAX_DERIVED_CHANGES);
  assert.equal(changes.some((change) => change.index === filledIndex), false);
  for (const change of changes) {
    assert.equal(change.color, cells[change.index]);
    assert.equal(filled[change.index], -1);
    const x = change.index % width;
    const y = Math.floor(change.index / width);
    assert.ok(Math.hypot(x - 10, y - 10) <= BOMB_RADIUS);
  }
});

test('legacy Bomb derivation caps at 32 and rejects centers far from the special', () => {
  const width = 40;
  const height = 40;
  const cells = tileCells(width, height);
  const specialIndex = 20 * width + 20;

  const capped = deriveLegacyBombChanges({
    cells,
    filled: tileCells(width, height, -1),
    width,
    height,
    specialIndex,
    centerX: 20,
    centerY: 20,
    radius: 4,
  });
  assert.equal(capped.length, SPECIAL_MAX_DERIVED_CHANGES);

  const far = deriveLegacyBombChanges({
    cells,
    filled: tileCells(width, height, -1),
    width,
    height,
    specialIndex,
    centerX: 20,
    centerY: 30,
  });
  assert.deepEqual(far, []);
});

test('tiled Bomb derivation reads only affected tiles and honors filled state', async () => {
  const width = 64;
  const height = 64;
  const tileSize = 32;
  const template = { id: 'template-bomb-unit', width, height, tile_size: tileSize };
  const userId = 'user-bomb-unit';
  const centerX = 32;
  const centerY = 32;

  const tilesByKey = new Map();
  for (let tileY = 0; tileY < 2; tileY += 1) {
    for (let tileX = 0; tileX < 2; tileX += 1) {
      tilesByKey.set(`${tileX}:${tileY}`, tileCells(32, 32));
    }
  }
  const centerFilled = filledCellMap(32, 32, [0]);
  const db = {
    async get(sql, params) {
      if (sql.includes('coloring_template_tiles')) {
        const [, tileX, tileY] = params;
        return { cells_json: JSON.stringify(tilesByKey.get(`${tileX}:${tileY}`) || []) };
      }
      if (sql.includes('coloring_tiled_progress_tiles')) {
        const [, , tileX, tileY] = params;
        return { filled_json: JSON.stringify(tileX === 1 && tileY === 1 ? centerFilled : Array(32 * 32).fill(-1)) };
      }
      return null;
    },
  };

  const changes = await deriveBombChanges(db, {
    userId,
    template,
    special: { cell_index: centerY * width + centerX },
    centerX,
    centerY,
  });

  assert.ok(changes.length > 0);
  assert.ok(changes.length <= SPECIAL_MAX_DERIVED_CHANGES);
  assert.equal(changes.some((change) => change.index === centerY * width + centerX), false);
  for (const change of changes) {
    assert.equal(change.color, 0);
    const x = change.index % width;
    const y = Math.floor(change.index / width);
    assert.ok(Math.hypot(x - centerX, y - centerY) <= BOMB_RADIUS);
  }
});
