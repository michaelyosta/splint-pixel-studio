import { randomBytes } from 'node:crypto';
import { get, run } from '../db.js';
import { hashSecret } from './auth-session.js';
import { verifyTelegramIdToken, resetOidcJwksCacheForTests } from './telegram-oidc-claims.js';
import { createPkceChallenge, createPkceVerifier } from './pkce.js';

export { verifyTelegramIdToken } from './telegram-oidc-claims.js';

export const TELEGRAM_OIDC_ISSUER = 'https://oauth.telegram.org';
export const TELEGRAM_OIDC_DISCOVERY_URL = `${TELEGRAM_OIDC_ISSUER}/.well-known/openid-configuration`;
const TRANSACTION_TTL_SECONDS = 10 * 60;
let discoveryCache = null;

function parseOrigin(value, { production = false } = {}) {
  let url;
  try { url = new URL(value); } catch { throw new Error('Browser auth origin/redirect URI must be a valid URL'); }
  if (production && url.protocol !== 'https:') throw new Error('Browser auth URLs must use HTTPS in production');
  if (url.username || url.password || url.hash) throw new Error('Browser auth URLs cannot contain credentials or fragments');
  return url;
}

export function getBrowserAuthConfig(env = process.env) {
  const clientId = String(env.TELEGRAM_OIDC_CLIENT_ID || '').trim();
  const clientSecret = String(env.TELEGRAM_OIDC_CLIENT_SECRET || '').trim();
  const redirectUri = String(env.TELEGRAM_OIDC_REDIRECT_URI || '').trim();
  const issuer = String(env.TELEGRAM_OIDC_ISSUER || TELEGRAM_OIDC_ISSUER).trim().replace(/\/$/, '');
  const configured = Boolean(clientId || clientSecret || redirectUri);
  if (!configured) return { configured: false, clientId: '', clientSecret: '', redirectUri: '', issuer, appOrigin: '' };
  if (!clientId || !clientSecret || !redirectUri) throw new Error('TELEGRAM_OIDC_CLIENT_ID, TELEGRAM_OIDC_CLIENT_SECRET, and TELEGRAM_OIDC_REDIRECT_URI must be configured together');
  const production = String(env.NODE_ENV || '').toLowerCase() === 'production';
  if (production && issuer !== TELEGRAM_OIDC_ISSUER) throw new Error('Production browser auth must use the official Telegram OIDC issuer');
  const redirect = parseOrigin(redirectUri, { production });
  const appOrigin = String(env.BROWSER_AUTH_ORIGIN || redirect.origin).trim();
  const appUrl = parseOrigin(appOrigin, { production });
  if (appUrl.origin !== appOrigin) throw new Error('BROWSER_AUTH_ORIGIN must be an exact origin without a path');
  if (redirect.protocol !== appUrl.protocol || redirect.hostname !== appUrl.hostname || redirect.port !== appUrl.port) {
    throw new Error('TELEGRAM_OIDC_REDIRECT_URI must belong to BROWSER_AUTH_ORIGIN');
  }
  const discoveryUrl = String(env.TELEGRAM_OIDC_DISCOVERY_URL || `${issuer}/.well-known/openid-configuration`).trim();
  if (production && discoveryUrl !== TELEGRAM_OIDC_DISCOVERY_URL) {
    throw new Error('Production browser auth must use the official Telegram OIDC discovery URL');
  }
  return {
    configured: true,
    clientId,
    clientSecret,
    redirectUri: redirect.href,
    issuer,
    appOrigin: appUrl.origin,
    discoveryUrl,
  };
}

export { createPkceChallenge, createPkceVerifier } from './pkce.js';

async function discover(config) {
  const now = Date.now();
  if (discoveryCache && discoveryCache.url === config.discoveryUrl && discoveryCache.expiresAt > now) return discoveryCache.document;
  const response = await fetch(config.discoveryUrl, { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`Telegram OIDC discovery failed (${response.status})`);
  const document = await response.json();
  if (document.issuer !== config.issuer) throw new Error('Telegram OIDC discovery issuer mismatch');
  if (!document.authorization_endpoint || !document.token_endpoint || !document.jwks_uri) throw new Error('Telegram OIDC discovery document is incomplete');
  discoveryCache = { url: config.discoveryUrl, document, expiresAt: now + 5 * 60_000 };
  return document;
}

export async function createOidcLoginTransaction() {
  const config = getBrowserAuthConfig();
  if (!config.configured) return null;
  const provider = await discover(config);
  const state = randomBytes(32).toString('base64url');
  const codeVerifier = createPkceVerifier();
  const nonce = randomBytes(32).toString('base64url');
  const now = new Date();
  const expires = new Date(now.getTime() + TRANSACTION_TTL_SECONDS * 1_000);
  await run(`INSERT INTO auth_login_transactions (state_hash,code_verifier,nonce,redirect_uri,expires_at,created_at)
    VALUES (?,?,?,?,?,?)`, [hashSecret(state), codeVerifier, nonce, config.redirectUri, expires.toISOString(), now.toISOString()]);
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: 'code',
    scope: 'openid profile',
    state,
    nonce,
    code_challenge: createPkceChallenge(codeVerifier),
    code_challenge_method: 'S256',
  });
  return { state, url: `${provider.authorization_endpoint}?${params.toString()}`, config, provider };
}

export async function consumeOidcLoginTransaction(state) {
  const value = String(state || '').trim();
  if (!/^[A-Za-z0-9_-]{32,128}$/.test(value)) return null;
  const row = await get('SELECT state_hash,code_verifier,nonce,redirect_uri,expires_at FROM auth_login_transactions WHERE state_hash=?', [hashSecret(value)]);
  // State is single-use even if the provider callback is malformed.
  if (row) await run('DELETE FROM auth_login_transactions WHERE state_hash=?', [row.state_hash]);
  if (!row || new Date(row.expires_at).getTime() <= Date.now()) return null;
  return row;
}

async function exchangeCode(code, transaction, provider, config) {
  const credentials = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64');
  const response = await fetch(provider.token_endpoint, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${credentials}`,
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code: String(code),
      redirect_uri: transaction.redirect_uri,
      code_verifier: transaction.code_verifier,
    }),
  });
  if (!response.ok) throw new Error(`Telegram OIDC token exchange failed (${response.status})`);
  const tokens = await response.json();
  if (!tokens.id_token) throw new Error('Telegram OIDC response did not include an id_token');
  return tokens;
}

export async function completeOidcLogin({ code, transaction }) {
  const config = getBrowserAuthConfig();
  if (!config.configured) throw new Error('Browser Telegram login is not configured');
  const provider = await discover(config);
  const tokens = await exchangeCode(code, transaction, provider, config);
  const claims = await verifyTelegramIdToken(tokens.id_token, {
    issuer: config.issuer,
    audience: config.clientId,
    jwksUrl: provider.jwks_uri,
    nonce: transaction.nonce,
  });
  return { claims, config };
}

export function resetOidcCachesForTests() {
  discoveryCache = null;
  resetOidcJwksCacheForTests();
}
