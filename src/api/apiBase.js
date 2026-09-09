const buildEnv = import.meta.env || {};

/**
 * Resolve the API base once for every browser data client. Vite injects the
 * VITE_API_URL value at build time; local development intentionally falls
 * back to the Vite /api proxy.
 */
export function resolveApiBase(env = buildEnv) {
  const configured = typeof env?.VITE_API_URL === 'string'
    ? env.VITE_API_URL.trim().replace(/\/+$/, '')
    : '';
  return configured || '/api';
}

export const API_BASE = resolveApiBase(buildEnv);

export function resolveApiUrl(path, baseUrl = API_BASE) {
  const value = String(path || '');
  if (/^[a-z][a-z\d+.-]*:/i.test(value)) return value;
  const base = String(baseUrl || '').replace(/\/+$/, '');
  const suffix = value.replace(/^\/+/, '');
  return base ? `${base}/${suffix}` : (value || '/');
}
