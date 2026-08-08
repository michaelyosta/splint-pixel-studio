/*
 * Session-goal loop: 30-second first progress, 3-minute bounded zone/segment,
 * 10-minute picture or progress fallback.
 *
 * The module is intentionally pure: rewards are never created here. All reward
 * chips in the UI come from existing server /progress/actions responses, and
 * this code only tracks verified server revision growth plus bounded local
 * timing state.
 */

export const GOAL_IDS = Object.freeze({
  FIRST_PROGRESS: 'first-progress',
  ZONE: 'zone',
  PICTURE: 'picture',
});

export const GOAL_STATUS = Object.freeze({
  IDLE: 'idle',
  RUNNING: 'running',
  PAUSED: 'paused',
  EXPIRED: 'expired',
  FINISHED: 'finished',
});

export const GOAL_ORDER = Object.freeze([
  GOAL_IDS.FIRST_PROGRESS,
  GOAL_IDS.ZONE,
  GOAL_IDS.PICTURE,
]);

export const GOAL_DURATIONS_MS = Object.freeze({
  [GOAL_IDS.FIRST_PROGRESS]: 30_000,
  [GOAL_IDS.ZONE]: 180_000,
  [GOAL_IDS.PICTURE]: 600_000,
});

export const SESSION_GOALS_STORAGE_VERSION = 1;

const FIRST_TARGET_MAX = 10;
const FIRST_TARGET_MIN = 3;
const TILED_FIRST_TARGET = 4;
const ZONE_SEGMENT_MIN = 48;
const ZONE_SEGMENT_MAX = 256;
const PICTURE_FEASIBLE_CELLS = 10_000;
const PICTURE_TARGET_MIN = 256;
const PICTURE_TARGET_MAX = 1024;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

export function isTiledTemplate(template) {
  return template?.storage_mode === 'tiled';
}

