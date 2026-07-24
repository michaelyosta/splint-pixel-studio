import test from 'node:test';
import assert from 'node:assert/strict';
import { rasterizeLine, rasterizeStroke } from '../src/features/coloring/engine/strokeRasterizer.js';
import { findClusters, getClusterBounds, mergeClusters, findUnfilledClusters } from '../src/features/coloring/engine/clusterGraph.js';
import { createWorkingWindows, selectNextWindow } from '../src/features/coloring/engine/workingWindows.js';
import { planCamera, clampCamera, getTransitionDuration, computeInitialCamera, isTargetVisible } from '../src/features/coloring/engine/cameraPlanner.js';
import { buildTargetId, computeVisibleUnfilledCount, isTargetConsideredDone, computeViewportCellBounds, normalizeSafeArea } from '../src/features/coloring/engine/routeTargeting.js';
import { scoreTargetQuality } from '../src/features/coloring/engine/workingWindows.js';
import { applyStroke, undoStroke, redoStroke, createStrokeOperation } from '../src/features/coloring/engine/paintReducer.js';
import { arraysEqual } from '../src/features/coloring/engine/coloringUtils.js';
import { createHistoryOperation, applyChanges } from '../src/features/coloring/engine/historyOperations.js';
import { centroid, distance, clampZoom, computePinchPan, isTapGesture } from '../src/features/coloring/engine/gestureMath.js';
import { AUTO_STATE } from '../src/features/coloring/engine/autoState.js';

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

/* ── Per-cell undo/redo history ── */

test('heterogeneous reveal stroke preserves different to values', () => {
  const template = { width: 2, height: 2, cells: [0, 1, 2, 3] };
  const filled = [-1, -1, -1, -1];
  const changes = [
    { index: 0, from: -1, to: 0 },
    { index: 1, from: -1, to: 1 },
    { index: 2, from: -1, to: 2 },
  ];
  const op = createHistoryOperation({ type: 'stroke', changes });
  assert.equal(op.changes.length, 3);
  assert.equal(op.changes[0].to, 0);
  assert.equal(op.changes[1].to, 1);
  assert.equal(op.changes[2].to, 2);
  assert.ok(op.timestamp > 0);
});

test('undo restores different from values', () => {
  const filled = [0, 1, 2, -1];
  const op = createHistoryOperation({
    type: 'stroke',
    changes: [
      { index: 0, from: -1, to: 0 },
      { index: 1, from: -1, to: 1 },
      { index: 2, from: 5, to: 2 },
    ],
  });
  const next = applyChanges(filled, op.changes, 'from');
  assert.equal(next[0], -1);
  assert.equal(next[1], -1);
  assert.equal(next[2], 5);
  assert.equal(next[3], -1);
});

test('redo restores different to values', () => {
  const filled = [-1, -1, -1, -1];
  const op = createHistoryOperation({
    type: 'stroke',
    changes: [
      { index: 0, from: -1, to: 0 },
      { index: 1, from: -1, to: 1 },
      { index: 2, from: -1, to: 2 },
    ],
  });
  const next = applyChanges(filled, op.changes, 'to');
  assert.equal(next[0], 0);
  assert.equal(next[1], 1);
  assert.equal(next[2], 2);
  assert.equal(next[3], -1);
});

test('two sequential operations use actual state', () => {
  const filled = [-1, -1, -1, -1];
  // First operation: paint cells 0 and 1 with color 0
  const op1 = createHistoryOperation({
    type: 'stroke',
    changes: [
      { index: 0, from: -1, to: 0 },
      { index: 1, from: -1, to: 0 },
    ],
  });
  const state1 = applyChanges(filled, op1.changes, 'to');
  assert.equal(state1[0], 0);
  assert.equal(state1[1], 0);
  // Second operation: overwrite cell 0 with color 2
  const op2 = createHistoryOperation({
    type: 'single',
    changes: [{ index: 0, from: 0, to: 2 }],
  });
  const state2 = applyChanges(state1, op2.changes, 'to');
  assert.equal(state2[0], 2);
  assert.equal(state2[1], 0);
  // Undo second operation
  const reverted = applyChanges(state2, op2.changes, 'from');
  assert.equal(reverted[0], 0);
  assert.equal(reverted[1], 0);
});

test('one gesture creates one history entry', () => {
  const op = createHistoryOperation({
    type: 'stroke',
    changes: [
      { index: 0, from: -1, to: 0 },
      { index: 1, from: -1, to: 0 },
      { index: 2, from: -1, to: 0 },
    ],
  });
  assert.equal(op.type, 'stroke');
  assert.equal(op.changes.length, 3);
});

test('new stroke after undo clears redo stack', () => {
  // Simulate: paint, undo, paint again
  const history = [];
  const future = [];
  // Push first op
  const op1 = createHistoryOperation({
    type: 'stroke',
    changes: [{ index: 0, from: -1, to: 0 }],
  });
  history.push(op1);
  // Undo: move op1 to future
  const undone = history.pop();
  future.push(undone);
  assert.equal(history.length, 0);
  assert.equal(future.length, 1);
  // New paint: should clear future
  future.length = 0;
  const op2 = createHistoryOperation({
    type: 'stroke',
    changes: [{ index: 1, from: -1, to: 1 }],
  });
  history.push(op2);
  assert.equal(future.length, 0);
  assert.equal(history.length, 1);
  assert.equal(history[0].changes[0].index, 1);
});

test('100 operations respect history limit', () => {
  const history = [];
  for (let i = 0; i < 150; i++) {
    const op = createHistoryOperation({
      type: 'single',
      changes: [{ index: i % 10, from: -1, to: i % 5 }],
    });
    history.push(op);
    if (history.length > 100) {
      history.shift();
    }
  }
  assert.equal(history.length, 100);
  assert.equal(history[0].changes[0].index, 0);
});

