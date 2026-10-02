import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { probeOperations, renderHuman, renderSummaryMarkdown } from '../scripts/ops-probe.mjs';

const BUNDLE_WITH_API = (apiOrigin) => `console.log("api ${apiOrigin}/live");`;
const HOME_HTML = (scripts) => `<!doctype html><html lang="ru"><head><title>Splint Pixel Studio test</title>${
  scripts.map((src) => `<script type="module" src="${src}"></script>`).join('')
}</head><body><div id="root"></div></body></html>`;

function startStub(getState) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const state = getState();
    if (url.pathname === '/') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(state.homeHtml);
      return;
    }
    if (url.pathname === '/assets/app.js') {
      if (state.asset404) {
        res.writeHead(404, { 'content-type': 'text/plain' });
        res.end('not found');
        return;
      }
      res.writeHead(200, { 'content-type': 'text/javascript' });
      res.end(state.bundleJs);
      return;
    }
    if (url.pathname === '/live') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ status: 'alive' }));
      return;
    }
    if (url.pathname === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', timestamp: state.healthTimestamp || new Date().toISOString() }));
      return;
    }
    if (url.pathname === '/ready') {
      if (state.hangReady) return;
      res.writeHead(state.readyStatus, { 'content-type': 'application/json' });
      res.end(JSON.stringify(state.readyPayload));
      return;
    }
    if (url.pathname === '/metrics') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ uptime_s: 1 }));
      return;
    }
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found');
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve({
        origin: `http://127.0.0.1:${address.port}`,
        close: () => new Promise((done) => server.close(done)),
      });
    });
  });
}

function healthyState(origin) {
  return {
    homeHtml: HOME_HTML(['/assets/app.js', 'https://telegram.org/js/telegram-web-app.js']),
    bundleJs: BUNDLE_WITH_API(origin),
    readyStatus: 200,
    readyPayload: {
      ready: true,
      checks: { database: 'ok', object_storage: 'ok', configuration: 'ok' },
    },
  };
}

async function withStub(stateInit, run) {
  const box = { state: null };
  const stub = await startStub(() => box.state);
  try {
    box.state = stateInit(stub.origin);
    const probe = (overrides = {}) => probeOperations({
      frontendOrigin: stub.origin,
      apiOrigin: stub.origin,
      expectedApiOrigin: stub.origin,
      timeoutMs: 3000,
      ...overrides,
    });
    await run({ stub, box, probe });
  } finally {
    await stub.close();
  }
}

function checkByName(result, name) {
  const found = result.checks.find((check) => check.name === name);
  assert.ok(found, `missing check ${name}`);
  return found;
}

const ALL_CHECKS = ['frontend-home', 'frontend-assets', 'api-binding', 'api-live', 'api-health', 'api-ready', 'api-metrics'];

test('full success across frontend, binding and backend checks', async () => {
  await withStub((origin) => healthyState(origin), async ({ probe }) => {
    const result = await probe();
    assert.equal(result.ok, true);
    for (const name of ALL_CHECKS) assert.equal(checkByName(result, name).ok, true, name);
  });
});

test('timeout on a hanging ready endpoint fails closed', async () => {
  await withStub(
    (origin) => ({ ...healthyState(origin), hangReady: true }),
    async ({ probe }) => {
      const result = await probe({ timeoutMs: 300 });
      assert.equal(result.ok, false);
      assert.match(checkByName(result, 'api-ready').detail, /timeout/);
    },
  );
});

test('http error on ready fails the probe', async () => {
  await withStub(
    (origin) => ({
      ...healthyState(origin),
      readyStatus: 500,
      readyPayload: { ready: false, checks: { database: 'error', object_storage: 'ok', configuration: 'ok' } },
    }),
    async ({ probe }) => {
      const result = await probe();
      assert.equal(result.ok, false);
      assert.match(checkByName(result, 'api-ready').detail, /http-500/);
    },
  );
});

test('ready without strict checks fails schema', async () => {
  await withStub(
    (origin) => ({ ...healthyState(origin), readyPayload: { ready: true } }),
    async ({ probe }) => {
      const result = await probe();
      assert.equal(result.ok, false);
      assert.equal(checkByName(result, 'api-ready').ok, false);
    },
  );
});

test('development configuration never satisfies production readiness', async () => {
  await withStub(
    (origin) => ({
      ...healthyState(origin),
      readyPayload: { ready: true, checks: { database: 'ok', object_storage: 'ok', configuration: 'development' } },
    }),
    async ({ probe }) => {
      const result = await probe();
      assert.equal(result.ok, false);
      assert.match(checkByName(result, 'api-ready').detail, /configuration/);
    },
  );
});

test('unready 503 fails with reason', async () => {
  await withStub(
    (origin) => ({
      ...healthyState(origin),
      readyStatus: 503,
      readyPayload: { ready: false, checks: { database: 'error', object_storage: 'ok', configuration: 'ok' } },
    }),
    async ({ probe }) => {
      const result = await probe();
      assert.equal(result.ok, false);
      assert.match(checkByName(result, 'api-ready').detail, /unready/);
    },
  );
});

test('missing bundle asset fails frontend-assets', async () => {
  await withStub(
    (origin) => ({ ...healthyState(origin), asset404: true }),
    async ({ probe }) => {
      const result = await probe();
      assert.equal(result.ok, false);
      assert.match(checkByName(result, 'frontend-assets').detail, /http-404/);
    },
  );
});