export function totalCells({ template, progress } = {}) {
  const fromProgress = Number(progress?.total_cells);
  const fromTemplate = Number(template?.width) * Number(template?.height);
  const value = isFiniteNumber(fromProgress) && fromProgress > 0 ? fromProgress : fromTemplate;
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

/** Server-verified completed cells. Tiled maps stay O(1) and never iterate. */
export function countCompletedCells({ template, progress } = {}) {
  if (isTiledTemplate(template)) {
    return Number(progress?.completed_cells) || 0;
  }
  if (!Array.isArray(template?.cells) || !Array.isArray(progress?.filled)) return 0;
  if (template.cells.length !== progress.filled.length) return 0;
  let count = 0;
  for (let index = 0; index < template.cells.length; index += 1) {
    if (progress.filled[index] === template.cells[index]) count += 1;
  }
  return count;
}

function pluralCells(count) {
  const value = Math.abs(count) % 100;
  const tail = value % 10;
  if (value > 10 && value < 20) return 'клеток';
  if (tail === 1) return 'клетка';
  if (tail >= 2 && tail <= 4) return 'клетки';
  return 'клеток';
}

export function buildFirstGoal(input) {
  const total = input.totalCells;
  const target = isTiledTemplate(input.template)
    ? Math.min(total, TILED_FIRST_TARGET)
    : Math.min(total, Math.min(FIRST_TARGET_MAX, Math.max(FIRST_TARGET_MIN, Math.ceil(total * 0.01))));
  const done = Math.min(input.completedCells, target);
  return {
    id: GOAL_IDS.FIRST_PROGRESS,
    target,
    done,
    remaining: Math.max(0, target - done),
    label: 'Первый прогресс',
    sublabel: `Закрасьте ${target} ${pluralCells(target)}`,
    durationMs: GOAL_DURATIONS_MS[GOAL_IDS.FIRST_PROGRESS],
    kind: 'first-progress',
  };
}

function subdivideZone(done, total) {
  if (total <= ZONE_SEGMENT_MAX) {
    return { size: total, done, remaining: Math.max(0, total - done), index: 0, whole: true };
  }
  const size = Math.min(ZONE_SEGMENT_MAX, Math.max(ZONE_SEGMENT_MIN, Math.round(total / 12)));
  const index = Math.floor(done / size);
  const segmentDone = Math.min(size, done);
  return { size, done: segmentDone, remaining: Math.max(0, size - segmentDone), index, whole: false };
}

export function buildZoneGoal(input) {
  const total = input.totalCells;
  if (isTiledTemplate(input.template)) {
    const size = Math.max(1, Math.min(total, Math.max(ZONE_SEGMENT_MIN, Math.min(ZONE_SEGMENT_MAX, Math.round(total / 12)))));
    const index = Math.floor(input.completedCells / size);
    const done = Math.min(size, input.completedCells);
    return {
      id: GOAL_IDS.ZONE,
      target: size,
      done,
      remaining: Math.max(0, size - done),
      label: `Сегмент ${index + 1}`,
      sublabel: `Ещё ${Math.max(0, size - done)} ${pluralCells(Math.max(0, size - done))} в этом сегменте`,
      durationMs: GOAL_DURATIONS_MS[GOAL_IDS.ZONE],
      kind: 'zone-segment',
    };
  }

  const zones = Array.isArray(input.zones) ? input.zones : [];
  const current = zones.find((zone) => zone.percent < 100) || zones.at(-1) || null;
  if (!current) return null;
  const zoneTitle = current.title || 'Фрагмент';
  const indices = Array.isArray(input.zoneIndices?.[current.id])
    ? input.zoneIndices[current.id]
    : (Array.isArray(current.indices) ? current.indices : []);
  let done = 0;
  let zoneTotal = Number(current.total || 0);
  if (indices.length) {
    zoneTotal = indices.length;
    done = indices.reduce(
      (count, index) => count + (input.progress?.filled?.[index] === input.template?.cells?.[index] ? 1 : 0),
      0,
    );
  } else if (!Number.isFinite(zoneTotal) || zoneTotal <= 0) {
    return null;
  } else {
    done = Number(current.done || 0);
  }
  if (zoneTotal <= 0) return null;
  const sub = subdivideZone(clamp(done, 0, zoneTotal), zoneTotal);
  return {
    id: GOAL_IDS.ZONE,
    target: sub.size,
    done: sub.done,
    remaining: sub.remaining,
    label: sub.whole ? `Фрагмент «${zoneTitle}»` : `Сегмент ${sub.index + 1} · «${zoneTitle}»`,
    sublabel: `Ещё ${sub.remaining} ${pluralCells(sub.remaining)}`,
    durationMs: GOAL_DURATIONS_MS[GOAL_IDS.ZONE],
    kind: sub.whole ? 'zone' : 'zone-subsegment',
  };
}

export function buildPictureGoal(input) {
  const total = input.totalCells;
  const completed = input.completedCells;
  if (total <= PICTURE_FEASIBLE_CELLS) {
    return {
      id: GOAL_IDS.PICTURE,
      target: total,
      done: completed,
      remaining: Math.max(0, total - completed),
      label: 'Вся картина',
      sublabel: `Осталось ${Math.max(0, total - completed)} ${pluralCells(Math.max(0, total - completed))}`,
      durationMs: GOAL_DURATIONS_MS[GOAL_IDS.PICTURE],
      kind: 'picture',
    };
  }
  const target = Math.min(PICTURE_TARGET_MAX, Math.max(PICTURE_TARGET_MIN, Math.round(total * 0.01)));
  const done = Math.min(completed, target);
  return {
    id: GOAL_IDS.PICTURE,
    target,
    done,
    remaining: Math.max(0, target - done),
    label: 'Прогресс карты',
    sublabel: `Закрасьте ещё ${Math.max(0, target - done)} ${pluralCells(Math.max(0, target - done))}`,
    durationMs: GOAL_DURATIONS_MS[GOAL_IDS.PICTURE],
    kind: 'picture-progress',
  };
}

export function computeGoals(input) {
  const completedCells = countCompletedCells(input);
  const totalCellsValue = totalCells(input);
  const normalized = { ...input, completedCells, totalCells: totalCellsValue };
  const first = buildFirstGoal(normalized);
  const zone = buildZoneGoal(normalized);
  const picture = buildPictureGoal(normalized);
  return {
    first,
    zone,
    picture,
    completedCells,
    totalCells: totalCellsValue,
    artworkDone: completedCells >= totalCellsValue && totalCellsValue > 0,
  };
}

export function selectGoalId(input) {
  const goals = computeGoals(input);
  if (goals.artworkDone) return null;
  if (goals.first.remaining > 0) return GOAL_IDS.FIRST_PROGRESS;
  if (goals.zone?.remaining > 0) return GOAL_IDS.ZONE;
  if (goals.picture.remaining > 0) return GOAL_IDS.PICTURE;
  return null;
}

function goalById(goals, goalId) {
  if (goalId === GOAL_IDS.FIRST_PROGRESS) return goals.first;
  if (goalId === GOAL_IDS.ZONE) return goals.zone;
  if (goalId === GOAL_IDS.PICTURE) return goals.picture;
  return null;
}

function sanitizeElapsed(value, durationMs) {
  const elapsed = isFiniteNumber(Number(value)) ? Math.floor(Number(value)) : 0;
  return durationMs > 0 ? Math.min(durationMs, elapsed) : elapsed;
}

function sanitizeStored(raw) {
  if (!raw || typeof raw !== 'object') return null;
  return {
    templateId: typeof raw.templateId === 'string' ? raw.templateId : null,
    goalId: GOAL_ORDER.includes(raw.goalId) ? raw.goalId : null,
    status: Object.values(GOAL_STATUS).includes(raw.status) ? raw.status : null,
    painted: Boolean(raw.painted),
    elapsedMs: isFiniteNumber(Number(raw.elapsedMs)) ? Number(raw.elapsedMs) : 0,
    firstPaintAt: isFiniteNumber(Number(raw.firstPaintAt)) ? Number(raw.firstPaintAt) : null,
    completedGoals: Array.isArray(raw.completedGoals)
      ? raw.completedGoals.filter((id) => GOAL_ORDER.includes(id))
      : [],
  };
}

export function createSessionState({ input, stored, now = Date.now() }) {
  const parsed = sanitizeStored(stored);
  const goals = computeGoals(input);
  const nextId = selectGoalId(input);
  const revision = Number(input.progress?.revision || 0);
  if (!nextId) {
    return {
      storageVersion: SESSION_GOALS_STORAGE_VERSION,
      templateId: input.template?.id ?? null,
      goalId: null,
      status: GOAL_STATUS.FINISHED,
      painted: Boolean(parsed?.painted),
      elapsedMs: 0,
      firstPaintAt: parsed?.firstPaintAt ?? null,
      startedAt: null,
      lastActiveAt: null,
      lastServerRevision: revision,
      completedGoals: parsed?.completedGoals || [],
    };
  }
  const sameTemplate = parsed?.templateId === input.template?.id;
  const storedValid = sameTemplate && parsed?.goalId === nextId;
  const painted = storedValid ? parsed.painted : false;
  const elapsedMs = storedValid ? sanitizeElapsed(parsed.elapsedMs, goalById(goals, nextId).durationMs) : 0;
  const status = !painted
    ? GOAL_STATUS.IDLE
    : (storedValid && parsed.status === GOAL_STATUS.PAUSED ? GOAL_STATUS.PAUSED : GOAL_STATUS.RUNNING);
  return {
    storageVersion: SESSION_GOALS_STORAGE_VERSION,
    templateId: input.template?.id ?? null,
    goalId: nextId,
    status,
    painted,
    elapsedMs,
    firstPaintAt: storedValid ? parsed.firstPaintAt : null,
    startedAt: painted ? now : null,
    lastActiveAt: painted ? now : null,
    lastServerRevision: revision,
    completedGoals: storedValid ? parsed.completedGoals : [],
  };
}

export function buildGoalView({ input, stored }) {
  if (!input?.template || !stored?.goalId) return null;
  const goals = computeGoals(input);
  const goal = goalById(goals, stored.goalId);
  if (!goal) return null;
  const nextIndex = GOAL_ORDER.indexOf(stored.goalId) + 1;
  const nextGoalId = GOAL_ORDER[nextIndex];
  return {
    id: stored.goalId,
    label: goal.label,
    sublabel: goal.sublabel,
    kind: goal.kind,
    target: goal.target,
    done: goal.done,
    remaining: goal.remaining,
    durationMs: goal.durationMs,
    status: stored.status,
    painted: Boolean(stored.painted),
    elapsedMs: sanitizeElapsed(stored.elapsedMs, goal.durationMs),
    remainingMs: Math.max(0, goal.durationMs - sanitizeElapsed(stored.elapsedMs, goal.durationMs)),
    progressPercent: goal.target > 0 ? Math.min(100, Math.round((goal.done / goal.target) * 100)) : 0,
    nextGoalLabel: nextGoalId && goalById(goals, nextGoalId) ? goalById(goals, nextGoalId).label : 'Продолжить раскраску',
  };
}

export function markFirstPaint(state, now = Date.now()) {
  if (!state || state.painted || state.status === GOAL_STATUS.FINISHED) return state;
  return {
    ...state,
    painted: true,
    firstPaintAt: state.firstPaintAt ?? now,
    startedAt: state.startedAt ?? now,
    status: GOAL_STATUS.RUNNING,
    lastActiveAt: now,
  };
}

function elapsedAt(state, now) {
  if (state.status !== GOAL_STATUS.RUNNING || !state.painted || !isFiniteNumber(state.lastActiveAt)) {
    return state.elapsedMs || 0;
  }
  return Math.max(0, (state.elapsedMs || 0) + Math.max(0, now - state.lastActiveAt));
}

export function tickSession(state, now = Date.now(), { visible = true, online = true } = {}) {
  if (!state?.painted || state.status === GOAL_STATUS.FINISHED || !visible || !online) return state;
  const durationMs = GOAL_DURATIONS_MS[state.goalId] || 0;
  const elapsed = elapsedAt(state, now);
  if (durationMs > 0 && elapsed >= durationMs) {
    return { ...state, elapsedMs: durationMs, status: GOAL_STATUS.EXPIRED, lastActiveAt: now };
  }
  return { ...state, elapsedMs: elapsed, lastActiveAt: now };
}

export function pauseSession(state, now = Date.now()) {
  if (!state?.painted || state.status !== GOAL_STATUS.RUNNING) return state;
  return { ...state, status: GOAL_STATUS.PAUSED, elapsedMs: elapsedAt(state, now), lastActiveAt: null };
}

export function resumeSession(state, now = Date.now()) {
  if (!state?.painted || state.status === GOAL_STATUS.FINISHED) return state;
  if (state.status !== GOAL_STATUS.PAUSED && state.status !== GOAL_STATUS.IDLE) return state;
  return { ...state, status: GOAL_STATUS.RUNNING, lastActiveAt: now };
}

export function advanceToNextGoal(state, input, now = Date.now(), reason = 'completed') {
  const goals = computeGoals(input);
  const currentIndex = GOAL_ORDER.indexOf(state.goalId);
  const forcedNext = reason === 'expired' && currentIndex >= 0 ? GOAL_ORDER[currentIndex + 1] : null;
  const nextId = (forcedNext && goalById(goals, forcedNext)?.remaining > 0)
    ? forcedNext
    : selectGoalId(input);
  const completedGoals = state.goalId
    ? [...(state.completedGoals || []), state.goalId]
    : (state.completedGoals || []);
  if (!nextId) {
    return {
      ...state,
      goalId: null,
      status: GOAL_STATUS.FINISHED,
      elapsedMs: 0,
      lastActiveAt: null,
      completedGoals,
      lastAdvanceReason: reason,
    };
  }
  return {
    ...state,
    goalId: nextId,
    status: GOAL_STATUS.RUNNING,
    painted: true,
    elapsedMs: 0,
    startedAt: state.startedAt ?? now,
    lastActiveAt: now,
    completedGoals,
    lastAdvanceReason: reason,
  };
}

/**
 * Applies a server-verified progress response. Completion is derived from the
 * server payload alone; this function never fabricates rewards or XP.
 */
export function applyVerifiedProgress(state, input, now = Date.now()) {
  if (!state || state.status === GOAL_STATUS.FINISHED) return { state, completedGoalId: null, changed: false };
  const revision = Number(input.progress?.revision || 0);
  const goals = computeGoals(input);
  const activeGoal = state.goalId ? goalById(goals, state.goalId) : null;
  if (activeGoal && activeGoal.remaining > 0) {
    return {
      state: { ...state, lastServerRevision: Math.max(Number(state.lastServerRevision || 0), revision) },
      completedGoalId: null,
      changed: false,
    };
  }
  const nextId = selectGoalId(input);
  if (!nextId && !state.goalId) return { state, completedGoalId: null, changed: false };
  const wasCompleted = Boolean(activeGoal && activeGoal.remaining <= 0);
  const advanced = advanceToNextGoal(
    { ...state, lastServerRevision: Math.max(Number(state.lastServerRevision || 0), revision) },
    input,
    now,
    wasCompleted ? 'completed' : 'reconstruction',
  );
  return { state: advanced, completedGoalId: wasCompleted ? state.goalId : null, changed: true };
}

export function serializeSession(state) {
  if (!state) return null;
  return {
    storageVersion: SESSION_GOALS_STORAGE_VERSION,
    templateId: state.templateId ?? null,
    goalId: state.goalId ?? null,
    status: state.status ?? GOAL_STATUS.IDLE,
    painted: Boolean(state.painted),
    elapsedMs: Math.max(0, Math.floor(state.elapsedMs || 0)),
    firstPaintAt: state.firstPaintAt ?? null,
    lastServerRevision: state.lastServerRevision ?? 0,
    completedGoals: Array.isArray(state.completedGoals) ? state.completedGoals : [],
  };
}

export function deserializeSession(raw) {
  return sanitizeStored(raw);
}

export function goalLabelForId(input, goalId) {
  const goals = computeGoals(input);
  return goalById(goals, goalId)?.label ?? null;
}
