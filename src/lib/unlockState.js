/*
 * Pure view-model helpers for the server-authoritative unlock snapshot and
 * recommendation payloads. Everything here is bounded: inputs are normalized,
 * lists are capped, and no code in this module ever touches cell maps or
 * creates per-cell structures.
 */

import { CONTENT_METADATA_SCHEMA_VERSION } from './contentMetadata.js';

export const UNLOCK_STATES = Object.freeze({
  AVAILABLE: 'available',
  OWNED: 'owned',
  PROGRESSION_LOCKED: 'progression_locked',
  PREMIUM_LOCKED: 'premium_locked',
});

export const REASON_CODES = Object.freeze({
  AVAILABLE: 'CONTENT_AVAILABLE',
  OWNED: 'CONTENT_OWNED',
  PROGRESSION_REQUIRED: 'PROGRESSION_REQUIRED',
  PREMIUM_REQUIRED: 'PREMIUM_REQUIRED',
  UNLOCK_READY: 'UNLOCK_READY',
  LEVEL_REQUIRED: 'LEVEL_REQUIRED',
  XP_REQUIRED: 'XP_REQUIRED',
  ACHIEVEMENT_REQUIRED: 'ACHIEVEMENT_REQUIRED',
  STREAK_REQUIRED: 'STREAK_REQUIRED',
  COMPLETIONS_REQUIRED: 'COMPLETIONS_REQUIRED',
  COLLECTION_REQUIRED: 'COLLECTION_REQUIRED',
});

export const RECOMMENDATION_REASONS = Object.freeze({
  CONTINUE_PROGRESS: 'CONTINUE_PROGRESS',
  THEME_AFFINITY: 'THEME_AFFINITY',
  COLLECTION_AFFINITY: 'COLLECTION_AFFINITY',
  DIFFICULTY_MATCH: 'DIFFICULTY_MATCH',
  DAILY_FEATURED: 'DAILY_FEATURED',
  COLD_START: 'COLD_START',
});

const REASON_CODES_SET = new Set(Object.values(REASON_CODES));
const RECOMMENDATION_REASONS_SET = new Set(Object.values(RECOMMENDATION_REASONS));

export const STATE_LABELS = Object.freeze({
  [UNLOCK_STATES.AVAILABLE]: 'Доступно',
  [UNLOCK_STATES.OWNED]: 'Открыто',
  [UNLOCK_STATES.PROGRESSION_LOCKED]: 'Закрыто прогрессом',
  [UNLOCK_STATES.PREMIUM_LOCKED]: 'Недоступно',
});

const STATE_DESCRIPTIONS = Object.freeze({
  [UNLOCK_STATES.AVAILABLE]: 'Можно начать сейчас.',
  [UNLOCK_STATES.OWNED]: 'Уже открыто в вашем профиле.',
  [UNLOCK_STATES.PROGRESSION_LOCKED]: 'Откроется, когда прогресс достигнет условий.',
  [UNLOCK_STATES.PREMIUM_LOCKED]: 'Сейчас недоступно.',
});

export function clampProgress(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.round(Math.min(1, Math.max(0, numeric)) * 1000) / 1000;
}

export function percentOf(value) {
  return Math.round(clampProgress(value) * 100);
}

export function stateLabel(state) {
  return STATE_LABELS[state] || 'Неизвестно';
}

export function stateDescription(state) {
  return STATE_DESCRIPTIONS[state] || '';
}

export function isKnownReasonCode(code) {
  return REASON_CODES_SET.has(code);
}

export function isPremiumReason(code) {
  return code === REASON_CODES.PREMIUM_REQUIRED;
}

export function reasonTitle(code) {
  switch (code) {
    case REASON_CODES.AVAILABLE: return 'Свободная раскраска';
    case REASON_CODES.OWNED: return 'Открыто';
    case REASON_CODES.UNLOCK_READY: return 'Готово к открытию';
    case REASON_CODES.PROGRESSION_REQUIRED: return 'Нужен прогресс';
    case REASON_CODES.PREMIUM_REQUIRED: return 'Контент сейчас недоступен';
    case REASON_CODES.LEVEL_REQUIRED: return 'Нужен уровень';
    case REASON_CODES.XP_REQUIRED: return 'Нужен опыт';
    case REASON_CODES.ACHIEVEMENT_REQUIRED: return 'Нужно достижение';
    case REASON_CODES.STREAK_REQUIRED: return 'Нужна серия дней';
    case REASON_CODES.COMPLETIONS_REQUIRED: return 'Нужны завершённые работы';
    case REASON_CODES.COLLECTION_REQUIRED: return 'Нужна коллекция';
    default: return 'Открывается в игре';
  }
}

