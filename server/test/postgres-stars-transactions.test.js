import test from 'node:test';
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';

const databaseUrl = process.env.DATABASE_URL;

if (databaseUrl) {
  process.env.ALLOW_DEV_AUTH = 'true';
  if (process.env.NODE_ENV === 'production') {
    delete process.env.NODE_ENV;
  }
}

const serverDir = join(dirname(fileURLToPath(import.meta.url)), '..');

async function getPool() {
  const pgModule = (await import('pg')).default;
  return new pgModule.Pool({ connectionString: databaseUrl });
}

async function getCleanTestPool() {
  const pool = await getPool();
  const { runMigrations } = await import('../database/migrations.js');
  await runMigrations({
    mode: 'postgres', pool, sqlite: null, persistFn: null,
    migrationsDir: join(serverDir, 'migrations'),
  });
  return pool;
}

// Ensure we compute the skip state once
let skipValue;
if (typeof skipValue === 'undefined') {
  skipValue = !databaseUrl;
}

// ── Write a top-level test for the skip message when no DATABASE_URL
if (!databaseUrl) {
  test('PostgreSQL Stars tests skipped (no DATABASE_URL)', { skip: true }, () => {});
}

// ── Low-level service tests ──────────────────────────────────────────

test('PG: successful message payment', { skip: skipValue }, async (t) => {
  const pool = await getCleanTestPool();

  const senderId = `pgs_${Date.now()}`;
  const receiverId = `pgr_${Date.now()}`;
  const requestId = `pgmsg_${Date.now()}`;
  const now = new Date().toISOString();

  t.after(async () => {
    await pool.query('DELETE FROM stars_ledger_entries WHERE operation_id IN (SELECT id FROM stars_operations WHERE actor_user_id = ANY($1::text[]))', [[senderId, receiverId]]);
    await pool.query('DELETE FROM stars_operations WHERE actor_user_id = ANY($1::text[])', [[senderId, receiverId]]);
    await pool.query('DELETE FROM message_requests WHERE sender_id = ANY($1::text[])', [[senderId, receiverId]]);
    await pool.query('DELETE FROM users WHERE id = ANY($1::text[])', [[senderId, receiverId]]);
    await pool.end();
  });

  await pool.query("INSERT INTO users (id,nickname,stars_balance,role,created_at,updated_at) VALUES ($1,'S',100,'user',NOW(),NOW())", [senderId]);
  await pool.query("INSERT INTO users (id,nickname,stars_balance,role,created_at,updated_at) VALUES ($1,'R',50,'user',NOW(),NOW())", [receiverId]);
  await pool.query("INSERT INTO message_requests (id,sender_id,receiver_id,price_in_stars,text,status,created_at,updated_at) VALUES ($1,$2,$3,50,'hi','payment_pending',NOW(),NOW())", [requestId, senderId, receiverId]);

  const { createStarsTransactionsService } = await import('../services/stars-transactions.js');
  const { withTransaction } = await import('../database/transaction.js');
  const svc = createStarsTransactionsService({ withTransaction: (cb) => withTransaction({ mode: 'postgres', pool }, cb), mode: 'postgres' });

  const result = await svc.payMessageRequest({ requestId, authenticatedUserId: senderId, idempotencyKey: `pgpay-${Date.now()}` });
  assert.equal(result.idempotent, false);
  assert.ok(result.request);

  const price = 50;
  const expectedPayout = Math.floor(price * 80 / 100);

  const s = await pool.query('SELECT stars_balance FROM users WHERE id=$1', [senderId]);
  const r = await pool.query('SELECT stars_balance FROM users WHERE id=$1', [receiverId]);
  const mr = await pool.query('SELECT status FROM message_requests WHERE id=$1', [requestId]);
  const ops = await pool.query("SELECT * FROM stars_operations WHERE operation_type='message_payment'");

  assert.equal(s.rows[0].stars_balance, 100 - price);
  assert.equal(r.rows[0].stars_balance, 50 + expectedPayout);
  assert.equal(mr.rows[0].status, 'delivered');
  assert.equal(ops.rows.length, 1);
  assert.equal(ops.rows[0].fee_amount, price - expectedPayout);
});

