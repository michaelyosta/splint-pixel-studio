import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GOAL_IDS,
  GOAL_STATUS,
  advanceToNextGoal,
  applyVerifiedProgress,
  buildGoalView,
  computeGoals,
  countCompletedCells,
  createSessionState,
  deserializeSession,
  markFirstPaint,
  pauseSession,
  resumeSession,
  selectGoalId,
  serializeSession,
  tickSession,
} from '../src/features/goals/sessionGoals.js';

function legacyTemplate(width = 32, height = 32, id = 'legacy') {
  const cells = Array.from({ length: width * height }, (_, index) => index % 5);
  return { id, storage_mode: 'legacy', width, height, cells };
}

function tiledTemplate(width = 192, height = 192, id = 'tiled') {
  return { id, storage_mode: 'tiled', width, height, cells: [] };
}

function legacyProgress(template, filled, revision = 0) {
  const completedCells = filled.reduce(
    (count, color, index) => count + (color === template.cells[index] ? 1 : 0),
    0,
  );
  return {
    template_id: template.id,
    filled,
    completed_cells: completedCells,
    total_cells: template.cells.length,
    percent: Math.round((completedCells / template.cells.length) * 100),
    revision,
  };
}

function tiledProgress(template, completedCells, revision = 0) {
  return {
    template_id: template.id,
    completed_cells: completedCells,
    total_cells: template.width * template.height,
    revision,
  };
}

function filledWithFirst(target, template) {
  return template.cells.map((color, index) => (index < target ? color : -1));
}

test('goal selection starts with a bounded first-progress goal', () => {
  const template = legacyTemplate(32, 32);
  const input = { template, progress: legacyProgress(template, Array(template.cells.length).fill(-1)) };
  assert.equal(selectGoalId(input), GOAL_IDS.FIRST_PROGRESS);
  const first = computeGoals(input).first;
  assert.equal(first.target, 10);
  assert.ok(first.durationMs <= 30_000);
});

test('tiny maps get a tiny first-progress target', () => {
  const template = legacyTemplate(8, 8);
  const input = { template, progress: legacyProgress(template, Array(64).fill(-1)) };
  assert.equal(computeGoals(input).first.target, 3);
});

test('tiled 1200x1200 first goal is one bounded stroke-sized target', () => {
  const template = tiledTemplate(1200, 1200, 'huge');
  const input = { template, progress: tiledProgress(template, 0) };
  const goals = computeGoals(input);
  assert.equal(goals.first.target, 4);
  assert.equal(goals.zone.target, 256);
  assert.ok(goals.picture.target <= 1024);
});

test('legacy zone goal uses the current incomplete zone without full-map scan', () => {
  const template = legacyTemplate(32, 32);
  const zones = [{ id: 1, title: 'Зона 1', total: 512, done: 20, percent: 3, indices: Array.from({ length: 512 }, (_, i) => i) }];
  const filled = template.cells.map((color, index) => (index < 20 ? color : -1));
  const input = { template, progress: legacyProgress(template, filled), zones, zoneIndices: { 1: zones[0].indices } };
  assert.equal(selectGoalId(input), GOAL_IDS.ZONE);
  const zone = computeGoals(input).zone;
  assert.equal(zone.kind, 'zone-subsegment');
  assert.equal(zone.target, 48);
  assert.equal(zone.done, 20);
  assert.equal(zone.remaining, 28);
  assert.equal(zone.done + zone.remaining, zone.target);
});

test('server progress skips already-finished first goal on reopen', () => {
  const template = legacyTemplate(32, 32);
  const filled = filledWithFirst(10, template);
  const zones = [{ id: 1, title: 'Зона 1', total: 512, done: 10, percent: 1, indices: Array.from({ length: 512 }, (_, i) => i) }];
  const input = {
    template,
    progress: legacyProgress(template, filled),
    zones,
    zoneIndices: { 1: zones[0].indices },
  };
  assert.equal(selectGoalId(input), GOAL_IDS.ZONE);
});

test('completed artwork leaves no active goal', () => {
  const template = legacyTemplate(16, 16);
  const filled = [...template.cells];
  const input = { template, progress: legacyProgress(template, filled) };
  assert.equal(selectGoalId(input), null);
  assert.equal(computeGoals(input).artworkDone, true);
});

test('verified progress transitions first -> zone -> picture -> finished', () => {
  const template = tiledTemplate(192, 192);
  let session = createSessionState({
    input: { template, progress: tiledProgress(template, 0) },
    stored: null,
    now: 0,
  });
  assert.equal(session.goalId, GOAL_IDS.FIRST_PROGRESS);

  let result = applyVerifiedProgress(
    session,
    { template, progress: tiledProgress(template, 4, 1) },
    1,
  );
  session = result.state;
  assert.equal(result.completedGoalId, GOAL_IDS.FIRST_PROGRESS);
  assert.equal(session.goalId, GOAL_IDS.ZONE);

  result = applyVerifiedProgress(
    session,
    { template, progress: tiledProgress(template, 256, 2) },
    2,
  );
  session = result.state;
  assert.equal(result.completedGoalId, GOAL_IDS.ZONE);
  assert.equal(session.goalId, GOAL_IDS.PICTURE);

  result = applyVerifiedProgress(
    session,
    { template, progress: tiledProgress(template, 369, 3) },
    3,
  );
  session = result.state;
  assert.equal(result.completedGoalId, GOAL_IDS.PICTURE);
  assert.equal(session.status, GOAL_STATUS.FINISHED);
  assert.equal(session.goalId, null);
});

