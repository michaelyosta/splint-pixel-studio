import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  authApi,
  bootstrapBrowserSession,
  getBrowserSessionState,
  subscribeBrowserSession,
} from '../api/client.js';
import { getPlatform, subscribePlatform } from '../lib/platform.js';

export function useBrowserAuth() {
  const [platform, setPlatform] = useState(() => getPlatform());
  const [session, setSession] = useState(() => getBrowserSessionState());

  useEffect(() => {
    let cancelled = false;
    bootstrapBrowserSession().then((next) => { if (!cancelled) setSession(next); });
    const unsubscribeSession = subscribeBrowserSession(setSession);
    const unsubscribePlatform = subscribePlatform(setPlatform);
    return () => {
      cancelled = true;
      unsubscribeSession();
      unsubscribePlatform();
    };
  }, []);

  const login = useCallback(() => authApi.login(), []);
  const logout = useCallback(async () => {
    await authApi.logout();
    setSession(getBrowserSessionState());
  }, []);
  const refresh = useCallback(async () => {
    const next = await authApi.session();
    setSession(next);
    return next;
  }, []);

  return useMemo(() => ({
    platform,
    status: session.status,
    user: session.user,
    csrfToken: session.csrfToken,
    expiresAt: session.expiresAt,
    isAuthenticated: platform.isTelegram || session.status === 'authenticated' || session.status === 'development',
    login,
    logout,
    refresh,
  }), [login, logout, platform, refresh, session]);
}
