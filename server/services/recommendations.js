// server/services/recommendations.js
//
// Bounded personalized template recommendations. Signals come only from
// verified server state (completed/in-progress legacy and tiled rows,
// themes/collections, difficulty/size, unlock/ownership). No cell arrays are
// read and no per-template queries are issued; history and candidates are
// each fetched as one bounded query, then scored in process.

import {
  attachUnlockFlags,
  collectProgressionFacts,
  STATE_PREMIUM_LOCKED,
  STATE_PROGRESSION_LOCKED,
} from './unlock-service.js';

export const RECOMMENDATION_REASONS = Object.freeze({
  CONTINUE_PROGRESS: 'CONTINUE_PROGRESS',
  THEME_AFFINITY: 'THEME_AFFINITY',
  COLLECTION_AFFINITY: 'COLLECTION_AFFINITY',
  DIFFICULTY_MATCH: 'DIFFICULTY_MATCH',
  DAILY_FEATURED: 'DAILY_FEATURED',
  COLD_START: 'COLD_START',
});

const MAX_CANDIDATES = 200;
const MAX_HISTORY = 300;

function stableHash(value) {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0);
}

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

async function loadHistory(db, userId) {
  const rows = await db.all(
    `SELECT t.id, t.theme, t.collection_id, t.difficulty, t.width, t.height, t.est_minutes, h.kind
      FROM (
        SELECT template_id AS id, 'completed' AS kind
        FROM artworks
        WHERE owner_id=? AND is_completed=1 AND template_id IS NOT NULL
        UNION
        SELECT template_id AS id, 'in_progress' AS kind
        FROM coloring_progress
        WHERE user_id=? AND completed_at IS NULL
        UNION
        SELECT template_id AS id, 'in_progress' AS kind
        FROM coloring_tiled_progress
        WHERE user_id=? AND completed_at IS NULL
      ) h
      JOIN coloring_templates t ON t.id=h.id AND t.status='active'
      ORDER BY t.added_at DESC
      LIMIT ?`,
    [userId, userId, userId, MAX_HISTORY],
  );

  const byTemplate = new Map();
  for (const row of rows) {
    const existing = byTemplate.get(row.id);
    if (!existing || (row.kind === 'completed' && existing.kind !== 'completed')) {
      byTemplate.set(row.id, row);
    }
  }
  return [...byTemplate.values()];
}

async function loadCandidates(db, userId) {
  return db.all(
    `SELECT t.id, t.title, t.preview_url, t.theme, t.collection_id, t.difficulty,
            t.width, t.height, t.est_minutes, t.daily_featured, t.added_at, t.storage_mode
      FROM coloring_templates t
      WHERE t.status='active' AND t.visibility='public'
        AND (t.owner_id IS NULL OR t.owner_id<>?)
        AND NOT EXISTS (
          SELECT 1 FROM artworks a
          WHERE a.owner_id=? AND a.template_id=t.id AND a.is_completed=1
        )
      ORDER BY t.added_at DESC, t.title ASC
      LIMIT ?`,
    [userId, userId, MAX_CANDIDATES],
  );
}

function buildHistorySignals(history) {
  const themes = new Map();
  const collections = new Map();
  const difficulties = new Map();
  const inProgress = new Set();
  let totalLogCells = 0;

  for (const row of history) {
    themes.set(row.theme || 'featured', (themes.get(row.theme || 'featured') || 0) + 1);
    if (row.collection_id) {
      collections.set(row.collection_id, (collections.get(row.collection_id) || 0) + 1);
    }
    difficulties.set(row.difficulty || 'easy', (difficulties.get(row.difficulty || 'easy') || 0) + 1);
    totalLogCells += Math.log(Math.max(1, toNumber(row.width, 1) * toNumber(row.height, 1)));
    if (row.kind === 'in_progress') inProgress.add(row.id);
  }

  return {
    themes,
    collections,
    difficulties,
    inProgress,
    average_log_cells: history.length ? totalLogCells / history.length : 0,
    history_count: history.length,
  };
}

