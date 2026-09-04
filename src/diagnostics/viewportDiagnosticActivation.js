/**
 * Read only the one Telegram start parameter reserved for this diagnostic.
 * Never serialize or log the surrounding init data object.
 */
export function readViewportDiagnosticStartParam(windowRef = globalThis.window) {
  const startParam = windowRef?.Telegram?.WebApp?.initDataUnsafe?.start_param;
  return typeof startParam === 'string' ? startParam : null;
}

export function isViewportDiagnosticEnabled({ search = '', startParam = null } = {}) {
  const query = new URLSearchParams(String(search || ''));
  return query.get('viewportDiagnostic') === '1'
    || startParam === 'viewportDiagnostic';
}

export function shouldMountViewportDiagnostic(windowRef = globalThis.window) {
  return isViewportDiagnosticEnabled({
    search: windowRef?.location?.search || '',
    startParam: readViewportDiagnosticStartParam(windowRef),
  });
}
