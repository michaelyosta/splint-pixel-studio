import { isTelegramHost } from '../lib/platform.js';

const buildEnv = import.meta.env || {};

const SAME_ORIGIN_API_BASE = '/api';

/**
 * Resolve the API base once for every browser data client. Vite injects the
 * VITE_API_URL value at build time; local development intentionally falls
 * back to the Vite /api proxy.
 */
export function resolveApiBase(env = buildEnv) {
  const configured = typeof env?.VITE_API_URL === 'string'
    ? env.VITE_API_URL.trim().replace(/\/+$/, '')
    : '';
  return configured || SAME_ORIGIN_API_BASE;
}

export const API_BASE = resolveApiBase(buildEnv);

export function resolveApiUrl(path, baseUrl = API_BASE) {
  const value = String(path || '');
  if (/^[a-z][a-z\d+.-]*:/i.test(value)) return value;
  const base = String(baseUrl || '').replace(/\/+$/, '');
  const suffix = value.replace(/^\/+/, '');
  return base ? `${base}/${suffix}` : (value || '/');
}

/**
 * Standalone browsers must reach the API through the same-origin `/api`
 * gateway so the server-issued OIDC session cookie is sent with every request
 * under SameSite=Lax. The Telegram Mini App authenticates with signed
 * initData instead of cookies and keeps using the configured absolute origin.
 */
export function resolveClientApiBase(env = buildEnv, { isTelegram = isTelegramHost() } = {}) {
  return isTelegram ? resolveApiBase(env) : SAME_ORIGIN_API_BASE;
}

export function resolveClientApiUrl(path, env = buildEnv, options) {
  return resolveApiUrl(path, resolveClientApiBase(env, options));
}