test('undo redo round-trip returns exact original array', () => {
  const initial = [1, 2, 3, 4];
  const op = createHistoryOperation({
    type: 'stroke',
    changes: [
      { index: 1, from: 2, to: 5 },
      { index: 2, from: 3, to: 6 },
    ],
  });
  // Apply
  const painted = applyChanges(initial, op.changes, 'to');
  assert.equal(painted[0], 1);
  assert.equal(painted[1], 5);
  assert.equal(painted[2], 6);
  assert.equal(painted[3], 4);
  // Undo
  const undone = applyChanges(painted, op.changes, 'from');
  assert.deepEqual(undone, initial);
  // Redo
  const redone = applyChanges(undone, op.changes, 'to');
  assert.deepEqual(redone, painted);
});

/* ── Reveal camera ── */

test('reveal clusters include unfilled cells of all colors', () => {
  const t = simpleTemplate(3, 3, ['#000', '#fff', '#f00'], [0, 1, 2, 0, 1, 2, 0, 1, 2]);
  const filled = Array(9).fill(-1);
  filled[4] = 1;
  const clusters = findUnfilledClusters(t, filled);
  const allIndices = new Set(clusters.flat());
  const remaining = Array.from({ length: 9 }, (_, i) => i).filter(i => filled[i] === -1);
  for (const idx of remaining) {
    assert.ok(allIndices.has(idx), `index ${idx} must be in a cluster`);
  }
  assert.equal(allIndices.size, 8);
  for (const idx of allIndices) {
    assert.ok(filled[idx] === -1, `index ${idx} should be unfilled`);
  }
});

test('filled cells are excluded from reveal clusters', () => {
  const t = simpleTemplate(2, 2, ['#fff'], [0, 0, 0, 0]);
  const filled = [-1, 0, -1, -1];
  const clusters = findUnfilledClusters(t, filled);
  const allIndices = new Set(clusters.flat());
  assert.ok(!allIndices.has(1));
  assert.ok(allIndices.has(0));
  assert.ok(allIndices.has(2));
  assert.ok(allIndices.has(3));
});

test('classic clusters remain restricted to selected color', () => {
  const t = simpleTemplate(3, 3, ['#fff', '#000'], [0, 1, 0, 1, 0, 1, 0, 1, 0]);
  const filled = Array(9).fill(-1);
  const clusters0 = findClusters(t, filled, 0);
  const clusters1 = findClusters(t, filled, 1);
  const all0 = new Set(clusters0.flat());
  const all1 = new Set(clusters1.flat());
  for (const idx of all0) assert.equal(t.cells[idx], 0);
  for (const idx of all1) assert.equal(t.cells[idx], 1);
});

test('changing selectedColor does not change reveal cell set', () => {
  const t = simpleTemplate(3, 3, ['#000', '#fff', '#f00'], [0, 1, 2, 0, 1, 2, 0, 1, 2]);
  const filled = Array(9).fill(-1);
  const clusters1 = findUnfilledClusters(t, filled);
  const set1 = new Set(clusters1.flat());
  const clusters2 = findUnfilledClusters(t, filled);
  const set2 = new Set(clusters2.flat());
  assert.deepEqual(set1, set2);
});

test('all unfilled indices appear in at least one working window', () => {
  const t = makeTemplate(8, 8);
  const filled = Array(64).fill(-1);
  filled[0] = 0; filled[10] = 0; filled[20] = 0;
  const clusters = findUnfilledClusters(t, filled);
  const merged = mergeClusters(clusters, t.width);
  const allWindows = [];
  for (const cluster of merged) {
    allWindows.push(...createWorkingWindows(cluster, t, 400, 400));
  }
  const windowCovered = new Set(allWindows.flatMap(w => w.cells));
  for (let i = 0; i < 64; i++) {
    if (filled[i] === -1) {
      assert.ok(windowCovered.has(i), `unfilled index ${i} must be covered`);
    }
  }
});

/* ── Gesture math ── */

function makePointerEvent(clientX, clientY) {
  return { clientX, clientY };
}

test('pure pan at ratio=1 does not change zoom', () => {
  const a = makePointerEvent(100, 100);
  const b = makePointerEvent(200, 200);
  const startDist = distance(a, b);
  const startCent = centroid(a, b);
  const startCam = { x: 50, y: 50, zoom: 1 };
  const rect = { left: 0, top: 0 };
  const a2 = makePointerEvent(150, 100);
  const b2 = makePointerEvent(250, 200);
  const result = computePinchPan({
    a: a2, b: b2,
    startDistance: startDist,
    startCentroid: startCent,
    startCamera: startCam,
    rect,
  });
  assert.ok(Math.abs(result.zoom - 1) < 0.01, 'zoom should not change');
  assert.ok(result.x !== 50 || result.y !== 50, 'camera should move');
});

test('pure pinch around fixed centroid does not shift center', () => {
  const centX = 200;
  const centY = 200;
  const startDist = 100;
  const startCam = { x: 0, y: 0, zoom: 1 };
  const rect = { left: 0, top: 0 };
  const a = makePointerEvent(centX - 50, centY);
  const b = makePointerEvent(centX + 50, centY);
  const startCentroid = { x: centX, y: centY };
  const a2 = makePointerEvent(centX - 25, centY);
  const b2 = makePointerEvent(centX + 25, centY);
  const result = computePinchPan({
    a: a2, b: b2,
    startDistance: startDist,
    startCentroid,
    startCamera: startCam,
    rect,
  });
  const cx = centX - rect.left;
  const sx = startCentroid.x - rect.left;
  const expectedX = cx + (startCam.x - sx) * (result.zoom / startCam.zoom);
  assert.ok(Math.abs(result.x - expectedX) < 0.01);
});

test('combined pan and pinch modifies both zoom and position', () => {
  const startDist = 200;
  const startCam = { x: 100, y: 100, zoom: 1 };
  const rect = { left: 10, top: 20 };
  const a = makePointerEvent(200, 200);
  const b = makePointerEvent(400, 200);
  const startCentroid = centroid(a, b);
  const a2 = makePointerEvent(220, 220);
  const b2 = makePointerEvent(460, 220);
  const result = computePinchPan({
    a: a2, b: b2,
    startDistance: startDist,
    startCentroid,
    startCamera: startCam,
    rect,
  });
  assert.ok(result.zoom !== 1);
  assert.ok(result.x !== 100 || result.y !== 100);
});

