import test from 'node:test';
import assert from 'node:assert/strict';
import { assessQuality, countSmallRegionCells } from './creatorQuality.js';

test('adjacent different colors are two singleton regions', () => {
  assert.equal(countSmallRegionCells(2, 1, [0, 1]), 2);
});

test('checkerboard uses four-way connectivity', () => {
  assert.equal(countSmallRegionCells(2, 2, [0, 1, 1, 0]), 4);
});

test('large regions of different colors are not small', () => {
  assert.equal(countSmallRegionCells(4, 2, [
    0, 0, 1, 1,
    0, 0, 1, 1,
  ]), 0);
});

test('mixed region sizes count only cells in regions of size at most two', () => {
  const cells = [
    0, 1, 1,
    2, 2, 2,
  ];
  assert.equal(countSmallRegionCells(3, 2, cells), 3);
  assert.equal(assessQuality(3, 2, ['#000', '#fff', '#f00'], cells).level, 'noisy');
});

test('quality labels cover good and fair outcomes', () => {
  assert.equal(assessQuality(10, 10, ['#000', '#fff'], Array(100).fill(0)).level, 'fair');
  const balanced = Array.from({ length: 100 }, (_, index) => index < 50 ? 0 : 1);
  assert.equal(assessQuality(10, 10, ['#000', '#fff'], balanced).level, 'good');
});
