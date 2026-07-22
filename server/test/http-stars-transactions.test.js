import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import initSqlJs from 'sql.js';
import { runMigrations } from '../database/migrations.js';

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

async function stopServer(server) {
  if (server.exitCode !== null || server.killed) return;
  const exited = once(server, 'exit');
  server.kill();
  await exited;
}

async function startServer(t, { dir, port, extraEnv = {} }) {
  const dbPath = join(dir, 'test.db.bin');
  const server = spawn('node', ['index.js'], {
    cwd: serverDir,
    env: cloneEnv({ PORT: String(port), SQLITE_DB_PATH: dbPath, ALLOW_DEV_AUTH: 'true', ...extraEnv }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Server did not start on port ${port}`)), 15_000);
    server.stdout.on('data', (chunk) => {
      if (chunk.toString().includes('running on')) { clearTimeout(timer); resolve(); }
    });
    server.once('error', reject);
  });
  t.after(async () => {
    if (server.exitCode === null && !server.killed) {
      await stopServer(server);
    }
    await rm(dir, { recursive: true, force: true });
  });
  return { server, port, url: `http://127.0.0.1:${port}`, dbPath };
}

async function setupTestUsers(url) {
  await fetch(`${url}/users/me`, { headers: { 'X-User-Id': 'test_sender' } });
  for (let i = 0; i < 5; i++) await fetch(`${url}/users/test_sender/add-stars`, { method: 'POST', headers: { 'X-User-Id': 'test_sender' } });
  await fetch(`${url}/users/me`, { headers: { 'X-User-Id': 'test_receiver' } });
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

function openDb(filePath) {
  const SQL = initSqlJs;
  return SQL;
}

async function queryDb(dbPath, queries) {
  const SQL = await initSqlJs();
  const db = new SQL.Database(await readFile(dbPath));
  db.run('PRAGMA foreign_keys = ON;');
  const results = {};
  for (const [key, { sql, params }] of Object.entries(queries)) {
    const stmt = db.prepare(sql);
    stmt.bind(params || []);
    if (stmt.step()) results[key] = stmt.getAsObject();
    else results[key] = null;
    stmt.free();
  }
  return results;
}

function q(sql, params) {
  return { sql, params: params || [] };
}

// ── Premium collection HTTP fixture ──────────────────────────────────

async function startServerWithPremiumCollection(t, port, providedDir = null) {
  const dir = providedDir || await mkdtemp(join(tmpdir(), 'splint-http-'));
  const dbPath = join(dir, 'test.db.bin');

  const SQL = await initSqlJs();
  const db = new SQL.Database();
  db.run('PRAGMA foreign_keys = ON;');
  const migrationsDir = join(serverDir, 'migrations', 'sqlite');
  await runMigrations({ mode: 'sqlite', pool: null, sqlite: db, persistFn: null, migrationsDir });

  const now = new Date().toISOString();
  db.run("INSERT INTO collections (id,title,pack_type,price_in_stars) VALUES (?,?,?,?)", ['col_http_prem', 'HTTP Premium Test', 'premium', 40]);
  db.run("INSERT INTO collections (id,title,pack_type,price_in_stars) VALUES (?,?,?,?)", ['col_http_free', 'HTTP Free Test', 'free', 0]);
  db.run("INSERT INTO achievements (id,title,description,category,icon,rarity,created_at) VALUES (?,?,?,?,?,?,?)", ['ach_test', 'Test', '', 'ritual', 'star', 'common', now]);
  db.run("INSERT INTO coloring_templates (id,title,width,height,palette_json,cells_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)", ['tpl_test', 'Test', 8, 8, JSON.stringify(['#000','#fff']), JSON.stringify(new Array(64).fill(0)), now, now]);

  await writeFile(dbPath, Buffer.from(db.export()));

  const server = spawn('node', ['index.js'], {
    cwd: serverDir,
    env: cloneEnv({ PORT: String(port), SQLITE_DB_PATH: dbPath, ALLOW_DEV_AUTH: 'true' }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Server did not start on port ${port}`)), 15_000);
    server.stdout.on('data', (chunk) => {
      if (chunk.toString().includes('running on')) { clearTimeout(timer); resolve(); }
    });
    server.once('error', reject);
  });
  t.after(async () => {
    if (server.exitCode === null && !server.killed) {
      await stopServer(server);
    }
    await rm(dir, { recursive: true, force: true });
  });
  return { server, port, url: `http://127.0.0.1:${port}`, dbPath };
}

async function giveStars(url, userId, count) {
  await fetch(`${url}/users/me`, { headers: { 'X-User-Id': userId } });
  for (let i = 0; i < count; i++) await fetch(`${url}/users/${userId}/add-stars`, { method: 'POST', headers: { 'X-User-Id': userId } });
}

// ── Payment: successful ──────────────────────────────────────────────

test('HTTP: POST /messages/request/pay successful', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'splint-http-'));
  const { url } = await startServer(t, { dir, port: 33001 });
  await setupTestUsers(url);
  const requestId = await createMessageRequest(url, 'test_sender', 'test_receiver', 'Pay me');

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

// ── Payment: insufficient balance ────────────────────────────────────

test('HTTP: insufficient balance returns 402 with correct state', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'splint-http-'));
  const dbPath = join(dir, 'test.db.bin');

  // Pre-build DB with sender having just enough stars to create a paid request
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  db.run('PRAGMA foreign_keys = ON;');
  const migDir = join(serverDir, 'migrations', 'sqlite');
  await runMigrations({ mode: 'sqlite', pool: null, sqlite: db, persistFn: null, migrationsDir: migDir });

  const now = new Date().toISOString();
  db.run("INSERT INTO users (id,telegram_id,nickname,stars_balance,role,created_at,updated_at) VALUES (?,?,?,?,?,?,?)", ['poor_s', null, 'Poor', 500, 'user', now, now]);
  db.run("INSERT INTO users (id,telegram_id,nickname,stars_balance,role,created_at,updated_at) VALUES (?,?,?,?,?,?,?)", ['rich_r', null, 'Rich', 0, 'user', now, now]);
  db.run("UPDATE users SET paid_open=1, price_in_stars=500 WHERE id='rich_r'");
  db.run("INSERT INTO achievements (id,title,description,category,icon,rarity,created_at) VALUES (?,?,?,?,?,?,?)", ['ach_402', 'Test', '', 'ritual', 'star', 'common', now]);
  db.run("INSERT INTO coloring_templates (id,title,width,height,palette_json,cells_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)", ['tpl_402', 'Test', 8, 8, JSON.stringify(['#000','#fff']), JSON.stringify(new Array(64).fill(0)), now, now]);
  db.run("INSERT INTO message_requests (id,sender_id,receiver_id,price_in_stars,text,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)", ['req_402', 'poor_s', 'rich_r', 500, 'expensive', 'payment_pending', now, now]);
  // Drain sender balance below price
  db.run("UPDATE users SET stars_balance=10 WHERE id='poor_s'");

  await writeFile(dbPath, Buffer.from(db.export()));

  const { url, server } = await startServer(t, { dir, port: 33005 });

  const res = await fetch(`${url}/messages/request/pay`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-User-Id': 'poor_s', 'Idempotency-Key': 'poor-pay-key-01' },
    body: JSON.stringify({ requestId: 'req_402' }),
  });
  assert.equal(res.status, 402);
  assert.equal((await res.json()).code, 'INSUFFICIENT_STARS');

  await stopServer(server);

  const state = await queryDb(dbPath, {
    sBal: q('SELECT stars_balance FROM users WHERE id=?', ['poor_s']),
    rBal: q('SELECT stars_balance FROM users WHERE id=?', ['rich_r']),
    mrStatus: q('SELECT status FROM message_requests WHERE id=?', ['req_402']),
    opsCnt: q('SELECT COUNT(*) as cnt FROM stars_operations'),
    leCnt: q('SELECT COUNT(*) as cnt FROM stars_ledger_entries'),
  });
  assert.equal(state.sBal.stars_balance, 10, 'Sender balance unchanged');
  assert.equal(state.rBal.stars_balance, 0, 'Receiver unchanged');
  assert.equal(state.mrStatus.status, 'payment_pending');
  assert.equal(state.opsCnt.cnt, 0, 'No operation');
  assert.equal(state.leCnt.cnt, 0, 'No ledger');
});

// ── Payment: same-key replay ─────────────────────────────────────────

test('HTTP: same-key payment replay returns idempotent:true', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'splint-http-'));
  const { url } = await startServer(t, { dir, port: 33002 });
  await setupTestUsers(url);
  const requestId = await createMessageRequest(url, 'test_sender', 'test_receiver', 'Replay');
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
  assert.ok(b2.request);
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
  assert.equal((await res2.json()).code, 'IDEMPOTENCY_KEY_REUSED');
});

