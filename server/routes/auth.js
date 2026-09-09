import { Router } from 'express';
import { get } from '../db.js';
import { asyncRoute } from '../middleware/asyncRoute.js';
import {
  clearCsrfCookie,
  clearSessionCookie,
  createBrowserSession,
  getBrowserSession,
  getCsrfCookie,
  getOidcStateCookie,
  revokeBrowserSession,
  setCsrfCookie,
  setOidcStateCookie,
  setSessionCookie,
  clearOidcStateCookie,
  verifySessionCsrf,
} from '../services/auth-session.js';
import { ensureTelegramUser } from '../services/identity.js';
import { completeOidcLogin, consumeOidcLoginTransaction, createOidcLoginTransaction, getBrowserAuthConfig } from '../services/telegram-oidc.js';

const router = Router();
const PUBLIC_USER_FIELDS = 'id,nickname,avatar_url,status,karma,level';

async function sessionUser(userId) {
  return get(`SELECT ${PUBLIC_USER_FIELDS} FROM users WHERE id=?`, [userId]);
}

function safeCallbackUrl(config, params = {}) {
  const url = new URL(config.appOrigin);
  for (const [key, value] of Object.entries(params)) {
    if (value) url.searchParams.set(key, String(value).slice(0, 100));
  }
  return url.href;
}

router.get('/session', asyncRoute(async (req, res) => {
  const session = await getBrowserSession(req);
  if (!session) return res.status(401).json({ authenticated: false });
  const user = await sessionUser(session.userId);
  const csrfToken = getCsrfCookie(req);
  if (!user || !csrfToken || !verifySessionCsrf(session, csrfToken)) {
    await revokeBrowserSession(req);
    clearSessionCookie(res);
    clearCsrfCookie(res);
    return res.status(401).json({ authenticated: false });
  }
  return res.json({ authenticated: true, user, csrfToken, expiresAt: session.expiresAt });
}));

router.get('/telegram/start', asyncRoute(async (_req, res) => {
  const config = getBrowserAuthConfig();
  if (!config.configured) return res.status(503).json({ error: 'Browser Telegram login is not configured', code: 'BROWSER_AUTH_NOT_CONFIGURED' });
  const transaction = await createOidcLoginTransaction();
  setOidcStateCookie(res, transaction.state);
  return res.redirect(302, transaction.url);
}));

router.get('/telegram/callback', asyncRoute(async (req, res) => {
  const config = getBrowserAuthConfig();
  if (!config.configured) return res.status(503).json({ error: 'Browser Telegram login is not configured', code: 'BROWSER_AUTH_NOT_CONFIGURED' });
  const requestState = String(req.query.state || '');
  const boundState = getOidcStateCookie(req);
  if (!boundState || boundState !== requestState) {
    return res.status(400).json({ error: 'Invalid or expired login state', code: 'OIDC_STATE_INVALID' });
  }
  const transaction = await consumeOidcLoginTransaction(requestState);
  clearOidcStateCookie(res);
  if (!transaction) return res.status(400).json({ error: 'Invalid or expired login state', code: 'OIDC_STATE_INVALID' });
  if (req.query.error) return res.redirect(302, safeCallbackUrl(config, { auth_error: 'telegram_denied' }));

  try {
    const { claims } = await completeOidcLogin({ code: req.query.code, transaction });
    const userId = await ensureTelegramUser({
      id: claims.id,
      preferred_username: claims.preferred_username,
      name: claims.name,
      picture: claims.picture,
    });
    const session = await createBrowserSession(userId);
    setSessionCookie(res, session.token);
    setCsrfCookie(res, session.csrfToken);
    return res.redirect(302, safeCallbackUrl(config, { auth: 'success' }));
  } catch (error) {
    console.error(JSON.stringify({ type: 'browser_auth_failure', error_class: error.name || 'Error' }));
    return res.redirect(302, safeCallbackUrl(config, { auth_error: 'telegram_verification_failed' }));
  }
}));

router.post('/logout', asyncRoute(async (req, res) => {
  const session = await getBrowserSession(req);
  if (session && !verifySessionCsrf(session, req.headers['x-csrf-token'])) {
    return res.status(403).json({ error: 'CSRF token required', code: 'CSRF_REQUIRED' });
  }
  await revokeBrowserSession(req);
  clearSessionCookie(res);
  clearCsrfCookie(res);
  return res.status(204).end();
}));

export default router;
