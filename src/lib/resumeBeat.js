/**
 * Small, local-only language layer for returning to an unfinished artwork.
 *
 * The server remains authoritative for progress and Smart Guidance. These
 * values are only a bounded promise shown before the next session starts; no
 * full-grid data or progression state belongs here.
 */

export const SESSION_DURATION_BUCKET = Object.freeze({
  SHORT: 'short',
  MEDIUM: 'medium',
  LONG: 'long',
});

const SHORT_SESSION_MAX_MS = 90_000;
const MEDIUM_SESSION_MAX_MS = 10 * 60_000;

export function classifySessionDuration(elapsedMs) {
  const elapsed = Number(elapsedMs);
  if (!Number.isFinite(elapsed) || elapsed < SHORT_SESSION_MAX_MS) {
    return SESSION_DURATION_BUCKET.SHORT;
  }
  if (elapsed < MEDIUM_SESSION_MAX_MS) return SESSION_DURATION_BUCKET.MEDIUM;
  return SESSION_DURATION_BUCKET.LONG;
}

export function normalizeSessionDurationBucket(value) {
  return Object.values(SESSION_DURATION_BUCKET).includes(value) ? value : null;
}

export function normalizeResumeBeat(beat) {
  if (!beat || typeof beat !== 'object') return null;
  const kind = typeof beat.kind === 'string' ? beat.kind : 'fragment';
  const tileKey = typeof beat.tileKey === 'string' ? beat.tileKey : null;
  const targetId = typeof beat.targetId === 'string' ? beat.targetId : null;
  const color = Number.isSafeInteger(Number(beat.color)) ? Number(beat.color) : null;
  const estimatedCells = Number.isSafeInteger(Number(beat.estimatedCells))
    ? Math.max(0, Number(beat.estimatedCells))
    : null;
  if (!tileKey && !targetId && estimatedCells == null) return null;
  return {
    kind,
    tileKey,
    targetId,
    color: color == null ? null : Math.max(0, color),
    estimatedCells,
  };
}

function formatCellCount(count) {
  if (!Number.isSafeInteger(Number(count)) || Number(count) <= 0) return null;
  return `около ${Number(count)} клеток`;
}

/** Return calm copy for a Home card, without reward or urgency language. */
export function describeResumeBeat(snapshot) {
  const beat = normalizeResumeBeat(snapshot?.nextBeat || snapshot?.smartTarget);
  if (!beat) {
    return {
      kind: 'saved-point',
      title: 'Следующий фрагмент ждёт',
      detail: 'Продолжим с сохранённой точки',
      promise: 'Сохранённая точка готова',
    };
  }
  const details = [formatCellCount(beat.estimatedCells)];
  if (beat.color != null) details.unshift(`цвет №${beat.color + 1}`);
  return {
    kind: beat.kind || 'fragment',
    title: 'Следующий фрагмент ждёт',
    detail: details.filter(Boolean).join(' · ') || 'Продолжим с сохранённой точки',
    promise: 'Откроем следующий фрагмент',
    tileKey: beat.tileKey,
    targetId: beat.targetId,
  };
}