// ── Payment: sequential different-key duplicate ──────────────────────

test('HTTP: sequential different-key payment duplicate returns 409', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'splint-http-'));
  const { url } = await startServer(t, { dir, port: 33011 });
  await setupTestUsers(url);
  const requestId = await createMessageRequest(url, 'test_sender', 'test_receiver', 'Dup');

  const r1 = await fetch(`${url}/messages/request/pay`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-User-Id': 'test_sender', 'Idempotency-Key': 'seq-key-aaaa' },
    body: JSON.stringify({ requestId }),
  });
  assert.equal(r1.status, 200);

  const r2 = await fetch(`${url}/messages/request/pay`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-User-Id': 'test_sender', 'Idempotency-Key': 'seq-key-bbbb' },
    body: JSON.stringify({ requestId }),
  });
  assert.equal(r2.status, 409);
  assert.equal((await r2.json()).code, 'ALREADY_PROCESSED');
});

// ── Payment: invalid keys ────────────────────────────────────────────

test('HTTP: short Idempotency-Key returns 400 INVALID_INPUT', async (t) => {
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
  assert.equal((await res.json()).code, 'INVALID_INPUT');
});

test('HTTP: empty Idempotency-Key returns 400 INVALID_INPUT', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'splint-http-'));
  const { url } = await startServer(t, { dir, port: 33012 });
  await setupTestUsers(url);
  const requestId = await createMessageRequest(url, 'test_sender', 'test_receiver', 'Empty key');
  const res = await fetch(`${url}/messages/request/pay`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-User-Id': 'test_sender', 'Idempotency-Key': '' },
    body: JSON.stringify({ requestId }),
  });
  assert.equal(res.status, 400);
  assert.equal((await res.json()).code, 'INVALID_INPUT');
});

