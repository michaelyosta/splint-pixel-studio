// server/services/director.js
//
// First vertical slice of the guided path. The Director is a thin composition
// layer, not a second source of truth: it derives a bounded Next Best Action
// from the same server-verified signals the rest of Splint already owns.

import { buildRecommendations } from './recommendations.js';
import { getUserUnlockSnapshot } from './unlock-service.js';
import { getDailyChallengeStatus } from './progression.js';
import { buildContentMetadata } from './content-quality.js';

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clampPercent(value) {
  return Math.max(0, Math.min(100, Math.round(toNumber(value, 0))));
}

function parseFilled(value) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function loadUnfinishedTemplates(db, userId) {
  const rows = await db.all(`
    SELECT t.id, t.title, t.preview_url, t.width, t.height, t.est_minutes,
           t.difficulty, t.theme, t.collection_id, t.storage_mode,
           p.filled_json,
           tp.completed_cells,
           CASE WHEN t.storage_mode='tiled' THEN tp.updated_at ELSE p.updated_at END AS last_activity_at
    FROM coloring_templates t
    LEFT JOIN coloring_progress p ON p.template_id=t.id AND p.user_id=?
    LEFT JOIN coloring_tiled_progress tp ON tp.template_id=t.id AND tp.user_id=?
    WHERE t.status='active'
      AND (t.owner_id=? OR p.user_id IS NOT NULL OR tp.user_id IS NOT NULL)
    ORDER BY COALESCE(tp.updated_at, p.updated_at, t.updated_at) DESC
  `, [userId, userId, userId]);

  const unfinished = [];
  for (const row of rows) {
    let percent = 0;
    let completedCells = 0;
    const totalCells = Math.max(1, toNumber(row.width, 1) * toNumber(row.height, 1));
    if (row.storage_mode === 'tiled') {
      completedCells = Math.max(0, toNumber(row.completed_cells, 0));
      percent = clampPercent((completedCells / totalCells) * 100);
    } else {
      const filled = parseFilled(row.filled_json);
      completedCells = filled.filter((color) => toNumber(color, -1) !== -1).length;
      percent = clampPercent((completedCells / totalCells) * 100);
    }
    // Do not use rounded percent for eligibility: one committed cell in a
    // 1200x1200 artwork legitimately rounds to 0%, but is still resumable.
    if (completedCells <= 0 || completedCells >= totalCells) continue;
    unfinished.push({
      id: row.id,
      title: row.title,
      preview_url: row.preview_url || null,
      width: toNumber(row.width, 0),
      height: toNumber(row.height, 0),
      est_minutes: toNumber(row.est_minutes, 3),
      difficulty: row.difficulty || 'easy',
      theme: row.theme || 'featured',
      collection_id: row.collection_id || null,
      storage_mode: row.storage_mode || 'legacy',
      percent,
      last_activity_at: row.last_activity_at || null,
    });
  }
  return unfinished.sort((first, second) => {
    const firstTime = Date.parse(first.last_activity_at || '') || 0;
    const secondTime = Date.parse(second.last_activity_at || '') || 0;
    if (secondTime !== firstTime) return secondTime - firstTime;
    return String(first.id).localeCompare(String(second.id));
  });
}

function templateAction(template, type, reason, reward = null) {
  return {
    id: `action_${type}_${template.id}`,
    type,
    template_id: template.id,
    title: template.title,
    preview_url: template.preview_url || null,
    reason,
    estimated_time: `${Math.max(1, toNumber(template.est_minutes, 3))} мин`,
    reward: reward || (type === 'resume'
      ? `Осталось ${100 - template.percent}% картины`
      : 'Первая раскрытая картина'),
    difficulty: template.difficulty || 'easy',
    progress_percent: template.percent || 0,
    content_metadata: template.content_metadata || buildContentMetadata(template),
    last_activity_at: template.last_activity_at || null,
  };
}