export function reasonText(code) {
  switch (code) {
    case REASON_CODES.AVAILABLE: return 'Раскраска доступна — можно начать прямо сейчас.';
    case REASON_CODES.OWNED: return 'Контент уже открыт в вашем профиле.';
    case REASON_CODES.UNLOCK_READY: return 'Условия выполнены — откройте контент и начните раскрашивать.';
    case REASON_CODES.PROGRESSION_REQUIRED: return 'Контент откроется после выполнения условий прогресса.';
    case REASON_CODES.PREMIUM_REQUIRED: return 'Контент сейчас недоступен. Вернитесь к бесплатным работам.';
    case REASON_CODES.LEVEL_REQUIRED: return 'Нужен более высокий уровень — получайте XP за верные клетки.';
    case REASON_CODES.XP_REQUIRED: return 'Нужно больше опыта — каждая верная клетка приносит XP.';
    case REASON_CODES.ACHIEVEMENT_REQUIRED: return 'Нужно открыть указанное достижение.';
    case REASON_CODES.STREAK_REQUIRED: return 'Нужна серия дней подряд.';
    case REASON_CODES.COMPLETIONS_REQUIRED: return 'Нужно завершить больше раскрасок.';
    case REASON_CODES.COLLECTION_REQUIRED: return 'Нужно полностью пройти указанную коллекцию.';
    default: return 'Контент откроется по мере игры.';
  }
}

export function recommendationReasonText(code) {
  switch (code) {
    case RECOMMENDATION_REASONS.CONTINUE_PROGRESS: return 'Продолжите начатую раскраску';
    case RECOMMENDATION_REASONS.THEME_AFFINITY: return 'Похоже на ваши любимые темы';
    case RECOMMENDATION_REASONS.COLLECTION_AFFINITY: return 'Из коллекции, которую вы раскрашиваете';
    case RECOMMENDATION_REASONS.DIFFICULTY_MATCH: return 'Подходит по сложности';
    case RECOMMENDATION_REASONS.DAILY_FEATURED: return 'Выбор дня';
    case RECOMMENDATION_REASONS.COLD_START: return 'Новое для вас';
    default: return 'Рекомендация';
  }
}

export function recommendationDetail(item) {
  if (!item || typeof item !== 'object') return '';
  const minutes = Number(item.est_minutes) > 0 ? `${Number(item.est_minutes)} мин` : '';
  const size = Number(item.width) > 0 && Number(item.height) > 0
    ? `${Number(item.width)}×${Number(item.height)}`
    : '';
  return [minutes, size].filter(Boolean).join(' · ');
}

// Recommendations are intentionally a small view model, but content metadata
// is not optional presentation garnish: it is the server's contract for
// duration/complexity labels. Preserve only the bounded, known sections so a
// malformed response cannot smuggle a large object into the Home surface.
function copyMetadataSection(section, fields) {
  if (!section || typeof section !== 'object' || Array.isArray(section)) return null;
  const result = {};
  for (const field of fields) {
    if (section[field] !== undefined && section[field] !== null) result[field] = section[field];
  }
  return result;
}

function normalizeRecommendationContentMetadata(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  if (value.schema_version !== CONTENT_METADATA_SCHEMA_VERSION) return null;
  const duration = copyMetadataSection(value.duration, [
    'band', 'label', 'minutes', 'total_cells', 'session_mode', 'confidence', 'source', 'item_count',
  ]);
  const complexity = copyMetadataSection(value.complexity, [
    'band', 'label', 'score', 'confidence', 'source', 'gate', 'item_count',
  ]);
  if (!duration?.label || !complexity?.label) return null;
  const style = copyMetadataSection(value.style, [
    'route', 'status', 'confidence', 'label', 'policy', 'source',
  ]);
  if (style && Array.isArray(value.style.reasons)) style.reasons = value.style.reasons.slice(0, 8).map(String);
  const qualityGate = copyMetadataSection(value.quality_gate, ['status', 'blocking', 'item_count']);
  if (qualityGate && Array.isArray(value.quality_gate.reasons)) qualityGate.reasons = value.quality_gate.reasons.slice(0, 8).map(String);
  return {
    schema_version: CONTENT_METADATA_SCHEMA_VERSION,
    duration,
    complexity,
    ...(style ? { style } : {}),
    ...(qualityGate ? { quality_gate: qualityGate } : {}),
  };
}

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function safeNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function normalizeRequirement(requirement) {
  if (!requirement || typeof requirement !== 'object') return null;
  const ruleType = String(requirement.rule_type || requirement.kind || '').trim();
  const target = String(requirement.target_value ?? requirement.target ?? '');
  const current = safeNumber(requirement.current, 0);
  const total = safeNumber(requirement.total, safeNumber(requirement.target, 0));
  return {
    rule_type: ruleType,
    reason_code: requirement.reason_code || REASON_CODES.PROGRESSION_REQUIRED,
    label: ruleType === 'premium' ? requirementTitle(ruleType) : String(requirement.label || requirementTitle(ruleType)),
    target_value: target,
    current,
    target: safeNumber(requirement.target, total),
    total,
    satisfied: Boolean(requirement.satisfied),
    progress: clampProgress(requirement.progress),
  };
}