// ── Concurrent same-key payment ──────────────────────────────────────

test('HTTP: concurrent same-key — both succeed, exact DB state', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'splint-http-'));
  const { url, server, dbPath } = await startServer(t, { dir, port: 33009 });
  await setupTestUsers(url);
  const requestId = await createMessageRequest(url, 'test_sender', 'test_receiver', 'Concurrent');
  const key = 'concurrent-same-http-key';

  const results = await Promise.allSettled([
    fetch(`${url}/messages/request/pay`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-User-Id': 'test_sender', 'Idempotency-Key': key }, body: JSON.stringify({ requestId }) }),
    fetch(`${url}/messages/request/pay`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-User-Id': 'test_sender', 'Idempotency-Key': key }, body: JSON.stringify({ requestId }) }),
  ]);

  const fulfilled = results.filter(r => r.status === 'fulfilled');
  assert.equal(fulfilled.length, 2);
  const bodies = await Promise.all(fulfilled.map(async r => { assert.equal(r.value.status, 200); return r.value.json(); }));
  assert.ok(bodies.find(b => b.idempotent === false));
  assert.ok(bodies.find(b => b.idempotent === true));

  await stopServer(server);
  const state = await queryDb(dbPath, {
    sBal: q('SELECT stars_balance FROM users WHERE id=?', ['test_sender']),
    rBal: q('SELECT stars_balance FROM users WHERE id=?', ['test_receiver']),
    mrStatus: q('SELECT status FROM message_requests WHERE id=?', [requestId]),
    opsCnt: q('SELECT COUNT(*) as cnt FROM stars_operations'),
    leCnt: q('SELECT COUNT(*) as cnt FROM stars_ledger_entries'),
  });
  const expectedPayout = Math.floor(50 * 80 / 100);
  assert.equal(state.sBal.stars_balance, 500 - 50, 'Sender debited once');
  assert.equal(state.rBal.stars_balance, expectedPayout, 'Receiver credited once');
  assert.equal(state.mrStatus.status, 'delivered');
  assert.equal(state.opsCnt.cnt, 1, 'One operation');
  assert.equal(state.leCnt.cnt, expectedPayout > 0 ? 2 : 1, 'Exact ledger');
});

