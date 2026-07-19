const API_BASE = import.meta.env.VITE_API_URL || '/api';

export const DEV_USER_ID = import.meta.env.VITE_DEV_USER_ID || 'user_pixelhunter';

export async function api(path, { method = 'GET', body, userId = DEV_USER_ID, signal } = {}) {
  const telegramInitData = window.Telegram?.WebApp?.initData;
  const response = await fetch(`${API_BASE}${path}`, {
    method,
    signal,
    headers: {
      'Content-Type': 'application/json',
      ...(telegramInitData ? { 'X-Telegram-Init-Data': telegramInitData } : { 'X-User-Id': userId }),
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
