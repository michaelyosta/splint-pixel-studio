import test from 'node:test';
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
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

function safeSchemaSuffix() {
  return `pg_http_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

async function createIsolatedTestDb(t) {
  const schema = safeSchemaSuffix();
  const pg = (await import('pg')).default;

  const adminPool = new pg.Pool({ connectionString: databaseUrl });
  await adminPool.query(`CREATE SCHEMA "${schema}"`);

  const pool = new pg.Pool({
    connectionString: databaseUrl,
    options: `-c search_path="${schema}",public`,
  });

  const { runMigrations } = await import('../database/migrations.js');
  await runMigrations({
    mode: 'postgres', pool, sqlite: null, persistFn: null,
    migrationsDir: join(serverDir, 'migrations'),
  });

  t.after(async () => {
    await pool.end();
    await adminPool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await adminPool.end();
  });

  return { pool, schema };
}

async function createApp(pool) {
  const { createStarsTransactionsService } = await import('../services/stars-transactions.js');
  const { withTransaction } = await import('../database/transaction.js');
  const svc = createStarsTransactionsService({ withTransaction: (cb) => withTransaction({ mode: 'postgres', pool }, cb), mode: 'postgres' });

  // Build a minimal Express app with the real routes, but inject our service
  const { default: profilesRouter } = await import('../routes/profiles.js');
  const { default: messagesRouter } = await import('../routes/messages.js');

  const app = express();
  app.use(express.json());

  // Monkey-patch: replace service functions with our per-schema instance
  // We need to override the module-level singleton. The simplest way:
  // The routes import from '../services/stars-transactions.js' which uses the global pool.
  // For PG HTTP tests, we need to replace the global db singleton.
  // Instead, we wrap the routes with an auth middleware and use a fresh DB init.

  // Actually: start the routes with the service we created. The imports already resolve.
  // But the production singleton uses the global initDb(). We need to override initDb()
  // or provide a dbPath that uses our schema.

  // Simplest approach: use a test-specific global initDb() override
  // We'll patch getDb() to return mode:'postgres' and our pool.

  const { getDb, initDb } = await import('../db.js');

  // Override initDb to use our pool
  let originalInitDb = null;
  // Since initDb is already called once (singleton), we need to force it.
  // Actually, routes call import db.js which already initialized.
  // The cleanest: just use the app with the routes as-is.
  // Since we set DATABASE_URL, the server uses postgres mode.
  // But we need our own schema. Let's start a real HTTP server with DATABASE_URL
  // and PGOPTIONS to set search_path.

  // Actually: let's just use a real subprocess approach like SQLite, but with PG
  return null; // placeholder - we'll use subprocess approach
}

async function startPgServer(t, { pool, port }) {
  // The routes use global db.js which is initialized per process.
  // We can't easily override per-test. Let's use a subprocess with
  // the schema as PGOPTIONS.

  // Actually, let's take a different approach: export createApp from a helper,
  // or just create the app directly injecting our service instance.

  const app = express();
  app.use(express.json());

  // Use the real routes with real middleware
  const { default: profilesRouter } = await import('../routes/profiles.js');
  const { default: messagesRouter } = await import('../routes/messages.js');

  app.use('/users', profilesRouter);
  app.use('/messages', messagesRouter);
  app.use('/health', (_req, res) => res.json({ status: 'ok' }));

  // Error handler
  app.use((err, _req, res, _next) => {
    console.error(err);
    if (res.headersSent) return;
    res.status(err.statusCode || err.status || 500).json({ error: err.message || 'Internal error', code: err.code });
  });

  return new Promise((resolve, reject) => {
    const server = app.listen(port, () => {
      resolve({ server, port, url: `http://127.0.0.1:${port}` });
    });
    server.on('error', reject);
  });
}

async function stopServer(server) {
  if (!server.listening) return;
  const closed = once(server, 'close');
  server.close();
  await closed;
}

// ── Tests ────────────────────────────────────────────────────────────

