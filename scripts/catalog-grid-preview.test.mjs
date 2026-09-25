import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBudgetedCatalogGridPreview, CATALOG_GRID_PREVIEW_BUDGET_BYTES } from './catalog-grid-preview.mjs';

test('catalog delivery preview keeps aspect ratio and meets the strict 16 KiB budget', () => {
  let state = 0x6d2b79f5;
  const cells = new Uint8Array(1200 * 960);
  for (let index = 0; index < cells.length; index += 1) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    cells[index] = state % 10;
  }
  const result = buildBudgetedCatalogGridPreview({
    cells,
    width: 1200,
    height: 960,
    palette: ['#000000', '#222222', '#444444', '#666666', '#888888', '#aaaaaa', '#bbbbbb', '#cccccc', '#dddddd', '#ffffff'],
  });
  assert.ok(result.byteLength <= CATALOG_GRID_PREVIEW_BUDGET_BYTES);
  assert.ok(result.width <= 1200 && result.height <= 1200);
  assert.ok(Math.max(result.width, result.height) < 1200, 'test map should exercise downsampling');
  assert.equal(result.width * 960, result.height * 1200);
});

test('catalog delivery preview rejects a budget impossible at the configured minimum', () => {
  let state = 0x6d2b79f5;
  const cells = new Uint8Array(128 * 128);
  for (let index = 0; index < cells.length; index += 1) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    cells[index] = state >>> 31;
  }
  assert.throws(() => buildBudgetedCatalogGridPreview({
    cells,
    width: 128,
    height: 128,
    palette: ['#000000', '#ffffff'],
    budgetBytes: 256,
    preferredMaxSide: 128,
    minimumMaxSide: 128,
  }), /cannot meet/);
});
