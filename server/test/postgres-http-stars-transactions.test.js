import test from 'node:test';
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

const databaseUrl = process.env.DATABASE_URL;
const serverDir = join(dirname(fileURLToPath(import.meta.url)), '..');

if (databaseUrl) {
  process.env.ALLOW_DEV_AUTH = 'true';
  if (process.env.NODE_ENV === 'production') delete process.env.NODE_ENV;
}

const skip = !databaseUrl;
if (!databaseUrl) {
  test('PostgreSQL HTTP Stars tests skipped (no DATABASE_URL)', { skip: true }, () => {});
}

function safeSuffix() {
  return `phttp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

async function ensureMigrations(pool) {
  const { runMigrations } = await import('../database/migrations.js');
  return runMigrations({
    mode: 'postgres', pool, sqlite: null, persistFn: null,
    migrationsDir: join(serverDir, 'migrations'),
  });
}

async function getFreePort() {
  const { createServer } = await import('node:net');
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.listen(0, () => { const p = s.address().port; s.close(() => resolve(p)); });
    s.on('error', reject);
  });
}

async function spawnServer(t, { schema, port }) {
  const env = {
    ...process.env,
    DATABASE_URL: databaseUrl,
    PGOPTIONS: `-c search_path="${schema}",public`,
    PORT: String(port),
    ALLOW_DEV_AUTH: 'true',
    NODE_ENV: 'test',
    RATE_LIMIT_MAX: '10000',
    // Block demo seed in test
    SEED_DEMO_DATA: '',
  };
  // Don't inherit any test-only flags
  delete env.ALLOW_DESTRUCTIVE_DB_RESET;

  const server = spawn('node', ['index.js'], {
    cwd: serverDir,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const serverUrl = `http://127.0.0.1:${port}`;
  let stderr = '';
  server.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Server did not start on port ${port}. stderr: ${stderr.slice(0, 500)}`)), 20_000);
    server.stdout.on('data', (chunk) => {
      if (chunk.toString().includes('database ready')) {
        // Wait a bit for listen to complete
        setTimeout(() => { clearTimeout(timer); resolve(); }, 300);
      }
    });
    server.once('error', reject);
  });

  // Verify server responds
  let healthOk = false;
  for (let i = 0; i < 10; i++) {
    try {
      const res = await fetch(`${serverUrl}/health`);
      if (res.status === 200) { healthOk = true; break; }
    } catch { /* retry */ }
    await new Promise(r => setTimeout(r, 200));
  }
  if (!healthOk) throw new Error(`Health check failed on port ${port}`);

  return { server, url: serverUrl, port };
}

async function stopServer(server) {
  if (server.exitCode !== null || server.killed) return;
  const exited = once(server, 'exit');
  server.kill();
  await exited;
}

async function createIsolatedSuite(t) {
  const schema = safeSuffix();
  const pg = (await import('pg')).default;

  const adminPool = new pg.Pool({ connectionString: databaseUrl });
  await adminPool.query(`CREATE SCHEMA "${schema}"`);

  const fixturePool = new pg.Pool({
    connectionString: databaseUrl,
    options: `-c search_path="${schema}",public`,
  });

  await ensureMigrations(fixturePool);

  t.after(async () => {
    await fixturePool.end();
    await adminPool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await adminPool.end();
  });

  return { schema, fixturePool, adminPool };
}

// ── Schema identity test ─────────────────────────────────────────────

test('PG-HTTP: server uses correct test schema', { skip }, async (t) => {
  const { schema, fixturePool } = await createIsolatedSuite(t);

  // Create a user that exists only in this test schema
  const userId = `pgsi_${Date.now()}`;
  await fixturePool.query("INSERT INTO users (id,nickname,stars_balance,role,created_at,updated_at) VALUES ($1,'U',100,'user',NOW(),NOW())", [userId]);
  // Verify fixture pool sees it
  const check = await fixturePool.query('SELECT id FROM users WHERE id=$1', [userId]);
  assert.equal(check.rows.length, 1, 'Fixture pool sees test user');

  const port = await getFreePort();
  const { server, url } = await spawnServer(t, { schema, port });

  // Server should see the same user
  const meRes = await fetch(`${url}/users/me`, { headers: { 'X-User-Id': userId } });
  assert.equal(meRes.status, 200, `Expected 200, got ${meRes.status}`);
  const me = await meRes.json();
  assert.equal(me.id, userId, 'Server sees user from test schema');

  // Verify current_schema via fixture pool
  const schemaCheck = await fixturePool.query('SELECT current_schema() as s');
  assert.ok(schemaCheck.rows[0].s.includes(schema), `Fixture pool uses schema ${schema}: got ${schemaCheck.rows[0].s}`);

  await stopServer(server);
});

// ── Successful message payment ───────────────────────────────────────

test('PG-HTTP: successful message payment', { skip }, async (t) => {
  const { schema, fixturePool } = await createIsolatedSuite(t);

  const sId = `pghs_${Date.now()}`;
  const rId = `pghr_${Date.now()}`;
  const reqId = `pghmsg_${Date.now()}`;
  const price = 50;

  await fixturePool.query("INSERT INTO users (id,nickname,stars_balance,role,created_at,updated_at) VALUES ($1,'S',100,'user',NOW(),NOW())", [sId]);
  await fixturePool.query("INSERT INTO users (id,nickname,stars_balance,role,created_at,updated_at) VALUES ($1,'R',50,'user',NOW(),NOW())", [rId]);
  await fixturePool.query("INSERT INTO message_requests (id,sender_id,receiver_id,price_in_stars,text,status,created_at,updated_at) VALUES ($1,$2,$3,$4,'hi','payment_pending',NOW(),NOW())", [reqId, sId, rId, price]);

  const port = await getFreePort();
  const { server, url } = await spawnServer(t, { schema, port });

  const res = await fetch(`${url}/messages/request/pay`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-User-Id': sId, 'Idempotency-Key': 'pgh-pay-success' },
    body: JSON.stringify({ requestId: reqId }),
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.idempotent, false);
  assert.equal(body.request.status, 'delivered');

  await stopServer(server);

  const expectedPayout = Math.floor(price * 80 / 100);
  const s = await fixturePool.query('SELECT stars_balance FROM users WHERE id=$1', [sId]);
  const r = await fixturePool.query('SELECT stars_balance FROM users WHERE id=$1', [rId]);
  const mr = await fixturePool.query('SELECT status FROM message_requests WHERE id=$1', [reqId]);
  const ops = await fixturePool.query("SELECT * FROM stars_operations WHERE operation_type='message_payment' AND actor_user_id=$1", [sId]);
  const entries = await fixturePool.query("SELECT * FROM stars_ledger_entries WHERE operation_id=$1", [ops.rows[0]?.id]);

  assert.equal(s.rows[0].stars_balance, 100 - price);
  assert.equal(r.rows[0].stars_balance, 50 + expectedPayout);
  assert.equal(mr.rows[0].status, 'delivered');
  assert.equal(ops.rows.length, 1);
  assert.equal(ops.rows[0].fee_amount, price - expectedPayout);
  assert.equal(ops.rows[0].gross_amount, price);
  assert.equal(entries.rows.length, expectedPayout > 0 ? 2 : 1);
});

// ── Same-key replay ──────────────────────────────────────────────────

test('PG-HTTP: same-key replay idempotent', { skip }, async (t) => {
  const { schema, fixturePool } = await createIsolatedSuite(t);

  const sId = `pghsr_${Date.now()}`;
  const rId = `pghrr_${Date.now()}`;
  const reqId = `pghrmsg_${Date.now()}`;
  const key = 'pgh-replay-123456';

  await fixturePool.query("INSERT INTO users (id,nickname,stars_balance,role,created_at,updated_at) VALUES ($1,'S',100,'user',NOW(),NOW())", [sId]);
  await fixturePool.query("INSERT INTO users (id,nickname,stars_balance,role,created_at,updated_at) VALUES ($1,'R',50,'user',NOW(),NOW())", [rId]);
  await fixturePool.query("INSERT INTO message_requests (id,sender_id,receiver_id,price_in_stars,text,status,created_at,updated_at) VALUES ($1,$2,$3,50,'hi','payment_pending',NOW(),NOW())", [reqId, sId, rId]);

  const port = await getFreePort();
  const { server, url } = await spawnServer(t, { schema, port });

  const r1 = await fetch(`${url}/messages/request/pay`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-User-Id': sId, 'Idempotency-Key': key },
    body: JSON.stringify({ requestId: reqId }),
  });
  assert.equal(r1.status, 200);
  const b1 = await r1.json();
  assert.equal(b1.idempotent, false);
  assert.ok(b1.request);
  assert.ok(b1.stars_balance !== undefined);

  const r2 = await fetch(`${url}/messages/request/pay`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-User-Id': sId, 'Idempotency-Key': key },
    body: JSON.stringify({ requestId: reqId }),
  });
  assert.equal(r2.status, 200);
  const b2 = await r2.json();
  assert.equal(b2.idempotent, true);
  assert.ok(b2.request);
  assert.ok(b2.stars_balance !== undefined);

  await stopServer(server);

  const ops = await fixturePool.query("SELECT COUNT(*) as cnt FROM stars_operations WHERE idempotency_key=$1 AND actor_user_id=$2", [key, sId]);
  assert.equal(parseInt(ops.rows[0].cnt, 10), 1);
  const s = await fixturePool.query('SELECT stars_balance FROM users WHERE id=$1', [sId]);
  assert.equal(s.rows[0].stars_balance, 100 - 50);

  const entries = await fixturePool.query("SELECT COUNT(*) as cnt FROM stars_ledger_entries");
  const expectedPayout = Math.floor(50 * 80 / 100);
  assert.equal(parseInt(entries.rows[0].cnt, 10), expectedPayout > 0 ? 2 : 1);
});

// ── Invalid Idempotency-Key ──────────────────────────────────────────

test('PG-HTTP: invalid Idempotency-Key returns 400', { skip }, async (t) => {
  const { schema, fixturePool } = await createIsolatedSuite(t);

  const sId = `pghi_${Date.now()}`;
  const rId = `pghir_${Date.now()}`;
  const reqId = `pghimsg_${Date.now()}`;

  await fixturePool.query("INSERT INTO users (id,nickname,stars_balance,role,created_at,updated_at) VALUES ($1,'S',100,'user',NOW(),NOW())", [sId]);
  await fixturePool.query("INSERT INTO users (id,nickname,stars_balance,role,created_at,updated_at) VALUES ($1,'R',50,'user',NOW(),NOW())", [rId]);
  await fixturePool.query("INSERT INTO message_requests (id,sender_id,receiver_id,price_in_stars,text,status,created_at,updated_at) VALUES ($1,$2,$3,50,'hi','payment_pending',NOW(),NOW())", [reqId, sId, rId]);

  const port = await getFreePort();
  const { server, url } = await spawnServer(t, { schema, port });

  const res = await fetch(`${url}/messages/request/pay`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-User-Id': sId, 'Idempotency-Key': 'short' },
    body: JSON.stringify({ requestId: reqId }),
  });
  assert.equal(res.status, 400);
  assert.equal((await res.json()).code, 'INVALID_INPUT');

  await stopServer(server);
});

// ── Insufficient balance ─────────────────────────────────────────────

test('PG-HTTP: insufficient balance returns 402', { skip }, async (t) => {
  const { schema, fixturePool } = await createIsolatedSuite(t);

  const sId = `pghp_${Date.now()}`;
  const rId = `pghpr_${Date.now()}`;
  const reqId = `pghpmsg_${Date.now()}`;

  await fixturePool.query("INSERT INTO users (id,nickname,stars_balance,role,created_at,updated_at) VALUES ($1,'S',10,'user',NOW(),NOW())", [sId]);
  await fixturePool.query("INSERT INTO users (id,nickname,stars_balance,role,created_at,updated_at) VALUES ($1,'R',0,'user',NOW(),NOW())", [rId]);
  await fixturePool.query("INSERT INTO message_requests (id,sender_id,receiver_id,price_in_stars,text,status,created_at,updated_at) VALUES ($1,$2,$3,50,'hi','payment_pending',NOW(),NOW())", [reqId, sId, rId]);

  const port = await getFreePort();
  const { server, url } = await spawnServer(t, { schema, port });

  const res = await fetch(`${url}/messages/request/pay`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-User-Id': sId, 'Idempotency-Key': 'pgh-poor-key-01' },
    body: JSON.stringify({ requestId: reqId }),
  });
  assert.equal(res.status, 402);
  const body = await res.json();
  assert.equal(body.code, 'INSUFFICIENT_STARS');

  await stopServer(server);

  const s = await fixturePool.query('SELECT stars_balance FROM users WHERE id=$1', [sId]);
  assert.equal(s.rows[0].stars_balance, 10);
  const mr = await fixturePool.query('SELECT status FROM message_requests WHERE id=$1', [reqId]);
  assert.equal(mr.rows[0].status, 'payment_pending');
  const ops = await fixturePool.query("SELECT COUNT(*) as cnt FROM stars_operations WHERE actor_user_id=$1", [sId]);
  assert.equal(parseInt(ops.rows[0].cnt, 10), 0);
  const les = await fixturePool.query("SELECT COUNT(*) as cnt FROM stars_ledger_entries");
  assert.equal(parseInt(les.rows[0].cnt, 10), 0);
});

// ── Concurrent same-key ──────────────────────────────────────────────

test('PG-HTTP: concurrent same-key — both 200, exact state', { skip }, async (t) => {
  const { schema, fixturePool } = await createIsolatedSuite(t);

  const sId = `pghcs_${Date.now()}`;
  const rId = `pghcr_${Date.now()}`;
  const reqId = `pghcmsg_${Date.now()}`;
  const key = `pgh-cc-${Date.now()}`;

  await fixturePool.query("INSERT INTO users (id,nickname,stars_balance,role,created_at,updated_at) VALUES ($1,'S',200,'user',NOW(),NOW())", [sId]);
  await fixturePool.query("INSERT INTO users (id,nickname,stars_balance,role,created_at,updated_at) VALUES ($1,'R',50,'user',NOW(),NOW())", [rId]);
  await fixturePool.query("INSERT INTO message_requests (id,sender_id,receiver_id,price_in_stars,text,status,created_at,updated_at) VALUES ($1,$2,$3,50,'hi','payment_pending',NOW(),NOW())", [reqId, sId, rId]);

  const port = await getFreePort();
  const { server, url } = await spawnServer(t, { schema, port });

  const results = await Promise.allSettled([
    fetch(`${url}/messages/request/pay`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-User-Id': sId, 'Idempotency-Key': key }, body: JSON.stringify({ requestId: reqId }) }),
    fetch(`${url}/messages/request/pay`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-User-Id': sId, 'Idempotency-Key': key }, body: JSON.stringify({ requestId: reqId }) }),
  ]);

  const fulfilled = results.filter(r => r.status === 'fulfilled');
  assert.equal(fulfilled.length, 2, 'Both fulfilled');
  const bodies = await Promise.all(fulfilled.map(r => r.value.json()));
  assert.ok(bodies.find(b => b.idempotent === false), 'Normal');
  assert.ok(bodies.find(b => b.idempotent === true), 'Idempotent');

  await stopServer(server);

  const s = await fixturePool.query('SELECT stars_balance FROM users WHERE id=$1', [sId]);
  const expectedPayout = Math.floor(50 * 80 / 100);
  const r = await fixturePool.query('SELECT stars_balance FROM users WHERE id=$1', [rId]);
  const mr = await fixturePool.query('SELECT status FROM message_requests WHERE id=$1', [reqId]);
  const ops = await fixturePool.query("SELECT COUNT(*) as cnt FROM stars_operations WHERE actor_user_id=$1", [sId]);
  const entries = await fixturePool.query("SELECT COUNT(*) as cnt FROM stars_ledger_entries");

  assert.equal(s.rows[0].stars_balance, 200 - 50, 'Sender debited once');
  assert.equal(r.rows[0].stars_balance, 50 + expectedPayout, 'Receiver credited once');
  assert.equal(mr.rows[0].status, 'delivered');
  assert.equal(parseInt(ops.rows[0].cnt, 10), 1, 'One operation');
  assert.equal(parseInt(entries.rows[0].cnt, 10), expectedPayout > 0 ? 2 : 1, 'Exact ledger entries');
});

// ── Concurrent different-key ─────────────────────────────────────────

test('PG-HTTP: concurrent different-key — one 200, one 409 ALREADY_PROCESSED', { skip }, async (t) => {
  const { schema, fixturePool } = await createIsolatedSuite(t);

  const sId = `pghds_${Date.now()}`;
  const rId = `pghdr_${Date.now()}`;
  const reqId = `pghdmsg_${Date.now()}`;

  await fixturePool.query("INSERT INTO users (id,nickname,stars_balance,role,created_at,updated_at) VALUES ($1,'S',200,'user',NOW(),NOW())", [sId]);
  await fixturePool.query("INSERT INTO users (id,nickname,stars_balance,role,created_at,updated_at) VALUES ($1,'R',50,'user',NOW(),NOW())", [rId]);
  await fixturePool.query("INSERT INTO message_requests (id,sender_id,receiver_id,price_in_stars,text,status,created_at,updated_at) VALUES ($1,$2,$3,50,'hi','payment_pending',NOW(),NOW())", [reqId, sId, rId]);

  const port = await getFreePort();
  const { server, url } = await spawnServer(t, { schema, port });

  const results = await Promise.allSettled([
    fetch(`${url}/messages/request/pay`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-User-Id': sId, 'Idempotency-Key': `pgh-diff-a-${Date.now()}` }, body: JSON.stringify({ requestId: reqId }) }),
    fetch(`${url}/messages/request/pay`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-User-Id': sId, 'Idempotency-Key': `pgh-diff-b-${Date.now()}` }, body: JSON.stringify({ requestId: reqId }) }),
  ]);

  const statuses = results.map(r => r.status === 'fulfilled' ? r.value.status : -1);
  assert.equal(statuses.filter(s => s === 200).length, 1, 'One 200');
  assert.equal(statuses.filter(s => s === 409).length, 1, 'One 409');
  const conflict = results.find(r => r.status === 'fulfilled' && r.value.status === 409);
  assert.equal((await conflict.value.json()).code, 'ALREADY_PROCESSED');

  await stopServer(server);

  const s = await fixturePool.query('SELECT stars_balance FROM users WHERE id=$1', [sId]);
  assert.equal(s.rows[0].stars_balance, 200 - 50);
  const ops = await fixturePool.query("SELECT COUNT(*) as cnt FROM stars_operations WHERE actor_user_id=$1", [sId]);
  assert.equal(parseInt(ops.rows[0].cnt, 10), 1, 'One financial effect');
});

// ── Premium purchase ─────────────────────────────────────────────────

test('PG-HTTP: premium purchase — exact ownership, operation, ledger, artworks', { skip }, async (t) => {
  const { schema, fixturePool, adminPool } = await createIsolatedSuite(t);

  const uId = `pghcu_${Date.now()}`;
  const cId = `pghccol_${Date.now()}`;
  const price = 30;

  await fixturePool.query("INSERT INTO users (id,nickname,stars_balance,role,created_at,updated_at) VALUES ($1,'U',100,'user',NOW(),NOW())", [uId]);
  await fixturePool.query("INSERT INTO collections (id,title,pack_type,price_in_stars) VALUES ($1,'Test','premium',$2)", [cId, price]);

  const port = await getFreePort();
  const { server, url } = await spawnServer(t, { schema, port });

  const res = await fetch(`${url}/users/collections/${cId}/add`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-User-Id': uId, 'Idempotency-Key': 'pgh-buy-key-01' },
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.idempotent, false);

  await stopServer(server);

  const u = await fixturePool.query('SELECT stars_balance FROM users WHERE id=$1', [uId]);
  assert.equal(u.rows[0].stars_balance, 100 - price);

  const own = await fixturePool.query('SELECT * FROM collection_ownerships WHERE user_id=$1 AND collection_id=$2', [uId, cId]);
  assert.equal(own.rows.length, 1);
  assert.equal(own.rows[0].acquisition_type, 'premium');
  assert.equal(own.rows[0].price_paid, price);
  assert.ok(own.rows[0].stars_operation_id, 'operation_id non-null');

  const ops = await fixturePool.query("SELECT COUNT(*) as cnt FROM stars_operations WHERE actor_user_id=$1", [uId]);
  assert.equal(parseInt(ops.rows[0].cnt, 10), 1, 'One operation');

  const entries = await fixturePool.query("SELECT COUNT(*) as cnt FROM stars_ledger_entries WHERE operation_id IN (SELECT id FROM stars_operations WHERE actor_user_id=$1)", [uId]);
  assert.equal(parseInt(entries.rows[0].cnt, 10), 1, 'One ledger entry');

  const arts = await fixturePool.query("SELECT COUNT(*) as cnt FROM artworks WHERE owner_id=$1 AND collection_id=$2", [uId, cId]);
  assert.equal(parseInt(arts.rows[0].cnt, 10), 2, 'Two artworks');
});

// ── Concurrent premium purchase ──────────────────────────────────────

test('PG-HTTP: concurrent premium purchase — one 200, one 409, exact state', { skip }, async (t) => {
  const { schema, fixturePool } = await createIsolatedSuite(t);

  const uId = `pghcpu_${Date.now()}`;
  const cId = `pghcpcol_${Date.now()}`;
  const price = 30;

  await fixturePool.query("INSERT INTO users (id,nickname,stars_balance,role,created_at,updated_at) VALUES ($1,'U',100,'user',NOW(),NOW())", [uId]);
  await fixturePool.query("INSERT INTO collections (id,title,pack_type,price_in_stars) VALUES ($1,'Test','premium',$2)", [cId, price]);

  const port = await getFreePort();
  const { server, url } = await spawnServer(t, { schema, port });

  const results = await Promise.allSettled([
    fetch(`${url}/users/collections/${cId}/add`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-User-Id': uId, 'Idempotency-Key': `pgh-cp-a-${Date.now()}` } }),
    fetch(`${url}/users/collections/${cId}/add`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-User-Id': uId, 'Idempotency-Key': `pgh-cp-b-${Date.now()}` } }),
  ]);

  const statuses = results.map(r => r.status === 'fulfilled' ? r.value.status : -1);
  assert.equal(statuses.filter(s => s === 200).length, 1, 'One 200');
  assert.equal(statuses.filter(s => s === 409).length, 1, 'One 409');

  await stopServer(server);

  const u = await fixturePool.query('SELECT stars_balance FROM users WHERE id=$1', [uId]);
  assert.equal(u.rows[0].stars_balance, 100 - price);

  const ops = await fixturePool.query("SELECT COUNT(*) as cnt FROM stars_operations WHERE actor_user_id=$1", [uId]);
  assert.equal(parseInt(ops.rows[0].cnt, 10), 1);

  const owns = await fixturePool.query('SELECT COUNT(*) as cnt FROM collection_ownerships WHERE user_id=$1 AND collection_id=$2', [uId, cId]);
  assert.equal(parseInt(owns.rows[0].cnt, 10), 1);

  const entries = await fixturePool.query("SELECT COUNT(*) as cnt FROM stars_ledger_entries WHERE operation_id IN (SELECT id FROM stars_operations WHERE actor_user_id=$1)", [uId]);
  assert.equal(parseInt(entries.rows[0].cnt, 10), 1);

  const arts = await fixturePool.query("SELECT COUNT(*) as cnt FROM artworks WHERE owner_id=$1 AND collection_id=$2", [uId, cId]);
  assert.equal(parseInt(arts.rows[0].cnt, 10), 2);
});