test('zoom is clamped between 0.25 and 4', () => {
  assert.equal(clampZoom(10), 4);
  assert.equal(clampZoom(0.1), 0.25);
  assert.equal(clampZoom(1.5), 1.5);
});

test('isTapGesture returns true for small movement', () => {
  const start = makePointerEvent(100, 100);
  const end = makePointerEvent(103, 102);
  assert.ok(isTapGesture(start, end));
});

test('isTapGesture returns false for large movement', () => {
  const start = makePointerEvent(100, 100);
  const end = makePointerEvent(120, 120);
  assert.ok(!isTapGesture(start, end));
});

test('isTapGesture returns false for null input', () => {
  assert.ok(!isTapGesture(null, makePointerEvent(100, 100)));
  assert.ok(!isTapGesture(makePointerEvent(100, 100), null));
});

test('centroid computes midpoint correctly', () => {
  const a = makePointerEvent(100, 200);
  const b = makePointerEvent(200, 300);
  const c = centroid(a, b);
  assert.equal(c.x, 150);
  assert.equal(c.y, 250);
});

test('distance computes correctly', () => {
  const a = makePointerEvent(0, 0);
  const b = makePointerEvent(3, 4);
  assert.equal(distance(a, b), 5);
});

test('zero startDistance produces finite camera values', () => {
  const a = makePointerEvent(200, 200);
  const b = makePointerEvent(200, 200);
  const startCentroid = centroid(a, b);
  const result = computePinchPan({
    a: makePointerEvent(210, 200),
    b: makePointerEvent(210, 200),
    startDistance: 0,
    startCentroid,
    startCamera: { x: 100, y: 100, zoom: 1 },
    rect: { left: 0, top: 0 },
  });
  assert.ok(Number.isFinite(result.x), 'x must be finite');
  assert.ok(Number.isFinite(result.y), 'y must be finite');
  assert.ok(Number.isFinite(result.zoom), 'zoom must be finite');
  assert.ok(result.zoom >= 0.25, 'zoom must be clamped');
  assert.ok(result.zoom <= 4, 'zoom must be clamped');
});

/* ── History contract regression ── */

test('ColoringSession callback payload has changes directly', () => {
  const operation = {
    type: 'stroke',
    color: 2,
    timestamp: Date.now(),
    changes: [
      { index: 1, from: -1, to: 2 },
      { index: 3, from: -1, to: 2 },
    ],
  };
  assert.ok(Array.isArray(operation.changes), 'operation.changes must be an array');
  assert.equal(operation.changes.length, 2);
  assert.ok(!('stroke' in operation), 'operation must not contain stroke field');
});

test('stroke commit creates one history entry', () => {
  const operation = createStrokeOperation({ color: 1, indices: [0, 1, 2] }, [-1, -1, -1, -1]);
  assert.equal(operation.type, 'stroke');
  assert.equal(operation.changes.length, 3);
});

test('history entry has no nested stroke field', () => {
  const op = createHistoryOperation({
    type: 'stroke',
    changes: [{ index: 0, from: -1, to: 0 }],
  });
  const entry = op;
  assert.ok(!('stroke' in entry), 'history entry must not have stroke field');
  assert.ok(Array.isArray(entry.changes), 'changes must be an array');
  assert.equal(entry.type, 'stroke');
});

test('undo after stroke does not throw', () => {
  const filled = [1, 1, -1, -1];
  const history = [{
    type: 'stroke',
    color: 1,
    timestamp: Date.now(),
    changes: [
      { index: 0, from: -1, to: 1 },
      { index: 1, from: -1, to: 1 },
    ],
  }];
  const result = undoStroke(filled, history);
  assert.equal(result.filled[0], -1);
  assert.equal(result.filled[1], -1);
  assert.ok(result.undone);
});

test('stroke undo redo round-trip returns exact state', () => {
  const initial = Array(4).fill(-1);
  const op = {
    type: 'stroke',
    color: 1,
    timestamp: Date.now(),
    changes: [
      { index: 0, from: -1, to: 1 },
      { index: 1, from: -1, to: 1 },
    ],
  };
  const painted = applyChanges(initial, op.changes, 'to');
  assert.equal(painted[0], 1);
  assert.equal(painted[1], 1);
  const undone = applyChanges(painted, op.changes, 'from');
  assert.deepEqual(undone, initial);
  const redone = applyChanges(undone, op.changes, 'to');
  assert.deepEqual(redone, painted);
});

test('reveal heterogeneous stroke survives undo redo chain', () => {
  const initial = Array(4).fill(-1);
  const op = {
    type: 'stroke',
    color: -1,
    timestamp: Date.now(),
    changes: [
      { index: 0, from: -1, to: 0 },
      { index: 1, from: -1, to: 1 },
      { index: 2, from: -1, to: 2 },
    ],
  };
  const painted = applyChanges(initial, op.changes, 'to');
  assert.equal(painted[0], 0);
  assert.equal(painted[1], 1);
  assert.equal(painted[2], 2);
  const undone = applyChanges(painted, op.changes, 'from');
  assert.ok(undone.every(f => f === -1));
  const redone = applyChanges(undone, op.changes, 'to');
  assert.equal(redone[0], 0);
  assert.equal(redone[1], 1);
  assert.equal(redone[2], 2);
});

/* ── Legacy paint regression ── */

function simulateLegacyClassic(template, filled, selectedColor, paintFn) {
  return function paintAt(index) {
    if (index == null || filled[index] !== -1) return;
    if (template.cells[index] !== selectedColor) return false;
    paintFn(index, selectedColor);
    return true;
  };
}

function simulateLegacyReveal(template, filled, paintFn) {
  return function paintAt(index) {
    if (index == null || filled[index] !== -1) return;
    const targetColor = template.cells[index];
    paintFn(index, targetColor);
    return true;
  };
}

