import test from 'node:test';
import assert from 'node:assert/strict';
import { findForgivingCell, getContextGoal, getRevealAction } from './playLoop.js';

const template = {
  width: 3,
  height: 2,
  cells: [0, 0, 1, 0, 1, 1],
};

test('reveal action selects the target color without palette input', () => {
  assert.deepEqual(getRevealAction(template, Array(6).fill(-1), 2), { color: 1, indices: [2] });
});

test('reveal area returns the connected region only', () => {
  assert.deepEqual(getRevealAction(template, Array(6).fill(-1), 0, true), { color: 0, indices: [0, 3, 1] });
});

test('forgiving input picks a nearby unfilled cell when the exact cell is complete', () => {
  assert.equal(findForgivingCell(3, 2, [0, -1, -1, -1, -1, -1], 0.8, 0.5), 1);
});

test('context goal uses the current zone and soft completion language', () => {
  const zones = [{ id: 'eyes', title: 'Глаза', percent: 50 }];
  assert.equal(getContextGoal(zones, { eyes: [0, 1] }, template, [0, -1, -1, -1, -1, -1]), 'Ещё один штрих — и «Глаза» раскроется');
});