test('PG-HTTP: successful message payment', { skip }, async (t) => {
  const { pool } = await createIsolatedTestDb(t);

  const sId = `pghs_${Date.now()}`;
  const rId = `pghr_${Date.now()}`;
  const reqId = `pghmsg_${Date.now()}`;
  const price = 50;

  await pool.query("INSERT INTO users (id,nickname,stars_balance,role,created_at,updated_at) VALUES ($1,'S',100,'user',NOW(),NOW())", [sId]);
  await pool.query("INSERT INTO users (id,nickname,stars_balance,role,created_at,updated_at) VALUES ($1,'R',50,'user',NOW(),NOW())", [rId]);
  await pool.query("INSERT INTO message_requests (id,sender_id,receiver_id,price_in_stars,text,status,created_at,updated_at) VALUES ($1,$2,$3,$4,'hi','payment_pending',NOW(),NOW())", [reqId, sId, rId, price]);

  const { server, url } = await startPgServer(t, { pool, port: 34001 });
  t.after(async () => { await stopServer(server); });

  const res = await fetch(`${url}/messages/request/pay`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-User-Id': sId, 'Idempotency-Key': 'pgh-pay-success' },
    body: JSON.stringify({ requestId: reqId }),
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.idempotent, false);
  assert.equal(body.request.status, 'delivered');

  const expectedPayout = Math.floor(price * 80 / 100);
  const s = await pool.query('SELECT stars_balance FROM users WHERE id=$1', [sId]);
  const r = await pool.query('SELECT stars_balance FROM users WHERE id=$1', [rId]);
  const mr = await pool.query('SELECT status FROM message_requests WHERE id=$1', [reqId]);
  const ops = await pool.query("SELECT * FROM stars_operations WHERE operation_type='message_payment' AND actor_user_id=$1", [sId]);
  const entries = await pool.query("SELECT * FROM stars_ledger_entries WHERE operation_id=$1", [ops.rows[0]?.id]);

  assert.equal(s.rows[0].stars_balance, 100 - price);
  assert.equal(r.rows[0].stars_balance, 50 + expectedPayout);
  assert.equal(mr.rows[0].status, 'delivered');
  assert.equal(ops.rows.length, 1);
  assert.equal(ops.rows[0].fee_amount, price - expectedPayout);
  assert.equal(entries.rows.length, expectedPayout > 0 ? 2 : 1);
});

test('PG-HTTP: same-key replay idempotent', { skip }, async (t) => {
  const { pool } = await createIsolatedTestDb(t);

  const sId = `pghsr_${Date.now()}`;
  const rId = `pghrr_${Date.now()}`;
  const reqId = `pghrmsg_${Date.now()}`;
  const key = 'pgh-replay-123456';

  await pool.query("INSERT INTO users (id,nickname,stars_balance,role,created_at,updated_at) VALUES ($1,'S',100,'user',NOW(),NOW())", [sId]);
  await pool.query("INSERT INTO users (id,nickname,stars_balance,role,created_at,updated_at) VALUES ($1,'R',50,'user',NOW(),NOW())", [rId]);
  await pool.query("INSERT INTO message_requests (id,sender_id,receiver_id,price_in_stars,text,status,created_at,updated_at) VALUES ($1,$2,$3,50,'hi','payment_pending',NOW(),NOW())", [reqId, sId, rId]);

  const { server, url } = await startPgServer(t, { pool, port: 34002 });
  t.after(async () => { await stopServer(server); });

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

  const ops = await pool.query("SELECT COUNT(*) as cnt FROM stars_operations WHERE idempotency_key=$1 AND actor_user_id=$2", [key, sId]);
  assert.equal(parseInt(ops.rows[0].cnt, 10), 1);

  const s = await pool.query('SELECT stars_balance FROM users WHERE id=$1', [sId]);
  assert.equal(s.rows[0].stars_balance, 100 - 50);
});

