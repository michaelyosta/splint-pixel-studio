export const SESSION_GAME_VERSION = 'spark-artifact-v1';

const VARIANTS = Object.freeze({
  control: Object.freeze({
    id: 'control',
    label: 'Control',
    allowedSpecialKinds: Object.freeze([]),
  }),
  treatment: Object.freeze({
    id: 'treatment',
    label: 'Spark + Artifact',
    allowedSpecialKinds: Object.freeze(['spark', 'artifact']),
  }),
});

function normalizeVariant(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return Object.hasOwn(VARIANTS, normalized) ? normalized : null;
}

export function resolveSessionGameExperiment(
  search = globalThis.location?.search || '',
  env = import.meta.env,
) {
  const params = new URLSearchParams(search);
  const mode = String(params.get('phase2') || env?.VITE_PHASE2_SESSION_GAME || '').trim().toLowerCase();
  const variantId = normalizeVariant(params.get('phase2Variant') || env?.VITE_PHASE2_VARIANT || 'treatment');
  const available = Boolean(env?.DEV || env?.VITE_PHASE2_SESSION_GAME_ENABLED === 'true');
  if (mode !== 'session' || !variantId || !available) {
    return {
      enabled: false,
      version: SESSION_GAME_VERSION,
      mode: null,
      variant: null,
      variantId: null,
      subjectId: null,
    };
  }

  const subject = String(params.get('phase2Subject') || '').trim();
  return {
    enabled: true,
    version: SESSION_GAME_VERSION,
    mode: 'session-game',
    variant: VARIANTS[variantId],
    variantId,
    subjectId: /^phase2_[a-z0-9_-]{1,40}$/i.test(subject) ? subject : null,
  };
}

export function isSessionGameSpecialAllowed(experiment, kind) {
  if (!experiment?.enabled) return true;
  return experiment.variant?.allowedSpecialKinds?.includes(String(kind || '').toLowerCase()) || false;
}

export function getSessionGameDevSubject(
  search = globalThis.location?.search || '',
  env = import.meta.env,
) {
  if (!env?.DEV || env?.VITE_ALLOW_DEV_AUTH !== 'true') return null;
  return resolveSessionGameExperiment(search, env).subjectId;
}

export const SESSION_GAME_VARIANTS = VARIANTS;
