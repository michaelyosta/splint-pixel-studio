import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPalette, findRewardingColor, getProgress, normalizeHex } from '../src/lib/pixelColoring.js';

test('getProgress counts only correctly filled cells', () => {
  const result = getProgress([0, 1, 2, 1], [0, -1, 0, 1]);
  assert.deepEqual(result, { completed: 2, total: 4, percent: 50 });
});

test('normalizeHex clamps and serializes RGB values', () => {
  assert.equal(normalizeHex(0, 181, 216), '#00b5d8');
  assert.equal(normalizeHex(-2, 260, 15), '#00ff0f');
});

test('findRewardingColor starts with the shortest unfinished color task', () => {
  const template = { palette: ['#000000', '#ffffff', '#ff0000'], cells: [0, 0, 0, 1, 1, 2] };
  assert.equal(findRewardingColor(template, Array(6).fill(-1)), 2);
});

test('buildPalette preserves a rare high-contrast accent', () => {
  const pixels = [...Array(90).fill([15, 20, 30]), ...Array(10).fill([250, 70, 40])];
  const palette = buildPalette(pixels, 2);
  assert.equal(palette.length, 2);
  assert.ok(palette.some((color) => color[0] > 200 && color[1] < 100));
});