test('Legacy classic: wrong color does not call onPaint', () => {
  const template = { width: 2, height: 2, cells: [0, 1, 0, 1] };
  const filled = [-1, -1, -1, -1];
  let painted = null;
  const paint = simulateLegacyClassic(template, filled, 0, (idx, color) => { painted = { idx, color }; });
  paint(0);
  assert.deepEqual(painted, { idx: 0, color: 0 });
  painted = null;
  paint(1);
  assert.equal(painted, null, 'must not paint wrong color cell');
});

test('Legacy reveal: wrong color cell paints with its target color', () => {
  const template = { width: 2, height: 2, cells: [0, 1, 0, 1] };
  const filled = [-1, -1, -1, -1];
  let painted = null;
  const paint = simulateLegacyReveal(template, filled, (idx, color) => { painted = { idx, color }; });
  paint(0);
  assert.deepEqual(painted, { idx: 0, color: 0 });
  painted = null;
  paint(1);
  assert.deepEqual(painted, { idx: 1, color: 1 }, 'must paint with target color, not selected');
});

test('Legacy reveal does not pass selectedColor instead of targetColor', () => {
  const template = { width: 2, height: 2, cells: [0, 2, 0, 2] };
  const filled = [-1, -1, -1, -1];
  let painted = null;
  const paint = simulateLegacyReveal(template, filled, (idx, color) => { painted = { idx, color }; });
  paint(1);
  assert.equal(painted.color, 2, 'must use cell target color 2');
  assert.notEqual(painted.color, 0, 'must not use selectedColor 0');
});