// ── Concurrent different-key payment ─────────────────────────────────

test('HTTP: concurrent different-key — one 200, one 409 ALREADY_PROCESSED, one financial effect', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'splint-http-'));
  const { url, server, dbPath } = await startServer(t, { dir, port: 33010 });
  await setupTestUsers(url);
  const requestId = await createMessageRequest(url, 'test_sender', 'test_receiver', 'Diff keys');

  const results = await Promise.allSettled([
    fetch(`${url}/messages/request/pay`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-User-Id': 'test_sender', 'Idempotency-Key': 'diff-key-A-http' }, body: JSON.stringify({ requestId }) }),
    fetch(`${url}/messages/request/pay`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-User-Id': 'test_sender', 'Idempotency-Key': 'diff-key-B-http' }, body: JSON.stringify({ requestId }) }),
  ]);

  const statuses = results.map(r => r.status === 'fulfilled' ? r.value.status : -1);
  assert.equal(statuses.filter(s => s === 200).length, 1);
  assert.equal(statuses.filter(s => s === 409).length, 1);
  const conflict = results.find(r => r.status === 'fulfilled' && r.value.status === 409);
  assert.equal((await conflict.value.json()).code, 'ALREADY_PROCESSED');

  await stopServer(server);
  const state = await queryDb(dbPath, {
    sBal: q('SELECT stars_balance FROM users WHERE id=?', ['test_sender']),
    opsCnt: q('SELECT COUNT(*) as cnt FROM stars_operations'),
  });
  assert.equal(state.sBal.stars_balance, 500 - 50);
  assert.equal(state.opsCnt.cnt, 1);
});

// ── Premium collection: purchase success ─────────────────────────────

test('HTTP: premium purchase — exact ownership, operation, ledger, artworks', async (t) => {
  const { url, server, dbPath } = await startServerWithPremiumCollection(t, 33020);
  await giveStars(url, 'prem_user', 5);

  const res = await fetch(`${url}/users/collections/col_http_prem/add`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-User-Id': 'prem_user', 'Idempotency-Key': 'prem-buy-key-01' },
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.idempotent, false);
  assert.ok(body.stars_balance < 500);

  await stopServer(server);
  const state = await queryDb(dbPath, {
    sBal: q('SELECT stars_balance FROM users WHERE id=?', ['prem_user']),
    own: q('SELECT * FROM collection_ownerships WHERE user_id=? AND collection_id=?', ['prem_user', 'col_http_prem']),
    opsCnt: q("SELECT COUNT(*) as cnt FROM stars_operations WHERE operation_type='collection_purchase'"),
    leCnt: q('SELECT COUNT(*) as cnt FROM stars_ledger_entries'),
    artCnt: q('SELECT COUNT(*) as cnt FROM artworks WHERE owner_id=? AND collection_id=?', ['prem_user', 'col_http_prem']),
  });
  assert.equal(state.sBal.stars_balance, 500 - 40, 'Balance reduced by price');
  assert.ok(state.own, 'Ownership exists');
  assert.equal(state.own.acquisition_type, 'premium');
  assert.equal(state.own.price_paid, 40);
  assert.ok(state.own.stars_operation_id, 'operation_id non-null');
  assert.equal(state.opsCnt.cnt, 1, 'One operation');
  assert.equal(state.leCnt.cnt, 1, 'One collection_debit entry');
  assert.equal(state.artCnt.cnt, 2, 'Two artworks');
});

