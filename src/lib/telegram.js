export function getTelegramWebApp() {
  return window.Telegram?.WebApp ?? null;
}

export function initializeTelegramWebApp() {
  const webApp = getTelegramWebApp();
  webApp?.ready();
  return webApp;
}
