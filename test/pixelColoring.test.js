import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPalette, cleanUpSmallRegions, edgeAwareSmoothColors, findRewardingColor, getProgress, isProgressComplete, normalizeHex, sampleGridColors } from '../src/lib/pixelColoring.js';

test('getProgress counts only correctly filled cells', () => {
  const result = getProgress([0, 1, 2, 1], [0, -1, 0, 1]);
  assert.deepEqual(result, { completed: 2, total: 4, percent: 50 });
});

test('isProgressComplete does not treat a rounded display percentage as completion', () => {
  const progress = getProgress(Array(576).fill(0), [...Array(575).fill(0), -1]);
  assert.equal(progress.percent, 100);
  assert.equal(isProgressComplete(progress), false);
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

test('cleanUpSmallRegions merges a tiny low-contrast noise region', () => {
  const cells = [0, 0, 0, 0, 1, 0, 0, 0, 0];
  const cleaned = cleanUpSmallRegions(cells, 3, 3, [[100, 110, 120], [104, 113, 121]]);
  assert.deepEqual(cleaned, Array(9).fill(0));
});

test('cleanUpSmallRegions keeps a tiny high-contrast accent', () => {
  const cells = [0, 0, 0, 0, 1, 0, 0, 0, 0];
  const cleaned = cleanUpSmallRegions(cells, 3, 3, [[230, 230, 230], [15, 20, 25]]);
  assert.equal(cleaned[4], 1);
});

test('sampleGridColors averages high-resolution source pixels into grid cells', () => {
  const pixels = new Uint8ClampedArray([
    10, 20, 30, 255, 30, 40, 50, 255,
    50, 60, 70, 255, 70, 80, 90, 255,
  ]);
  assert.deepEqual(sampleGridColors(pixels, 2, 2, 1, 1), [[40, 50, 60]]);
});

test('edgeAwareSmoothColors smooths texture but preserves a strong boundary', () => {
  const smoothed = edgeAwareSmoothColors([
    [100, 100, 100], [104, 101, 100], [225, 225, 225],
    [101, 99, 102], [103, 102, 101], [224, 226, 225],
  ], 3, 2);
  assert.ok(smoothed[0][0] < 110);
  assert.ok(smoothed[2][0] > 210);
});
