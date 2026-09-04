import {
  VIEWPORT_DIAGNOSTIC_VARIANTS,
  readViewportDiagnosticArmingVariant,
} from './viewportDiagnosticActivation.js';

export const VIEWPORT_DIAGNOSTIC_MARKER_KEY = 'splint.viewportDiagnostic.nextVariant';
export const VIEWPORT_DIAGNOSTIC_MARKER_TTL_MS = 10 * 60 * 1000;

const VALID_VARIANTS = new Set(Object.values(VIEWPORT_DIAGNOSTIC_VARIANTS));

function normalizeVariant(value) {
  return typeof value === 'string' && VALID_VARIANTS.has(value) ? value : null;
}

function safeStorage(windowRef) {
  try {
    return windowRef?.localStorage || null;
  } catch {
    return null;
  }
}

function resolveNow(now) {
  return Number.isFinite(now) ? now : Date.now();
}

/** Store one bounded, non-auth marker for the next ordinary compact launch. */
export function armViewportDiagnosticVariant({
  windowRef = globalThis.window,
  variant,
  now = Date.now(),
} = {}) {
  const normalizedVariant = normalizeVariant(variant);
  const storage = safeStorage(windowRef);
  if (!normalizedVariant || !storage) {
    return { armed: false, variant: null, reason: normalizedVariant ? 'storage_unavailable' : 'unknown_variant' };
  }

  const createdAt = resolveNow(now);
  try {
    storage.setItem(VIEWPORT_DIAGNOSTIC_MARKER_KEY, JSON.stringify({
      variant: normalizedVariant,
      createdAt,
    }));
    return { armed: true, variant: normalizedVariant, createdAt };
  } catch {
    return { armed: false, variant: normalizedVariant, reason: 'storage_write_failed' };
  }
}

/**
 * Consume and immediately clear the marker. Invalid, expired and malformed
 * markers are removed too, so a single arm can never be reused.
 */
export function consumeViewportDiagnosticVariant({
  windowRef = globalThis.window,
  now = Date.now(),
} = {}) {
  const storage = safeStorage(windowRef);
  if (!storage) return null;

  let rawMarker;
  try {
    rawMarker = storage.getItem(VIEWPORT_DIAGNOSTIC_MARKER_KEY);
    if (rawMarker === null) return null;
    storage.removeItem(VIEWPORT_DIAGNOSTIC_MARKER_KEY);
  } catch {
    return null;
  }

  let marker;
  try {
    marker = JSON.parse(rawMarker);
  } catch {
    return null;
  }

  const variant = normalizeVariant(marker?.variant);
  const createdAt = Number(marker?.createdAt);
  const age = resolveNow(now) - createdAt;
  if (!variant || !Number.isFinite(createdAt) || age < 0 || age > VIEWPORT_DIAGNOSTIC_MARKER_TTL_MS) {
    return null;
  }
  return variant;
}

/**
 * Select the one-shot launch phase before Telegram initialization. Arming
 * wins over any existing marker; a direct arming launch is never measured.
 */
export function resolveViewportDiagnosticOneShot({
  windowRef = globalThis.window,
  now = Date.now(),
} = {}) {
  const armingVariant = readViewportDiagnosticArmingVariant(windowRef);
  if (armingVariant) {
    return {
      mode: 'arm',
      variant: armingVariant,
      ...armViewportDiagnosticVariant({ windowRef, variant: armingVariant, now }),
    };
  }

  const consumedVariant = consumeViewportDiagnosticVariant({ windowRef, now });
  if (consumedVariant) return { mode: 'consume', variant: consumedVariant };
  return { mode: 'ordinary', variant: null };
}

/** Add a short diagnostic-only acknowledgement without mounting measurements. */
export function showViewportDiagnosticArmedStatus({
  documentRef = globalThis.document,
  variant,
  durationMs = 5000,
} = {}) {
  if (!documentRef?.body || !normalizeVariant(variant)) return () => {};

  const status = documentRef.createElement('div');
  status.dataset.viewportDiagnosticArmed = variant;
  status.setAttribute('role', 'status');
  status.textContent = `NEXT COMPACT DIAGNOSTIC ARMED: ${variant}`;
  Object.assign(status.style, {
    position: 'fixed',
    left: '12px',
    right: '12px',
    bottom: '12px',
    zIndex: '2147483647',
    padding: '10px 12px',
    borderRadius: '10px',
    background: '#111827',
    color: '#f9fafb',
    font: '600 13px/1.3 system-ui, sans-serif',
  });
  documentRef.body.append(status);

  let timer = null;
  const cleanup = () => {
    if (timer !== null) globalThis.clearTimeout?.(timer);
    status.remove?.();
  };
  if (Number.isFinite(durationMs) && durationMs > 0) {
    timer = globalThis.setTimeout?.(cleanup, durationMs) ?? null;
  }
  return cleanup;
}