// ── Premium collection: same-key replay ──────────────────────────────

test('HTTP: premium replay — no duplicate state', async (t) => {
  const { url, server, dbPath } = await startServerWithPremiumCollection(t, 33021);
  await giveStars(url, 'prem_replay', 5);
  const key = 'prem-replay-key-http';

  const r1 = await fetch(`${url}/users/collections/col_http_prem/add`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-User-Id': 'prem_replay', 'Idempotency-Key': key },
  });
  assert.equal(r1.status, 200);
  assert.equal((await r1.json()).idempotent, false);

  const r2 = await fetch(`${url}/users/collections/col_http_prem/add`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-User-Id': 'prem_replay', 'Idempotency-Key': key },
  });
  assert.equal(r2.status, 200);
  assert.equal((await r2.json()).idempotent, true);

  await stopServer(server);
  const state = await queryDb(dbPath, {
    sBal: q('SELECT stars_balance FROM users WHERE id=?', ['prem_replay']),
    ownCnt: q('SELECT COUNT(*) as cnt FROM collection_ownerships WHERE user_id=? AND collection_id=?', ['prem_replay', 'col_http_prem']),
    opsCnt: q('SELECT COUNT(*) as cnt FROM stars_operations'),
    leCnt: q('SELECT COUNT(*) as cnt FROM stars_ledger_entries'),
    artCnt: q('SELECT COUNT(*) as cnt FROM artworks WHERE owner_id=? AND collection_id=?', ['prem_replay', 'col_http_prem']),
  });
  assert.equal(state.sBal.stars_balance, 500 - 40, 'Balance not changed by replay');
  assert.equal(state.ownCnt.cnt, 1);
  assert.equal(state.opsCnt.cnt, 1);
  assert.equal(state.leCnt.cnt, 1);
  assert.equal(state.artCnt.cnt, 2);
});

// ── Premium collection: different-key duplicate ──────────────────────

test('HTTP: premium different-key duplicate — 409', async (t) => {
  const { url } = await startServerWithPremiumCollection(t, 33022);
  await giveStars(url, 'prem_dup', 5);

  await fetch(`${url}/users/collections/col_http_prem/add`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-User-Id': 'prem_dup', 'Idempotency-Key': 'prem-dup-aaa1' },
  });
  const r2 = await fetch(`${url}/users/collections/col_http_prem/add`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-User-Id': 'prem_dup', 'Idempotency-Key': 'prem-dup-bbb2' },
  });
  assert.equal(r2.status, 409);
  assert.equal((await r2.json()).code, 'ALREADY_PROCESSED');
});

// ── Premium collection: insufficient balance ─────────────────────────

test('HTTP: premium insufficient balance — 402, no effects', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'splint-http-'));
  const { url, server, dbPath } = await startServerWithPremiumCollection(t, 33023, dir);
  await fetch(`${url}/users/me`, { headers: { 'X-User-Id': 'prem_poor' } });

  const res = await fetch(`${url}/users/collections/col_http_prem/add`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-User-Id': 'prem_poor', 'Idempotency-Key': 'prem-poor-key-01' },
  });
  assert.equal(res.status, 402);
  assert.equal((await res.json()).code, 'INSUFFICIENT_STARS');

  await stopServer(server);
  const state = await queryDb(dbPath, {
    opsCnt: q('SELECT COUNT(*) as cnt FROM stars_operations'),
    leCnt: q('SELECT COUNT(*) as cnt FROM stars_ledger_entries'),
    ownCnt: q('SELECT COUNT(*) as cnt FROM collection_ownerships WHERE user_id=? AND collection_id=?', ['prem_poor', 'col_http_prem']),
    artCnt: q('SELECT COUNT(*) as cnt FROM artworks WHERE owner_id=? AND collection_id=?', ['prem_poor', 'col_http_prem']),
  });
  assert.equal(state.opsCnt.cnt, 0);
  assert.equal(state.leCnt.cnt, 0);
  assert.equal(state.ownCnt.cnt, 0);
  assert.equal(state.artCnt.cnt, 0);
});

