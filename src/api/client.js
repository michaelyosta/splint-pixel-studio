import { getCoreFeelDevSubject } from '../features/coreFeel/coreFeelExperiment.js';
import { getSessionGameDevSubject } from '../features/sessionGame/sessionGameExperiment.js';
import { resolveApiUrl } from './apiBase.js';
import { getPlatform } from '../lib/platform.js';
import { getTelegramWebApp } from '../lib/telegram.js';

export const DEV_USER_ID = getCoreFeelDevSubject()
  || getSessionGameDevSubject()
  || import.meta.env.VITE_DEV_USER_ID
  || 'user_pixelhunter';

let browserSessionState = Object.freeze({ status: 'unknown', user: null, csrfToken: null, expiresAt: null });
let browserSessionPromise = null;

function notifyBrowserSession() {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('splint:browser-session', { detail: browserSessionState }));
}

function setBrowserSessionState(next) {
  browserSessionState = Object.freeze({ ...browserSessionState, ...next });
  notifyBrowserSession();
  return browserSessionState;
}

export function getBrowserSessionState() {
  return browserSessionState;
}

export function subscribeBrowserSession(listener) {
  if (typeof window === 'undefined') return () => {};
  const handleChange = (event) => listener(event.detail || browserSessionState);
  window.addEventListener('splint:browser-session', handleChange);
  return () => window.removeEventListener('splint:browser-session', handleChange);
}

export async function bootstrapBrowserSession({ force = false } = {}) {
  const platform = getPlatform();
  if (platform.isTelegram || import.meta.env.VITE_ALLOW_DEV_AUTH === 'true') {
    return setBrowserSessionState({ status: 'development', user: null, csrfToken: null, expiresAt: null });
  }
  if (!force && browserSessionState.status !== 'unknown') return browserSessionState;
  if (browserSessionPromise && !force) return browserSessionPromise;
  browserSessionPromise = fetch(resolveApiUrl('/auth/session'), {
    credentials: 'include',
    cache: 'no-store',
    headers: { Accept: 'application/json' },
  })
    .then(async (response) => {
      const data = await response.json().catch(() => ({}));
      if (response.ok && data.authenticated && data.user && data.csrfToken) {
        return setBrowserSessionState({ status: 'authenticated', user: data.user, csrfToken: data.csrfToken, expiresAt: data.expiresAt || null });
      }
      return setBrowserSessionState({ status: 'anonymous', user: null, csrfToken: null, expiresAt: null });
    })
    .catch(() => setBrowserSessionState({ status: 'anonymous', user: null, csrfToken: null, expiresAt: null }))
    .finally(() => { browserSessionPromise = null; });
  return browserSessionPromise;
}

function authHeaders(userId = DEV_USER_ID) {
  const telegramInitData = getTelegramWebApp()?.initData?.trim();
  const allowDevAuth = import.meta.env.VITE_ALLOW_DEV_AUTH === 'true';

  const headers = telegramInitData
    ? { 'X-Telegram-Init-Data': telegramInitData }
    : allowDevAuth
      ? { 'X-User-Id': userId }
      : {};
  return headers;
}

async function request(path, { method = 'GET', body, userId = DEV_USER_ID, signal, headers: extraHeaders = {} } = {}) {
  await bootstrapBrowserSession();
  const csrfHeader = !['GET', 'HEAD', 'OPTIONS'].includes(method) && browserSessionState.csrfToken
    ? { 'X-CSRF-Token': browserSessionState.csrfToken }
    : {};

  const response = await fetch(resolveApiUrl(path), {
    method,
    signal,
    credentials: 'include',
    // User-scoped JSON endpoints must not be revalidated into an empty 304
    // response: mobile WebKit can otherwise leave profile state unhydrated.
    cache: 'no-store',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(userId),
      ...extraHeaders,
      ...csrfHeader,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || 'Не удалось выполнить запрос');
    error.status = response.status;
    error.data = data;
    throw error;
  }
  return data;
}

