import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const serverDir = join(__dirname, '..');

function cloneEnv(overrides = {}) {
  const env = { ...process.env };
  delete env.DATABASE_URL;
  delete env.NODE_ENV;
  delete env.ALLOW_DESTRUCTIVE_DB_RESET;
  delete env.SEED_DEMO_DATA;
  return { ...env, ...overrides };
}

async function startServer(t, { dir, port, extraEnv = {} }) {
  const dbPath = join(dir, 'test.db.bin');

  const server = spawn('node', ['index.js'], {
    cwd: serverDir,
    env: cloneEnv({ PORT: String(port), SQLITE_DB_PATH: dbPath, ALLOW_DEV_AUTH: 'true', ...extraEnv }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Server did not start on port ${port}`)), 12_000);
    server.stdout.on('data', (chunk) => {
      if (chunk.toString().includes('running on')) { clearTimeout(timer); resolve(); }
    });
    server.once('error', reject);
  });

  t.after(() => { server.kill(); });
  t.after(async () => { await rm(dir, { recursive: true, force: true }); });

  return { server, port, url: `http://127.0.0.1:${port}` };
}

async function setupTestUsers(url) {
  // Create sender with 500 stars
  await fetch(`${url}/users/me`, { headers: { 'X-User-Id': 'test_sender' } });
  await fetch(`${url}/users/test_sender/add-stars`, { method: 'POST', headers: { 'X-User-Id': 'test_sender' } });
  await fetch(`${url}/users/test_sender/add-stars`, { method: 'POST', headers: { 'X-User-Id': 'test_sender' } });
  await fetch(`${url}/users/test_sender/add-stars`, { method: 'POST', headers: { 'X-User-Id': 'test_sender' } });
  await fetch(`${url}/users/test_sender/add-stars`, { method: 'POST', headers: { 'X-User-Id': 'test_sender' } });
  await fetch(`${url}/users/test_sender/add-stars`, { method: 'POST', headers: { 'X-User-Id': 'test_sender' } });

  // Create receiver with some stars
  await fetch(`${url}/users/me`, { headers: { 'X-User-Id': 'test_receiver' } });

  // Enable paid messages on receiver
  await fetch(`${url}/users/test_receiver/settings`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'X-User-Id': 'test_receiver' },
    body: JSON.stringify({ paid_open: true, price_in_stars: 50 }),
  });
}

async function createMessageRequest(url, senderId, receiverId, text = 'test message') {
  const res = await fetch(`${url}/messages/request/create`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-User-Id': senderId },
    body: JSON.stringify({ receiverId, text }),
  });
  const body = await res.json();
  return body.id;
}

// ── Payment: successful ──────────────────────────────────────────────

test('HTTP: POST /messages/request/pay successful', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'splint-http-'));
  const { url } = await startServer(t, { dir, port: 33001 });

  await setupTestUsers(url);
  const requestId = await createMessageRequest(url, 'test_sender', 'test_receiver', 'Pay me please');

  const res = await fetch(`${url}/messages/request/pay`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-User-Id': 'test_sender', 'Idempotency-Key': 'http-pay-success-key' },
    body: JSON.stringify({ requestId }),
  });

  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.success, true);
  assert.equal(body.idempotent, false);
  assert.ok(body.stars_balance !== undefined);
  assert.ok(body.request);
  assert.equal(body.request.status, 'delivered');
});

// ── Payment: same-key replay ─────────────────────────────────────────

test('HTTP: same-key payment replay returns idempotent:true', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'splint-http-'));
  const { url } = await startServer(t, { dir, port: 33002 });

  await setupTestUsers(url);
  const requestId = await createMessageRequest(url, 'test_sender', 'test_receiver', 'Replay test');

  const key = 'replay-key-http-test';

  const res1 = await fetch(`${url}/messages/request/pay`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-User-Id': 'test_sender', 'Idempotency-Key': key },
    body: JSON.stringify({ requestId }),
  });
  assert.equal(res1.status, 200);
  const b1 = await res1.json();
  assert.equal(b1.idempotent, false);

  const res2 = await fetch(`${url}/messages/request/pay`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-User-Id': 'test_sender', 'Idempotency-Key': key },
    body: JSON.stringify({ requestId }),
  });
  assert.equal(res2.status, 200);
  const b2 = await res2.json();
  assert.equal(b2.idempotent, true);
  assert.ok(b2.request, 'Replay response has request');
  assert.ok(b2.stars_balance !== undefined);
});

// ── Payment: reused key ──────────────────────────────────────────────

test('HTTP: reused Idempotency-Key with different request returns 409', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'splint-http-'));
  const { url } = await startServer(t, { dir, port: 33003 });

  await setupTestUsers(url);
  const req1 = await createMessageRequest(url, 'test_sender', 'test_receiver', 'First');
  const req2 = await createMessageRequest(url, 'test_sender', 'test_receiver', 'Second');
  const key = 'reused-key-http-test';

  await fetch(`${url}/messages/request/pay`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-User-Id': 'test_sender', 'Idempotency-Key': key },
    body: JSON.stringify({ requestId: req1 }),
  });

  const res2 = await fetch(`${url}/messages/request/pay`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-User-Id': 'test_sender', 'Idempotency-Key': key },
    body: JSON.stringify({ requestId: req2 }),
  });

  assert.equal(res2.status, 409);
  const body = await res2.json();
  assert.equal(body.code, 'IDEMPOTENCY_KEY_REUSED');
});

// ── Payment: invalid key ─────────────────────────────────────────────