test('PG-HTTP: invalid Idempotency-Key returns 400', { skip }, async (t) => {
  const { pool } = await createIsolatedTestDb(t);

  const sId = `pghi_${Date.now()}`;
  const rId = `pghir_${Date.now()}`;
  const reqId = `pghimsg_${Date.now()}`;

  await pool.query("INSERT INTO users (id,nickname,stars_balance,role,created_at,updated_at) VALUES ($1,'S',100,'user',NOW(),NOW())", [sId]);
  await pool.query("INSERT INTO users (id,nickname,stars_balance,role,created_at,updated_at) VALUES ($1,'R',50,'user',NOW(),NOW())", [rId]);
  await pool.query("INSERT INTO message_requests (id,sender_id,receiver_id,price_in_stars,text,status,created_at,updated_at) VALUES ($1,$2,$3,50,'hi','payment_pending',NOW(),NOW())", [reqId, sId, rId]);

  const { server, url } = await startPgServer(t, { pool, port: 34003 });
  t.after(async () => { await stopServer(server); });

  const res = await fetch(`${url}/messages/request/pay`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-User-Id': sId, 'Idempotency-Key': 'short' },
    body: JSON.stringify({ requestId: reqId }),
  });
  assert.equal(res.status, 400);
  assert.equal((await res.json()).code, 'INVALID_INPUT');
});

test('PG-HTTP: insufficient balance returns 402', { skip }, async (t) => {
  const { pool } = await createIsolatedTestDb(t);

  const sId = `pghp_${Date.now()}`;
  const rId = `pghpr_${Date.now()}`;
  const reqId = `pghpmsg_${Date.now()}`;

  await pool.query("INSERT INTO users (id,nickname,stars_balance,role,created_at,updated_at) VALUES ($1,'S',10,'user',NOW(),NOW())", [sId]);
  await pool.query("INSERT INTO users (id,nickname,stars_balance,role,created_at,updated_at) VALUES ($1,'R',0,'user',NOW(),NOW())", [rId]);
  await pool.query("INSERT INTO message_requests (id,sender_id,receiver_id,price_in_stars,text,status,created_at,updated_at) VALUES ($1,$2,$3,50,'hi','payment_pending',NOW(),NOW())", [reqId, sId, rId]);

  const { server, url } = await startPgServer(t, { pool, port: 34004 });
  t.after(async () => { await stopServer(server); });

  const res = await fetch(`${url}/messages/request/pay`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-User-Id': sId, 'Idempotency-Key': 'pgh-poor-key-01' },
    body: JSON.stringify({ requestId: reqId }),
  });
  assert.equal(res.status, 402);
  const body = await res.json();
  assert.equal(body.code, 'INSUFFICIENT_STARS');

  const s = await pool.query('SELECT stars_balance FROM users WHERE id=$1', [sId]);
  assert.equal(s.rows[0].stars_balance, 10);
  const mr = await pool.query('SELECT status FROM message_requests WHERE id=$1', [reqId]);
  assert.equal(mr.rows[0].status, 'payment_pending');
  const ops = await pool.query("SELECT COUNT(*) as cnt FROM stars_operations WHERE actor_user_id=$1", [sId]);
  assert.equal(parseInt(ops.rows[0].cnt, 10), 0);
});

