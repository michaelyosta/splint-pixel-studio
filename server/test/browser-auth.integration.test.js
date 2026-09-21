import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHmac, createSign, generateKeyPairSync } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPkceChallenge } from '../services/pkce.js';

const apiPort = 31942;
const apiBase = `http://127.0.0.1:${apiPort}`;
const clientId = '987654321';
const clientSecret = 'oidc-test-secret';
const botToken = 'oidc-test-bot-token';

function signJwt(privateKey, claims) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const header = encode({ alg: 'RS256', typ: 'JWT', kid: 'provider-key' });
  const body = encode(claims);
  const input = `${header}.${body}`;
  const signer = createSign('RSA-SHA256');
  signer.update(input);
  signer.end();
  return `${input}.${signer.sign(privateKey).toString('base64url')}`;
}

function buildInitData(user) {
  const params = new URLSearchParams({
    query_id: 'browser-continuity-test',
    user: JSON.stringify(user),
    auth_date: String(Math.floor(Date.now() / 1_000)),
  });
  const data = [...params.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${key}=${value}`).join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest();
  params.set('hash', createHmac('sha256', secret).update(data).digest('hex'));
  return params.toString();
}

async function waitForApi(child) {
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Browser auth API did not start')), 15_000);
    child.stdout.on('data', (chunk) => {
      if (chunk.toString().includes('running on')) {
        clearTimeout(timer);
        resolve();
      }
    });
    child.once('error', reject);
    child.once('exit', (code) => reject(new Error(`Browser auth API exited early (${code})`)));
  });
}

test('browser Telegram OIDC session and Mini App identity are continuous', async (t) => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const publicJwk = { ...publicKey.export({ format: 'jwk' }), kid: 'provider-key', alg: 'RS256', use: 'sig' };
  let expectedCodeChallenge = null;
  let expectedNonce = null;

  const provider = createServer(async (req, res) => {
    if (req.url.startsWith('/.well-known/openid-configuration')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        issuer: provider.issuer,
        authorization_endpoint: `${provider.baseUrl}/authorize`,
        token_endpoint: `${provider.baseUrl}/token`,
        jwks_uri: `${provider.baseUrl}/jwks`,
      }));
      return;
    }
    if (req.url === '/jwks') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ keys: [publicJwk] }));
      return;
    }
    if (req.url === '/token' && req.method === 'POST') {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = new URLSearchParams(Buffer.concat(chunks).toString());
      const challenge = createPkceChallenge(body.get('code_verifier') || '');
      assert.equal(challenge, expectedCodeChallenge);
      assert.equal(body.get('redirect_uri'), `http://127.0.0.1:${apiPort}/auth/telegram/callback`);
      const now = Math.floor(Date.now() / 1_000);
      const idToken = signJwt(privateKey, {
        iss: provider.issuer,
        aud: clientId,
        sub: 'provider-subject-777001',
        iat: now - 2,
        exp: now + 600,
        nonce: expectedNonce,
        id: '777001',
        preferred_username: 'oidc_user',
        name: 'OIDC User',
      });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ token_type: 'Bearer', id_token: idToken }));
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise((resolve) => provider.listen(0, '127.0.0.1', resolve));
  provider.baseUrl = `http://127.0.0.1:${provider.address().port}`;
  provider.issuer = `${provider.baseUrl}/issuer`;
  t.after(() => provider.close());

  const directory = await mkdtemp(join(tmpdir(), 'splint-browser-auth-'));
  const env = {
    ...process.env,
    NODE_ENV: 'test',
    PORT: String(apiPort),
    SQLITE_DB_PATH: join(directory, 'test.db.bin'),
    MEDIA_STORAGE_ROOT: join(directory, 'uploads'),
    TELEGRAM_BOT_TOKEN: botToken,
    TELEGRAM_OIDC_CLIENT_ID: clientId,
    TELEGRAM_OIDC_CLIENT_SECRET: clientSecret,
    TELEGRAM_OIDC_REDIRECT_URI: `${apiBase}/auth/telegram/callback`,
    BROWSER_AUTH_ORIGIN: apiBase,
    TELEGRAM_OIDC_ISSUER: provider.issuer,
    TELEGRAM_OIDC_DISCOVERY_URL: `${provider.baseUrl}/.well-known/openid-configuration`,
  };
  delete env.DATABASE_URL;
  const api = spawn('node', ['index.js'], { cwd: join(import.meta.dirname, '..'), env, stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(async () => {
    api.kill();
    await rm(directory, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
  });
  await waitForApi(api);

  const missing = await fetch(`${apiBase}/auth/session`);
  assert.equal(missing.status, 401);

  const invalidState = await fetch(`${apiBase}/auth/telegram/callback?state=invalid-state&code=unused`);
  assert.equal(invalidState.status, 400);

  const start = await fetch(`${apiBase}/auth/telegram/start`, { redirect: 'manual' });
  assert.equal(start.status, 302);
  const startCookies = start.headers.getSetCookie?.() || [start.headers.get('set-cookie')].filter(Boolean);
  const stateCookie = startCookies.find((value) => value.startsWith('splint_session_oidc_state='))?.split(';', 1)[0];
  assert.ok(stateCookie);
  const authorizationUrl = new URL(start.headers.get('location'));
  const state = authorizationUrl.searchParams.get('state');
  expectedCodeChallenge = authorizationUrl.searchParams.get('code_challenge');
  expectedNonce = authorizationUrl.searchParams.get('nonce');
  assert.equal(authorizationUrl.searchParams.get('code_challenge_method'), 'S256');
  assert.ok(state);

  const mismatchedCallback = await fetch(`${apiBase}/auth/telegram/callback?state=${encodeURIComponent(state)}&code=valid-code`, {
    headers: { Cookie: 'splint_session_oidc_state=attacker-state' },
    redirect: 'manual',
  });
  assert.equal(mismatchedCallback.status, 400);

  const callback = await fetch(`${apiBase}/auth/telegram/callback?state=${encodeURIComponent(state)}&code=valid-code`, { headers: { Cookie: stateCookie }, redirect: 'manual' });
  assert.equal(callback.status, 302);
  const setCookies = callback.headers.getSetCookie?.() || [callback.headers.get('set-cookie')].filter(Boolean);
  const cookie = setCookies.map((value) => value.split(';', 1)[0]).join('; ');
  assert.match(cookie, /splint_session=/);
  assert.match(cookie, /splint_session_csrf=/);

  const session = await fetch(`${apiBase}/auth/session`, { headers: { Cookie: cookie } });
  assert.equal(session.status, 200);
  const sessionJson = await session.json();
  assert.equal(sessionJson.authenticated, true);
  assert.equal(sessionJson.user.id, 'tg_777001');

  const browserMe = await fetch(`${apiBase}/users/me`, { headers: { Cookie: cookie } });
  assert.equal(browserMe.status, 200);
  const browserProfile = await browserMe.json();

  const miniAppMe = await fetch(`${apiBase}/users/me`, { headers: { 'X-Telegram-Init-Data': buildInitData({ id: 777001, username: 'mini_app_name' }) } });
  assert.equal(miniAppMe.status, 200);
  const miniAppProfile = await miniAppMe.json();
  assert.equal(browserProfile.id, miniAppProfile.id);

  const replay = await fetch(`${apiBase}/auth/telegram/callback?state=${encodeURIComponent(state)}&code=valid-code`, { redirect: 'manual' });
  assert.equal(replay.status, 400);

  const csrfMissing = await fetch(`${apiBase}/auth/logout`, { method: 'POST', headers: { Cookie: cookie } });
  assert.equal(csrfMissing.status, 403);
  const csrfToken = sessionJson.csrfToken;
  const logout = await fetch(`${apiBase}/auth/logout`, { method: 'POST', headers: { Cookie: cookie, 'X-CSRF-Token': csrfToken } });
  assert.equal(logout.status, 204);
  const afterLogout = await fetch(`${apiBase}/auth/session`, { headers: { Cookie: cookie } });
  assert.equal(afterLogout.status, 401);
});