test('PG: same-key replay idempotent', { skip: skipValue }, async (t) => {
  const pool = await getCleanTestPool();

  const senderId = `pgsr_${Date.now()}`;
  const receiverId = `pgrr_${Date.now()}`;
  const requestId = `pgrmsg_${Date.now()}`;
  const key = 'pg-replay-key-123456';

  t.after(async () => {
    await pool.query('DELETE FROM stars_ledger_entries WHERE operation_id IN (SELECT id FROM stars_operations WHERE actor_user_id = ANY($1::text[]))', [[senderId, receiverId]]);
    await pool.query('DELETE FROM stars_operations WHERE actor_user_id = ANY($1::text[])', [[senderId, receiverId]]);
    await pool.query('DELETE FROM message_requests WHERE sender_id = ANY($1::text[])', [[senderId, receiverId]]);
    await pool.query('DELETE FROM users WHERE id = ANY($1::text[])', [[senderId, receiverId]]);
    await pool.end();
  });

  await pool.query("INSERT INTO users (id,nickname,stars_balance,role,created_at,updated_at) VALUES ($1,'S',100,'user',NOW(),NOW())", [senderId]);
  await pool.query("INSERT INTO users (id,nickname,stars_balance,role,created_at,updated_at) VALUES ($1,'R',50,'user',NOW(),NOW())", [receiverId]);
  await pool.query("INSERT INTO message_requests (id,sender_id,receiver_id,price_in_stars,text,status,created_at,updated_at) VALUES ($1,$2,$3,50,'hi','payment_pending',NOW(),NOW())", [requestId, senderId, receiverId]);

  const { createStarsTransactionsService } = await import('../services/stars-transactions.js');
  const { withTransaction } = await import('../database/transaction.js');
  const svc = createStarsTransactionsService({ withTransaction: (cb) => withTransaction({ mode: 'postgres', pool }, cb), mode: 'postgres' });

  const r1 = await svc.payMessageRequest({ requestId, authenticatedUserId: senderId, idempotencyKey: key });
  assert.equal(r1.idempotent, false);

  const r2 = await svc.payMessageRequest({ requestId, authenticatedUserId: senderId, idempotencyKey: key });
  assert.equal(r2.idempotent, true);
  assert.ok(r2.request);

  const ops = await pool.query("SELECT * FROM stars_operations WHERE idempotency_key=$1", [key]);
  assert.equal(ops.rows.length, 1);
});

test('PG: concurrent same-key payments via independent connections', { skip: skipValue }, async (t) => {
  const pool = await getCleanTestPool();

  const senderId = `pgcs_${Date.now()}`;
  const receiverId = `pgcr_${Date.now()}`;
  const requestId = `pgcmsg_${Date.now()}`;
  const key = `pg-cc-key-${Date.now()}`;
  const price = 50;

  t.after(async () => {
    await pool.query('DELETE FROM stars_ledger_entries WHERE operation_id IN (SELECT id FROM stars_operations WHERE actor_user_id = ANY($1::text[]))', [[senderId, receiverId]]);
    await pool.query('DELETE FROM stars_operations WHERE actor_user_id = ANY($1::text[])', [[senderId, receiverId]]);
    await pool.query('DELETE FROM message_requests WHERE sender_id = ANY($1::text[])', [[senderId, receiverId]]);
    await pool.query('DELETE FROM users WHERE id = ANY($1::text[])', [[senderId, receiverId]]);
    await pool.end();
  });

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
  assert.ok(fulfilled.length === 2, `Both should succeed, got ${fulfilled.length}`);

  const normal = fulfilled.find(r => r.value.idempotent === false);
  const replay = fulfilled.find(r => r.value.idempotent === true);
  assert.ok(normal, 'One should be normal');
  assert.ok(replay, 'One should be idempotent');

  const s = await pool.query('SELECT stars_balance FROM users WHERE id=$1', [senderId]);
  assert.equal(s.rows[0].stars_balance, 200 - price);

  const ops = await pool.query("SELECT COUNT(*) as cnt FROM stars_operations WHERE idempotency_key=$1", [key]);
  assert.equal(parseInt(ops.rows[0].cnt, 10), 1);
});

