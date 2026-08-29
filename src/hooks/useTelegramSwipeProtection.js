import { useEffect } from 'react';
import { bindTelegramVerticalSwipes } from '../lib/telegram';

/**
 * Keeps Telegram's vertical swipe-to-close gesture disabled while the current
 * screen is mounted and restores the previous state on unmount.
 */
export function useTelegramSwipeProtection(active = true) {
  useEffect(() => {
    if (!active) return undefined;
    return bindTelegramVerticalSwipes();
  }, [active]);
}

export default useTelegramSwipeProtection;