test('bundle without the expected API origin fails binding', async () => {
  await withStub(
    (origin) => ({ ...healthyState(origin), bundleJs: 'console.log("no api here");' }),
    async ({ probe }) => {
      const result = await probe();
      assert.equal(result.ok, false);
      assert.equal(checkByName(result, 'api-binding').ok, false);
      assert.equal(checkByName(result, 'frontend-assets').ok, true);
    },
  );
});

test('unexpected foreign script fails, telegram SDK stays ignored', async () => {
  await withStub(
    () => ({
      ...healthyState('http://127.0.0.1:1'),
      homeHtml: HOME_HTML(['/assets/app.js', 'https://cdn.example.com/unknown.js']),
    }),
    async ({ probe }) => {
      const result = await probe();
      assert.equal(result.ok, false);
      assert.match(checkByName(result, 'frontend-assets').detail, /foreign/);
    },
  );
});

test('recovery: failing ready flips the probe back to ok', async () => {
  await withStub(
    (origin) => ({
      ...healthyState(origin),
      readyStatus: 503,
      readyPayload: { ready: false, checks: { database: 'error', object_storage: 'ok', configuration: 'ok' } },
    }),
    async ({ box, probe }) => {
      assert.equal((await probe()).ok, false);
      box.state.readyStatus = 200;
      box.state.readyPayload = { ready: true, checks: { database: 'ok', object_storage: 'ok', configuration: 'ok' } };
      assert.equal((await probe()).ok, true);
    },
  );
});

test('stale health timestamp fails health', async () => {
  await withStub(
    (origin) => ({ ...healthyState(origin), healthTimestamp: new Date(Date.now() - 60 * 60 * 1000).toISOString() }),
    async ({ probe }) => {
      const result = await probe();
      assert.equal(result.ok, false);
      assert.match(checkByName(result, 'api-health').detail, /stale/);
    },
  );
});

test('stalled body after headers times out without hanging', async () => {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (url.pathname === '/ready') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.write('{"ready":true,');
      return;
    }
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const origin = `http://127.0.0.1:${server.address().port}`;
    const begin = Date.now();
    const result = await probeOperations({
      frontendOrigin: origin,
      apiOrigin: origin,
      expectedApiOrigin: origin,
      timeoutMs: 300,
    });
    assert.ok(Date.now() - begin < 30000, 'probe must not hang on a stalled body');
    assert.equal(checkByName(result, 'api-ready').ok, false);
    assert.match(checkByName(result, 'api-ready').detail, /timeout/);
  } finally {
    await new Promise((done) => server.close(done));
  }
});

test('oversize body fails capped', async () => {
  await withStub(
    (origin) => healthyState(origin),
    async ({ probe }) => {
      const { DEFAULT_LIMITS } = await import('../scripts/ops-probe.mjs');
      const big = await probe({
        limits: { ...DEFAULT_LIMITS, maxJsonBytes: 16 },
      });
      assert.equal(big.ok, false);
      assert.match(checkByName(big, 'api-live').detail, /exceeds/);
    },
  );
});

test('userinfo and query never reach human or summary output', async () => {
  const evil = 'https://user:s3cret@cdn.example.com/x.js?tok=abc';
  const stub = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (url.pathname === '/') {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(HOME_HTML(['/assets/app.js', evil]));
      return;
    }
    if (url.pathname === '/assets/app.js') {
      res.writeHead(200, { 'content-type': 'text/javascript' });
      res.end('console.log("x");');
      return;
    }
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found');
  });
  await new Promise((resolve) => stub.listen(0, '127.0.0.1', resolve));
  try {
    const origin = `http://127.0.0.1:${stub.address().port}`;
    const result = await probeOperations({
      frontendOrigin: origin,
      apiOrigin: origin,
      expectedApiOrigin: origin,
      timeoutMs: 3000,
    });
    assert.equal(result.ok, false);
    const human = renderHuman(result);
    const summary = renderSummaryMarkdown(result);
    for (const output of [human, summary, JSON.stringify(result)]) {
      assert.ok(!output.includes('s3cret'), 'credentials must not leak into output');
      assert.ok(!output.includes('tok=abc'), 'query must not leak into output');
    }
    assert.ok(human.includes('https://cdn.example.com'), 'safe origin stays for diagnosis');
  } finally {
    await new Promise((done) => stub.close(done));
  }
});

test('credentialed same-origin asset fails closed without logging secrets', async () => {
  const stub = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (url.pathname === '/') {
      const port = stub.address().port;
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(HOME_HTML([`http://user:pw127@127.0.0.1:${port}/assets/app.js`]));
      return;
    }
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found');
  });
  await new Promise((resolve) => stub.listen(0, '127.0.0.1', resolve));
  try {
    const origin = `http://127.0.0.1:${stub.address().port}`;
    const result = await probeOperations({
      frontendOrigin: origin,
      apiOrigin: origin,
      expectedApiOrigin: origin,
      timeoutMs: 3000,
    });
    assert.equal(result.ok, false);
    assert.equal(checkByName(result, 'frontend-assets').ok, false);
    const human = renderHuman(result);
    assert.ok(!human.includes('pw127'), 'credentials must not leak into output');
  } finally {
    await new Promise((done) => stub.close(done));
  }
});

