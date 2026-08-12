import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FUSE_CHAIN_MAX_STEPS,
  SPECIAL_MAX_DERIVED_CHANGES,
  buildFuseOfferSteps,
  deriveFuseChanges,
  remainingFuseStepChanges,
  takeFuseStepChanges,
} from '../services/tiled-specials.js';

function tileCells(width, height, fill = 0) {
  return Array(width * height).fill(fill);
}

test('Fuse derivation is bounded, exact-color, ring-ordered, skips filled cells, and never removes progress', () => {
  const width = 20;
  const height = 20;
  const cells = tileCells(width, height);
  cells[5 * width + 5] = 1;
  const filledIndex = 4 * width + 4;
  const filled = Array(width * height).fill(-1);
  filled[filledIndex] = 0;
  const specialIndex = 10 * width + 10;

  const changes = deriveFuseChanges({
    cells,
    filled,
    width,
    height,
    specialIndex,
  });

  assert.ok(changes.length > 0);
  assert.ok(changes.length <= SPECIAL_MAX_DERIVED_CHANGES);
  assert.equal(changes.some((change) => change.index === filledIndex), false);
  for (const change of changes) {
    assert.equal(change.color, cells[change.index]);
    assert.equal(filled[change.index], -1);
    assert.ok(Number(change.distance) >= 1);
    assert.ok(Number(change.distance) <= FUSE_CHAIN_MAX_STEPS);
  }
});

test('Fuse offer steps are the real remaining rings of the chain', () => {
  const width = 20;
  const height = 20;
  const changes = deriveFuseChanges({
    cells: tileCells(width, height),
    filled: Array(width * height).fill(-1),
    width,
    height,
    specialIndex: 10 * width + 10,
  });
  const steps = buildFuseOfferSteps(changes);

  assert.ok(steps.length >= 1);
  assert.ok(steps.length <= FUSE_CHAIN_MAX_STEPS);
  assert.ok(steps.every((step, index) => index === 0 || step.distance > steps[index - 1].distance));
  const totalCells = steps.reduce((sum, step) => sum + step.cells, 0);
  assert.equal(totalCells, changes.length);
  assert.ok(totalCells <= SPECIAL_MAX_DERIVED_CHANGES);
  assert.ok(steps.every((step) => step.cells > 0));
});

test('Fuse disarm takes exactly the next ring and leaves the outer rings for later', () => {
  const width = 20;
  const height = 20;
  const changes = deriveFuseChanges({
    cells: tileCells(width, height),
    filled: Array(width * height).fill(-1),
    width,
    height,
    specialIndex: 10 * width + 10,
  });

  const first = takeFuseStepChanges(changes);
  const later = remainingFuseStepChanges(changes);
  assert.ok(first.length > 0);
  assert.ok(first.every((change) => change.distance === first[0].distance));
  assert.ok(later.every((change) => change.distance > first[0].distance));
  assert.equal(first.length + later.length, changes.length);
  assert.deepEqual(
    new Set([...first, ...later].map((change) => change.index)),
    new Set(changes.map((change) => change.index)),
  );
});

test('A one-ring Fuse offer is a single-step chain', () => {
  const changes = [
    { index: 1, color: 0, distance: 1 },
    { index: 3, color: 0, distance: 1 },
  ];

  assert.deepEqual(buildFuseOfferSteps(changes), [
    { step: 1, distance: 1, cells: 2, estimated_cells: 2 },
  ]);
  assert.deepEqual(takeFuseStepChanges(changes), changes);
  assert.deepEqual(remainingFuseStepChanges(changes), []);
});
