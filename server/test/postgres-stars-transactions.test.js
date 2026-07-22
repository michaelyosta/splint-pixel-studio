import test from 'node:test';
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';

const databaseUrl = process.env.DATABASE_URL;

const serverDir = join(dirname(fileURLToPath(import.meta.url)), '..');

if (databaseUrl) {
  process.env.ALLOW_DEV_AUTH = 'true';
  if (process.env.NODE_ENV === 'production') {
    delete process.env.NODE_ENV;
  }
}

// Unique schema per test file — avoids append-only table DELETE issues
const SCHEMA = `stars_test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

const skip = !databaseUrl;

if (!databaseUrl) {
  test('PostgreSQL Stars tests skipped (no DATABASE_URL)', { skip: true }, () => {});
}

let _adminPool = null;
let _migrationsRan = false;

async function getAdminPool() {
  if (_adminPool) return _adminPool;
  const pg = (await import('pg')).default;
  _adminPool = new pg.Pool({ connectionString: databaseUrl });
  return _adminPool;
}

async function ensureSchema() {
  const admin = await getAdminPool();
  await admin.query(`CREATE SCHEMA IF NOT EXISTS "${SCHEMA}"`);
}

async function getTestPool() {
  const pg = (await import('pg')).default;
  const pool = new pg.Pool({
    connectionString: databaseUrl,
    options: `-c search_path="${SCHEMA}",public`,
  });

  if (!_migrationsRan) {
    const { runMigrations } = await import('../database/migrations.js');
    await runMigrations({
      mode: 'postgres', pool, sqlite: null, persistFn: null,
      migrationsDir: join(serverDir, 'migrations'),
    });
    _migrationsRan = true;
  }

  return pool;
}

// Global cleanup: drop entire test schema after suite
let _cleanupDone = false;
function ensureGlobalCleanup() {
  if (_cleanupDone) return;
  _cleanupDone = true;

  test('PG: schema cleanup', { skip }, async (t) => {
    const admin = await getAdminPool();
    await admin.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
    await admin.end();
  });
}

// ── Low-level service tests ──────────────────────────────────────────

test('PG: successful message payment', { skip }, async (t) => {
  await ensureSchema();
  ensureGlobalCleanup();
  const pool = await getTestPool();

  const senderId = `pgs_${Date.now()}`;
  const receiverId = `pgr_${Date.now()}`;
  const requestId = `pgmsg_${Date.now()}`;
  const price = 50;

  await pool.query("INSERT INTO users (id,nickname,stars_balance,role,created_at,updated_at) VALUES ($1,'S',100,'user',NOW(),NOW())", [senderId]);
  await pool.query("INSERT INTO users (id,nickname,stars_balance,role,created_at,updated_at) VALUES ($1,'R',50,'user',NOW(),NOW())", [receiverId]);
  await pool.query("INSERT INTO message_requests (id,sender_id,receiver_id,price_in_stars,text,status,created_at,updated_at) VALUES ($1,$2,$3,$4,'hi','payment_pending',NOW(),NOW())", [requestId, senderId, receiverId, price]);

  const { createStarsTransactionsService } = await import('../services/stars-transactions.js');
  const { withTransaction } = await import('../database/transaction.js');
  const svc = createStarsTransactionsService({ withTransaction: (cb) => withTransaction({ mode: 'postgres', pool }, cb), mode: 'postgres' });

  const result = await svc.payMessageRequest({ requestId, authenticatedUserId: senderId, idempotencyKey: `pgpay-${Date.now()}` });
  assert.equal(result.idempotent, false);
  assert.ok(result.request);

  const expectedPayout = Math.floor(price * 80 / 100);
  const s = await pool.query('SELECT stars_balance FROM users WHERE id=$1', [senderId]);
  const r = await pool.query('SELECT stars_balance FROM users WHERE id=$1', [receiverId]);
  const mr = await pool.query('SELECT status FROM message_requests WHERE id=$1', [requestId]);
  const ops = await pool.query("SELECT * FROM stars_operations WHERE operation_type='message_payment'");
  const entries = await pool.query("SELECT * FROM stars_ledger_entries WHERE operation_id=$1", [ops.rows[0]?.id]);

  assert.equal(s.rows[0].stars_balance, 100 - price);
  assert.equal(r.rows[0].stars_balance, 50 + expectedPayout);
  assert.equal(mr.rows[0].status, 'delivered');
  assert.equal(ops.rows.length, 1);
  assert.equal(ops.rows[0].fee_amount, price - expectedPayout);
  assert.equal(ops.rows[0].gross_amount, price);
  assert.equal(entries.rows.length, expectedPayout > 0 ? 2 : 1);

  await pool.end();
});

test('PG: same-key replay idempotent', { skip }, async (t) => {
  await ensureSchema();
  ensureGlobalCleanup();
  const pool = await getTestPool();

  const senderId = `pgsr_${Date.now()}`;
  const receiverId = `pgrr_${Date.now()}`;
  const requestId = `pgrmsg_${Date.now()}`;
  const key = 'pg-replay-key-123456';

  await pool.query("INSERT INTO users (id,nickname,stars_balance,role,created_at,updated_at) VALUES ($1,'S',100,'user',NOW(),NOW())", [senderId]);
  await pool.query("INSERT INTO users (id,nickname,stars_balance,role,created_at,updated_at) VALUES ($1,'R',50,'user',NOW(),NOW())", [receiverId]);
  await pool.query("INSERT INTO message_requests (id,sender_id,receiver_id,price_in_stars,text,status,created_at,updated_at) VALUES ($1,$2,$3,50,'hi','payment_pending',NOW(),NOW())", [requestId, senderId, receiverId]);

  const { createStarsTransactionsService } = await import('../services/stars-transactions.js');
  const { withTransaction } = await import('../database/transaction.js');
  const svc = createStarsTransactionsService({ withTransaction: (cb) => withTransaction({ mode: 'postgres', pool }, cb), mode: 'postgres' });

  const r1 = await svc.payMessageRequest({ requestId, authenticatedUserId: senderId, idempotencyKey: key });
  assert.equal(r1.idempotent, false);
  assert.ok(r1.request);

  const r2 = await svc.payMessageRequest({ requestId, authenticatedUserId: senderId, idempotencyKey: key });
  assert.equal(r2.idempotent, true);
  assert.ok(r2.request);

  const ops = await pool.query("SELECT * FROM stars_operations WHERE idempotency_key=$1", [key]);
  assert.equal(ops.rows.length, 1);

  const entries = await pool.query("SELECT * FROM stars_ledger_entries WHERE operation_id=$1", [ops.rows[0].id]);
  const price = 50;
  const expectedPayout = Math.floor(price * 80 / 100);
  assert.equal(entries.rows.length, expectedPayout > 0 ? 2 : 1);

  await pool.end();
});

test('PG: concurrent same-key payments — two fulfilled, one normal, one idempotent', { skip }, async (t) => {
  await ensureSchema();
  ensureGlobalCleanup();
  const pool = await getTestPool();

  const senderId = `pgcs_${Date.now()}`;
  const receiverId = `pgcr_${Date.now()}`;
  const requestId = `pgcmsg_${Date.now()}`;
  const key = `pg-cc-key-${Date.now()}`;
  const price = 50;

  await pool.query("INSERT INTO users (id,nickname,stars_balance,role,created_at,updated_at) VALUES ($1,'S',200,'user',NOW(),NOW())", [senderId]);
  await pool.query("INSERT INTO users (id,nickname,stars_balance,role,created_at,updated_at) VALUES ($1,'R',50,'user',NOW(),NOW())", [receiverId]);
  await pool.query("INSERT INTO message_requests (id,sender_id,receiver_id,price_in_stars,text,status,created_at,updated_at) VALUES ($1,$2,$3,$4,'hi','payment_pending',NOW(),NOW())", [requestId, senderId, receiverId, price]);

  const { createStarsTransactionsService } = await import('../services/stars-transactions.js');
  const { withTransaction } = await import('../database/transaction.js');

  const results = await Promise.allSettled([
    createStarsTransactionsService({ withTransaction: (cb) => withTransaction({ mode: 'postgres', pool }, cb), mode: 'postgres' }).payMessageRequest({ requestId, authenticatedUserId: senderId, idempotencyKey: key }),
    createStarsTransactionsService({ withTransaction: (cb) => withTransaction({ mode: 'postgres', pool }, cb), mode: 'postgres' }).payMessageRequest({ requestId, authenticatedUserId: senderId, idempotencyKey: key }),
  ]);

  const fulfilled = results.filter(r => r.status === 'fulfilled');
  assert.equal(fulfilled.length, 2, 'Both should be fulfilled');

  const normal = fulfilled.find(r => r.value.idempotent === false);
  const replay = fulfilled.find(r => r.value.idempotent === true);
  assert.ok(normal, 'One normal success');
  assert.ok(replay, 'One idempotent replay');
  assert.equal(replay.value.operation_id, normal.value.operation_id);

  // Verify exactly one financial effect
  const s = await pool.query('SELECT stars_balance FROM users WHERE id=$1', [senderId]);
  const r = await pool.query('SELECT stars_balance FROM users WHERE id=$1', [receiverId]);
  const mr = await pool.query('SELECT status FROM message_requests WHERE id=$1', [requestId]);
  const ops = await pool.query("SELECT COUNT(*) as cnt FROM stars_operations WHERE idempotency_key=$1", [key]);
  const entries = await pool.query("SELECT COUNT(*) as cnt FROM stars_ledger_entries WHERE operation_id IN (SELECT id FROM stars_operations WHERE idempotency_key=$1)", [key]);

  assert.equal(s.rows[0].stars_balance, 200 - price, 'Sender debited exactly once');
  const expectedPayout = Math.floor(price * 80 / 100);
  assert.equal(r.rows[0].stars_balance, 50 + expectedPayout, 'Receiver credited once');
  assert.equal(mr.rows[0].status, 'delivered');
  assert.equal(parseInt(ops.rows[0].cnt, 10), 1, 'One operation');
  assert.equal(parseInt(entries.rows[0].cnt, 10), expectedPayout > 0 ? 2 : 1, 'Exact ledger entries');

  await pool.end();
});

test('PG: concurrent different-key payments — one success, one ALREADY_PROCESSED', { skip }, async (t) => {
  await ensureSchema();
  ensureGlobalCleanup();
  const pool = await getTestPool();

  const senderId = `pgds_${Date.now()}`;
  const receiverId = `pgdr_${Date.now()}`;
  const requestId = `pgdmsg_${Date.now()}`;
  const price = 50;

  await pool.query("INSERT INTO users (id,nickname,stars_balance,role,created_at,updated_at) VALUES ($1,'S',200,'user',NOW(),NOW())", [senderId]);
  await pool.query("INSERT INTO users (id,nickname,stars_balance,role,created_at,updated_at) VALUES ($1,'R',50,'user',NOW(),NOW())", [receiverId]);
  await pool.query("INSERT INTO message_requests (id,sender_id,receiver_id,price_in_stars,text,status,created_at,updated_at) VALUES ($1,$2,$3,$4,'hi','payment_pending',NOW(),NOW())", [requestId, senderId, receiverId, price]);

  const { createStarsTransactionsService } = await import('../services/stars-transactions.js');
  const { withTransaction } = await import('../database/transaction.js');
  const { StarsTransactionError } = await import('../services/stars-transactions.js');

  const results = await Promise.allSettled([
    createStarsTransactionsService({ withTransaction: (cb) => withTransaction({ mode: 'postgres', pool }, cb), mode: 'postgres' }).payMessageRequest({ requestId, authenticatedUserId: senderId, idempotencyKey: `pg-diff-a-${Date.now()}` }),
    createStarsTransactionsService({ withTransaction: (cb) => withTransaction({ mode: 'postgres', pool }, cb), mode: 'postgres' }).payMessageRequest({ requestId, authenticatedUserId: senderId, idempotencyKey: `pg-diff-b-${Date.now()}` }),
  ]);

  const fulfilled = results.filter(r => r.status === 'fulfilled');
  const rejected = results.filter(r => r.status === 'rejected');
  assert.equal(fulfilled.length, 1, 'Exactly one success');
  assert.equal(rejected.length, 1, 'Exactly one rejection');

  const rejection = rejected[0].reason;
  assert.ok(rejection instanceof StarsTransactionError, 'Rejection is StarsTransactionError');
  assert.equal(rejection.code, 'ALREADY_PROCESSED');
  assert.equal(rejection.statusCode, 409);

  const s = await pool.query('SELECT stars_balance FROM users WHERE id=$1', [senderId]);
  assert.equal(s.rows[0].stars_balance, 200 - price, 'Debited once');

  const ops = await pool.query("SELECT COUNT(*) as cnt FROM stars_operations");
  assert.equal(parseInt(ops.rows[0].cnt, 10), 1, 'One financial effect');

  await pool.end();
});

test('PG: same key different natural references — one success, one IDEMPOTENCY_KEY_REUSED', { skip }, async (t) => {
  await ensureSchema();
  ensureGlobalCleanup();
  const pool = await getTestPool();

  const senderId = `pgsk_${Date.now()}`;
  const receiverId = `pgskr_${Date.now()}`;
  const req1 = `pgsk1_${Date.now()}`;
  const req2 = `pgsk2_${Date.now()}`;
  const key = `pg-sk-key-${Date.now()}`;
  const price = 50;

  await pool.query("INSERT INTO users (id,nickname,stars_balance,role,created_at,updated_at) VALUES ($1,'S',400,'user',NOW(),NOW())", [senderId]);
  await pool.query("INSERT INTO users (id,nickname,stars_balance,role,created_at,updated_at) VALUES ($1,'R',50,'user',NOW(),NOW())", [receiverId]);
  await pool.query("INSERT INTO message_requests (id,sender_id,receiver_id,price_in_stars,text,status,created_at,updated_at) VALUES ($1,$2,$3,$4,'a','payment_pending',NOW(),NOW())", [req1, senderId, receiverId, price]);
  await pool.query("INSERT INTO message_requests (id,sender_id,receiver_id,price_in_stars,text,status,created_at,updated_at) VALUES ($1,$2,$3,$4,'b','payment_pending',NOW(),NOW())", [req2, senderId, receiverId, price]);

  const { createStarsTransactionsService } = await import('../services/stars-transactions.js');
  const { withTransaction } = await import('../database/transaction.js');
  const { StarsTransactionError } = await import('../services/stars-transactions.js');

  // First payment succeeds
  const svc1 = createStarsTransactionsService({ withTransaction: (cb) => withTransaction({ mode: 'postgres', pool }, cb), mode: 'postgres' });
  const r1 = await svc1.payMessageRequest({ requestId: req1, authenticatedUserId: senderId, idempotencyKey: key });
  assert.equal(r1.idempotent, false);

  // Second payment with same key but different request → IDEMPOTENCY_KEY_REUSED
  const svc2 = createStarsTransactionsService({ withTransaction: (cb) => withTransaction({ mode: 'postgres', pool }, cb), mode: 'postgres' });
  try {
    await svc2.payMessageRequest({ requestId: req2, authenticatedUserId: senderId, idempotencyKey: key });
    assert.fail('Should have thrown');
  } catch (e) {
    assert.ok(e instanceof StarsTransactionError);
    assert.equal(e.code, 'IDEMPOTENCY_KEY_REUSED');
    assert.equal(e.statusCode, 409);
  }

  // Second request should be unchanged
  const mr2 = await pool.query('SELECT status FROM message_requests WHERE id=$1', [req2]);
  assert.equal(mr2.rows[0].status, 'payment_pending');

  await pool.end();
});

test('PG: cross-payment A->B and B->A no deadlock', { skip }, async (t) => {
  await ensureSchema();
  ensureGlobalCleanup();
  const pool = await getTestPool();

  const userA = `pgxa_${Date.now()}`;
  const userB = `pgxb_${Date.now()}`;
  const reqAB = `pgxab_${Date.now()}`;
  const reqBA = `pgxba_${Date.now()}`;
  const price = 30;

  await pool.query("INSERT INTO users (id,nickname,stars_balance,role,created_at,updated_at) VALUES ($1,'A',200,'user',NOW(),NOW())", [userA]);
  await pool.query("INSERT INTO users (id,nickname,stars_balance,role,created_at,updated_at) VALUES ($1,'B',200,'user',NOW(),NOW())", [userB]);
  await pool.query("INSERT INTO message_requests (id,sender_id,receiver_id,price_in_stars,text,status,created_at,updated_at) VALUES ($1,$2,$3,$4,'ab','payment_pending',NOW(),NOW())", [reqAB, userA, userB, price]);
  await pool.query("INSERT INTO message_requests (id,sender_id,receiver_id,price_in_stars,text,status,created_at,updated_at) VALUES ($1,$2,$3,$4,'ba','payment_pending',NOW(),NOW())", [reqBA, userB, userA, price]);

  const { createStarsTransactionsService } = await import('../services/stars-transactions.js');
  const { withTransaction } = await import('../database/transaction.js');
  const svc = createStarsTransactionsService({ withTransaction: (cb) => withTransaction({ mode: 'postgres', pool }, cb), mode: 'postgres' });

  const results = await Promise.allSettled([
    svc.payMessageRequest({ requestId: reqAB, authenticatedUserId: userA, idempotencyKey: `pg-xab-${Date.now()}` }),
    svc.payMessageRequest({ requestId: reqBA, authenticatedUserId: userB, idempotencyKey: `pg-xba-${Date.now()}` }),
  ]);

  const fulfilled = results.filter(r => r.status === 'fulfilled');
  assert.equal(fulfilled.length, 2, `Both cross payments should succeed, got ${fulfilled.length}`);

  const a = await pool.query('SELECT stars_balance FROM users WHERE id=$1', [userA]);
  const b = await pool.query('SELECT stars_balance FROM users WHERE id=$1', [userB]);
  const payout = Math.floor(price * 80 / 100);

  assert.equal(a.rows[0].stars_balance, 200 - price + payout, 'A: paid B, received from B');
  assert.equal(b.rows[0].stars_balance, 200 - price + payout, 'B: paid A, received from A');

  const ops = await pool.query("SELECT COUNT(*) as cnt FROM stars_operations");
  assert.equal(parseInt(ops.rows[0].cnt, 10), 2, 'Two operations');
  const entries = await pool.query("SELECT COUNT(*) as cnt FROM stars_ledger_entries");
  assert.ok(parseInt(entries.rows[0].cnt, 10) >= 4, 'At least 4 ledger entries (2 debits + 2 credits)');

  await pool.end();
});

test('PG: forced rollback after debit via hooks', { skip }, async (t) => {
  await ensureSchema();
  ensureGlobalCleanup();
  const pool = await getTestPool();

  const senderId = `pgfs_${Date.now()}`;
  const receiverId = `pgfr_${Date.now()}`;
  const requestId = `pgfmsg_${Date.now()}`;
  const price = 50;

  await pool.query("INSERT INTO users (id,nickname,stars_balance,role,created_at,updated_at) VALUES ($1,'S',100,'user',NOW(),NOW())", [senderId]);
  await pool.query("INSERT INTO users (id,nickname,stars_balance,role,created_at,updated_at) VALUES ($1,'R',50,'user',NOW(),NOW())", [receiverId]);
  await pool.query("INSERT INTO message_requests (id,sender_id,receiver_id,price_in_stars,text,status,created_at,updated_at) VALUES ($1,$2,$3,$4,'test','payment_pending',NOW(),NOW())", [requestId, senderId, receiverId, price]);

  const { createStarsTransactionsService } = await import('../services/stars-transactions.js');
  const { withTransaction } = await import('../database/transaction.js');

  const svc = createStarsTransactionsService({
    withTransaction: (cb) => withTransaction({ mode: 'postgres', pool }, cb),
    mode: 'postgres',
    hooks: { afterDebit: () => { throw new Error('Simulated failure after debit'); } },
  });

  let rolledBack = false;
  try {
    await svc.payMessageRequest({ requestId, authenticatedUserId: senderId, idempotencyKey: `pg-fail-${Date.now()}` });
  } catch (e) {
    if (e.message === 'Simulated failure after debit') rolledBack = true;
    else throw e;
  }
  assert.ok(rolledBack);

  const s = await pool.query('SELECT stars_balance FROM users WHERE id=$1', [senderId]);
  const r = await pool.query('SELECT stars_balance FROM users WHERE id=$1', [receiverId]);
  const mr = await pool.query('SELECT status FROM message_requests WHERE id=$1', [requestId]);
  const ops = await pool.query('SELECT COUNT(*) as cnt FROM stars_operations');

  assert.equal(s.rows[0].stars_balance, 100, 'Sender balance restored');
  assert.equal(r.rows[0].stars_balance, 50, 'Receiver unchanged');
  assert.equal(mr.rows[0].status, 'payment_pending', 'Status restored');
  assert.equal(parseInt(ops.rows[0].cnt, 10), 0, 'No operations');

  await pool.end();
});

test('PG: premium collection purchase', { skip }, async (t) => {
  await ensureSchema();
  ensureGlobalCleanup();
  const pool = await getTestPool();

  const userId = `pgcu_${Date.now()}`;
  const colId = `pgcol_${Date.now()}`;
  const price = 30;

  await pool.query("INSERT INTO users (id,nickname,stars_balance,role,created_at,updated_at) VALUES ($1,'U',100,'user',NOW(),NOW())", [userId]);
  await pool.query("INSERT INTO collections (id,title,pack_type,price_in_stars) VALUES ($1,'Test','premium',$2)", [colId, price]);

  const { createStarsTransactionsService } = await import('../services/stars-transactions.js');
  const { withTransaction } = await import('../database/transaction.js');
  const svc = createStarsTransactionsService({ withTransaction: (cb) => withTransaction({ mode: 'postgres', pool }, cb), mode: 'postgres' });

  const result = await svc.purchaseCollection({ collectionId: colId, authenticatedUserId: userId, idempotencyKey: `pg-buy-${Date.now()}` });
  assert.equal(result.idempotent, false);

  const u = await pool.query('SELECT stars_balance FROM users WHERE id=$1', [userId]);
  const own = await pool.query('SELECT * FROM collection_ownerships WHERE user_id=$1 AND collection_id=$2', [userId, colId]);
  const ops = await pool.query("SELECT COUNT(*) as cnt FROM stars_operations WHERE operation_type='collection_purchase'");
  const entries = await pool.query("SELECT COUNT(*) as cnt FROM stars_ledger_entries WHERE operation_id IN (SELECT id FROM stars_operations WHERE operation_type='collection_purchase' AND actor_user_id=$1)", [userId]);
  const arts = await pool.query("SELECT COUNT(*) as cnt FROM artworks WHERE owner_id=$1 AND collection_id=$2", [userId, colId]);

  assert.equal(u.rows[0].stars_balance, 100 - price);
  assert.equal(own.rows.length, 1);
  assert.equal(own.rows[0].acquisition_type, 'premium');
  assert.equal(own.rows[0].price_paid, price);
  assert.equal(parseInt(ops.rows[0].cnt, 10), 1);
  assert.equal(parseInt(entries.rows[0].cnt, 10), 1);
  assert.equal(parseInt(arts.rows[0].cnt, 10), 2, 'Two artworks created');

  await pool.end();
});

test('PG: concurrent premium purchase — one success, one ALREADY_PROCESSED', { skip }, async (t) => {
  await ensureSchema();
  ensureGlobalCleanup();
  const pool = await getTestPool();

  const userId = `pgcpu_${Date.now()}`;
  const colId = `pgcpcol_${Date.now()}`;
  const price = 30;

  await pool.query("INSERT INTO users (id,nickname,stars_balance,role,created_at,updated_at) VALUES ($1,'U',100,'user',NOW(),NOW())", [userId]);
  await pool.query("INSERT INTO collections (id,title,pack_type,price_in_stars) VALUES ($1,'Test','premium',$2)", [colId, price]);

  const { createStarsTransactionsService } = await import('../services/stars-transactions.js');
  const { withTransaction } = await import('../database/transaction.js');
  const { StarsTransactionError } = await import('../services/stars-transactions.js');

  const results = await Promise.allSettled([
    createStarsTransactionsService({ withTransaction: (cb) => withTransaction({ mode: 'postgres', pool }, cb), mode: 'postgres' }).purchaseCollection({ collectionId: colId, authenticatedUserId: userId, idempotencyKey: `pg-cp-a-${Date.now()}` }),
    createStarsTransactionsService({ withTransaction: (cb) => withTransaction({ mode: 'postgres', pool }, cb), mode: 'postgres' }).purchaseCollection({ collectionId: colId, authenticatedUserId: userId, idempotencyKey: `pg-cp-b-${Date.now()}` }),
  ]);

  const fulfilled = results.filter(r => r.status === 'fulfilled');
  const rejected = results.filter(r => r.status === 'rejected');
  assert.equal(fulfilled.length, 1, 'Exactly one success');
  assert.equal(rejected.length, 1, 'Exactly one rejection');

  const rejErr = rejected[0].reason;
  assert.ok(rejErr instanceof StarsTransactionError);
  assert.equal(rejErr.code, 'ALREADY_PROCESSED');

  const u = await pool.query('SELECT stars_balance FROM users WHERE id=$1', [userId]);
  assert.equal(u.rows[0].stars_balance, 100 - price, 'Debited once');

  const ops = await pool.query("SELECT COUNT(*) as cnt FROM stars_operations");
  assert.equal(parseInt(ops.rows[0].cnt, 10), 1, 'One operation');

  const owns = await pool.query('SELECT COUNT(*) as cnt FROM collection_ownerships WHERE user_id=$1 AND collection_id=$2', [userId, colId]);
  assert.equal(parseInt(owns.rows[0].cnt, 10), 1, 'One ownership');

  const entries = await pool.query("SELECT COUNT(*) as cnt FROM stars_ledger_entries");
  assert.equal(parseInt(entries.rows[0].cnt, 10), 1, 'One ledger entry');

  const arts = await pool.query("SELECT COUNT(*) as cnt FROM artworks WHERE owner_id=$1 AND collection_id=$2", [userId, colId]);
  assert.equal(parseInt(arts.rows[0].cnt, 10), 2, 'Two artworks');

  await pool.end();
});

test('PG: append-only triggers block UPDATE/DELETE on both tables', { skip }, async (t) => {
  await ensureSchema();
  ensureGlobalCleanup();
  const pool = await getTestPool();

  const userId = `pgao_${Date.now()}`;
  const opId = `pgaoop_${Date.now()}`;
  const leId = `pgaole_${Date.now()}`;

  await pool.query("INSERT INTO users (id,nickname,stars_balance,role,created_at,updated_at) VALUES ($1,'U',100,'user',NOW(),NOW())", [userId]);
  await pool.query("INSERT INTO stars_operations (id,idempotency_key,request_fingerprint,operation_type,reference_key,actor_user_id,gross_amount,fee_amount,created_at) VALUES ($1,$2,'fp','collection_purchase','ref:pg', $3,10,0,NOW())", [opId, `pgaok-${Date.now()}`, userId]);
  await pool.query("INSERT INTO stars_ledger_entries (id,operation_id,user_id,entry_type,delta,balance_after,created_at) VALUES ($1,$2,$3,'collection_debit',-10,90,NOW())", [leId, opId, userId]);

  // Stars operations
  await assert.rejects(
    () => pool.query("UPDATE stars_operations SET gross_amount=20 WHERE id=$1", [opId]),
    /append-only|UPDATE is not allowed/,
  );
  await assert.rejects(
    () => pool.query("DELETE FROM stars_operations WHERE id=$1", [opId]),
    /append-only|DELETE is not allowed/,
  );

  // Stars ledger entries
  await assert.rejects(
    () => pool.query("UPDATE stars_ledger_entries SET delta=-20 WHERE id=$1", [leId]),
    /append-only|UPDATE is not allowed/,
  );
  await assert.rejects(
    () => pool.query("DELETE FROM stars_ledger_entries WHERE id=$1", [leId]),
    /append-only|DELETE is not allowed/,
  );

  await pool.end();
});

test('PG: pool usable after conflict and rollback', { skip }, async (t) => {
  await ensureSchema();
  ensureGlobalCleanup();
  const pool = await getTestPool();

  const senderId = `pgpr_${Date.now()}`;
  const receiverId = `pgprr_${Date.now()}`;
  const requestId = `pgprm_${Date.now()}`;

  await pool.query("INSERT INTO users (id,nickname,stars_balance,role,created_at,updated_at) VALUES ($1,'S',200,'user',NOW(),NOW())", [senderId]);
  await pool.query("INSERT INTO users (id,nickname,stars_balance,role,created_at,updated_at) VALUES ($1,'R',50,'user',NOW(),NOW())", [receiverId]);
  await pool.query("INSERT INTO message_requests (id,sender_id,receiver_id,price_in_stars,text,status,created_at,updated_at) VALUES ($1,$2,$3,50,'hi','payment_pending',NOW(),NOW())", [requestId, senderId, receiverId]);

  const { createStarsTransactionsService } = await import('../services/stars-transactions.js');
  const { withTransaction } = await import('../database/transaction.js');

  const svcFail = createStarsTransactionsService({
    withTransaction: (cb) => withTransaction({ mode: 'postgres', pool }, cb),
    mode: 'postgres',
    hooks: { afterDebit: () => { throw new Error('Simulated failure'); } },
  });

  try { await svcFail.payMessageRequest({ requestId, authenticatedUserId: senderId, idempotencyKey: `pg-rc-${Date.now()}` }); } catch {}

  const alive = await pool.query('SELECT 1 as ok');
  assert.equal(alive.rows[0].ok, 1, 'Pool still works after rollback');

  const svcOk = createStarsTransactionsService({ withTransaction: (cb) => withTransaction({ mode: 'postgres', pool }, cb), mode: 'postgres' });
  const result = await svcOk.payMessageRequest({ requestId, authenticatedUserId: senderId, idempotencyKey: `pg-ok-${Date.now()}` });
  assert.equal(result.idempotent, false, 'Normal payment succeeds after conflict');

  await pool.end();
});

test('PG: migration 005 second run skipped', { skip }, async (t) => {
  await ensureSchema();
  ensureGlobalCleanup();
  const pool = await getTestPool();

  const { runMigrations } = await import('../database/migrations.js');
  const result = await runMigrations({
    mode: 'postgres', pool, sqlite: null, persistFn: null,
    migrationsDir: join(serverDir, 'migrations'),
  });

  assert.equal(result.applied, 0, 'Second run should apply 0');
  assert.ok(result.skipped >= 5, `Should skip at least 5, got ${result.skipped}`);

  await pool.end();
});

test('PG: price=1 returns controlled error', { skip }, async (t) => {
  await ensureSchema();
  ensureGlobalCleanup();
  const pool = await getTestPool();

  const senderId = `pgp1_${Date.now()}`;
  const receiverId = `pgp1r_${Date.now()}`;
  const requestId = `pgp1m_${Date.now()}`;

  await pool.query("INSERT INTO users (id,nickname,stars_balance,role,created_at,updated_at) VALUES ($1,'S',100,'user',NOW(),NOW())", [senderId]);
  await pool.query("INSERT INTO users (id,nickname,stars_balance,role,created_at,updated_at) VALUES ($1,'R',50,'user',NOW(),NOW())", [receiverId]);
  await pool.query("INSERT INTO message_requests (id,sender_id,receiver_id,price_in_stars,text,status,created_at,updated_at) VALUES ($1,$2,$3,1,'hi','payment_pending',NOW(),NOW())", [requestId, senderId, receiverId]);

  const { createStarsTransactionsService } = await import('../services/stars-transactions.js');
  const { withTransaction } = await import('../database/transaction.js');
  const svc = createStarsTransactionsService({ withTransaction: (cb) => withTransaction({ mode: 'postgres', pool }, cb), mode: 'postgres' });

  await assert.rejects(
    () => svc.payMessageRequest({ requestId, authenticatedUserId: senderId, idempotencyKey: `pg-p1-${Date.now()}` }),
    (e) => e.code === 'INVALID_FINANCIAL_STATE' && e.statusCode === 409,
  );

  const s = await pool.query('SELECT stars_balance FROM users WHERE id=$1', [senderId]);
  assert.equal(s.rows[0].stars_balance, 100, 'Balance unchanged');

  await pool.end();
});
