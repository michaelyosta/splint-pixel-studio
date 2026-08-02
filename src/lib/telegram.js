export function getTelegramWebApp() {
  return window.Telegram?.WebApp ?? null;
}

export function initializeTelegramWebApp() {
  const webApp = getTelegramWebApp();
  if (!webApp) return null;
  webApp.ready();
  // Ask Telegram for the full viewport height right away so the studio
  // never renders in the collapsed in-app window.
  try { webApp.expand?.(); } catch { /* older clients */ }
  applyTelegramTheme(webApp);
  try { webApp.onEvent?.('themeChanged', () => applyTelegramTheme(webApp)); } catch { /* optional */ }
  return webApp;
}

/**
 * Mirrors the Telegram color scheme onto the document root so CSS can swap
 * the design tokens (see `[data-theme='light']` in index.css).
 */
export function applyTelegramTheme(webApp = getTelegramWebApp()) {
  // Outside a real Telegram session the web-app stub reports a default
  // ('light') scheme — keep the studio's own dark theme there.
  const isRealSession = Boolean(webApp?.initData?.trim());
  const scheme = isRealSession ? webApp?.colorScheme : null;
  if (scheme === 'light' || scheme === 'dark') {
    document.documentElement.dataset.tgTheme = scheme;
  } else {
    delete document.documentElement.dataset.tgTheme;
  }
  const headerColor = webApp?.themeParams?.bg_color;
  if (headerColor && webApp?.setHeaderColor) {
    try { webApp.setHeaderColor(headerColor); } catch { /* unsupported */ }
  }
}

export function hapticImpact(style = 'light') {
  try { getTelegramWebApp()?.HapticFeedback?.impactOccurred?.(style); } catch { /* optional */ }
}

export function hapticSelection() {
  try { getTelegramWebApp()?.HapticFeedback?.selectionChanged?.(); } catch { /* optional */ }
}

/**
 * Shows the native Telegram back button while `onBack` is relevant and
 * restores the previous state on cleanup. Returns a cleanup function.
 */
export function bindTelegramBackButton(onBack) {
  const backButton = getTelegramWebApp()?.BackButton;
  if (!backButton) return () => {};
  try {
    backButton.onClick(onBack);
    backButton.show();
  } catch {
    return () => {};
  }
  return () => {
    try {
      backButton.offClick(onBack);
      backButton.hide();
    } catch { /* optional */ }
  };
}

/**
 * Shares a URL through the Telegram share sheet when inside the Mini App,
 * falling back to the Web Share API and finally to `null` so the caller can
 * use its own last resort (e.g. download).
 */
export async function shareViaTelegram({ url, text }) {
  const webApp = getTelegramWebApp();
  const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`;
  if (webApp?.openTelegramLink) {
    try {
      webApp.openTelegramLink(shareUrl);
      return 'telegram';
    } catch { /* fall through */ }
  }
  if (typeof navigator.share === 'function') {
    await navigator.share({ title: text, text, url });
    return 'native';
  }
  return null;
}

/** Returns a deep link that re-opens this Mini App on a specific coloring. */
export function buildColoringDeepLink(coloringId) {
  const base = `${window.location.origin}${window.location.pathname}`;
  return `${base}?coloring=${encodeURIComponent(coloringId)}`;
}

/** Reads the coloring id requested via `?coloring=` or Telegram start param. */
export function getRequestedColoringId() {
  const fromQuery = new URLSearchParams(window.location.search).get('coloring');
  if (fromQuery) return fromQuery;
  const startParam = getTelegramWebApp()?.initDataUnsafe?.start_param;
  if (startParam?.startsWith('coloring_')) return startParam.slice('coloring_'.length);
  return null;
}