function scoreCandidate(candidate, signals, userId) {
  const cellCount = Math.max(1, toNumber(candidate.width, 1) * toNumber(candidate.height, 1));
  const logCells = Math.log(cellCount);
  const sizeDistance = signals.average_log_cells
    ? Math.abs(logCells - signals.average_log_cells) / Math.max(1, signals.average_log_cells)
    : 0;
  const themeCount = signals.themes.get(candidate.theme || 'featured') || 0;
  const collectionCount = candidate.collection_id ? (signals.collections.get(candidate.collection_id) || 0) : 0;
  const difficultyCount = signals.difficulties.get(candidate.difficulty || 'easy') || 0;
  const isInProgress = signals.inProgress.has(candidate.id);
  const score = (
    (themeCount * 3)
    + (collectionCount * 2)
    + (difficultyCount * 2)
    + (isInProgress ? 4 : 0)
    + (toNumber(candidate.daily_featured, 0) ? 0.5 : 0)
    - (sizeDistance * 0.5)
  );

  let reason = RECOMMENDATION_REASONS.COLD_START;
  if (isInProgress) reason = RECOMMENDATION_REASONS.CONTINUE_PROGRESS;
  else if (themeCount > 0) reason = RECOMMENDATION_REASONS.THEME_AFFINITY;
  else if (collectionCount > 0) reason = RECOMMENDATION_REASONS.COLLECTION_AFFINITY;
  else if (difficultyCount > 0) reason = RECOMMENDATION_REASONS.DIFFICULTY_MATCH;
  else if (toNumber(candidate.daily_featured, 0)) reason = RECOMMENDATION_REASONS.DAILY_FEATURED;

  return {
    score: Math.round(score * 100) / 100,
    reason,
    signals: {
      theme_count: themeCount,
      collection_count: collectionCount,
      difficulty_count: difficultyCount,
      size_distance: Math.round(sizeDistance * 100) / 100,
      in_progress: isInProgress,
      featured: Boolean(toNumber(candidate.daily_featured, 0)),
    },
    stable_rank: stableHash(`${userId}:${candidate.id}`),
  };
}

function recommendationPayload(candidate, ranking) {
  return {
    id: candidate.id,
    title: candidate.title,
    preview_url: candidate.preview_url || null,
    theme: candidate.theme || 'featured',
    collection_id: candidate.collection_id || null,
    difficulty: candidate.difficulty || 'easy',
    width: toNumber(candidate.width, 0),
    height: toNumber(candidate.height, 0),
    total_cells: toNumber(candidate.width, 0) * toNumber(candidate.height, 0),
    est_minutes: toNumber(candidate.est_minutes, 3),
    storage_mode: candidate.storage_mode || 'legacy',
    unlock_state: candidate.unlock_state || null,
    unlock_reason_code: candidate.unlock_reason_code || null,
    reason_code: ranking.reason,
    score: ranking.score,
    signals: ranking.signals,
  };
}

/**
 * Deterministic personalized recommendation list. Cold start is stable per
 * user/template hash; history ranking is additive and explainable.
 */
export async function buildRecommendations(db, userId, { limit = 8 } = {}) {
  const requestedLimit = Math.min(20, Math.max(1, toNumber(limit, 8)));
  const facts = await collectProgressionFacts(db, userId);
  const history = await loadHistory(db, userId);
  const signals = buildHistorySignals(history);
  const candidates = await attachUnlockFlags(db, await loadCandidates(db, userId), userId, { facts });

  const ranked = [];
  for (const candidate of candidates) {
    if (candidate.unlock_state === STATE_PREMIUM_LOCKED
      || candidate.unlock_state === STATE_PROGRESSION_LOCKED) {
      continue;
    }
    const ranking = scoreCandidate(candidate, signals, userId);
    ranked.push({ candidate, ranking });
  }

  ranked.sort((a, b) => (
    (b.ranking.score - a.ranking.score)
    || (a.ranking.stable_rank - b.ranking.stable_rank)
    || String(a.candidate.id).localeCompare(String(b.candidate.id))
  ));

  return {
    user_id: userId,
    generated_at: new Date().toISOString(),
    cold_start: signals.history_count === 0,
    candidates_evaluated: ranked.length,
    recommendations: ranked.slice(0, requestedLimit).map(({ candidate, ranking }) => recommendationPayload(candidate, ranking)),
  };
}
