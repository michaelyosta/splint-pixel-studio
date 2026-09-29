import { useCallback, useState } from 'react';

export const FIRST_RUN_GUIDE_STORAGE_KEY = 'splint:first-run-guide:v1';
const DISMISSED_VALUE = 'dismissed';

function readDismissed() {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return false;
    return window.localStorage.getItem(FIRST_RUN_GUIDE_STORAGE_KEY) === DISMISSED_VALUE;
  } catch {
    return false;
  }
}

export function useFirstRunGuide() {
  const [dismissed, setDismissed] = useState(readDismissed);
  const dismissGuide = useCallback(() => {
    try {
      window.localStorage.setItem(FIRST_RUN_GUIDE_STORAGE_KEY, DISMISSED_VALUE);
    } catch {
      // Restricted storage (Telegram WebView privacy modes) is valid: the
      // guide simply shows again next cold start instead of crashing.
    }
    setDismissed(true);
  }, []);
  return { guideVisible: !dismissed, dismissGuide };
}