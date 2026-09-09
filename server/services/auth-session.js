import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { get, run } from '../db.js';

export const SESSION_COOKIE_NAME = process.env.SESSION_COOKIE_NAME || 'splint_session';
export const CSRF_COOKIE_NAME = `${SESSION_COOKIE_NAME}_csrf`;
export const OIDC_STATE_COOKIE_NAME = `${SESSION_COOKIE_NAME}_oidc_state`;
const DEFAULT_SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;
const MIN_SESSION_TTL_SECONDS = 60 * 60;
const MAX_SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;

function sessionTtlSeconds() {
  const configured = Number(process.env.SESSION_TTL_SECONDS || DEFAULT_SESSION_TTL_SECONDS);
  if (!Number.isFinite(configured)) return DEFAULT_SESSION_TTL_SECONDS;
  return Math.min(MAX_SESSION_TTL_SECONDS, Math.max(MIN_SESSION_TTL_SECONDS, Math.floor(configured)));
}

export function hashSecret(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

function equalSecret(left, right) {
  if (!left || !right) return false;
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  return a.length === b.length && timingSafeEqual(a, b);
}

export function parseCookies(header = '') {
  return String(header).split(';').reduce((cookies, part) => {
    const separator = part.indexOf('=');
    if (separator <= 0) return cookies;
    const name = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    try { cookies[name] = decodeURIComponent(value); } catch { cookies[name] = value; }
    return cookies;
  }, {});
}

function cookieOptions({ maxAge = sessionTtlSeconds() } = {}) {
  const secure = String(process.env.NODE_ENV || '').toLowerCase() === 'production';
  return `Path=/; Max-Age=${Math.max(0, Math.floor(maxAge))}; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`;
}

function csrfCookieOptions({ maxAge = sessionTtlSeconds() } = {}) {
  const secure = String(process.env.NODE_ENV || '').toLowerCase() === 'production';
  return `Path=/; Max-Age=${Math.max(0, Math.floor(maxAge))}; SameSite=Lax${secure ? '; Secure' : ''}`;
}

export function setSessionCookie(res, token, options) {
  res.setHeader('Set-Cookie', `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}; ${cookieOptions(options)}`);
}

export function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${SESSION_COOKIE_NAME}=; ${cookieOptions({ maxAge: 0 })}`);
}

export function setCsrfCookie(res, token, options) {
  res.append('Set-Cookie', `${CSRF_COOKIE_NAME}=${encodeURIComponent(token)}; ${csrfCookieOptions(options)}`);
}

export function clearCsrfCookie(res) {
  res.append('Set-Cookie', `${CSRF_COOKIE_NAME}=; ${csrfCookieOptions({ maxAge: 0 })}`);
}

export function setOidcStateCookie(res, state) {
  res.append('Set-Cookie', `${OIDC_STATE_COOKIE_NAME}=${encodeURIComponent(state)}; ${cookieOptions({ maxAge: 10 * 60 })}`);
}

export function clearOidcStateCookie(res) {
  res.append('Set-Cookie', `${OIDC_STATE_COOKIE_NAME}=; ${cookieOptions({ maxAge: 0 })}`);
}

export function getOidcStateCookie(req) {
  return parseCookies(req.headers.cookie || '')[OIDC_STATE_COOKIE_NAME] || null;
}

export function getCsrfCookie(req) {
  return parseCookies(req.headers.cookie || '')[CSRF_COOKIE_NAME] || null;
}

export async function createBrowserSession(userId) {
  const token = randomBytes(32).toString('base64url');
  const csrfToken = randomBytes(32).toString('base64url');
  const id = randomBytes(16).toString('hex');
  const now = new Date();
  const expires = new Date(now.getTime() + sessionTtlSeconds() * 1_000);
  await run(`INSERT INTO auth_sessions (id,user_id,token_hash,csrf_token_hash,expires_at,created_at,last_seen_at)
    VALUES (?,?,?,?,?,?,?)`, [id, userId, hashSecret(token), hashSecret(csrfToken), expires.toISOString(), now.toISOString(), now.toISOString()]);
  return { id, userId, token, csrfToken, expiresAt: expires.toISOString() };
}

export async function getBrowserSession(req) {
  const token = parseCookies(req.headers.cookie || '')[SESSION_COOKIE_NAME];
  if (!token || token.length > 256) return null;
  const session = await get(`SELECT id,user_id,token_hash,csrf_token_hash,expires_at FROM auth_sessions WHERE token_hash=?`, [hashSecret(token)]);
  if (!session || new Date(session.expires_at).getTime() <= Date.now()) {
    if (session) await run('DELETE FROM auth_sessions WHERE id=?', [session.id]);
    return null;
  }
  // Do not write on every request; this timestamp is a bounded activity hint.
  await run('UPDATE auth_sessions SET last_seen_at=? WHERE id=?', [new Date().toISOString(), session.id]);
  return {
    id: session.id,
    userId: session.user_id,
    csrfTokenHash: session.csrf_token_hash,
    expiresAt: session.expires_at,
  };
}

export function verifySessionCsrf(session, csrfToken) {
  return Boolean(session?.csrfTokenHash && csrfToken && equalSecret(session.csrfTokenHash, hashSecret(csrfToken)));
}

export async function revokeBrowserSession(req) {
  const token = parseCookies(req.headers.cookie || '')[SESSION_COOKIE_NAME];
  if (token) await run('DELETE FROM auth_sessions WHERE token_hash=?', [hashSecret(token)]);
}

export async function deleteExpiredAuthState() {
  const now = new Date().toISOString();
  await run('DELETE FROM auth_sessions WHERE expires_at<=?', [now]);
  await run('DELETE FROM auth_login_transactions WHERE expires_at<=?', [now]);
}
