export function getTelegramWebApp() {
  return window.Telegram?.WebApp ?? null;
}

/**
 * WebApp API version that introduced vertical swipe control
 * (`isVerticalSwipesEnabled`, `enableVerticalSwipes`, `disableVerticalSwipes`).
 */
export const TELEGRAM_SWIPE_CONTROL_VERSION = '7.7';

/** Compares dotted Telegram WebApp versions; returns -1, 0, or 1. */
export function compareTelegramVersions(left, right) {
  const parts = (value) => String(value ?? '').split('.').map((part) => {
    const parsed = Number.parseInt(part, 10);
    return Number.isNaN(parsed) ? 0 : parsed;
  });
  const a = parts(left);
  const b = parts(right);
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    const diff = (a[index] || 0) - (b[index] || 0);
    if (diff !== 0) return diff > 0 ? 1 : -1;
  }
  return 0;
}

export function isTelegramVersionAtLeast(version, minimum = TELEGRAM_SWIPE_CONTROL_VERSION) {
  return compareTelegramVersions(version, minimum) >= 0;
}

export function isRealTelegramSession(webApp = getTelegramWebApp()) {
  return Boolean(webApp && String(webApp.initData || '').trim());
}

/**
 * Reports whether this WebApp can disable the vertical swipe-to-close gesture.
 * Prefers Telegram's own `isVersionAtLeast` capability check and falls back to
 * comparing `version` when the capability helper is unavailable or throws.
 */
export function supportsTelegramVerticalSwipes(webApp = getTelegramWebApp()) {
  if (!webApp) return false;
  let versionSupported = false;
  if (typeof webApp.isVersionAtLeast === 'function') {
    try {
      versionSupported = Boolean(webApp.isVersionAtLeast(TELEGRAM_SWIPE_CONTROL_VERSION));
    } catch {
      versionSupported = false;
    }
  }
  if (!versionSupported) {
    versionSupported = isTelegramVersionAtLeast(webApp.version, TELEGRAM_SWIPE_CONTROL_VERSION);
  }
  return versionSupported
    && typeof webApp.disableVerticalSwipes === 'function'
    && typeof webApp.enableVerticalSwipes === 'function';
}

/** Disables Telegram vertical swipe-to-close gestures when supported. */
export function disableTelegramVerticalSwipes(webApp = getTelegramWebApp()) {
  if (!supportsTelegramVerticalSwipes(webApp)) return false;
  try {
    webApp.disableVerticalSwipes();
    return true;
  } catch {
    return false;
  }
}

/** Re-enables Telegram vertical swipe-to-close gestures when supported. */
export function enableTelegramVerticalSwipes(webApp = getTelegramWebApp()) {
  if (!supportsTelegramVerticalSwipes(webApp)) return false;
  try {
    webApp.enableVerticalSwipes();
    return true;
  } catch {
    return false;
  }
}

const SWIPE_PROTECTION_ATTR = 'data-tg-swipe-protected';

/**
 * Observes the last known Telegram vertical-swipe state. If the official
 * bridge accepted a call but still reports swipes enabled, the protection is
 * uncertain rather than claimed.
 */
export function getTelegramVerticalSwipeStatus(webApp = getTelegramWebApp()) {
  const apiSupported = supportsTelegramVerticalSwipes(webApp);
  const previousState = webApp?.isVerticalSwipesEnabled == null
    ? null
    : Boolean(webApp.isVerticalSwipesEnabled);
  const currentState = webApp?.isVerticalSwipesEnabled == null
    ? null
    : Boolean(webApp.isVerticalSwipesEnabled);
  const fallbackApplied = typeof document !== 'undefined'
    && document.documentElement.hasAttribute(SWIPE_PROTECTION_ATTR);
  let protectionApplied = fallbackApplied;
  let uncertain = false;
  if (apiSupported && currentState === false) protectionApplied = true;
  if (apiSupported && currentState === true) uncertain = true;
  return {
    apiSupported,
    fallbackApplied,
    previousState,
    currentState,
    protectionApplied,
    uncertain,
  };
}

/**
 * Binds lifecycle-scoped Telegram vertical swipe protection. Disables swipes
 * while the returned cleanup is pending and restores the previous state on
 * leave. Older WebApp versions get a CSS overscroll fallback only in a real
 * Telegram session, so normal browser SDK stubs do not globally alter
 * overscroll. The protection applies regardless of Telegram's fullscreen mode.
 */
export function bindTelegramVerticalSwipes(webApp = getTelegramWebApp()) {
  const wasEnabled = webApp?.isVerticalSwipesEnabled !== false;
  const officialApplied = disableTelegramVerticalSwipes(webApp);
  let fallbackApplied = false;
  if (!officialApplied && webApp && isRealTelegramSession(webApp) && typeof document !== 'undefined') {
    document.documentElement.setAttribute(SWIPE_PROTECTION_ATTR, 'true');
    fallbackApplied = true;
  }
  return () => {
    if (fallbackApplied && typeof document !== 'undefined') {
      document.documentElement.removeAttribute(SWIPE_PROTECTION_ATTR);
    }
    if (wasEnabled) enableTelegramVerticalSwipes(webApp);
  };
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

function buildAppDeepLink(params) {
  const base = `${window.location.origin}${window.location.pathname}`;
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params || {})) {
    if (value === null || value === undefined || value === '') continue;
    query.set(key, String(value));
  }
  return `${base}${query.toString() ? `?${query.toString()}` : ''}`;
}

/** Returns a deep link that re-opens this Mini App on a specific artwork. */
export function buildColoringDeepLink(coloringId, { packId = null } = {}) {
  return buildAppDeepLink({ coloring: coloringId, pack: packId });
}

// Artwork terminology is useful for result/share surfaces while preserving
// the original coloring helper for existing callers.
export const buildArtworkDeepLink = buildColoringDeepLink;

/** Returns a deep link that opens the bounded showcase/store on one pack. */
export function buildPackDeepLink(packId) {
  return buildAppDeepLink({ pack: packId });
}

/** Builds either an artwork or pack link for a Telegram share object. */
export function buildResultDeepLink({ artworkId = null, coloringId = null, packId = null } = {}) {
  if (artworkId || coloringId) return buildColoringDeepLink(artworkId || coloringId, { packId });
  return buildPackDeepLink(packId);
}

/** Reads the coloring id requested via `?coloring=`/`?coloringId=` or Telegram start param. */
export function getRequestedColoringId() {
  const query = new URLSearchParams(window.location.search);
  const fromQuery = query.get('coloring') || query.get('coloringId');
  if (fromQuery) return fromQuery;
  const startParam = getTelegramWebApp()?.initDataUnsafe?.start_param;
  if (startParam?.startsWith('coloring_')) return startParam.slice('coloring_'.length);
  return null;
}

/** Reads the pack id requested via `?pack=` or Telegram start param. */
export function getRequestedPackId() {
  const fromQuery = new URLSearchParams(window.location.search).get('pack');
  if (fromQuery) return fromQuery;
  const startParam = getTelegramWebApp()?.initDataUnsafe?.start_param;
  if (startParam?.startsWith('pack_')) return startParam.slice('pack_'.length);
  return null;
}
