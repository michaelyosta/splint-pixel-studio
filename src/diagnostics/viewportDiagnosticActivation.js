/**
 * Read only the one Telegram start parameter reserved for this diagnostic.
 * Never serialize or log the surrounding init data object.
 */
export const VIEWPORT_DIAGNOSTIC_VARIANTS = Object.freeze({
  baseline: 'baseline',
  noBackdrop: 'noBackdrop',
  promotedLayer: 'promotedLayer',
});

const VIEWPORT_DIAGNOSTIC_START_PARAMS = Object.freeze({
  viewportDiagnostic_baseline: VIEWPORT_DIAGNOSTIC_VARIANTS.baseline,
  viewportDiagnostic_noBackdrop: VIEWPORT_DIAGNOSTIC_VARIANTS.noBackdrop,
  viewportDiagnostic_promotedLayer: VIEWPORT_DIAGNOSTIC_VARIANTS.promotedLayer,
});

function variantFromExactValue(value) {
  if (typeof value !== 'string') return null;
  return VIEWPORT_DIAGNOSTIC_START_PARAMS[value] || null;
}

export function readViewportDiagnosticStartParam(windowRef = globalThis.window) {
  const startParam = windowRef?.Telegram?.WebApp?.initDataUnsafe?.start_param;
  return typeof startParam === 'string' ? startParam : null;
}

export function readViewportDiagnosticVariant({ search = '', startParam = null, tgWebAppStartParam = null } = {}) {
  const query = new URLSearchParams(String(search || ''));
  const candidates = [
    variantFromExactValue(startParam),
    variantFromExactValue(tgWebAppStartParam),
    variantFromExactValue(query.get('tgWebAppStartParam')),
    variantFromExactValue(query.get('viewportDiagnosticVariant')),
    variantFromExactValue(query.get('viewportDiagnostic')),
  ];
  const explicitVariant = candidates.find(Boolean);
  if (explicitVariant) return explicitVariant;

  // Preserve the original diagnostic entry points as baseline mode only.
  if (startParam === 'viewportDiagnostic'
    || tgWebAppStartParam === 'viewportDiagnostic'
    || query.get('tgWebAppStartParam') === 'viewportDiagnostic'
    || query.get('viewportDiagnostic') === '1') {
    return VIEWPORT_DIAGNOSTIC_VARIANTS.baseline;
  }
  return null;
}

export function isViewportDiagnosticEnabled({ search = '', startParam = null, tgWebAppStartParam = null } = {}) {
  return readViewportDiagnosticVariant({ search, startParam, tgWebAppStartParam }) !== null;
}

export function resolveViewportDiagnosticVariant(windowRef = globalThis.window) {
  return readViewportDiagnosticVariant({
    search: windowRef?.location?.search || '',
    startParam: readViewportDiagnosticStartParam(windowRef),
  });
}

export function shouldMountViewportDiagnostic(windowRef = globalThis.window) {
  return resolveViewportDiagnosticVariant(windowRef) !== null;
}
