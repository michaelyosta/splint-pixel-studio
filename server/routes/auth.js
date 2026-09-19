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
import { ensureConfiguredAdminOwner } from '../services/admin-acl.js';
import { completeOidcLogin, consumeOidcLoginTransaction, createOidcLoginTransaction, getBrowserAuthConfig } from '../services/telegram-oidc.js';

const router = Router();
const PUBLIC_USER_FIELDS = 'id,nickname,avatar_url,status,karma,level';

const BROWSER_AUTH_UNAVAILABLE_HTML = `<!doctype html>
<html lang="ru">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Splint — вход недоступен</title></head>
<body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#04080e;color:#e8f5fa;font-family:system-ui,sans-serif">
<main style="max-width:420px;padding:28px;text-align:center">
<p style="letter-spacing:.16em;color:#9bb4c2;font-size:12px">SPLINT PIXEL STUDIO</p>
<h1 style="font-size:20px">Вход через Telegram временно недоступен</h1>
<p style="color:#9bb4c2;line-height:1.5">Браузерная авторизация не настроена на сервере. Попробуйте позже или откройте студию в Telegram.</p>
</main>
</body>
</html>`;

function browserAuthAvailable() {
  try { return getBrowserAuthConfig().configured; } catch { return false; }
}

function respondBrowserAuthUnavailable(req, res, event) {
  // Keep the diagnostic in logs/observability while ordinary browser
  // navigations get a product error state instead of raw JSON.
  console.error(JSON.stringify({ type: 'browser_auth_unconfigured', event }));
  if (String(req.headers.accept || '').includes('text/html')) {
    return res.status(503).type('html').send(BROWSER_AUTH_UNAVAILABLE_HTML);
  }
  return res.status(503).json({ error: 'Browser Telegram login is not configured', code: 'BROWSER_AUTH_NOT_CONFIGURED' });
}

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
  const browserAuthEnabled = browserAuthAvailable();
  const session = await getBrowserSession(req);
  if (!session) return res.status(401).json({ authenticated: false, browserAuthEnabled });
  const user = await sessionUser(session.userId);
  const csrfToken = getCsrfCookie(req);
  if (!user || !csrfToken || !verifySessionCsrf(session, csrfToken)) {
    await revokeBrowserSession(req);
    clearSessionCookie(res);
    clearCsrfCookie(res);
    return res.status(401).json({ authenticated: false, browserAuthEnabled });
  }
  return res.json({ authenticated: true, user, csrfToken, expiresAt: session.expiresAt, browserAuthEnabled });
}));

router.get('/telegram/start', asyncRoute(async (req, res) => {
  const config = getBrowserAuthConfig();
  if (!config.configured) return respondBrowserAuthUnavailable(req, res, 'start');
  const transaction = await createOidcLoginTransaction();
  setOidcStateCookie(res, transaction.state);
  return res.redirect(302, transaction.url);
}));

router.get('/telegram/callback', asyncRoute(async (req, res) => {
  const config = getBrowserAuthConfig();
  if (!config.configured) return respondBrowserAuthUnavailable(req, res, 'callback');
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
    await ensureConfiguredAdminOwner({ userId, telegramId: claims.id });
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
