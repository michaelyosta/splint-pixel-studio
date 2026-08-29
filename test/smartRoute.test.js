import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  GUIDANCE_REASON,
  countPaintedCellsInTarget,
  isGuidanceIndexMissing,
  isStaleGuidance,
  isTargetActionable,
  isTrueColorCompletion,
  normalizeGuidancePayload,
  planGuidanceCamera,
} from '../src/features/coloring/large-grid/smartRoute.js';

function planFixture(overrides = {}) {
  return {
    schema_version: 1,
    template_id: 'synthetic-1200',
    progress_revision: 7,
    reason: GUIDANCE_REASON.INITIAL_TARGET,
    selected_color: 2,
    global_remaining_for_color: 1234,
    next_color: null,
    color_complete: false,
    artwork_complete: false,
    target: {
      tile_x: 3,
      tile_y: 5,
      anchor_x: 104,
      anchor_y: 172,
      bounds: { min_x: 96, min_y: 160, max_x: 107, max_y: 171, width: 12, height: 12 },
      estimated_cells: 37,
      color: 2,
    },
    ...overrides,
  };
}

test('guidance payload is normalized into a bounded plan and never leaks full-grid arrays', () => {
  const plan = normalizeGuidancePayload(planFixture(), { templateId: 'synthetic-1200' });
  assert.equal(plan.progressRevision, 7);
  assert.equal(plan.selectedColor, 2);
  assert.equal(plan.globalRemainingForColor, 1234);
  assert.deepEqual(plan.target.bounds, {
    min_x: 96, min_y: 160, max_x: 107, max_y: 171, width: 12, height: 12,
  });
  assert.throws(
    () => normalizeGuidancePayload({ ...planFixture(), cells: [0, 1, 2] }),
    /must not contain full cell arrays/,
  );
  assert.throws(
    () => normalizeGuidancePayload({ ...planFixture(), target: { ...planFixture().target, cells: [1] } }),
    /must not contain full cell arrays/,
  );
});

test('stale guidance is detected from the progress revision and never overrides a newer route', () => {
  const fresh = normalizeGuidancePayload(planFixture());
  assert.equal(isStaleGuidance(fresh, 6), false);
  assert.equal(isStaleGuidance(fresh, 7), false);
  assert.equal(isStaleGuidance(fresh, 8), true);
  assert.equal(isStaleGuidance(null, 8), false);
});

test('guidance index-missing diagnostic survives normalization and is detectable', () => {
  const plan = normalizeGuidancePayload({
    schema_version: 1,
    template_id: 'synthetic-1200',
    progress_revision: 3,
    reason: 'INDEX_MISSING',
    index_missing: true,
    selected_color: null,
    global_remaining_for_color: 0,
    next_color: null,
    color_complete: false,
    artwork_complete: false,
    target: null,
  });
  assert.equal(plan.indexMissing, true);
  assert.equal(isGuidanceIndexMissing(plan), true);
  assert.equal(isTargetActionable(plan), false);
  // A normal plan must never be mistaken for index-missing.
  assert.equal(isGuidanceIndexMissing(normalizeGuidancePayload(planFixture())), false);
});

test('true color completion requires server-confirmed global zero, not a loaded-cache zero', () => {
  // This is the regression for bug D: a loaded-only guide may reach 0 while
  // the color still exists in unloaded tiles.
  assert.equal(isTrueColorCompletion({
    reason: GUIDANCE_REASON.SAME_COLOR_NEXT,
    globalRemainingForColor: 0,
  }), false);
  assert.equal(isTrueColorCompletion({
    reason: GUIDANCE_REASON.COLOR_COMPLETE,
    globalRemainingForColor: 0,
  }), true);
  assert.equal(isTrueColorCompletion({
    reason: GUIDANCE_REASON.COLOR_COMPLETE,
    globalRemainingForColor: 5,
  }), false);
});

test('guidance camera plans a paintable working zoom centered on the anchor', () => {
  const plan = normalizeGuidancePayload(planFixture());
  const camera = planGuidanceCamera(plan, { width: 390, height: 700 }, { width: 1200, height: 1200 }, 32);
  assert.ok(camera);
  assert.ok(camera.zoom >= 0.4 && camera.zoom <= 1);
  const worldX = (pixel) => (pixel - camera.x) / camera.zoom / 32;
  const worldY = (pixel) => (pixel - camera.y) / camera.zoom / 32;
  // The whole actionable window must be inside the viewport.
  assert.ok(worldX(0) <= 96 + 0.5 && worldX(390) >= 108 - 0.5, 'target window must fit horizontally');
  assert.ok(worldY(0) <= 160 + 0.5 && worldY(700) >= 172 - 0.5, 'target window must fit vertically');
  const anchorScreenX = (104.5 - worldX(0)) * camera.zoom * 32;
  const anchorScreenY = (172.5 - worldY(0)) * camera.zoom * 32;
  assert.ok(anchorScreenX >= 0 && anchorScreenX <= 390, 'anchor must stay visible');
  assert.ok(anchorScreenY >= 0 && anchorScreenY <= 700, 'anchor must stay visible');
});

test('guidance camera keeps edge targets outside the in-canvas HUD safe area', () => {
  const viewport = { width: 390, height: 700 };
  const template = { width: 1200, height: 1200 };
  const edgePlan = (minY, maxY, anchorY) => normalizeGuidancePayload(planFixture({
    target: {
      ...planFixture().target,
      tile_y: Math.floor(minY / 32),
      anchor_y: anchorY,
      bounds: {
        ...planFixture().target.bounds,
        min_y: minY,
        max_y: maxY,
        height: maxY - minY + 1,
      },
    },
  }));
  const screenY = (worldY, camera) => worldY * 32 * camera.zoom + camera.y;

  const top = planGuidanceCamera(edgePlan(0, 11, 5), viewport, template, 32);
  assert.ok(screenY(0, top) >= 58 - 0.01, 'top target must stay below the guide HUD');

  const bottom = planGuidanceCamera(edgePlan(1188, 1199, 1194), viewport, template, 32);
  assert.ok(screenY(1200, bottom) <= viewport.height - 58 + 0.01,
    'bottom target must stay above the action dock');
});

test('target completion only counts painted cells inside the active window', () => {
  const plan = normalizeGuidancePayload(planFixture());
  const changes = [
    { index: 104 + 170 * 1200 },
    { index: 400 },
    { index: 100 + 160 * 1200 },
  ];
  assert.equal(countPaintedCellsInTarget(plan, changes, 1200), 2);
  assert.equal(countPaintedCellsInTarget(plan, [], 1200), 0);
  assert.equal(countPaintedCellsInTarget(null, changes, 1200), 0);
  assert.equal(isTargetActionable(plan), true);
  assert.equal(isTargetActionable({ ...plan, target: null }), false);
});
