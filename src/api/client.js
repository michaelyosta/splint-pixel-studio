const API_BASE = import.meta.env.VITE_API_URL || '/api';

export const DEV_USER_ID = import.meta.env.VITE_DEV_USER_ID || 'user_pixelhunter';

async function request(path, { method = 'GET', body, userId = DEV_USER_ID, signal } = {}) {
  const telegramInitData = window.Telegram?.WebApp?.initData?.trim();
  const allowDevAuth = import.meta.env.VITE_ALLOW_DEV_AUTH === 'true';

  const authHeaders = telegramInitData
    ? { 'X-Telegram-Init-Data': telegramInitData }
    : allowDevAuth
      ? { 'X-User-Id': userId }
      : {};

  const response = await fetch(`${API_BASE}${path}`, {
    method,
    signal,
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders,
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

export const api = request;

export const metaApi = {
  streak: () => request('/meta/streak'),
  touchStreak: () => request('/meta/streak/touch', { method: 'POST' }),
  achievements: () => request('/meta/achievements'),
  unlockAchievement: (id) => request(`/meta/achievements/${id}/unlock`, { method: 'POST' }),
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
    const qs = query.toString();
    return request(`/colorings${qs ? `?${qs}` : ''}`);
  },
  today: () => request('/colorings/today'),
  zones: (id) => request(`/colorings/${id}/zones`),
};