test('PG: concurrent different-key payments, one 409', { skip: skipValue }, async (t) => {
  const pool = await getCleanTestPool();

  const senderId = `pgds_${Date.now()}`;
  const receiverId = `pgdr_${Date.now()}`;
  const requestId = `pgdmsg_${Date.now()}`;
  const price = 50;

  t.after(async () => {
    await pool.query('DELETE FROM stars_ledger_entries WHERE operation_id IN (SELECT id FROM stars_operations WHERE actor_user_id = ANY($1::text[]))', [[senderId, receiverId]]);
    await pool.query('DELETE FROM stars_operations WHERE actor_user_id = ANY($1::text[])', [[senderId, receiverId]]);
    await pool.query('DELETE FROM message_requests WHERE sender_id = ANY($1::text[])', [[senderId, receiverId]]);
    await pool.query('DELETE FROM users WHERE id = ANY($1::text[])', [[senderId, receiverId]]);
    await pool.end();
  });

  await pool.query("INSERT INTO users (id,nickname,stars_balance,role,created_at,updated_at) VALUES ($1,'S',200,'user',NOW(),NOW())", [senderId]);
  await pool.query("INSERT INTO users (id,nickname,stars_balance,role,created_at,updated_at) VALUES ($1,'R',50,'user',NOW(),NOW())", [receiverId]);
  await pool.query("INSERT INTO message_requests (id,sender_id,receiver_id,price_in_stars,text,status,created_at,updated_at) VALUES ($1,$2,$3,$4,'hi','payment_pending',NOW(),NOW())", [requestId, senderId, receiverId, price]);

  const { createStarsTransactionsService } = await import('../services/stars-transactions.js');
  const { withTransaction } = await import('../database/transaction.js');

  const results = await Promise.allSettled([
    createStarsTransactionsService({ withTransaction: (cb) => withTransaction({ mode: 'postgres', pool }, cb), mode: 'postgres' }).payMessageRequest({ requestId, authenticatedUserId: senderId, idempotencyKey: `pg-diff-a-${Date.now()}` }),
    createStarsTransactionsService({ withTransaction: (cb) => withTransaction({ mode: 'postgres', pool }, cb), mode: 'postgres' }).payMessageRequest({ requestId, authenticatedUserId: senderId, idempotencyKey: `pg-diff-b-${Date.now()}` }),
  ]);

  const fulfilled = results.filter(r => r.status === 'fulfilled');
  const rejected = results.filter(r => r.status === 'rejected');
  assert.equal(fulfilled.length, 1);
  assert.equal(rejected.length, 1);

  const s = await pool.query('SELECT stars_balance FROM users WHERE id=$1', [senderId]);
  assert.equal(s.rows[0].stars_balance, 200 - price);

  const ops = await pool.query("SELECT COUNT(*) as cnt FROM stars_operations");
  assert.equal(parseInt(ops.rows[0].cnt, 10), 1);
});

test('PG: cross-payment A->B and B->A no deadlock', { skip: skipValue }, async (t) => {
  const pool = await getCleanTestPool();

  const userA = `pgxa_${Date.now()}`;
  const userB = `pgxb_${Date.now()}`;
  const reqAB = `pgxab_${Date.now()}`;
  const reqBA = `pgxba_${Date.now()}`;
  const price = 30;

  t.after(async () => {
    await pool.query('DELETE FROM stars_ledger_entries WHERE operation_id IN (SELECT id FROM stars_operations WHERE actor_user_id = ANY($1::text[]))', [[userA, userB]]);
    await pool.query('DELETE FROM stars_operations WHERE actor_user_id = ANY($1::text[])', [[userA, userB]]);
    await pool.query('DELETE FROM message_requests WHERE sender_id = ANY($1::text[])', [[userA, userB]]);
    await pool.query('DELETE FROM users WHERE id = ANY($1::text[])', [[userA, userB]]);
    await pool.end();
  });

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
});

test('PG: forced rollback after debit via hooks', { skip: skipValue }, async (t) => {
  const pool = await getCleanTestPool();

  const senderId = `pgfs_${Date.now()}`;
  const receiverId = `pgfr_${Date.now()}`;
  const requestId = `pgfmsg_${Date.now()}`;
  const price = 50;

  t.after(async () => {
    await pool.query('DELETE FROM stars_operations WHERE actor_user_id = ANY($1::text[])', [[senderId, receiverId]]);
    await pool.query('DELETE FROM message_requests WHERE sender_id = ANY($1::text[])', [[senderId, receiverId]]);
    await pool.query('DELETE FROM users WHERE id = ANY($1::text[])', [[senderId, receiverId]]);
    await pool.end();
  });

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

  assert.equal(s.rows[0].stars_balance, 100);
  assert.equal(r.rows[0].stars_balance, 50);
  assert.equal(mr.rows[0].status, 'payment_pending');
  assert.equal(parseInt(ops.rows[0].cnt, 10), 0);
});

