export const CORE_FEEL_REFERENCE_TEMPLATE_ID = 'color_astro-whale';

const REFERENCE_FRAGMENTS = [
  {
    id: 'whale-head-contour',
    label: 'Контур головы',
    prompt: 'Проведи по светлому контуру',
    color: 2,
    cells: [
      148, 149, 150, 177, 178, 179, 180, 204, 205, 206, 207, 208, 209,
      231, 232, 234, 235, 236, 237, 238, 265, 266, 294, 295, 323, 351,
    ],
  },
  {
    id: 'whale-face',
    label: 'Лицо кита',
    prompt: 'Раскрой лицо кита',
    color: 3,
    cells: [
      233, 258, 259, 260, 261, 262, 263, 264, 285, 286, 287, 288, 289,
      290, 291, 292, 293, 313, 314, 315, 316, 317, 318, 319, 320, 321,
      322, 340, 341, 342, 343, 344, 345, 346, 347, 348, 349, 350, 369,
      370, 371, 372, 373, 375, 376, 377, 378, 401, 402, 403, 404, 405,
      430, 431, 432,
    ],
  },
  {
    id: 'whale-eye-glow',
    label: 'Свет в глазах',
    prompt: 'Добавь свет в глазах',
    color: 8,
    cells: [397, 398, 426, 427, 428, 429, 455, 456, 457],
  },
];

const VARIANTS = {
  control: {
    id: 'control',
    label: 'Control · current feel',
    enhanced: false,
    strokeStyle: 'current',
    revealStyle: 'none',
    cameraStyle: 'auto',
    hapticIntensity: 'current',
  },
  a: {
    id: 'a',
    label: 'A · crisp settle',
    enhanced: true,
    strokeStyle: 'crisp',
    revealStyle: 'edge-settle',
    cameraStyle: 'ownership-pause',
    hapticIntensity: 'quiet',
  },
  b: {
    id: 'b',
    label: 'B · soft breathe',
    enhanced: true,
    strokeStyle: 'soft',
    revealStyle: 'tonal-breathe',
    cameraStyle: 'ownership-breathe',
    hapticIntensity: 'balanced',
  },
  c: {
    id: 'c',
    label: 'C · luminous edge',
    enhanced: true,
    strokeStyle: 'luminous',
    revealStyle: 'luminous-edge',
    cameraStyle: 'ownership-pause',
    hapticIntensity: 'expressive',
  },
};

function normalizeVariant(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return Object.hasOwn(VARIANTS, normalized) ? normalized : null;
}

function readBooleanParam(value, fallback) {
  if (value == null || value === '') return fallback;
  return !['0', 'false', 'off', 'no'].includes(String(value).toLowerCase());
}

export function resolveCoreFeelExperiment(search = globalThis.location?.search || '', env = import.meta.env) {
  const params = new URLSearchParams(search);
  const variantId = normalizeVariant(params.get('coreFeel') || env?.VITE_CORE_FEEL_VARIANT);
  const experimentAvailable = Boolean(env?.DEV || env?.VITE_CORE_FEEL_EXPERIMENT_ENABLED === 'true');
  if (!variantId || !experimentAvailable) {
    return {
      enabled: false,
      referenceTemplateId: CORE_FEEL_REFERENCE_TEMPLATE_ID,
      variant: null,
      variantId: null,
      soundEnabled: false,
      hapticsEnabled: true,
      subjectId: null,
    };
  }

  const subject = String(params.get('coreSubject') || '').trim();
  return {
    enabled: true,
    referenceTemplateId: CORE_FEEL_REFERENCE_TEMPLATE_ID,
    variant: VARIANTS[variantId],
    variantId,
    soundEnabled: readBooleanParam(params.get('coreSound'), false),
    hapticsEnabled: readBooleanParam(params.get('coreHaptics'), true),
    subjectId: /^corefeel_[a-z0-9_-]{1,40}$/i.test(subject) ? subject : null,
  };
}

export function getCoreFeelFragments(template) {
  if (!template || template.id !== CORE_FEEL_REFERENCE_TEMPLATE_ID) return [];
  const cellCount = Number(template.width) * Number(template.height);
  return REFERENCE_FRAGMENTS.map((fragment) => ({
    ...fragment,
    cells: fragment.cells.filter((index) => (
      index >= 0
      && index < cellCount
      && template.cells[index] === fragment.color
    )),
  })).filter((fragment) => fragment.cells.length > 0);
}

export function getNextCoreFeelFragment(template, filled, afterId = null) {
  const fragments = getCoreFeelFragments(template);
  const startIndex = afterId == null
    ? 0
    : Math.max(0, fragments.findIndex((fragment) => fragment.id === afterId) + 1);
  for (let index = startIndex; index < fragments.length; index += 1) {
    const fragment = fragments[index];
    const remainingCells = fragment.cells.filter((cellIndex) => filled?.[cellIndex] === -1);
    if (remainingCells.length) return { ...fragment, cells: remainingCells };
  }
  return null;
}

export function getCoreFeelFragmentForColor(template, filled, color) {
  return getCoreFeelFragments(template)
    .map((fragment) => ({
      ...fragment,
      cells: fragment.cells.filter((cellIndex) => filled?.[cellIndex] === -1),
    }))
    .find((fragment) => fragment.color === color && fragment.cells.length) || null;
}

export function isCoreFeelReference(experiment, template) {
  return Boolean(experiment?.enabled && template?.id === experiment.referenceTemplateId);
}

export function getCoreFeelDevSubject(search = globalThis.location?.search || '', env = import.meta.env) {
  if (!env?.DEV || env?.VITE_ALLOW_DEV_AUTH !== 'true') return null;
  return resolveCoreFeelExperiment(search, env).subjectId;
}

export const CORE_FEEL_VARIANTS = Object.freeze(VARIANTS);
