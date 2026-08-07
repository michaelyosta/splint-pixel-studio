import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_MANUAL_PALETTE,
  buildManualDraft,
  createBlankCells,
  getManualGridSize,
  removePaletteColor,
  resizePixelCells,
} from '../src/features/creator/manualPixelEditorUtils.js';

test('manual editor creates a backend-compatible blank draft', () => {
  const draft = buildManualDraft({ width: 32, height: 32 });
  assert.equal(draft.width, 32);
  assert.equal(draft.height, 32);
  assert.equal(draft.cells.length, 1024);
  assert.equal(draft.palette.length, DEFAULT_MANUAL_PALETTE.length);
  assert.ok(draft.cells.every((color) => Number.isInteger(color) && color >= 0 && color < draft.palette.length));
});

test('manual editor uses only supported grid sizes', () => {
  assert.equal(getManualGridSize(48), 48);
  assert.equal(getManualGridSize(17), 32);
  assert.equal(getManualGridSize(64), 64);
});

test('resizing a pixel drawing keeps nearest-neighbour colour regions', () => {
  const source = [0, 1, 2, 3];
  assert.deepEqual(resizePixelCells(source, 2, 2, 4, 4), [
    0, 0, 1, 1,
    0, 0, 1, 1,
    2, 2, 3, 3,
    2, 2, 3, 3,
  ]);
});

test('removing a non-background palette colour remaps affected cells to the background', () => {
  const result = removePaletteColor([0, 1, 2, 3, 2], ['#000000', '#111111', '#222222', '#333333'], 2);
  assert.deepEqual(result.palette, ['#000000', '#111111', '#333333']);
  assert.deepEqual(result.cells, [0, 1, 0, 2, 0]);
  assert.equal(result.removed, true);
});

test('the background palette colour cannot be removed', () => {
  const cells = createBlankCells(2, 2);
  const result = removePaletteColor(cells, ['#000000', '#FFFFFF'], 0);
  assert.equal(result.removed, false);
  assert.deepEqual(result.cells, cells);
});