test('PG: premium collection purchase', { skip: skipValue }, async (t) => {
  const pool = await getCleanTestPool();

  const userId = `pgcu_${Date.now()}`;
  const colId = `pgcol_${Date.now()}`;
  const price = 30;

  t.after(async () => {
    await pool.query('DELETE FROM artworks WHERE owner_id=$1', [userId]);
    await pool.query('DELETE FROM stars_ledger_entries WHERE operation_id IN (SELECT id FROM stars_operations WHERE actor_user_id=$1)', [userId]);
    await pool.query('DELETE FROM stars_operations WHERE actor_user_id=$1', [userId]);
    await pool.query('DELETE FROM collection_ownerships WHERE user_id=$1', [userId]);
    await pool.query('DELETE FROM collections WHERE id=$1', [colId]);
    await pool.query('DELETE FROM users WHERE id=$1', [userId]);
    await pool.end();
  });

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

  assert.equal(u.rows[0].stars_balance, 100 - price);
  assert.equal(own.rows.length, 1);
  assert.equal(own.rows[0].acquisition_type, 'premium');
  assert.equal(parseInt(ops.rows[0].cnt, 10), 1);
});

test('PG: concurrent premium purchase, one succeeds', { skip: skipValue }, async (t) => {
  const pool = await getCleanTestPool();

  const userId = `pgcpu_${Date.now()}`;
  const colId = `pgcpcol_${Date.now()}`;
  const price = 30;

  t.after(async () => {
    await pool.query('DELETE FROM artworks WHERE owner_id=$1', [userId]);
    await pool.query('DELETE FROM stars_ledger_entries WHERE operation_id IN (SELECT id FROM stars_operations WHERE actor_user_id=$1)', [userId]);
    await pool.query('DELETE FROM stars_operations WHERE actor_user_id=$1', [userId]);
    await pool.query('DELETE FROM collection_ownerships WHERE user_id=$1', [userId]);
    await pool.query('DELETE FROM collections WHERE id=$1', [colId]);
    await pool.query('DELETE FROM users WHERE id=$1', [userId]);
    await pool.end();
  });

  await pool.query("INSERT INTO users (id,nickname,stars_balance,role,created_at,updated_at) VALUES ($1,'U',100,'user',NOW(),NOW())", [userId]);
  await pool.query("INSERT INTO collections (id,title,pack_type,price_in_stars) VALUES ($1,'Test','premium',$2)", [colId, price]);

  const { createStarsTransactionsService } = await import('../services/stars-transactions.js');
  const { withTransaction } = await import('../database/transaction.js');

  const results = await Promise.allSettled([
    createStarsTransactionsService({ withTransaction: (cb) => withTransaction({ mode: 'postgres', pool }, cb), mode: 'postgres' }).purchaseCollection({ collectionId: colId, authenticatedUserId: userId, idempotencyKey: `pg-cp-a-${Date.now()}` }),
    createStarsTransactionsService({ withTransaction: (cb) => withTransaction({ mode: 'postgres', pool }, cb), mode: 'postgres' }).purchaseCollection({ collectionId: colId, authenticatedUserId: userId, idempotencyKey: `pg-cp-b-${Date.now()}` }),
  ]);

  const fulfilled = results.filter(r => r.status === 'fulfilled');
  const rejected = results.filter(r => r.status === 'rejected');
  assert.equal(fulfilled.length, 1);
  assert.equal(rejected.length, 1);

  const u = await pool.query('SELECT stars_balance FROM users WHERE id=$1', [userId]);
  assert.equal(u.rows[0].stars_balance, 100 - price);

  const ops = await pool.query("SELECT COUNT(*) as cnt FROM stars_operations");
  assert.equal(parseInt(ops.rows[0].cnt, 10), 1);

  const owns = await pool.query('SELECT COUNT(*) as cnt FROM collection_ownerships WHERE user_id=$1 AND collection_id=$2', [userId, colId]);
  assert.equal(parseInt(owns.rows[0].cnt, 10), 1);
});

test('PG: append-only triggers block UPDATE/DELETE', { skip: skipValue }, async (t) => {
  const pool = await getCleanTestPool();

  const userId = `pgao_${Date.now()}`;
  const opId = `pgaoop_${Date.now()}`;

  t.after(async () => {
    await pool.query('DELETE FROM stars_ledger_entries WHERE operation_id=$1', [opId]);
    await pool.query('DELETE FROM stars_operations WHERE id=$1', [opId]);
    await pool.query('DELETE FROM users WHERE id=$1', [userId]);
    await pool.end();
  });

  await pool.query("INSERT INTO users (id,nickname,stars_balance,role,created_at,updated_at) VALUES ($1,'U',100,'user',NOW(),NOW())", [userId]);
  await pool.query("INSERT INTO stars_operations (id,idempotency_key,request_fingerprint,operation_type,reference_key,actor_user_id,gross_amount,fee_amount,created_at) VALUES ($1,$2,'fp','collection_purchase','ref:pg', $3,10,0,NOW())", [opId, `pgaok-${Date.now()}`, userId]);

  await assert.rejects(
    () => pool.query("UPDATE stars_operations SET gross_amount=20 WHERE id=$1", [opId]),
    /append-only|UPDATE is not allowed/,
    'UPDATE blocked',
  );

  await assert.rejects(
    () => pool.query("DELETE FROM stars_operations WHERE id=$1", [opId]),
    /append-only|DELETE is not allowed/,
    'DELETE blocked',
  );
});

