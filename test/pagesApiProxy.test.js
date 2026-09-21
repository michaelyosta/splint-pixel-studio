import test from 'node:test';
import assert from 'node:assert/strict';
import { buildUpstreamHeaders, buildUpstreamUrl, onRequest } from '../functions/api/[[path]].js';

test('same-origin /api paths are rewritten onto the API origin', () => {
  assert.equal(
    buildUpstreamUrl('https://pixel.showalove.ru/api/auth/telegram/start?x=1').toString(),
    'https://splint-api.onrender.com/auth/telegram/start?x=1',
  );
  assert.equal(
    buildUpstreamUrl('https://pixel.showalove.ru/api/colorings?q=1&sort=new').toString(),
    'https://splint-api.onrender.com/colorings?q=1&sort=new',
  );
  assert.equal(
    buildUpstreamUrl('https://pixel.showalove.ru/api/auth/telegram/callback?code=abc&state=def').toString(),
    'https://splint-api.onrender.com/auth/telegram/callback?code=abc&state=def',
  );
});

test('proxy headers forward the real client address and drop the page host', () => {
  const request = new Request('https://pixel.showalove.ru/api/auth/session', {
    headers: {
      host: 'pixel.showalove.ru',
      'cf-connecting-ip': '203.0.113.7',
      cookie: 'splint_session=opaque',
    },
  });
  const headers = buildUpstreamHeaders(request);
  assert.equal(headers.get('host'), null);
  assert.equal(headers.get('x-forwarded-for'), '203.0.113.7');
  assert.equal(headers.get('x-forwarded-proto'), 'https');
  assert.equal(headers.get('x-forwarded-host'), 'pixel.showalove.ru');
  assert.equal(headers.get('cookie'), 'splint_session=opaque');
});

test('proxy passes upstream redirects, cookies, and JSON through untouched', async (t) => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    const headers = new Headers({
      location: 'https://oauth.telegram.org/auth?client_id=1',
    });
    headers.append('set-cookie', 'splint_session=opaque-session; Path=/; Secure; HttpOnly; SameSite=Lax');
    headers.append('set-cookie', 'splint_csrf=csrf-token; Path=/; Secure; SameSite=Lax');
    headers.append('set-cookie', 'splint_session_oidc_state=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=Lax');
    return new Response(null, { status: 302, headers });
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const response = await onRequest({
    request: new Request('https://pixel.showalove.ru/api/auth/telegram/start', { method: 'GET' }),
  });

  assert.equal(calls[0].url, 'https://splint-api.onrender.com/auth/telegram/start');
  assert.equal(calls[0].options.redirect, 'manual');
  assert.equal(response.status, 302);
  assert.equal(response.headers.get('location'), 'https://oauth.telegram.org/auth?client_id=1');
  const cookies = response.headers.getSetCookie();
  assert.equal(cookies.length, 3, 'proxy must preserve every callback Set-Cookie header');
  assert.match(cookies[0], /splint_session=opaque-session/);
  assert.match(cookies[1], /splint_csrf=csrf-token/);
  assert.match(cookies[2], /splint_session_oidc_state=/);
});

test('proxy forwards request bodies for mutating methods', async (t) => {
  const originalFetch = globalThis.fetch;
  let forwarded = null;
  globalThis.fetch = async (_url, options) => {
    forwarded = options.body ? await new Response(options.body).text() : null;
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const response = await onRequest({
    request: new Request('https://pixel.showalove.ru/api/auth/logout', { method: 'POST', body: '' }),
  });

  assert.equal(response.status, 200);
  assert.equal(forwarded, '');
});

test('proxy fails closed when the upstream is unreachable', async (t) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('network down'); };
  t.after(() => { globalThis.fetch = originalFetch; });

  const response = await onRequest({
    request: new Request('https://pixel.showalove.ru/api/auth/session', { method: 'GET' }),
  });

  assert.equal(response.status, 502);
  const body = await response.json();
  assert.equal(body.code, 'API_PROXY_UPSTREAM_ERROR');
});