function requirementTitle(ruleType) {
  switch (ruleType) {
    case 'level': return 'Уровень';
    case 'xp': return 'Опыт (XP)';
    case 'achievement': return 'Достижение';
    case 'streak': return 'Серия дней';
    case 'completed_artworks': return 'Завершённые раскраски';
    case 'collection_completion': return 'Завершённая коллекция';
    case 'premium': return 'Контент сейчас недоступен';
    default: return 'Условие';
  }
}

export function nextActionForRequirement(requirement) {
  const normalized = normalizeRequirement(requirement);
  if (!normalized) return '';
  const current = normalized.current;
  const target = normalized.target;
  const total = normalized.total > 0 ? normalized.total : target;
  switch (normalized.rule_type) {
    case 'level':
      return `Достигните уровня ${target}. Сейчас уровень ${current}. Раскрашивайте картины, чтобы получать XP.`;
    case 'xp':
      return `Наберите ${target} XP. Сейчас ${current} XP. Каждая верная клетка даёт очки опыта.`;
    case 'achievement':
      return `Откройте достижение «${normalized.target_value || normalized.label}».`;
    case 'streak':
      return `Раскрашивайте ${target} дней подряд. Сейчас серия ${current} дн.`;
    case 'completed_artworks':
      return `Завершите ${target} раскрасок. Сейчас завершено ${current}.`;
    case 'collection_completion':
      return `Завершите коллекцию целиком: ${current} из ${total}.`;
    case 'premium':
      return 'Контент сейчас недоступен.';
    default:
      return normalized.satisfied ? 'Условие выполнено.' : 'Продолжайте раскрашивать, чтобы выполнить условие.';
  }
}

export function formatRequirement(requirement) {
  const normalized = normalizeRequirement(requirement);
  if (!normalized) return null;
  const total = normalized.total > 0 ? normalized.total : normalized.target;
  let progressText;
  if (normalized.rule_type === 'achievement') {
    progressText = normalized.satisfied ? 'Открыто' : 'Не открыто';
  } else if (normalized.rule_type === 'premium') {
    progressText = 'Недоступно';
  } else {
    progressText = `${Math.min(normalized.current, total)} / ${total}`;
  }
  return {
    ...normalized,
    progressText,
    percent: percentOf(normalized.progress),
    nextAction: nextActionForRequirement(normalized),
  };
}

function normalizeSubject(subject) {
  if (!subject || typeof subject !== 'object') return null;
  const state = Object.values(UNLOCK_STATES).includes(subject.state) ? subject.state : null;
  if (!state) return null;
  return {
    subject_type: subject.subject_type === 'collection' ? 'collection' : 'template',
    subject_id: String(subject.subject_id ?? ''),
    title: String(subject.title || 'Без названия'),
    state,
    owned: Boolean(subject.owned),
    locked: Boolean(subject.locked),
    reason_code: isKnownReasonCode(subject.reason_code) ? subject.reason_code : REASON_CODES.PROGRESSION_REQUIRED,
    grant_required: Boolean(subject.grant_required),
    unlockable_now: Boolean(subject.unlockable_now),
    requirements: safeArray(subject.requirements)
      .map(normalizeRequirement)
      .filter(Boolean)
      .slice(0, 6),
    progress_ratio: clampProgress(subject.progress_ratio),
  };
}

function normalizeFacts(facts) {
  if (!facts || typeof facts !== 'object') return null;
  return {
    level: safeNumber(facts.level, 1),
    xp_total: safeNumber(facts.xp_total, 0),
    longest_streak: safeNumber(facts.longest_streak, 0),
    achievements_unlocked: safeNumber(facts.achievements_unlocked, 0),
    completed_artworks: safeNumber(facts.completed_artworks, 0),
    completed_collections: safeArray(facts.completed_collections)
      .map((item) => ({
        collection_id: String(item?.collection_id ?? ''),
        completed: safeNumber(item?.completed, 0),
        total: safeNumber(item?.total, 0),
      }))
      .filter((item) => item.collection_id)
      .slice(0, 20),
    owned_collections: safeNumber(facts.owned_collections, 0),
    owned_templates: safeNumber(facts.owned_templates, 0),
  };
}