test('PG: pool usable after conflict and rollback', { skip: skipValue }, async (t) => {
  const pool = await getCleanTestPool();

  const senderId = `pgpr_${Date.now()}`;
  const receiverId = `pgprr_${Date.now()}`;
  const requestId = `pgprm_${Date.now()}`;

  t.after(async () => {
    await pool.query('DELETE FROM stars_operations WHERE actor_user_id = ANY($1::text[])', [[senderId, receiverId]]);
    await pool.query('DELETE FROM message_requests WHERE sender_id = ANY($1::text[])', [[senderId, receiverId]]);
    await pool.query('DELETE FROM users WHERE id = ANY($1::text[])', [[senderId, receiverId]]);
    await pool.end();
  });

  await pool.query("INSERT INTO users (id,nickname,stars_balance,role,created_at,updated_at) VALUES ($1,'S',200,'user',NOW(),NOW())", [senderId]);
  await pool.query("INSERT INTO users (id,nickname,stars_balance,role,created_at,updated_at) VALUES ($1,'R',50,'user',NOW(),NOW())", [receiverId]);
  await pool.query("INSERT INTO message_requests (id,sender_id,receiver_id,price_in_stars,text,status,created_at,updated_at) VALUES ($1,$2,$3,50,'hi','payment_pending',NOW(),NOW())", [requestId, senderId, receiverId]);

  const { createStarsTransactionsService } = await import('../services/stars-transactions.js');
  const { withTransaction } = await import('../database/transaction.js');

  // Force a rollback
  const svcFail = createStarsTransactionsService({
    withTransaction: (cb) => withTransaction({ mode: 'postgres', pool }, cb),
    mode: 'postgres',
    hooks: { afterDebit: () => { throw new Error('Simulated failure'); } },
  });

  try {
    await svcFail.payMessageRequest({ requestId, authenticatedUserId: senderId, idempotencyKey: `pg-rc-${Date.now()}` });
  } catch { /* expected */ }

  // Pool should still work
  const alive = await pool.query('SELECT 1 as ok');
  assert.equal(alive.rows[0].ok, 1);

  // And a normal payment should succeed
  const svcOk = createStarsTransactionsService({ withTransaction: (cb) => withTransaction({ mode: 'postgres', pool }, cb), mode: 'postgres' });
  const result = await svcOk.payMessageRequest({ requestId, authenticatedUserId: senderId, idempotencyKey: `pg-ok-${Date.now()}` });
  assert.equal(result.idempotent, false);
});

test('PG: migration 005 second run skipped', { skip: skipValue }, async (t) => {
  const pool = await getCleanTestPool();

  t.after(async () => { await pool.end(); });

  const { runMigrations } = await import('../database/migrations.js');
  const result = await runMigrations({
    mode: 'postgres', pool, sqlite: null, persistFn: null,
    migrationsDir: join(serverDir, 'migrations'),
  });

  assert.equal(result.applied, 0, 'Second run should apply 0');
  assert.ok(result.skipped >= 5, `Should skip at least 5, got ${result.skipped}`);
});

test('PG: price=1 returns controlled error', { skip: skipValue }, async (t) => {
  const pool = await getCleanTestPool();

  const senderId = `pgp1_${Date.now()}`;
  const receiverId = `pgp1r_${Date.now()}`;
  const requestId = `pgp1m_${Date.now()}`;

  t.after(async () => {
    await pool.query('DELETE FROM stars_operations WHERE actor_user_id = ANY($1::text[])', [[senderId, receiverId]]);
    await pool.query('DELETE FROM message_requests WHERE sender_id = ANY($1::text[])', [[senderId, receiverId]]);
    await pool.query('DELETE FROM users WHERE id = ANY($1::text[])', [[senderId, receiverId]]);
    await pool.end();
  });

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
});