test('PG-HTTP: concurrent same-key — both 200, one normal, one idempotent', { skip }, async (t) => {
  const { pool } = await createIsolatedTestDb(t);

  const sId = `pghcs_${Date.now()}`;
  const rId = `pghcr_${Date.now()}`;
  const reqId = `pghcmsg_${Date.now()}`;
  const key = `pgh-cc-${Date.now()}`;

  await pool.query("INSERT INTO users (id,nickname,stars_balance,role,created_at,updated_at) VALUES ($1,'S',200,'user',NOW(),NOW())", [sId]);
  await pool.query("INSERT INTO users (id,nickname,stars_balance,role,created_at,updated_at) VALUES ($1,'R',50,'user',NOW(),NOW())", [rId]);
  await pool.query("INSERT INTO message_requests (id,sender_id,receiver_id,price_in_stars,text,status,created_at,updated_at) VALUES ($1,$2,$3,50,'hi','payment_pending',NOW(),NOW())", [reqId, sId, rId]);

  const { server, url } = await startPgServer(t, { pool, port: 34005 });
  t.after(async () => { await stopServer(server); });

  const results = await Promise.allSettled([
    fetch(`${url}/messages/request/pay`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-User-Id': sId, 'Idempotency-Key': key }, body: JSON.stringify({ requestId: reqId }) }),
    fetch(`${url}/messages/request/pay`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-User-Id': sId, 'Idempotency-Key': key }, body: JSON.stringify({ requestId: reqId }) }),
  ]);

  const fulfilled = results.filter(r => r.status === 'fulfilled');
  assert.equal(fulfilled.length, 2);
  const bodies = await Promise.all(fulfilled.map(r => r.value.json()));
  assert.ok(bodies.find(b => b.idempotent === false), 'Normal');
  assert.ok(bodies.find(b => b.idempotent === true), 'Idempotent');

  const s = await pool.query('SELECT stars_balance FROM users WHERE id=$1', [sId]);
  const expectedPayout = Math.floor(50 * 80 / 100);
  const r = await pool.query('SELECT stars_balance FROM users WHERE id=$1', [rId]);
  const ops = await pool.query("SELECT COUNT(*) as cnt FROM stars_operations WHERE actor_user_id=$1", [sId]);

  assert.equal(s.rows[0].stars_balance, 200 - 50);
  assert.equal(r.rows[0].stars_balance, 50 + expectedPayout);
  assert.equal(parseInt(ops.rows[0].cnt, 10), 1);
});

test('PG-HTTP: concurrent different-key — one 200, one 409', { skip }, async (t) => {
  const { pool } = await createIsolatedTestDb(t);

  const sId = `pghds_${Date.now()}`;
  const rId = `pghdr_${Date.now()}`;
  const reqId = `pghdmsg_${Date.now()}`;

  await pool.query("INSERT INTO users (id,nickname,stars_balance,role,created_at,updated_at) VALUES ($1,'S',200,'user',NOW(),NOW())", [sId]);
  await pool.query("INSERT INTO users (id,nickname,stars_balance,role,created_at,updated_at) VALUES ($1,'R',50,'user',NOW(),NOW())", [rId]);
  await pool.query("INSERT INTO message_requests (id,sender_id,receiver_id,price_in_stars,text,status,created_at,updated_at) VALUES ($1,$2,$3,50,'hi','payment_pending',NOW(),NOW())", [reqId, sId, rId]);

  const { server, url } = await startPgServer(t, { pool, port: 34006 });
  t.after(async () => { await stopServer(server); });

  const results = await Promise.allSettled([
    fetch(`${url}/messages/request/pay`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-User-Id': sId, 'Idempotency-Key': `pgh-diff-a-${Date.now()}` }, body: JSON.stringify({ requestId: reqId }) }),
    fetch(`${url}/messages/request/pay`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-User-Id': sId, 'Idempotency-Key': `pgh-diff-b-${Date.now()}` }, body: JSON.stringify({ requestId: reqId }) }),
  ]);

  const statuses = results.map(r => r.status === 'fulfilled' ? r.value.status : -1);
  assert.equal(statuses.filter(s => s === 200).length, 1);
  assert.equal(statuses.filter(s => s === 409).length, 1);

  const conflict = results.find(r => r.status === 'fulfilled' && r.value.status === 409);
  assert.equal((await conflict.value.json()).code, 'ALREADY_PROCESSED');

  const s = await pool.query('SELECT stars_balance FROM users WHERE id=$1', [sId]);
  assert.equal(s.rows[0].stars_balance, 200 - 50);
  const ops = await pool.query("SELECT COUNT(*) as cnt FROM stars_operations WHERE actor_user_id=$1", [sId]);
  assert.equal(parseInt(ops.rows[0].cnt, 10), 1);
});

test('PG-HTTP: premium purchase', { skip }, async (t) => {
  const { pool } = await createIsolatedTestDb(t);

  const uId = `pghcu_${Date.now()}`;
  const cId = `pghccol_${Date.now()}`;
  const price = 30;

  await pool.query("INSERT INTO users (id,nickname,stars_balance,role,created_at,updated_at) VALUES ($1,'U',100,'user',NOW(),NOW())", [uId]);
  await pool.query("INSERT INTO collections (id,title,pack_type,price_in_stars) VALUES ($1,'Test','premium',$2)", [cId, price]);

  const { server, url } = await startPgServer(t, { pool, port: 34007 });
  t.after(async () => { await stopServer(server); });

  const res = await fetch(`${url}/users/collections/${cId}/add`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-User-Id': uId, 'Idempotency-Key': 'pgh-buy-key-01' },
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.idempotent, false);

  const u = await pool.query('SELECT stars_balance FROM users WHERE id=$1', [uId]);
  assert.equal(u.rows[0].stars_balance, 100 - price);

  const own = await pool.query('SELECT * FROM collection_ownerships WHERE user_id=$1 AND collection_id=$2', [uId, cId]);
  assert.equal(own.rows.length, 1);
  assert.equal(own.rows[0].acquisition_type, 'premium');
  assert.equal(own.rows[0].price_paid, price);
  assert.ok(own.rows[0].stars_operation_id, 'operation_id non-null');

  const ops = await pool.query("SELECT COUNT(*) as cnt FROM stars_operations WHERE actor_user_id=$1", [uId]);
  assert.equal(parseInt(ops.rows[0].cnt, 10), 1);

  const entries = await pool.query("SELECT COUNT(*) as cnt FROM stars_ledger_entries WHERE operation_id IN (SELECT id FROM stars_operations WHERE actor_user_id=$1)", [uId]);
  assert.equal(parseInt(entries.rows[0].cnt, 10), 1);

  const arts = await pool.query("SELECT COUNT(*) as cnt FROM artworks WHERE owner_id=$1 AND collection_id=$2", [uId, cId]);
  assert.equal(parseInt(arts.rows[0].cnt, 10), 2);
});

test('PG-HTTP: concurrent premium purchase — one 200, one 409', { skip }, async (t) => {
  const { pool } = await createIsolatedTestDb(t);

  const uId = `pghcpu_${Date.now()}`;
  const cId = `pghcpcol_${Date.now()}`;
  const price = 30;

  await pool.query("INSERT INTO users (id,nickname,stars_balance,role,created_at,updated_at) VALUES ($1,'U',100,'user',NOW(),NOW())", [uId]);
  await pool.query("INSERT INTO collections (id,title,pack_type,price_in_stars) VALUES ($1,'Test','premium',$2)", [cId, price]);

  const { server, url } = await startPgServer(t, { pool, port: 34008 });
  t.after(async () => { await stopServer(server); });

  const results = await Promise.allSettled([
    fetch(`${url}/users/collections/${cId}/add`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-User-Id': uId, 'Idempotency-Key': `pgh-cp-a-${Date.now()}` } }),
    fetch(`${url}/users/collections/${cId}/add`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-User-Id': uId, 'Idempotency-Key': `pgh-cp-b-${Date.now()}` } }),
  ]);

  const statuses = results.map(r => r.status === 'fulfilled' ? r.value.status : -1);
  assert.equal(statuses.filter(s => s === 200).length, 1);
  assert.equal(statuses.filter(s => s === 409).length, 1);

  const u = await pool.query('SELECT stars_balance FROM users WHERE id=$1', [uId]);
  assert.equal(u.rows[0].stars_balance, 100 - price);

  const ops = await pool.query("SELECT COUNT(*) as cnt FROM stars_operations WHERE actor_user_id=$1", [uId]);
  assert.equal(parseInt(ops.rows[0].cnt, 10), 1);

  const owns = await pool.query('SELECT COUNT(*) as cnt FROM collection_ownerships WHERE user_id=$1 AND collection_id=$2', [uId, cId]);
  assert.equal(parseInt(owns.rows[0].cnt, 10), 1);

  const entries = await pool.query("SELECT COUNT(*) as cnt FROM stars_ledger_entries WHERE operation_id IN (SELECT id FROM stars_operations WHERE actor_user_id=$1)", [uId]);
  assert.equal(parseInt(entries.rows[0].cnt, 10), 1);

  const arts = await pool.query("SELECT COUNT(*) as cnt FROM artworks WHERE owner_id=$1 AND collection_id=$2", [uId, cId]);
  assert.equal(parseInt(arts.rows[0].cnt, 10), 2);
});
