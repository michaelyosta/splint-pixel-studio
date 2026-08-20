import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeRevealBounds,
  revealBoundsToScreen,
  revealCeremonyCopy,
  revealCeremonyDuration,
} from '../src/features/coloring/large-grid/revealCeremony.js';

test('normalise reveal bounds accepts server and resume shapes and clamps to the grid', () => {
  assert.deepEqual(
    normalizeRevealBounds({ min_x: -3, min_y: 2.9, max_x: 99, max_y: 8.1 }, 16, 8),
    { min_x: 0, min_y: 2, max_x: 15, max_y: 7 },
  );
  assert.deepEqual(
    normalizeRevealBounds({ minX: 2, minY: 3, maxX: 4, maxY: 5 }, 16, 16),
    { min_x: 2, min_y: 3, max_x: 4, max_y: 5 },
  );
});

test('invalid and inverted bounds do not create a ceremony frame', () => {
  assert.equal(normalizeRevealBounds(null, 16, 16), null);
  assert.equal(normalizeRevealBounds({ min_x: 4, min_y: 2, max_x: 3, max_y: 5 }, 16, 16), null);
  assert.equal(normalizeRevealBounds({ min_x: 0, min_y: 0, max_x: 1 }, 16, 16), null);
});

test('reveal bounds map to CSS screen coordinates without changing the camera', () => {
  assert.deepEqual(
    revealBoundsToScreen(
      { min_x: 2, min_y: 3, max_x: 4, max_y: 5 },
      { x: 10, y: -4, zoom: 0.5 },
      32,
    ),
    { left: 42, top: 44, width: 48, height: 48 },
  );
  assert.equal(revealBoundsToScreen(null, { x: 0, y: 0, zoom: 1 }), null);
});

test('ceremony copy keeps ownership in the artwork and reduced motion shortens it', () => {
  assert.match(revealCeremonyCopy('fragment').detail, /твоим жестом/);
  assert.match(revealCeremonyCopy('artwork').label, /раскрыта/);
  assert.ok(revealCeremonyDuration('fragment', true) < revealCeremonyDuration('fragment', false));
  assert.ok(revealCeremonyDuration('artwork', true) < revealCeremonyDuration('artwork', false));
});

