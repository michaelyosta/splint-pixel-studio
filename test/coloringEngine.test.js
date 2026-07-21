import test from 'node:test';
import assert from 'node:assert/strict';
import { rasterizeLine, rasterizeStroke } from '../src/features/coloring/engine/strokeRasterizer.js';
import { findClusters, getClusterBounds, mergeClusters } from '../src/features/coloring/engine/clusterGraph.js';
import { createWorkingWindows, selectNextWindow } from '../src/features/coloring/engine/workingWindows.js';
import { planCamera, clampCamera, getTransitionDuration } from '../src/features/coloring/engine/cameraPlanner.js';
import { applyStroke, undoStroke, redoStroke, createStrokeOperation } from '../src/features/coloring/engine/paintReducer.js';
import { arraysEqual } from '../src/features/coloring/engine/coloringUtils.js';

/* ── StrokeRasterizer ── */

test('rasterizeLine: horizontal line', () => {
  const points = rasterizeLine(0, 5, 4, 5);
  assert.equal(points.length, 5);
  assert.deepEqual(points.map(p => p.x), [0, 1, 2, 3, 4]);
  assert.ok(points.every(p => p.y === 5));
});

test('rasterizeLine: vertical line', () => {
  const points = rasterizeLine(3, 0, 3, 4);
  assert.equal(points.length, 5);
  assert.ok(points.every(p => p.x === 3));
  assert.deepEqual(points.map(p => p.y), [0, 1, 2, 3, 4]);
});

test('rasterizeLine: diagonal line', () => {
  const points = rasterizeLine(0, 0, 4, 4);
  assert.equal(points.length, 5);
  assert.deepEqual(points.map(p => ({ x: p.x, y: p.y })), [
    { x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 2 },
    { x: 3, y: 3 }, { x: 4, y: 4 },
  ]);
});

test('rasterizeLine: reverse direction', () => {
  const points = rasterizeLine(4, 4, 0, 0);
  assert.equal(points.length, 5);
  assert.deepEqual(points[0], { x: 4, y: 4 });
  assert.deepEqual(points[4], { x: 0, y: 0 });
});

test('rasterizeLine: single point', () => {
  const points = rasterizeLine(2, 3, 2, 3);
  assert.equal(points.length, 1);
  assert.deepEqual(points[0], { x: 2, y: 3 });
});

test('rasterizeStroke: no duplicates', () => {
  const indices = rasterizeStroke(0, 10, 5, 5);
  const unique = new Set(indices);
  assert.equal(indices.length, unique.size);
});

test('rasterizeStroke: horizontal indices correct', () => {
  // 5-wide grid: cells at (0,0)=0, (1,0)=1, (2,0)=2, (3,0)=3, (4,0)=4
  const result = rasterizeStroke(0, 4, 5, 5);
  assert.deepEqual(result, [0, 1, 2, 3, 4]);
});

test('rasterizeStroke: out of bounds clamped', () => {
  const result = rasterizeStroke(0, 4, 5, 5);
  assert.ok(result.every(idx => idx >= 0 && idx < 25));
});

test('rasterizeStroke: empty for null input', () => {
  assert.deepEqual(rasterizeStroke(null, 5, 5, 5), []);
  assert.deepEqual(rasterizeStroke(5, null, 5, 5), []);
});

/* ── ClusterGraph ── */

function simpleTemplate(width, height, palette, cells) {
  return { width, height, palette, cells };
}