// ── Premium collection: concurrent purchase ──────────────────────────

test('HTTP: concurrent premium — one 200, one 409, exact state', async (t) => {
  const { url, server, dbPath } = await startServerWithPremiumCollection(t, 33024);
  await giveStars(url, 'prem_conc', 5);

  const results = await Promise.allSettled([
    fetch(`${url}/users/collections/col_http_prem/add`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-User-Id': 'prem_conc', 'Idempotency-Key': 'prem-conc-aa1' } }),
    fetch(`${url}/users/collections/col_http_prem/add`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-User-Id': 'prem_conc', 'Idempotency-Key': 'prem-conc-bb2' } }),
  ]);
  const statuses = results.map(r => r.status === 'fulfilled' ? r.value.status : -1);
  assert.equal(statuses.filter(s => s === 200).length, 1);
  assert.equal(statuses.filter(s => s === 409).length, 1);
  const conflict = results.find(r => r.status === 'fulfilled' && r.value.status === 409);
  assert.equal((await conflict.value.json()).code, 'ALREADY_PROCESSED');

  await stopServer(server);
  const state = await queryDb(dbPath, {
    sBal: q('SELECT stars_balance FROM users WHERE id=?', ['prem_conc']),
    ownCnt: q('SELECT COUNT(*) as cnt FROM collection_ownerships WHERE user_id=? AND collection_id=?', ['prem_conc', 'col_http_prem']),
    opsCnt: q('SELECT COUNT(*) as cnt FROM stars_operations'),
    leCnt: q('SELECT COUNT(*) as cnt FROM stars_ledger_entries'),
    artCnt: q('SELECT COUNT(*) as cnt FROM artworks WHERE owner_id=? AND collection_id=?', ['prem_conc', 'col_http_prem']),
  });
  assert.equal(state.sBal.stars_balance, 500 - 40);
  assert.equal(state.ownCnt.cnt, 1);
  assert.equal(state.opsCnt.cnt, 1);
  assert.equal(state.leCnt.cnt, 1);
  assert.equal(state.artCnt.cnt, 2);
});

// ── Premium collection: legacy ownership ─────────────────────────────

test('HTTP: legacy ownership rejects purchase, no new operation', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'splint-http-'));
  const dbPath = join(dir, 'test.db.bin');

  const SQL = await initSqlJs();
  const db = new SQL.Database();
  db.run('PRAGMA foreign_keys = ON;');
  const migDir = join(serverDir, 'migrations', 'sqlite');
  await runMigrations({ mode: 'sqlite', pool: null, sqlite: db, persistFn: null, migrationsDir: migDir });

  const now = new Date().toISOString();
  db.run("INSERT INTO collections (id,title,pack_type,price_in_stars) VALUES (?,?,?,?)", ['col_http_leg', 'Legacy Test', 'premium', 40]);
  db.run("INSERT INTO users (id,telegram_id,nickname,stars_balance,role,created_at,updated_at) VALUES (?,?,?,?,?,?,?)", ['leg_user', null, 'Legacy', 500, 'user', now, now]);
  db.run("INSERT INTO achievements (id,title,description,category,icon,rarity,created_at) VALUES (?,?,?,?,?,?,?)", ['ach_tl', 'Test', '', 'ritual', 'star', 'common', now]);
  db.run("INSERT INTO coloring_templates (id,title,width,height,palette_json,cells_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)", ['tpl_tl', 'Test', 8, 8, JSON.stringify(['#000','#fff']), JSON.stringify(new Array(64).fill(0)), now, now]);
  db.run("INSERT INTO collection_ownerships (user_id,collection_id,acquisition_type,price_paid,stars_operation_id,created_at) VALUES (?,?,?,?,?,?)", ['leg_user', 'col_http_leg', 'legacy', 0, null, now]);

  const opsBefore = db.exec("SELECT COUNT(*) as cnt FROM stars_operations");
  await writeFile(dbPath, Buffer.from(db.export()));

  const { url, server } = await startServer(t, { dir, port: 33025 });

  const res = await fetch(`${url}/users/collections/col_http_leg/add`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-User-Id': 'leg_user', 'Idempotency-Key': 'leg-buy-key-01' },
  });
  assert.equal(res.status, 409);
  assert.equal((await res.json()).code, 'ALREADY_PROCESSED');

  const meRes = await fetch(`${url}/users/me`, { headers: { 'X-User-Id': 'leg_user' } });
  const me = await meRes.json();
  assert.equal(me.stars_balance, 500, 'Balance unchanged');

  await stopServer(server);
  const state = await queryDb(dbPath, {
    opsCnt: q('SELECT COUNT(*) as cnt FROM stars_operations'),
    leCnt: q('SELECT COUNT(*) as cnt FROM stars_ledger_entries'),
  });
  assert.equal(state.opsCnt.cnt, 0, 'No new operation');
  assert.equal(state.leCnt.cnt, 0, 'No ledger entries');
});