test('HTTP: invalid Idempotency-Key returns 400', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'splint-http-'));
  const { url } = await startServer(t, { dir, port: 33004 });

  await setupTestUsers(url);
  const requestId = await createMessageRequest(url, 'test_sender', 'test_receiver', 'Bad key');

  const res = await fetch(`${url}/messages/request/pay`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-User-Id': 'test_sender', 'Idempotency-Key': 'short' },
    body: JSON.stringify({ requestId }),
  });

  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.code, 'INVALID_INPUT');
});

// ── Payment: insufficient balance (covered by unit tests, skip HTTP) ─

// ── Collection: premium purchase ─────────────────────────────────────

test('HTTP: POST /users/collections/:id/add successful', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'splint-http-'));
  const { url } = await startServer(t, { dir, port: 33006, extraEnv: { SEED_DEMO_DATA: 'true' } });

  await fetch(`${url}/users/me`, { headers: { 'X-User-Id': 'col_buyer' } });
  for (let i = 0; i < 5; i++) {
    await fetch(`${url}/users/col_buyer/add-stars`, { method: 'POST', headers: { 'X-User-Id': 'col_buyer' } });
  }

  // col_night-city is a free collection from the default catalog
  const res = await fetch(`${url}/users/collections/col_night-city/add`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-User-Id': 'col_buyer', 'Idempotency-Key': 'http-col-buy-key' },
  });

  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.success, true);
  assert.equal(body.idempotent, false);
});

// ── Collection: free duplicate ───────────────────────────────────────

test('HTTP: free collection duplicate returns 409', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'splint-http-'));
  const { url } = await startServer(t, { dir, port: 33007, extraEnv: { SEED_DEMO_DATA: 'true' } });

  await fetch(`${url}/users/me`, { headers: { 'X-User-Id': 'dup_buyer' } });

  const key1 = 'dup-col-key-http-1';
  const res1 = await fetch(`${url}/users/collections/col_night-city/add`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-User-Id': 'dup_buyer', 'Idempotency-Key': key1 },
  });
  assert.equal(res1.status, 200);

  const res2 = await fetch(`${url}/users/collections/col_night-city/add`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-User-Id': 'dup_buyer', 'Idempotency-Key': 'dup-col-key-http-2' },
  });
  assert.equal(res2.status, 409);
});

// ── Collection: replay ───────────────────────────────────────────────

test('HTTP: collection replay returns idempotent', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'splint-http-'));
  const { url } = await startServer(t, { dir, port: 33008, extraEnv: { SEED_DEMO_DATA: 'true' } });

  await fetch(`${url}/users/me`, { headers: { 'X-User-Id': 'replay_buyer' } });
  for (let i = 0; i < 5; i++) {
    await fetch(`${url}/users/replay_buyer/add-stars`, { method: 'POST', headers: { 'X-User-Id': 'replay_buyer' } });
  }

  const key = 'replay-col-http-key';

  const res1 = await fetch(`${url}/users/collections/col_cozy-forest/add`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-User-Id': 'replay_buyer', 'Idempotency-Key': key },
  });
  assert.equal(res1.status, 200);
  const b1 = await res1.json();
  assert.equal(b1.idempotent, false);

  const res2 = await fetch(`${url}/users/collections/col_cozy-forest/add`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-User-Id': 'replay_buyer', 'Idempotency-Key': key },
  });
  assert.equal(res2.status, 200);
  const b2 = await res2.json();
  assert.equal(b2.idempotent, true);
});

// ── Concurrent same-key payment ──────────────────────────────────────

test('HTTP: concurrent same-key payment, both succeed, one idempotent', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'splint-http-'));
  const { url } = await startServer(t, { dir, port: 33009 });

  await setupTestUsers(url);
  const requestId = await createMessageRequest(url, 'test_sender', 'test_receiver', 'Concurrent');
  const key = 'concurrent-same-http-key';

  const results = await Promise.allSettled([
    fetch(`${url}/messages/request/pay`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-User-Id': 'test_sender', 'Idempotency-Key': key },
      body: JSON.stringify({ requestId }),
    }),
    fetch(`${url}/messages/request/pay`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-User-Id': 'test_sender', 'Idempotency-Key': key },
      body: JSON.stringify({ requestId }),
    }),
  ]);

  const fulfilled = results.filter(r => r.status === 'fulfilled');
  assert.equal(fulfilled.length, 2, `Both should succeed, got ${fulfilled.length}`);

  const bodies = await Promise.all(fulfilled.map(async r => {
    const b = await r.value.json();
    assert.equal(r.value.status, 200);
    return b;
  }));

  const normal = bodies.find(b => b.idempotent === false);
  const replay = bodies.find(b => b.idempotent === true);
  assert.ok(normal, 'One normal success');
  assert.ok(replay, 'One idempotent replay');
});

// ── Concurrent different-key payment ─────────────────────────────────

test('HTTP: concurrent different-key payment, one success, one 409', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'splint-http-'));
  const { url } = await startServer(t, { dir, port: 33010 });

  await setupTestUsers(url);
  const requestId = await createMessageRequest(url, 'test_sender', 'test_receiver', 'Diff keys');

  const results = await Promise.allSettled([
    fetch(`${url}/messages/request/pay`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-User-Id': 'test_sender', 'Idempotency-Key': 'diff-key-A-http' },
      body: JSON.stringify({ requestId }),
    }),
    fetch(`${url}/messages/request/pay`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-User-Id': 'test_sender', 'Idempotency-Key': 'diff-key-B-http' },
      body: JSON.stringify({ requestId }),
    }),
  ]);

  const statuses = results.map(r => r.status === 'fulfilled' ? r.value.status : -1);
  const successCount = statuses.filter(s => s === 200).length;
  const conflictCount = statuses.filter(s => s === 409).length;

  assert.equal(successCount, 1, 'Exactly one 200');
  assert.equal(conflictCount, 1, 'Exactly one 409');
  assert.equal(successCount + conflictCount, 2, 'All requests completed');
});
