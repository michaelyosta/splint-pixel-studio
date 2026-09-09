function getWindow() {
  return typeof window === 'undefined' ? null : window;
}

function getWebApp() {
  return getWindow()?.Telegram?.WebApp || null;
}

const TELEGRAM_HOST_PLATFORMS = new Set(['ios', 'android', 'tdesktop', 'macos', 'weba', 'webk', 'unigram']);

export function isTelegramHost(webApp = getWebApp()) {
  if (!webApp) return false;
  const initData = String(webApp.initData || '').trim();
  const hostPlatform = String(webApp.platform || '').toLowerCase();
  return Boolean(initData || TELEGRAM_HOST_PLATFORMS.has(hostPlatform));
}

export function getPlatformSnapshot() {
  const webApp = getWebApp();
  const isTelegram = isTelegramHost(webApp);
  const platformName = String(webApp?.platform || '').toLowerCase();
  const width = getWindow()?.innerWidth || 0;
  const height = getWindow()?.innerHeight || 0;
  const inset = webApp?.safeAreaInset || webApp?.contentSafeAreaInset || {};
  const authMode = isTelegram && String(webApp?.initData || '').trim()
    ? 'telegram_init_data'
    : import.meta.env?.VITE_ALLOW_DEV_AUTH === 'true'
      ? 'development'
      : 'anonymous';
  return Object.freeze({
    isTelegram,
    isTelegramIOS: isTelegram && platformName === 'ios',
    isTelegramAndroid: isTelegram && platformName === 'android',
    isTelegramDesktop: isTelegram && ['tdesktop', 'macos', 'weba', 'webk'].includes(platformName),
    isBrowser: !isTelegram,
    viewport: { width, height },
    safeArea: {
      top: Number(inset.top) || 0,
      right: Number(inset.right) || 0,
      bottom: Number(inset.bottom) || 0,
      left: Number(inset.left) || 0,
    },
    authMode,
    canUseHaptics: Boolean(webApp?.HapticFeedback),
    canUseTelegramPayments: Boolean(isTelegram && webApp?.openInvoice),
    canUseTelegramLifecycle: Boolean(isTelegram && webApp?.onEvent),
    canUseShare: Boolean(webApp?.openTelegramLink || getWindow()?.navigator?.share),
  });
}

// This value is only a local-storage namespace hint. Server authorization
// must continue to use signed initData or the server-issued browser session.
export function getTelegramResumeScopeId(currentWindow = getWindow()) {
  const value = currentWindow?.Telegram?.WebApp?.initDataUnsafe?.user?.id;
  return value != null && /^\d+$/.test(String(value)) ? String(value) : null;
}

export function subscribePlatform(listener) {
  const currentWindow = getWindow();
  if (!currentWindow) return () => {};
  const handleResize = () => listener(getPlatformSnapshot());
  currentWindow.addEventListener('resize', handleResize);
  currentWindow.visualViewport?.addEventListener('resize', handleResize);
  return () => {
    currentWindow.removeEventListener('resize', handleResize);
    currentWindow.visualViewport?.removeEventListener('resize', handleResize);
  };
}

export function getPlatform() {
  return getPlatformSnapshot();
}
