/**
 * Compact special-cell help content and client-side first-seen state.
 *
 * This module is presentation-only: it describes the frozen Spark/Bomb/Fuse/
 * Choice/Hazard/Artifact kinds and never changes their server behavior.
 * Persistence is a single versioned localStorage record so the intro and the
 * per-kind hints can be shown once without a backend migration.
 */

export const SPECIAL_HELP_STORAGE_KEY = 'splint_special_help_v1';

export const SPECIAL_HELP_KINDS = [
  'spark',
  'bomb',
  'fuse',
  'choice',
  'hazard',
  'artifact',
];

export const SPECIAL_HELP_ITEMS = [
  {
    kind: 'spark',
    label: 'Искра',
    short: 'После верной клетки выберите участок: он закрасится автоматически.',
  },
  {
    kind: 'bomb',
    label: 'Бомба',
    short: 'Выберите точку: верные клетки вокруг неё закрасятся сразу.',
  },
  {
    kind: 'fuse',
    label: 'Фитиль',
    short: 'Обезвредьте цепочку до паузы, чтобы сохранить бонус.',
  },
  {
    kind: 'choice',
    label: 'Выбор',
    short: 'После верной клетки выберите один из предложенных эффектов.',
  },
  {
    kind: 'hazard',
    label: 'Опасность',
    short: 'Обезвредьте маркер или пропустите его с небольшой паузой.',
  },
  {
    kind: 'artifact',
    label: 'Артефакт',
    short: 'Найдите все фрагменты в этой картине: прогресс сохраняется.',
  },
];

const SPECIAL_HELP_ITEM_MAP = Object.freeze(
  Object.fromEntries(SPECIAL_HELP_ITEMS.map((item) => [item.kind, item])),
);

export function normalizeSpecialKind(kind) {
  const normalized = String(kind || '').trim().toLowerCase();
  return SPECIAL_HELP_ITEM_MAP[normalized] ? normalized : null;
}

export function specialHelpItem(kind) {
  const normalized = normalizeSpecialKind(kind);
  return normalized ? SPECIAL_HELP_ITEM_MAP[normalized] : null;
}

export function defaultSpecialHelpState() {
  return { version: 1, introSeen: false, kinds: [] };
}

function normalizeState(parsed) {
  const kinds = Array.isArray(parsed?.kinds)
    ? [...new Set(parsed.kinds.map(normalizeSpecialKind).filter(Boolean))]
    : [];
  return {
    version: parsed?.version === 1 ? 1 : 1,
    introSeen: Boolean(parsed?.introSeen),
    kinds,
  };
}

export function readSpecialHelpState(storage) {
  if (!storage || typeof storage.getItem !== 'function') return defaultSpecialHelpState();
  try {
    const raw = storage.getItem(SPECIAL_HELP_STORAGE_KEY);
    if (!raw) return defaultSpecialHelpState();
    return normalizeState(JSON.parse(raw));
  } catch {
    return defaultSpecialHelpState();
  }
}

export function writeSpecialHelpState(storage, state) {
  if (!storage || typeof storage.setItem !== 'function') return false;
  try {
    storage.setItem(SPECIAL_HELP_STORAGE_KEY, JSON.stringify(normalizeState(state)));
    return true;
  } catch {
    return false;
  }
}

export function markSpecialKindSeen(state, kind) {
  const normalized = normalizeSpecialKind(kind);
  if (!normalized || state.kinds.includes(normalized)) return state;
  return { ...state, kinds: [...state.kinds, normalized] };
}

export function markSpecialIntroSeen(state) {
  return state.introSeen ? state : { ...state, introSeen: true };
}

/** The intro/legend marks the help as read but never suppresses a kind hint. */
export function markSpecialHelpRead(state) {
  return { ...state, introSeen: true };
}

export function shouldShowSpecialIntro(state, { hasSpecials = false, legacyOnboardingSeen = false, treatment = false } = {}) {
  return Boolean(treatment && hasSpecials && legacyOnboardingSeen && !state.introSeen);
}

export function shouldShowSpecialKindHint(state, kind) {
  const normalized = normalizeSpecialKind(kind);
  return Boolean(normalized && !state.kinds.includes(normalized));
}

export function hasSpecialsInProgress(progress) {
  return progress?.specials_experiment_group === 'treatment';
}

export function specialKindsInProgress(progress) {
  const kinds = [];
  for (const special of progress?.specials || []) {
    const kind = normalizeSpecialKind(special?.kind);
    if (kind && !kinds.includes(kind)) kinds.push(kind);
  }
  return kinds;
}