/**
 * Normalizes a server snapshot defensively. Lists are capped so a future
 * server regression cannot create unbounded client work.
 */
export function normalizeSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return null;
  const collections = safeArray(snapshot.collections).map(normalizeSubject).filter(Boolean).slice(0, 100);
  const templates = safeArray(snapshot.templates).map(normalizeSubject).filter(Boolean).slice(0, 100);
  const nextActionable = safeArray(snapshot.next_actionable).map(normalizeSubject).filter(Boolean).slice(0, 3);
  const summary = snapshot.summary && typeof snapshot.summary === 'object' ? snapshot.summary : {};
  return {
    user_id: String(snapshot.user_id ?? ''),
    progression_facts: normalizeFacts(snapshot.progression_facts),
    summary: {
      total_subjects: safeNumber(summary.total_subjects, collections.length + templates.length),
      available: safeNumber(summary.available, 0),
      owned: safeNumber(summary.owned, 0),
      progression_locked: safeNumber(summary.progression_locked, 0),
      premium_locked: safeNumber(summary.premium_locked, 0),
    },
    collections,
    templates,
    next_actionable: nextActionable,
  };
}

function fallbackSubject(subjects, state) {
  return subjects.find((subject) => subject.state === state) || null;
}

/**
 * Builds the concise current/next unlock journey from the normalized
 * snapshot. The server's ranked `next_actionable` list wins; fallbacks keep
 * the surface useful for older servers without ranking.
 */
export function buildJourneyView(snapshot) {
  const normalized = normalizeSnapshot(snapshot);
  if (!normalized) return null;
  const subjects = [...normalized.collections, ...normalized.templates];
  const actionable = normalized.next_actionable;
  const current = actionable[0]
    || fallbackSubject(subjects, UNLOCK_STATES.AVAILABLE)
    || fallbackSubject(subjects, UNLOCK_STATES.PROGRESSION_LOCKED)
    || null;
  const next = actionable[1] || (current && subjects.find((subject) => subject.subject_id !== current.subject_id)) || null;
  return {
    facts: normalized.progression_facts,
    summary: normalized.summary,
    current,
    next,
    counts: {
      available: normalized.summary.available,
      owned: normalized.summary.owned,
      progression_locked: normalized.summary.progression_locked,
      premium_locked: normalized.summary.premium_locked,
    },
  };
}

/**
 * Client-side dedupe and cap for recommendations. The server already excludes
 * locked/hidden/completed rows, but the UI never renders more than `limit`
 * cards and never trusts a duplicate or malformed row.
 */
export function prepareRecommendations(items, { limit = 8 } = {}) {
  const max = Math.min(20, Math.max(1, Math.floor(Number(limit) || 8)));
  const seen = new Set();
  const result = [];
  for (const item of safeArray(items)) {
    if (!item || typeof item !== 'object') continue;
    const id = String(item.id ?? '');
    if (!id || seen.has(id)) continue;
    if (item.unlock_state === UNLOCK_STATES.PROGRESSION_LOCKED || item.unlock_state === UNLOCK_STATES.PREMIUM_LOCKED) continue;
    seen.add(id);
    result.push({
      id,
      title: String(item.title || 'Без названия'),
      preview_url: item.preview_url || null,
      theme: String(item.theme || 'featured'),
      difficulty: String(item.difficulty || 'easy'),
      width: safeNumber(item.width, 0),
      height: safeNumber(item.height, 0),
      est_minutes: safeNumber(item.est_minutes, 3),
      storage_mode: String(item.storage_mode || 'legacy'),
      reason_code: RECOMMENDATION_REASONS_SET.has(item.reason_code)
        ? item.reason_code
        : RECOMMENDATION_REASONS.COLD_START,
      score: safeNumber(item.score, 0),
      unlock_state: item.unlock_state || null,
      unlock_reason_code: item.unlock_reason_code || null,
      // Keep authoritative labels available to the renderer. Do not derive
      // replacements from est_minutes/difficulty when the field is absent.
      content_metadata: normalizeRecommendationContentMetadata(item.content_metadata),
    });
    if (result.length >= max) break;
  }
  return result;
}

export function isUnlockLockedPayload(payload) {
  return Boolean(payload && typeof payload === 'object' && payload.state
    && Object.values(UNLOCK_STATES).includes(payload.state));
}