export async function downloadColoringResult(id, { userId = DEV_USER_ID, signal } = {}) {
  await bootstrapBrowserSession();
  const response = await fetch(resolveApiUrl(`/colorings/${encodeURIComponent(id)}/result`), {
    method: 'GET',
    signal,
    credentials: 'include',
    cache: 'no-store',
    headers: {
      Accept: 'image/png,image/*',
      ...authHeaders(userId),
    },
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    const error = new Error(data.error || 'РќРµ СѓРґР°Р»РѕСЃСЊ Р·Р°РіСЂСѓР·РёС‚СЊ СЂРµР·СѓР»СЊС‚Р°С‚');
    error.status = response.status;
    error.data = data;
    throw error;
  }
  return response.blob();
}

export const api = request;

export const authApi = {
  session: () => bootstrapBrowserSession({ force: true }),
  loginUrl: () => resolveApiUrl('/auth/telegram/start'),
  login: () => {
    if (typeof window !== 'undefined') window.location.assign(resolveApiUrl('/auth/telegram/start'));
  },
  logout: async () => {
    await request('/auth/logout', { method: 'POST' });
    setBrowserSessionState({ status: 'anonymous', user: null, csrfToken: null, expiresAt: null });
  },
};

export const metaApi = {
  streak: () => request('/meta/streak'),
  progression: () => request('/meta/progression'),
  dailyChallenge: () => request('/meta/daily-challenge'),
  weeklyChallenge: () => request('/meta/weekly-challenge'),
  achievements: () => request('/meta/achievements'),
  collections: () => request('/meta/collections'),
  collectionTemplates: (id) => request(`/meta/collections/${id}/templates`),
  track: (event, payload = {}) => request('/meta/analytics', { method: 'POST', body: { event, payload } }),
  analyticsSummary: () => request('/meta/analytics/summary'),
};

export const catalogApi = {
  list: (params = {}) => {
    const query = new URLSearchParams();
    if (params.mood) query.set('mood', params.mood);
    if (params.theme) query.set('theme', params.theme);
    if (params.max_minutes) query.set('max_minutes', String(params.max_minutes));
    if (params.featured) query.set('featured', '1');
    if (params.q) query.set('q', params.q);
    if (params.sort) query.set('sort', params.sort);
    if (params.access) query.set('access', params.access);
    if (params.limit !== undefined) query.set('limit', String(params.limit));
    if (params.offset !== undefined) query.set('offset', String(params.offset));
    const qs = query.toString();
    return request(`/colorings${qs ? `?${qs}` : ''}`);
  },
  today: () => request('/colorings/today'),
  zones: (id) => request(`/colorings/${id}/zones`),
  favorites: () => request('/colorings/favorites'),
  history: (limit = 20) => request(`/colorings/history?limit=${encodeURIComponent(limit)}`),
  setFavorite: (id, favorite) => request(`/colorings/${id}/favorite`, { method: favorite ? 'PUT' : 'DELETE' }),
  recommendations: (limit = 8) => request(`/colorings/recommendations?limit=${encodeURIComponent(limit)}`),
};

export const unlocksApi = {
  me: () => request('/unlocks/me'),
  collection: (id) => request(`/unlocks/collections/${encodeURIComponent(id)}`),
  template: (id) => request(`/unlocks/templates/${encodeURIComponent(id)}`),
};

export const telegramStarsApi = {
  config: () => request('/payments/telegram-stars/config'),
  createOrder: (productId, idempotencyKey) => request('/payments/telegram-stars/orders', {
    method: 'POST',
    body: { product_id: productId },
    headers: idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {},
  }),
  order: (orderId) => request(`/payments/telegram-stars/orders/${encodeURIComponent(orderId)}`),
  support: (body, idempotencyKey) => request('/payments/telegram-stars/support', {
    method: 'POST',
    body,
    headers: idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {},
  }),
};

export const directorApi = {
  next: ({ exclude = null } = {}) => {
    const query = new URLSearchParams();
    if (exclude) query.set('exclude', String(exclude).slice(0, 100));
    const qs = query.toString();
    return request(`/director/next${qs ? `?${qs}` : ''}`);
  },
};

/**
 * A 403 direct-ID response from the server carries a stable `code` and an
 * `unlock` payload. The player uses this to render a real locked-state screen
 * instead of a generic request failure.
 */
export function parseUnlockLockedError(error) {
  if (!error || error.status !== 403) return null;
  const data = error.data && typeof error.data === 'object' ? error.data : {};
  if (data.unlock && typeof data.unlock === 'object' && data.unlock.state) return data.unlock;
  if (data.subject_type && data.state) return data;
  return null;
}

export const creatorCollectionsApi = {
  mine: () => request('/collections/mine'),
  get: (id) => request(`/collections/${encodeURIComponent(id)}`),
  create: (payload) => request('/collections', { method: 'POST', body: payload }),
  update: (id, payload) => request(`/collections/${encodeURIComponent(id)}`, { method: 'PATCH', body: payload }),
  archive: (id) => request(`/collections/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  addTemplate: (id, templateId, position) => request(`/collections/${encodeURIComponent(id)}/templates`, {
    method: 'POST',
    body: { template_id: templateId, ...(position === undefined ? {} : { position }) },
  }),
  removeTemplate: (id, templateId) => request(`/collections/${encodeURIComponent(id)}/templates/${encodeURIComponent(templateId)}`, { method: 'DELETE' }),
};