test('timer starts only on first paint and only counts active time', () => {
  const template = legacyTemplate(16, 16);
  const input = { template, progress: legacyProgress(template, Array(256).fill(-1)) };
  let session = createSessionState({ input, stored: null, now: 0 });
  assert.equal(session.status, GOAL_STATUS.IDLE);
  assert.equal(tickSession(session, 5000).elapsedMs, 0);

  session = markFirstPaint(session, 1000);
  assert.equal(session.status, GOAL_STATUS.RUNNING);
  session = tickSession(session, 6000);
  assert.equal(session.elapsedMs, 5000);

  session = pauseSession(session, 6000);
  assert.equal(session.status, GOAL_STATUS.PAUSED);
  assert.equal(tickSession(session, 9000).elapsedMs, 5000);

  session = resumeSession(session, 9000);
  assert.equal(session.status, GOAL_STATUS.RUNNING);
  session = tickSession(session, 11_000);
  assert.equal(session.elapsedMs, 7000);
});

test('timer expiry advances to the next goal', () => {
  const template = tiledTemplate(192, 192);
  let session = createSessionState({
    input: { template, progress: tiledProgress(template, 0) },
    stored: null,
    now: 0,
  });
  session = markFirstPaint(session, 0);
  session = tickSession(session, 30_000);
  assert.equal(session.status, GOAL_STATUS.EXPIRED);
  assert.equal(session.elapsedMs, 30_000);

  const advanced = advanceToNextGoal(session, { template, progress: tiledProgress(template, 0, 0) }, 30_001, 'expired');
  assert.equal(advanced.goalId, GOAL_IDS.ZONE);
  assert.equal(advanced.status, GOAL_STATUS.RUNNING);
  assert.equal(advanced.elapsedMs, 0);
});

test('reload reconstruction keeps bounded elapsed and never invents idle time', () => {
  const template = legacyTemplate(32, 32);
  const input = { template, progress: legacyProgress(template, Array(1024).fill(-1)) };
  let session = createSessionState({ input, stored: null, now: 1000 });
  session = markFirstPaint(session, 1000);
  session = tickSession(session, 6000);

  const stored = serializeSession(session);
  const restored = deserializeSession(JSON.parse(JSON.stringify(stored)));
  const reopened = createSessionState({ input, stored: restored, now: 900_000 });
  assert.equal(reopened.goalId, GOAL_IDS.FIRST_PROGRESS);
  assert.equal(reopened.painted, true);
  assert.equal(reopened.elapsedMs, 5000);
  assert.equal(reopened.status, GOAL_STATUS.RUNNING);

  const afterGap = tickSession(reopened, 900_100);
  assert.equal(afterGap.elapsedMs, 5100);
});

test('reload reconstructs the deterministic next goal from server progress', () => {
  const template = legacyTemplate(32, 32);
  const stored = {
    templateId: template.id,
    goalId: GOAL_IDS.FIRST_PROGRESS,
    status: GOAL_STATUS.RUNNING,
    painted: true,
    elapsedMs: 9000,
  };
  const filled = filledWithFirst(10, template);
  const zones = [{ id: 1, title: 'Зона 1', total: 512, done: 10, percent: 1, indices: Array.from({ length: 512 }, (_, i) => i) }];
  const input = {
    template,
    progress: legacyProgress(template, filled, 3),
    zones,
    zoneIndices: { 1: zones[0].indices },
  };
  const session = createSessionState({ input, stored: deserializeSession(stored), now: 0 });
  assert.equal(session.goalId, GOAL_IDS.ZONE);
  assert.equal(session.elapsedMs, 0);
});

test('huge-map math is bounded and never scans a 1200x1200 filled array', () => {
  const template = tiledTemplate(1200, 1200, 'huge');
  const progress = { completed_cells: 777, total_cells: 1_440_000, revision: 5 };
  assert.equal(countCompletedCells({ template, progress }), 777);
  const goals = computeGoals({ template, progress });
  assert.equal(goals.first.target, 4);
  assert.ok(goals.zone.target <= 256);
  assert.ok(goals.zone.target >= 48);
  assert.equal(goals.zone.done, Math.min(777, goals.zone.target));
  assert.ok(goals.picture.target <= 1024);
  assert.ok(goals.picture.target >= 256);
});

test('goal views expose accessible progress without client rewards', () => {
  const template = tiledTemplate(192, 192);
  let session = createSessionState({
    input: { template, progress: tiledProgress(template, 0) },
    stored: null,
    now: 0,
  });
  session = markFirstPaint(session, 0);
  const view = buildGoalView({ input: { template, progress: tiledProgress(template, 2, 1) }, stored: session });
  assert.equal(view.done, 2);
  assert.equal(view.target, 4);
  assert.ok(view.progressPercent >= 0 && view.progressPercent <= 100);
  assert.ok(view.remainingMs > 0);
});

test('no client rewards are ever created by the state machine', () => {
  const template = tiledTemplate(192, 192);
  const session = createSessionState({
    input: { template, progress: tiledProgress(template, 0) },
    stored: null,
    now: 0,
  });
  const result = applyVerifiedProgress(
    session,
    { template, progress: tiledProgress(template, 4, 1) },
    1,
  );
  const forbidden = ['rewards', 'xp', 'xp_awarded', 'unlock'];
  const serialized = serializeSession(result.state);
  for (const key of Object.keys(serialized)) {
    assert.ok(!forbidden.includes(key), `serialized session must not contain ${key}`);
  }
  for (const key of Object.keys(result.state)) {
    assert.ok(!forbidden.includes(key), `session state must not contain ${key}`);
  }
});