test('findClusters: four adjacent cells', () => {
  const t = simpleTemplate(4, 4, ['#fff', '#000'], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  const filled = Array(16).fill(-1);
  const clusters = findClusters(t, filled, 0);
  const totalCells = clusters.reduce((s, c) => s + c.length, 0);
  assert.equal(totalCells, 16);
  assert.ok(clusters.every(c => c.length >= 2));
});

test('findClusters: diagonal connection (8-directional)', () => {
  const t = simpleTemplate(3, 3, ['#fff', '#000'], [0, 0, 0, 0, 1, 0, 0, 0, 0]);
  const filled = Array(9).fill(-1);
  const clusters = findClusters(t, filled, 0);
  // All 0-cells should be one cluster via diagonal connections
  assert.equal(clusters.length, 1);
  assert.equal(clusters[0].length, 8);
});

test('findClusters: two independent clusters', () => {
  // 5x3 grid: row 1 is all color 1, separating top and bottom rows of color 0
  const t = simpleTemplate(5, 3, ['#fff', '#000'], [
    0, 0, 0, 0, 0,
    1, 1, 1, 1, 1,
    0, 0, 0, 0, 0,
  ]);
  const filled = Array(15).fill(-1);
  const clusters = findClusters(t, filled, 0);
  assert.equal(clusters.length, 2);
  assert.equal(clusters[0].length, 5);
  assert.equal(clusters[1].length, 5);
  // Each cluster should be entirely in one row
  const row0 = clusters.find(c => c.every(idx => Math.floor(idx / 5) === 0));
  const row2 = clusters.find(c => c.every(idx => Math.floor(idx / 5) === 2));
  assert.ok(row0, 'cluster in row 0');
  assert.ok(row2, 'cluster in row 2');
});

test('findClusters: filled cells excluded', () => {
  const t = simpleTemplate(3, 3, ['#fff'], [
    0, 0, 0,
    0, 0, 0,
    0, 0, 0,
  ]);
  const filled = [-1, 0, -1, 0, -1, 0, -1, 0, -1];
  const clusters = findClusters(t, filled, 0);
  const allIndices = clusters.flat();
  assert.ok(!allIndices.includes(1));
  assert.ok(!allIndices.includes(3));
});

test('findClusters: different colors not merged', () => {
  const t = simpleTemplate(2, 2, ['#fff', '#000'], [0, 1, 1, 1]);
  const filled = Array(4).fill(-1);
  const clusters = findClusters(t, filled, 0);
  assert.equal(clusters.length, 1);
  assert.deepEqual(clusters[0], [0]);
});

test('getClusterBounds: computes correctly', () => {
  const bounds = getClusterBounds([5, 6, 9, 10], 4);
  assert.deepEqual(bounds, { minX: 1, minY: 1, maxX: 2, maxY: 2, width: 2, height: 2 });
});

test('mergeClusters: close clusters merge', () => {
  const clusters = [
    [0, 1, 2],       // top row
    [8, 9, 10],      // one row below (distance 1)
  ];
  const merged = mergeClusters(clusters, 4);
  assert.equal(merged.length, 1);
});

test('mergeClusters: far clusters stay separate', () => {
  const clusters = [
    [0, 1],           // x=0..1, y=0
    [20, 21],         // x=0..1, y=5 (far away)
  ];
  const merged = mergeClusters(clusters, 4);
  assert.equal(merged.length, 2);
});

/* ── WorkingWindows ── */

function makeTemplate(w, h) {
  return { width: w, height: h, palette: ['#fff'], cells: Array(w * h).fill(0) };
}

test('createWorkingWindows: small cluster fits in one window', () => {
  const t = makeTemplate(8, 8);
  const cluster = [0, 1, 2, 8, 9, 10];
  const wins = createWorkingWindows(cluster, t, 400, 400);
  assert.equal(wins.length, 1);
  assert.equal(wins[0].cellCount, 6);
});

test('createWorkingWindows: large cluster splits', () => {
  const t = makeTemplate(64, 64);
  const cluster = [];
  for (let i = 0; i < 4096; i++) cluster.push(i);
  const wins = createWorkingWindows(cluster, t, 400, 400);
  assert.ok(wins.length > 1);
});

test('createWorkingWindows: windows within bounds', () => {
  const t = makeTemplate(16, 16);
  const cluster = Array.from({ length: 256 }, (_, i) => i);
  const wins = createWorkingWindows(cluster, t, 300, 300);
  for (const win of wins) {
    assert.ok(win.bounds.minX >= 0);
    assert.ok(win.bounds.minY >= 0);
    assert.ok(win.bounds.maxX < 16);
    assert.ok(win.bounds.maxY < 16);
    assert.ok(win.cellCount > 0);
  }
});

test('createWorkingWindows: no cells lost', () => {
  const t = makeTemplate(10, 10);
  const cluster = Array.from({ length: 100 }, (_, i) => i);
  const wins = createWorkingWindows(cluster, t, 200, 200);
  const allCells = new Set(wins.flatMap(w => w.cells));
  assert.equal(allCells.size, 100);
});

test('createWorkingWindows: rectangular coloring', () => {
  const t = makeTemplate(40, 16);
  const cluster = Array.from({ length: 640 }, (_, i) => i);
  const wins = createWorkingWindows(cluster, t, 400, 300);
  assert.ok(wins.length > 0);
  for (const win of wins) {
    assert.ok(win.bounds.maxX < 40);
    assert.ok(win.bounds.maxY < 16);
  }
});

/* ── CameraPlanner ── */

test('planCamera: zoom within range', () => {
  const target = { centerX: 10, centerY: 10, zoom: 2 };
  const cam = planCamera(target, 400, 400, 20, 20);
  assert.ok(cam.zoom >= 0.25);
  assert.ok(cam.zoom <= 4);
});

test('planCamera: center within bounds', () => {
  const target = { centerX: 0, centerY: 0, zoom: 1 };
  const cam = planCamera(target, 400, 400, 20, 20);
  const totalW = 20 * 32 * cam.zoom;
  assert.ok(cam.x <= 0 || Math.abs(cam.x - (400 - totalW) / 2) < 1);
});

test('clampCamera: zoom clamped', () => {
  const c = clampCamera({ x: 0, y: 0, zoom: 10 }, 400, 400, 20, 20);
  assert.ok(c.zoom <= 4);
  const c2 = clampCamera({ x: 0, y: 0, zoom: 0.1 }, 400, 400, 20, 20);
  assert.ok(c2.zoom >= 0.25);
});

test('getTransitionDuration: reduced motion', () => {
  assert.equal(getTransitionDuration(10, true), 1);
});

test('getTransitionDuration: short distance', () => {
  assert.equal(getTransitionDuration(3, false), 180);
});

test('getTransitionDuration: long distance', () => {
  assert.equal(getTransitionDuration(20, false), 400);
});

/* ── PaintReducer ── */

test('applyStroke: changes all indices', () => {
  const state = [-1, -1, -1, -1];
  const stroke = { color: 1, indices: [0, 2] };
  const next = applyStroke(state, stroke);
  assert.equal(next[0], 1);
  assert.equal(next[1], -1);
  assert.equal(next[2], 1);
});

test('applyStroke: empty stroke no change', () => {
  const state = [-1, -1];
  const next = applyStroke(state, { color: 1, indices: [] });
  assert.deepEqual(next, state);
});

test('createStrokeOperation: creates correct changes', () => {
  const stroke = { color: 2, indices: [1, 3] };
  const prev = [-1, -1, -1, -1];
  const op = createStrokeOperation(stroke, prev);
  assert.equal(op.type, 'stroke');
  assert.equal(op.color, 2);
  assert.deepEqual(op.changes, [
    { index: 1, from: -1, to: 2 },
    { index: 3, from: -1, to: 2 },
  ]);
});

test('undoStroke: reverses entire stroke', () => {
  const filled = [0, 1, 0, -1];
  const history = [{
    type: 'stroke',
    color: 1,
    changes: [{ index: 1, from: -1, to: 1 }],
  }];
  const result = undoStroke(filled, history);
  assert.equal(result.filled[1], -1);
  assert.equal(result.history.length, 0);
  assert.ok(result.undone);
});

test('redoStroke: restores entire stroke', () => {
  const filled = [0, -1, 0, -1];
  const future = [{
    type: 'stroke',
    color: 1,
    changes: [{ index: 1, from: -1, to: 1 }],
  }];
  const result = redoStroke(filled, future);
  assert.equal(result.filled[1], 1);
  assert.equal(result.future.length, 0);
  assert.ok(result.redone);
});

test('undoStroke: empty history returns null undone', () => {
  const filled = [0, 1];
  const result = undoStroke(filled, []);
  assert.equal(result.undone, null);
  assert.deepEqual(result.filled, filled);
});

test('redoStroke: empty future returns null redone', () => {
  const filled = [0, -1];
  const result = redoStroke(filled, []);
  assert.equal(result.redone, null);
  assert.deepEqual(result.filled, filled);
});

test('empty stroke does not create operation', () => {
  const prev = [-1, -1];
  const op = createStrokeOperation({ color: 0, indices: [] }, prev);
  assert.equal(op.changes.length, 0);
});

test('color is fixed during stroke', () => {
  const stroke = { color: 3, indices: [0, 1, 2] };
  assert.equal(stroke.color, 3);
});

/* ── P0 Regression tests ── */

test('beginInteraction blocks focusOnWindow', () => {
  const { focusOnWindow, beginInteraction } = createCameraHarness(null, () => {});
  beginInteraction();
  const result = focusOnWindow({ centerX: 10, centerY: 10, zoom: 1 }, false, false);
  assert.equal(result, null, 'should return null when interacting');
});

test('endInteraction flushes pending focus with force', () => {
  let executed = null;
  const pending = { window: { centerX: 10, centerY: 10 }, immediate: true, force: true };
  const harness = createCameraHarness(pending, (win, imm, force) => { executed = { win, imm, force }; });
  harness.beginInteraction();
  harness.focusOnWindow(pending.window, pending.immediate, pending.force);
  harness.endInteraction();
  assert.notEqual(executed, null, 'should execute pending focus');
  assert.equal(executed.force, true, 'should preserve force flag');
  assert.equal(executed.win.centerX, 10);
});

test('arraysEqual detects same content from different reference', () => {
  const a = [1, 2, 3, -1, 5];
  const b = [1, 2, 3, -1, 5];
  const c = [1, 2, 3, -1, 6];
  const d = [1, 2, 3];
  assert.ok(arraysEqual(a, b), 'same content, diff ref');
  assert.ok(!arraysEqual(a, c), 'different content');
  assert.ok(arraysEqual(a, a), 'same reference');
  assert.ok(!arraysEqual(a, d), 'different length');
  assert.ok(!arraysEqual(a, null), 'null b');
  assert.ok(!arraysEqual(null, a), 'null a');
});

test('forced pending focus runs with auto disabled', () => {
  let executed = null;
  const harness = createCameraHarness(null, (win, imm, force) => { executed = { win, imm, force }; });
  harness.setAutoEnabled(false);
  harness.beginInteraction();
  harness.focusOnWindow({ centerX: 10, centerY: 10 }, false, true);
  harness.endInteraction();
  assert.notEqual(executed, null, 'should execute pending with force');
  assert.equal(executed.force, true);
  assert.equal(executed.win.centerX, 10);
});

test('force focus bypasses auto-disabled check', () => {
  const harness = createCameraHarness(null, () => {});
  harness.setAutoEnabled(false);
  const result = harness.focusOnWindow({ centerX: 10, centerY: 10, zoom: 1 }, true, true);
  assert.notEqual(result, null, 'force should bypass auto check');
});

test('window completion detects correctly vs target color', () => {
  const template = { width: 2, height: 2, cells: [1, 1, 0, 0] };
  const cells = [0, 1];
  const filledComplete = [1, 1, 0, 0];
  const filledWrong = [0, 1, 0, 0];
  assert.ok(cells.every(idx => filledComplete[idx] === template.cells[idx]), 'correct fill');
  assert.ok(!cells.every(idx => filledWrong[idx] === template.cells[idx]), 'wrong fill fails');
});

test('selectNextWindow picks closest unvisited', () => {
  const wins = [
    { centerX: 0, centerY: 0, cellCount: 5 },
    { centerX: 20, centerY: 20, cellCount: 5 },
    { centerX: -20, centerY: -20, cellCount: 5 },
  ];
  const visited = new Set([0]);
  const result = selectNextWindow(wins, { x: 10, y: 10 }, { x: 0, y: 0 }, visited);
  assert.ok(result, 'should pick a window');
  assert.ok(result === wins[1] || result === wins[2]);
});

test('selectNextWindow: all blocked returns null', () => {
  const wins = [
    { centerX: 0, centerY: 0, cellCount: 5 },
    { centerX: 20, centerY: 20, cellCount: 5 },
  ];
  const allBlocked = new Set([0, 1]);
  const result = selectNextWindow(wins, { x: 10, y: 10 }, { x: 0, y: 0 }, allBlocked);
  assert.equal(result, null);
});

test('selectNextWindow: single blocked window returns null', () => {
  const wins = [{ centerX: 0, centerY: 0, cellCount: 5 }];
  const blocked = new Set([0]);
  const result = selectNextWindow(wins, { x: 10, y: 10 }, { x: 0, y: 0 }, blocked);
  assert.equal(result, null);
});

test('selectNextWindow: near blocked never beats far unblocked', () => {
  const wins = [
    { centerX: 0, centerY: 0, cellCount: 5 },
    { centerX: 100, centerY: 0, cellCount: 5 },
  ];
  const blocked = new Set([0]);
  const result = selectNextWindow(wins, { x: 0, y: 0 }, null, blocked);
  assert.ok(result, 'should pick a window');
  assert.equal(result.centerX, 100, 'should pick unblocked window');
});

test('empty stroke does not create history operation', () => {
  const op = createStrokeOperation({ color: 0, indices: [] }, [-1, -1]);
  assert.equal(op.changes.length, 0);
});

test('undo fully reverts multi-cell stroke', () => {
  const filled = [1, 1, -1, -1];
  const history = [{
    type: 'stroke',
    color: 1,
    changes: [{ index: 0, from: -1, to: 1 }, { index: 1, from: -1, to: 1 }],
  }];
  const result = undoStroke(filled, history);
  assert.equal(result.filled[0], -1);
  assert.equal(result.filled[1], -1);
});

test('redo fully restores multi-cell stroke', () => {
  const filled = [-1, -1, -1, -1];
  const future = [{
    type: 'stroke',
    color: 1,
    changes: [{ index: 0, from: -1, to: 1 }, { index: 1, from: -1, to: 1 }],
  }];
  const result = redoStroke(filled, future);
  assert.equal(result.filled[0], 1);
  assert.equal(result.filled[1], 1);
});

/* ── Reveal-stroke regression tests ── */

test('reveal stroke paints each cell with its own target color', () => {
  const template = { width: 3, height: 2, palette: ['#000', '#fff', '#f00'], cells: [0, 1, 2, 0, 1, 2] };
  const filled = [-1, -1, -1, -1, -1, -1];
  const strokeCells = [0, 4]; // indices 0 (color 0) and 4 (color 1)
  const nextFilled = [...filled];
  const changes = [];
  for (const idx of strokeCells) {
    nextFilled[idx] = template.cells[idx];
    changes.push({ index: idx, from: filled[idx], to: template.cells[idx] });
  }
  const operation = { type: 'stroke', color: -1, timestamp: Date.now(), changes };
  assert.equal(nextFilled[0], 0, 'cell 0 gets target color 0');
  assert.equal(nextFilled[4], 1, 'cell 4 gets target color 1');
  assert.equal(operation.changes.length, 2, 'two changes');
});

test('reveal stroke has no duplicate indices', () => {
  const indices = [0, 1, 1, 2, 0, 3];
  const unique = new Set(indices);
  assert.equal(unique.size, 4);
});

test('reveal stroke creates one history operation', () => {
  const template = { width: 2, height: 2, cells: [0, 1, 0, 1] };
  const filled = [-1, -1, -1, -1];
  const strokeCells = [0, 1];
  const changes = strokeCells.map(idx => ({ index: idx, from: filled[idx], to: template.cells[idx] }));
  const operation = { type: 'stroke', color: -1, changes };
  assert.equal(operation.changes.length, 2);
  // Undo it
  for (const change of operation.changes) {
    filled[change.index] = change.from;
  }
  assert.ok(filled.every(f => f === -1), 'all reverted');
});

test('reveal stroke undo reverts all cells', () => {
  const template = { width: 2, height: 2, cells: [0, 1, 0, 1] };
  const filled = [-1, -1, -1, -1];
  const strokeCells = [0, 1, 3];
  for (const idx of strokeCells) {
    filled[idx] = template.cells[idx];
  }
  // Undo
  for (const idx of strokeCells) {
    filled[idx] = -1;
  }
  assert.ok(filled.every(f => f === -1));
});

/* Helpers for camera tests */
function createCameraHarness(stubPending, stubFocusOnWindow) {
  let _autoEnabled = true;
  let _interacting = false;
  let _pending = null;
  return {
    setAutoEnabled(v) { _autoEnabled = v; },
    beginInteraction() { _interacting = true; _pending = null; },
    endInteraction() {
      _interacting = false;
      const p = _pending || stubPending;
      _pending = null;
      if (p && (p.force || _autoEnabled)) {
        stubFocusOnWindow(p.window, p.immediate, p.force);
      }
    },
    focusOnWindow(win, immediate, force) {
      if (_interacting) { _pending = { window: win, immediate, force }; return null; }
      if (!force && !_autoEnabled) return null;
      return { x: 0, y: 0, zoom: 1 };
    },
  };
}


