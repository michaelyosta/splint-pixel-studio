import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SPECIAL_MARKER_VISUALS,
  specialMarkerScreenRadius,
  specialMarkerVisual,
} from '../src/features/coloring/specialMarker.js';

test('screen radius clamps to bounded screen-space pixels', () => {
  assert.equal(specialMarkerScreenRadius(32), 10);
  assert.equal(specialMarkerScreenRadius(9.375), 4);
  assert.equal(specialMarkerScreenRadius(12), 4);
  assert.equal(specialMarkerScreenRadius(1), 4);
  assert.equal(specialMarkerScreenRadius(100), 10);
});

test('screen radius handles invalid and non-positive inputs with the minimum', () => {
  for (const value of [undefined, null, NaN, 'nope', 0, -5, Infinity]) {
    assert.equal(specialMarkerScreenRadius(value), 4);
  }
});

test('screen radius options are honored and bounded', () => {
  assert.equal(
    specialMarkerScreenRadius(32, { min: 2, max: 8, fraction: 0.25 }),
    8,
  );
  assert.equal(
    specialMarkerScreenRadius(1, { min: 2, max: 8, fraction: 0.25 }),
    2,
  );
  assert.equal(
    specialMarkerScreenRadius(64, { min: 2, max: 8, fraction: 0.25 }),
    8,
  );
});

test('visual lookup falls back to a stable unknown marker', () => {
  for (const kind of [undefined, null, '', 'JAMMER', 'Spark', '  bomb ']) {
    const visual = specialMarkerVisual(kind);
    assert.ok(visual.markerColor);
    assert.ok(visual.markerOutline);
    assert.ok(visual.markerShape);
  }
  assert.equal(specialMarkerVisual('spark'), SPECIAL_MARKER_VISUALS.spark);
  assert.equal(specialMarkerVisual('bomb'), SPECIAL_MARKER_VISUALS.bomb);
  assert.equal(specialMarkerVisual('fuse'), SPECIAL_MARKER_VISUALS.fuse);
  assert.equal(specialMarkerVisual('choice'), SPECIAL_MARKER_VISUALS.choice);
  assert.equal(specialMarkerVisual('artifact'), SPECIAL_MARKER_VISUALS.artifact);
  assert.equal(specialMarkerVisual('hazard'), SPECIAL_MARKER_VISUALS.hazard);
});

test('all marker visuals have non-empty color and shape fields', () => {
  for (const [kind, visual] of Object.entries(SPECIAL_MARKER_VISUALS)) {
    assert.match(visual.markerColor, /^rgba?\(/, `${kind} markerColor`);
    assert.match(visual.markerOutline, /^#/, `${kind} markerOutline`);
    assert.ok(visual.markerShape.length > 0, `${kind} markerShape`);
  }
});