// ── Free collection tests ────────────────────────────────────────────

test('HTTP: free collection add successful', async (t) => {
  const { url } = await startServerWithPremiumCollection(t, 33026);
  await fetch(`${url}/users/me`, { headers: { 'X-User-Id': 'free_buyer' } });
  const res = await fetch(`${url}/users/collections/col_http_free/add`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-User-Id': 'free_buyer', 'Idempotency-Key': 'free-col-key-01' },
  });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).success, true);
});

test('HTTP: free collection duplicate returns 409', async (t) => {
  const { url } = await startServerWithPremiumCollection(t, 33027);
  await fetch(`${url}/users/me`, { headers: { 'X-User-Id': 'free_dup' } });
  await fetch(`${url}/users/collections/col_http_free/add`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-User-Id': 'free_dup', 'Idempotency-Key': 'free-dup-aaa1' } });
  const r2 = await fetch(`${url}/users/collections/col_http_free/add`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-User-Id': 'free_dup', 'Idempotency-Key': 'free-dup-bbb2' } });
  assert.equal(r2.status, 409);
});

// ── Settings: price validation ───────────────────────────────────────

test('HTTP: settings price_in_stars=1 returns 400', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'splint-http-'));
  const { url } = await startServer(t, { dir, port: 33030 });
  await fetch(`${url}/users/me`, { headers: { 'X-User-Id': 'st1' } });
  const res = await fetch(`${url}/users/st1/settings`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', 'X-User-Id': 'st1' }, body: JSON.stringify({ price_in_stars: 1 }) });
  assert.equal(res.status, 400);
  assert.equal((await res.json()).code, 'INVALID_INPUT');
});

test('HTTP: settings price_in_stars="2abc" returns 400', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'splint-http-'));
  const { url } = await startServer(t, { dir, port: 33031 });
  await fetch(`${url}/users/me`, { headers: { 'X-User-Id': 'st2' } });
  const res = await fetch(`${url}/users/st2/settings`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', 'X-User-Id': 'st2' }, body: JSON.stringify({ price_in_stars: "2abc" }) });
  assert.equal(res.status, 400);
  assert.equal((await res.json()).code, 'INVALID_INPUT');
});

test('HTTP: settings price_in_stars=2 returns 200', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'splint-http-'));
  const { url } = await startServer(t, { dir, port: 33032 });
  await fetch(`${url}/users/me`, { headers: { 'X-User-Id': 'st3' } });
  const res = await fetch(`${url}/users/st3/settings`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', 'X-User-Id': 'st3' }, body: JSON.stringify({ price_in_stars: 2 }) });
  assert.equal(res.status, 200);
});
