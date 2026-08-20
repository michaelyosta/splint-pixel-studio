export const SESSION_GAME_VERSION = 'spark-artifact-v2';

// Phase 2 event candidates intentionally share one session contract. The
// query/env switch only selects the positive-event treatment; it never makes
// the production special-cell catalogue broader. This keeps comparison
// reversible while allowing Spark and Bomb to be judged at the same session
// scale.
const POSITIVE_EVENTS = Object.freeze({
  spark_choice: Object.freeze({
    id: 'spark_choice',
    label: 'Spark choice',
    allowedSpecialKinds: Object.freeze(['spark', 'artifact']),
    mode: 'choice',
  }),
  spark_auto: Object.freeze({
    id: 'spark_auto',
    label: 'Automatic Spark spectacle',
    allowedSpecialKinds: Object.freeze(['spark', 'artifact']),
    mode: 'automatic',
  }),
  bomb: Object.freeze({
    id: 'bomb',
    label: 'Bomb spatial reveal',
    allowedSpecialKinds: Object.freeze(['bomb', 'artifact']),
    mode: 'spatial',
  }),
});

const VARIANTS = Object.freeze({
  control: Object.freeze({
    id: 'control',
    label: 'Control',
    allowedSpecialKinds: Object.freeze([]),
    positiveEvent: null,
  }),
  treatment: Object.freeze({
    id: 'treatment',
    label: 'Phase 2 event + Artifact',
  }),
});

function normalizeVariant(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return Object.hasOwn(VARIANTS, normalized) ? normalized : null;
}

function normalizePositiveEvent(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return Object.hasOwn(POSITIVE_EVENTS, normalized) ? normalized : 'spark_choice';
}

export function resolveSessionGameExperiment(
  search = globalThis.location?.search || '',
  env = import.meta.env,
) {
  const params = new URLSearchParams(search);
  const mode = String(params.get('phase2') || env?.VITE_PHASE2_SESSION_GAME || '').trim().toLowerCase();
  const variantId = normalizeVariant(params.get('phase2Variant') || env?.VITE_PHASE2_VARIANT || 'treatment');
  const positiveEventId = normalizePositiveEvent(
    params.get('phase2Event') || env?.VITE_PHASE2_EVENT || 'spark_choice',
  );
  const available = Boolean(env?.DEV || env?.VITE_PHASE2_SESSION_GAME_ENABLED === 'true');
  if (mode !== 'session' || !variantId || !available) {
    return {
      enabled: false,
      version: SESSION_GAME_VERSION,
      mode: null,
      variant: null,
      variantId: null,
      subjectId: null,
      positiveEvent: null,
      positiveEventId: null,
    };
  }

  const subject = String(params.get('phase2Subject') || '').trim();
  return {
    enabled: true,
    version: SESSION_GAME_VERSION,
    mode: 'session-game',
    variant: variantId === 'treatment'
      ? Object.freeze({
        ...VARIANTS.treatment,
        allowedSpecialKinds: POSITIVE_EVENTS[positiveEventId].allowedSpecialKinds,
      })
      : VARIANTS.control,
    variantId,
    positiveEvent: variantId === 'treatment' ? POSITIVE_EVENTS[positiveEventId] : null,
    positiveEventId: variantId === 'treatment' ? positiveEventId : null,
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
export const SESSION_GAME_POSITIVE_EVENTS = POSITIVE_EVENTS;