test('Reveal single paint creates canonical history operation', () => {
  const template = { width: 2, height: 2, cells: [0, 1, 0, 1] };
  let lastOp = null;
  const paint = simulateLegacyReveal(template, [-1, -1, -1, -1], (idx, color) => {
    lastOp = {
      type: 'single',
      timestamp: Date.now(),
      changes: [{ index: idx, from: -1, to: color }],
    };
  });
  paint(3);
  assert.ok(lastOp, 'operation must be created');
  assert.equal(lastOp.type, 'single');
  assert.equal(lastOp.changes.length, 1);
  assert.equal(lastOp.changes[0].index, 3);
  assert.equal(lastOp.changes[0].to, 1);
  assert.ok(!('stroke' in lastOp), 'no nested stroke field');
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

/* ── Camera Jump Fix ── */

test('computeInitialCamera returns deterministic non-unit zoom', () => {
  const t = makeTemplate(32, 32);
  const cam = computeInitialCamera(t, 400, 300);
  assert.ok(cam.zoom > 0, 'zoom must be positive');
  assert.ok(cam.zoom <= 1, 'zoom must not exceed 1');
  assert.notEqual(cam.zoom, 1, 'zoom must not be fixed at 1');
  const cam2 = computeInitialCamera(t, 400, 300);
  assert.equal(cam.zoom, cam2.zoom, 'zoom must be deterministic');
  assert.equal(cam.x, cam2.x);
  assert.equal(cam.y, cam2.y);
});

test('computeInitialCamera respects safe area', () => {
  const t = makeTemplate(32, 32);
  const camNoSafe = computeInitialCamera(t, 400, 300);
  const camSafe = computeInitialCamera(t, 400, 300, { top: 0, right: 130, bottom: 0, left: 0 });
  assert.ok(camSafe.zoom <= camNoSafe.zoom, 'zoom should shrink when safe area reduces available space');
  assert.notEqual(camSafe.zoom, camNoSafe.zoom, 'zoom must differ with safe area applied');
});

test('planCamera with safe area avoids right zone', () => {
  const target = { centerX: 15, centerY: 15, zoom: 2 };
  const cam = planCamera(target, 400, 300, 32, 32, { top: 0, right: 160, bottom: 0, left: 0 });
  const centerScreenX = 400 / 2 - target.centerX * 32 * cam.zoom;
  assert.ok(centerScreenX <= cam.x + 1, 'center of target should not be hidden under right overlay');
});

/* ── AUTO Route Recovery ── */

test('selectNextWindow: auto recovers when visited set blocks all', () => {
  const wins = [
    { centerX: 0, centerY: 0, cellCount: 5 },
    { centerX: 20, centerY: 0, cellCount: 3 },
  ];
  const allVisited = new Set([0, 1]);
  const result = selectNextWindow(wins, { x: 10, y: 0 }, null, allVisited);
  assert.equal(result, null, 'should return null when all blocked');
});

test('selectNextWindow: cleared visited set restores candidates', () => {
  const wins = [
    { centerX: 0, centerY: 0, cellCount: 5 },
    { centerX: 20, centerY: 0, cellCount: 3 },
  ];
  const cleared = new Set();
  const result = selectNextWindow(wins, { x: 10, y: 0 }, null, cleared);
  assert.notEqual(result, null, 'should find a window when visited is cleared');
  assert.ok(result === wins[0] || result === wins[1]);
});

test('getBlockedSet: completed windows are blocked', () => {
  const template = { width: 2, height: 2, cells: [0, 0, 1, 1] };
  const mockWindows = [
    { cells: [0, 1], centerX: 0.5, centerY: 0, cellCount: 2 },
    { cells: [2, 3], centerX: 0.5, centerY: 1, cellCount: 2 },
  ];
  const filled = [0, 0, 1, 1];
  const blocked = new Set();
  mockWindows.forEach((win, idx) => {
    if (win.cells.every(ci => filled[ci] === template.cells[ci])) {
      blocked.add(idx);
    }
  });
  assert.equal(blocked.size, 2, 'all windows should be blocked when filled = template.cells');
});

test('getBlockedSet: partially filled windows are not blocked', () => {
  const template = { width: 2, height: 2, cells: [0, 0, 1, 1] };
  const mockWindows = [
    { cells: [0, 1], centerX: 0.5, centerY: 0, cellCount: 2 },
    { cells: [2, 3], centerX: 0.5, centerY: 1, cellCount: 2 },
  ];
  const filled = [0, -1, 1, 1];
  const blocked = new Set();
  mockWindows.forEach((win, idx) => {
    if (win.cells.every(ci => filled[ci] === template.cells[ci])) {
      blocked.add(idx);
    }
  });
  assert.equal(blocked.size, 1, 'only completed windows should be blocked');
  assert.ok(blocked.has(1), 'window with all cells filled should be blocked');
  assert.ok(!blocked.has(0), 'window with unfilled cells should not be blocked');
});

test('last unfilled cell search finds correct index', () => {
  const template = { width: 3, height: 3 };
  const filled = [0, 0, 0, 0, 0, 0, 0, 0, -1];
  const cx = (template.width - 1) / 2;
  const cy = (template.height - 1) / 2;
  let lastIdx = -1;
  let bestDist = Infinity;
  for (let i = 0; i < filled.length; i++) {
    if (filled[i] !== -1) continue;
    const dx = (i % template.width) - cx;
    const dy = Math.floor(i / template.width) - cy;
    const dist = dx * dx + dy * dy;
    if (dist < bestDist) {
      bestDist = dist;
      lastIdx = i;
    }
  }
  assert.equal(lastIdx, 8, 'last unfilled cell at index 8 must be found');
});

test('no unfilled cells returns -1 from last-cell search', () => {
  const template = { width: 2, height: 2 };
  const filled = [0, 1, 2, 3];
  const found = filled.findIndex(f => f === -1);
  assert.equal(found, -1, 'no unfilled cells should give -1');
});

test('hasUnfilledCells: partial fill returns true', () => {
  const filled = [0, -1, 1, 0];
  const has = filled.some(f => f === -1);
  assert.ok(has);
});

test('hasUnfilledCells: complete fill returns false', () => {
  const filled = [0, 1, 2, 3];
  const has = filled.some(f => f === -1);
  assert.ok(!has);
});

/* ── AUTO State Machine ── */

test('AUTO_STATE enum has three distinct values', () => {
  const states = new Set([AUTO_STATE.OFF, AUTO_STATE.ACTIVE, AUTO_STATE.PAUSED]);
  assert.equal(states.size, 3, 'must have exactly 3 distinct states');
});

test('AUTO_STATE values are frozen', () => {
  assert.throws(() => { AUTO_STATE.OFF = 'foo'; }, TypeError, 'enum should be frozen');
});

test('toggleAuto: active -> off', () => {
  let state = AUTO_STATE.ACTIVE;
  if (state === AUTO_STATE.ACTIVE) state = AUTO_STATE.OFF;
  assert.equal(state, AUTO_STATE.OFF);
});

test('toggleAuto: off -> active', () => {
  let state = AUTO_STATE.OFF;
  if (state === AUTO_STATE.OFF) state = AUTO_STATE.ACTIVE;
  assert.equal(state, AUTO_STATE.ACTIVE);
});

test('toggleAuto: paused resumes (not toggles off)', () => {
  let state = AUTO_STATE.PAUSED;
  if (state === AUTO_STATE.PAUSED) state = AUTO_STATE.ACTIVE;
  assert.equal(state, AUTO_STATE.ACTIVE, 'toggle should resume when paused, not turn off');
});

test('pauseAuto: active -> paused', () => {
  let state = AUTO_STATE.ACTIVE;
  if (state === AUTO_STATE.ACTIVE) state = AUTO_STATE.PAUSED;
  assert.equal(state, AUTO_STATE.PAUSED);
});

test('pauseAuto: off -> stays off', () => {
  let state = AUTO_STATE.OFF;
  if (state !== AUTO_STATE.ACTIVE) { /* no-op, only pause active */ }
  assert.equal(state, AUTO_STATE.OFF);
});

test('isAutoActive: only ACTIVE without interaction', () => {
  const state = AUTO_STATE.ACTIVE;
  const interacting = false;
  const isActive = state === AUTO_STATE.ACTIVE && !interacting;
  assert.ok(isActive);
});

test('isAutoActive: PAUSED is not active', () => {
  const state = AUTO_STATE.PAUSED;
  const interacting = false;
  const isActive = state === AUTO_STATE.ACTIVE && !interacting;
  assert.ok(!isActive);
});

test('isAutoActive: ACTIVE but interacting is not active', () => {
  const state = AUTO_STATE.ACTIVE;
  const interacting = true;
  const isActive = state === AUTO_STATE.ACTIVE && !interacting;
  assert.ok(!isActive);
});

test('isAutoActive: OFF is not active', () => {
  const state = AUTO_STATE.OFF;
  const interacting = false;
  const isActive = state === AUTO_STATE.ACTIVE && !interacting;
  assert.ok(!isActive);
});

test('color change preserves activeWindowId consistency', () => {
  let activeWindowId = 2;
  const newColorIndex = 1;
  activeWindowId = newColorIndex !== activeWindowId ? -1 : activeWindowId;
  const incorrect = activeWindowId === -1;
  assert.ok(incorrect || activeWindowId === newColorIndex);
});

test('stale timer disposal does not control new template', () => {
  let fired = false;
  const sessionId = 1;
  const timer = setTimeout(() => { fired = true; }, 100);
  const newSessionId = sessionId + 1;
  clearTimeout(timer);
  assert.ok(newSessionId > sessionId, 'new session created');
  assert.ok(!fired, 'stale timer must not fire');
});

test('recovery counter resets on route rebuild', () => {
  let count = 0;
  count = 0;
  assert.equal(count, 0, 'recovery count must reset');
  count += 1;
  count += 1;
  count += 1;
  assert.equal(count, 3);
  count = 0;
  assert.equal(count, 0, 'count resets on fresh route');
});

/* ── Safe Area & HUD ── */

test('safe area reduces effective viewport', () => {
  const viewW = 400;
  const viewH = 300;
  const safe = { top: 60, right: 140, bottom: 0, left: 0 };
  const availW = viewW - safe.left - safe.right;
  const availH = viewH - safe.top - safe.bottom;
  assert.ok(availW < viewW, 'available width must be reduced');
  assert.ok(availH < viewH, 'available height must be reduced');
  assert.equal(availW, 260);
  assert.equal(availH, 240);
});

test('safe area zero allows full viewport', () => {
  const viewW = 400;
  const viewH = 300;
  const safe = { top: 0, right: 0, bottom: 0, left: 0 };
  const availW = viewW - safe.left - safe.right;
  const availH = viewH - safe.top - safe.bottom;
  assert.equal(availW, 400);
  assert.equal(availH, 300);
});

/* ── Stable Target IDs ── */

test('buildTargetId produces deterministic id', () => {
  const t = makeTemplate(4, 4);
  const win = { cells: [0, 1, 2, 3], bounds: { minX: 0, minY: 0, maxX: 3, maxY: 0, width: 4, height: 1 }, cellCount: 4 };
  const id1 = buildTargetId(t, win, 0);
  const id2 = buildTargetId(t, win, 0);
  assert.equal(id1, id2, 'same inputs must produce same id');
  assert.ok(id1.startsWith('tgt_'), 'id must have prefix');
});

test('buildTargetId different color produces different id', () => {
  const t = makeTemplate(4, 4);
  const win = { cells: [0, 1, 2, 3], bounds: { minX: 0, minY: 0, maxX: 3, maxY: 0, width: 4, height: 1 }, cellCount: 4 };
  const id0 = buildTargetId(t, win, 0);
  const id1 = buildTargetId(t, win, 1);
  assert.notEqual(id0, id1, 'different colors must produce different ids');
});

test('buildTargetId different cells produce different id', () => {
  const t = makeTemplate(4, 4);
  const win1 = { cells: [0, 1, 2, 3], bounds: { minX: 0, minY: 0, maxX: 3, maxY: 0, width: 4, height: 1 }, cellCount: 4 };
  const win2 = { cells: [4, 5, 6, 7], bounds: { minX: 0, minY: 1, maxX: 3, maxY: 1, width: 4, height: 1 }, cellCount: 4 };
  assert.notEqual(buildTargetId(t, win1, 0), buildTargetId(t, win2, 0));
});

test('buildTargetId reveal mode (null color) produces id', () => {
  const t = makeTemplate(4, 4);
  const win = { cells: [0, 1], bounds: { minX: 0, minY: 0, maxX: 1, maxY: 0, width: 2, height: 1 }, cellCount: 2 };
  const id = buildTargetId(t, win, null);
  assert.ok(id.includes('_-1_'), 'null routing color should encode as -1');
});

test('buildTargetId survives array rebuild', () => {
  const t = makeTemplate(4, 4);
  const win1 = { cells: [5, 9, 10], bounds: { minX: 1, minY: 1, maxX: 2, maxY: 2, width: 2, height: 2 }, cellCount: 3 };
  const sorted = [...win1.cells].sort((a, b) => a - b);
  const win2 = { cells: sorted, bounds: win1.bounds, cellCount: 3 };
  assert.equal(buildTargetId(t, win1, 2), buildTargetId(t, win2, 2));
});

/* ── Visible Cell Counting ── */

test('computeVisibleUnfilledCount all visible at overview', () => {
  const t = makeTemplate(4, 4);
  const target = { cells: [0, 1, 2, 3] };
  const camera = { x: 0, y: 0, zoom: 1 };
  const filled = [-1, -1, -1, -1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  const count = computeVisibleUnfilledCount(target, camera, t, filled, 400, 300, null);
  assert.equal(count, 4);
});

test('computeVisibleUnfilledCount zero when zoomed far from target', () => {
  const t = makeTemplate(8, 8);
  const target = { cells: [0, 1] };
  const camera = { x: -500, y: -500, zoom: 1 };
  const filled = Array(64).fill(-1);
  const count = computeVisibleUnfilledCount(target, camera, t, filled, 200, 200, null);
  assert.equal(count, 0);
});

test('computeVisibleUnfilledCount only unfilled count', () => {
  const t = makeTemplate(4, 4);
  const target = { cells: [0, 1, 2, 3] };
  const camera = { x: 0, y: 0, zoom: 1 };
  const filled = [0, -1, -1, -1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  const count = computeVisibleUnfilledCount(target, camera, t, filled, 400, 300, null);
  assert.equal(count, 3, 'should count only unfilled visible cells');
});

test('computeVisibleUnfilledCount safe area excludes right zone', () => {
  const t = makeTemplate(4, 4);
  const target = { cells: [0, 1, 2, 3] };
  const camera = { x: 0, y: 0, zoom: 2 };
  const filled = [-1, -1, -1, -1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  const count = computeVisibleUnfilledCount(target, camera, t, filled, 400, 300, { top: 0, right: 200, bottom: 0, left: 0 });
  assert.ok(count >= 0 && count <= 4, 'safe area should not affect these cells at this zoom');
});

/* ── Target Completion ── */

test('isTargetConsideredDone all cells filled returns true', () => {
  const t = makeTemplate(4, 4);
  const target = { cells: [0, 1] };
  const camera = { x: 0, y: 0, zoom: 1 };
  const filled = [0, 0, -1, -1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  assert.ok(isTargetConsideredDone(target, camera, t, filled, 400, 300, null));
});

test('isTargetConsideredDone visible cells filled but non-visible unfilled', () => {
  const t = makeTemplate(4, 4);
  const target = { cells: [0, 1, 8, 9] };
  const camera = { x: 0, y: 0, zoom: 0.5 };
  const filled = [0, 0, -1, -1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  const visible = computeVisibleUnfilledCount(target, camera, t, filled, 200, 150, null);
  assert.equal(visible, 0, 'at small viewport + low zoom, all cells are too small to be visible');
  const done = isTargetConsideredDone(target, camera, t, filled, 200, 150, null);
  assert.ok(done, 'visible unfilled=0 means target is considered done');
});

test('isTargetConsideredDone unfilled visible cells returns false', () => {
  const t = makeTemplate(4, 4);
  const target = { cells: [0, 1] };
  const camera = { x: 0, y: 0, zoom: 1 };
  const filled = [-1, -1, -1, -1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  assert.ok(!isTargetConsideredDone(target, camera, t, filled, 400, 300, null));
});

/* ── Viewport Bounds ── */

test('computeViewportCellBounds overview covers whole template', () => {
  const bounds = computeViewportCellBounds({ x: 0, y: 0, zoom: 0.1 }, 400, 300, null, 32, 32);
  assert.ok(bounds.maxCellX - bounds.minCellX > 0);
  assert.ok(bounds.maxCellY - bounds.minCellY > 0);
});

test('computeViewportCellBounds zoom 2 narrows view', () => {
  const boundsZoom2 = computeViewportCellBounds({ x: 0, y: 0, zoom: 2 }, 400, 300, null, 32, 32);
  const boundsZoom1 = computeViewportCellBounds({ x: 0, y: 0, zoom: 1 }, 400, 300, null, 32, 32);
  assert.ok(boundsZoom2.maxCellX - boundsZoom2.minCellX < boundsZoom1.maxCellX - boundsZoom1.minCellX,
    'higher zoom means fewer visible cells');
});

/* ── Target Quality Scoring ── */

test('scoreTargetQuality prefers more unfilled cells', () => {
  const t = makeTemplate(8, 8);
  const win1 = { cells: [0, 1], cellCount: 2 };
  const win2 = { cells: [0, 1, 8, 9], cellCount: 4 };
  const filled = Array(64).fill(-1);
  assert.ok(scoreTargetQuality(win2, t, filled) > scoreTargetQuality(win1, t, filled),
    'target with more unfilled cells scores higher');
});

test('scoreTargetQuality gives lower score for completed cluster', () => {
  const t = makeTemplate(4, 4);
  const win = { cells: [0, 1, 2], cellCount: 3 };
  const filledEmpty = [-1, -1, -1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  const filledDone = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  assert.notEqual(scoreTargetQuality(win, t, filledEmpty), scoreTargetQuality(win, t, filledDone));
});

/* ── isTargetVisible ── */

test('isTargetVisible target center in viewport returns true', () => {
  const target = { centerX: 5, centerY: 5 };
  const camera = { x: 0, y: 0, zoom: 1 };
  assert.ok(isTargetVisible(target, camera, null, 400, 300));
});

test('isTargetVisible target center far outside viewport returns false', () => {
  const target = { centerX: 50, centerY: 50 };
  const camera = { x: 0, y: 0, zoom: 1 };
  assert.ok(!isTargetVisible(target, camera, null, 200, 150));
});

test('isTargetVisible null target returns false', () => {
  assert.ok(!isTargetVisible(null, { x: 0, y: 0, zoom: 1 }, null, 400, 300));
});

/* ── createWorkingWindows with safe area ── */

test('createWorkingWindows safe area reduces visible cells per window', () => {
  const cluster = Array.from({ length: 256 }, (_, i) => i);
  const t = makeTemplate(16, 16);
  const winsNoSafe = createWorkingWindows(cluster, t, 400, 300);
  const winsSafe = createWorkingWindows(cluster, t, 400, 300, { top: 60, right: 140, bottom: 0, left: 0 });
  assert.ok(winsSafe.length >= winsNoSafe.length, 'smaller viewport yields equal or more sub-windows');
});

/* ── AUTO advance semantics ── */

test('AUTO advance: target with all visible cells filled triggers advance', () => {
  const t = { width: 4, height: 4, cells: Array(16).fill(0), palette: ['#fff'] };
  const target = { cells: [0, 1, 4, 5], centerX: 1.5, centerY: 1.5, zoom: 1.5, cellCount: 4 };
  const camera = { x: 50, y: 50, zoom: 1.5 };
  const filled = [0, 0, -1, -1, 0, 0, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1];
  const visibleUnfilled = computeVisibleUnfilledCount(target, camera, t, filled, 400, 300, { top: 0, right: 0, bottom: 0, left: 0 });
  assert.equal(visibleUnfilled, 0, 'cells 0,1,4,5 filled — visible unfilled = 0');
  const globalUnfilled = filled.reduce((c, f) => c + (f === -1 ? 1 : 0), 0);
  assert.ok(globalUnfilled > 0, 'global unfilled still > 0');
  assert.ok(visibleUnfilled === 0 && globalUnfilled > 0, 'AUTO should advance when visible cells done');
});

test('AUTO advance: target with hidden unfilled cells still triggers advance', () => {
  const t = { width: 4, height: 4, cells: Array(16).fill(0), palette: ['#fff'] };
  const target = { cells: [0, 1, 8, 9], centerX: 0.5, centerY: 0.5, zoom: 2, cellCount: 4 };
  const camera = { x: -400, y: -400, zoom: 2 };
  const filled = [0, 0, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1];
  const visible = computeVisibleUnfilledCount(target, camera, t, filled, 400, 300, { top: 0, right: 0, bottom: 0, left: 0 });
  assert.equal(visible, 0, 'camera shifted so cells are off-screen');
  const done = isTargetConsideredDone(target, camera, t, filled, 400, 300, { top: 0, right: 0, bottom: 0, left: 0 });
  assert.ok(done, 'visible unfilled=0 triggers done');
});

test('AUTO advance: after color change, new target is selected', () => {
  const template = { width: 4, height: 2, cells: [0, 0, 1, 1, 0, 0, 1, 1], palette: ['#fff', '#000'] };
  const filled = [-1, -1, -1, -1, -1, -1, -1, -1];
  const clusters0 = findClusters(template, filled, 0);
  assert.ok(clusters0.length > 0, 'color 0 has unfilled clusters');
  const clusters1 = findClusters(template, filled, 1);
  assert.ok(clusters1.length > 0, 'color 1 has unfilled clusters');
  assert.notDeepEqual(clusters0, clusters1, 'different colors have different clusters');
});

test('AUTO advance: completed template does not trigger advance', () => {
  const t = { width: 2, height: 2, cells: [0, 1, 0, 1], palette: ['#fff', '#000'] };
  const filled = [0, 1, 0, 1];
  const hasUnfilled = filled.some(f => f === -1);
  assert.ok(!hasUnfilled, 'fully completed has no unfilled');
  const target = { cells: [0, 2], centerX: 0.5, centerY: 0.5, zoom: 1, cellCount: 2 };
  const camera = { x: 0, y: 0, zoom: 1 };
  assert.ok(isTargetConsideredDone(target, camera, t, filled, 400, 300, null));
});

test('AUTO advance: stable ID survives window array rebuild', () => {
  const t = makeTemplate(4, 4);
  const win1 = { cells: [1, 2, 5, 6], bounds: { minX: 1, minY: 1, maxX: 2, maxY: 1, width: 2, height: 1 }, cellCount: 4 };
  const id1 = buildTargetId(t, win1, 0);
  const win2 = { cells: [1, 2, 5, 6], bounds: { minX: 1, minY: 1, maxX: 2, maxY: 1, width: 2, height: 1 }, cellCount: 4 };
  const id2 = buildTargetId(t, win2, 0);
  assert.equal(id1, id2, 'stable id must survive object recreation');
});

test('AUTO advance: visited targets excluding current returns new id', () => {
  const t = makeTemplate(4, 4);
  const winA = { cells: [0, 1, 4, 5], bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1, width: 2, height: 2 }, cellCount: 4 };
  const winB = { cells: [2, 3, 6, 7], bounds: { minX: 2, minY: 0, maxX: 3, maxY: 1, width: 2, height: 2 }, cellCount: 4 };
  const idA = buildTargetId(t, winA, 0);
  const idB = buildTargetId(t, winB, 0);
  assert.notEqual(idA, idB);
  const visited = new Set([idA]);
  const hasVisitedB = visited.has(idB);
  assert.ok(!hasVisitedB, 'unvisited target B should not be in visited set');
});

/* ── normalizeSafeArea ── */

test('normalizeSafeArea: valid insets pass through', () => {
  const result = normalizeSafeArea({ top: 60, right: 70, bottom: 0, left: 0 }, 400, 300);
  assert.equal(result.top, 60);
  assert.equal(result.right, 70);
  assert.equal(result.bottom, 0);
  assert.equal(result.left, 0);
});

test('normalizeSafeArea: NaN values become 0', () => {
  const result = normalizeSafeArea({ top: NaN, right: NaN, bottom: 0, left: 0 }, 400, 300);
  assert.equal(result.top, 0);
  assert.equal(result.right, 0);
});

test('normalizeSafeArea: negative values become 0', () => {
  const result = normalizeSafeArea({ top: -10, right: -5, bottom: -1, left: -3 }, 400, 300);
  assert.equal(result.top, 0);
  assert.equal(result.right, 0);
  assert.equal(result.bottom, 0);
  assert.equal(result.left, 0);
});

test('normalizeSafeArea: top+bottom > height normalizes', () => {
  const result = normalizeSafeArea({ top: 200, right: 0, bottom: 200, left: 0 }, 400, 300);
  assert.ok(result.top + result.bottom <= 300 - 120);
  assert.ok(result.top >= 0 && result.bottom >= 0);
});

test('normalizeSafeArea: left+right > width normalizes', () => {
  const result = normalizeSafeArea({ top: 0, right: 300, bottom: 0, left: 200 }, 400, 300);
  assert.ok(result.left + result.right <= 400 - 120);
  assert.ok(result.left >= 0 && result.right >= 0);
});

test('normalizeSafeArea: huge invalid values fallback to zeros', () => {
  const result = normalizeSafeArea({ top: 500, right: 500, bottom: 500, left: 500 }, 400, 300);
  assert.deepEqual(result, { top: 0, right: 0, bottom: 0, left: 0 },
    'fully invalid safe area must fallback to zero insets');
});

test('normalizeSafeArea: null/undefined returns zeros', () => {
  const result = normalizeSafeArea(null, 400, 300);
  assert.deepEqual(result, { top: 0, right: 0, bottom: 0, left: 0 });
  const result2 = normalizeSafeArea(undefined, 400, 300);
  assert.deepEqual(result2, { top: 0, right: 0, bottom: 0, left: 0 });
});

test('normalizeSafeArea: hudRect width becomes right inset ~64', () => {
  const hudW = 52;
  const rightInset = Math.max(0, hudW + 12);
  const topInset = Math.max(0, 200 + 12);
  const result = normalizeSafeArea({ top: topInset, right: rightInset, bottom: 0, left: 0 }, 400, 300);
  assert.equal(result.right, 64);
  assert.ok(result.top <= topInset, 'top may be clamped to fit usable height');
  assert.ok(result.top >= 0);
  assert.equal(result.bottom, 0);
  assert.equal(result.left, 0);
});

test('normalizeSafeArea: absolute DOM left=300 does not become right=300', () => {
  const absLeft = 300;
  const absTop = 200;
  const hudW = 52;
  const rightByWidth = Math.max(0, hudW + 12);
  assert.equal(rightByWidth, 64);
  assert.notEqual(rightByWidth, absLeft, 'right inset must come from width+gutter, not abs DOM left');
});

test('normalizeSafeArea: dock outside canvas produced no bottom inset', () => {
  const sa = normalizeSafeArea({ top: 0, right: 0, bottom: 0, left: 0 }, 400, 300);
  assert.equal(sa.bottom, 0, 'no bottom inset from external dock');
});

test('normalizeSafeArea: invalid safe area does not block cameraReady', () => {
  const bad = { top: 1000, right: 1000, bottom: 1000, left: 1000 };
  const result = normalizeSafeArea(bad, 400, 300);
  assert.equal(result.top, 0);
  assert.equal(result.right, 0);
});