function recommendationAction(item, type = 'start') {
  return {
    id: `action_${type}_${item.id}`,
    type,
    template_id: item.id,
    title: item.title,
    preview_url: item.preview_url || null,
    reason: item.reason_code || 'COLD_START',
    estimated_time: `${Math.max(1, toNumber(item.est_minutes, 3))} мин`,
    reward: 'Новая раскрытая картина',
    difficulty: item.difficulty || 'easy',
    progress_percent: 0,
    content_metadata: item.content_metadata || buildContentMetadata(item),
  };
}

function dailyAction(daily) {
  if (!daily?.template_id) return null;
  const target = Math.max(1, toNumber(daily.target_cells, 1));
  return {
    id: 'action_daily',
    type: 'daily',
    template_id: daily.template_id,
    title: 'Ежедневная картина',
    preview_url: null,
    reason: 'DAILY',
    estimated_time: '≈5 мин',
    reward: `+${toNumber(daily.xp_reward, 30)} XP`,
    difficulty: 'easy',
    progress_percent: clampPercent((toNumber(daily.progress_cells, 0) / target) * 100),
  };
}

function browseAction() {
  return {
    id: 'action_browse',
    type: 'browse',
    template_id: null,
    title: 'Выбрать другую картину',
    preview_url: null,
    reason: 'EXPLORE',
    estimated_time: '—',
    reward: 'Каталог',
    difficulty: null,
    progress_percent: 0,
  };
}

function unlockPreview(snapshot) {
  const next = snapshot?.next_actionable?.[0];
  if (!next || next.state !== 'progression_locked') return null;
  return {
    subject_type: next.subject_type,
    subject_id: next.subject_id,
    title: next.title,
    reason_code: next.reason_code,
    progress_ratio: Math.max(0, Math.min(1, toNumber(next.progress_ratio, 0))),
    requirements: Array.isArray(next.requirements) ? next.requirements.slice(0, 3) : [],
  };
}

/**
 * Build the bounded Next Best Action for one player. The primary action is
 * always the strongest existing thread: resume an unfinished artwork, start a
 * recommendation, or fall back to the daily task / catalog.
 */
export async function buildNextBestAction(db, userId, { excludeTemplateId = null } = {}) {
  const [unfinished, recommendations, snapshot, daily] = await Promise.all([
    loadUnfinishedTemplates(db, userId),
    buildRecommendations(db, userId, { limit: 8 }),
    getUserUnlockSnapshot(db, userId),
    getDailyChallengeStatus(db, userId),
  ]);

  const excluded = (item) => item?.template_id && item.template_id === excludeTemplateId;
  const candidates = unfinished
    .filter((item) => item.id !== excludeTemplateId)
    .map((item) => templateAction(item, 'resume', 'CONTINUE_PROGRESS'));
  const recommended = (recommendations.recommendations || [])
    .filter((item) => item.id !== excludeTemplateId)
    .map((item) => recommendationAction(item));
  const dailyCandidate = dailyAction(daily);

  const primary = candidates[0]
    || recommended[0]
    || (dailyCandidate && !excluded(dailyCandidate) ? dailyCandidate : null)
    || browseAction();

  const secondary = [];
  const push = (action) => {
    if (!action || secondary.some((item) => item.id === action.id || (action.template_id && item.template_id === action.template_id))) return;
    if (excluded(action)) return;
    if (primary.template_id && action.template_id === primary.template_id) return;
    secondary.push(action);
  };
  push(dailyCandidate);
  push(recommended[0]);
  push(recommended[1]);
  push(browseAction());

  const preview = unlockPreview(snapshot);
  return {
    generated_at: new Date().toISOString(),
    user_id: userId,
    primary_action: primary,
    secondary_actions: secondary.slice(0, 2),
    unlock_preview: preview,
    choice_window: {
      id: 'guided-path',
      options: [primary, ...secondary.slice(0, 2)],
    },
  };
}
