import test from 'node:test';
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const databaseUrl = process.env.DATABASE_URL;
const serverDir = join(dirname(fileURLToPath(import.meta.url)), '..');

if (databaseUrl) {
  process.env.ALLOW_DEV_AUTH = 'true';
  if (process.env.NODE_ENV === 'production') {
    delete process.env.NODE_ENV;
  }
}

const skip = !databaseUrl;
if (!databaseUrl) {
  test('PostgreSQL Stars tests skipped (no DATABASE_URL)', { skip: true }, () => {});
}

function safeSchemaSuffix() {
  return `stars_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
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

async function makeService(pool) {
  const { createStarsTransactionsService } = await import('../services/stars-transactions.js');
  const { withTransaction } = await import('../database/transaction.js');
  return createStarsTransactionsService({ withTransaction: (cb) => withTransaction({ mode: 'postgres', pool }, cb), mode: 'postgres' });
}

test('PG: successful message payment', { skip }, async (t) => {
  const { pool } = await createIsolatedTestDb(t);
  const svc = await makeService(pool);

  const sId = `pgs_${Date.now()}`;
  const rId = `pgr_${Date.now()}`;
  const reqId = `pgmsg_${Date.now()}`;
  const price = 50;

  await pool.query("INSERT INTO users (id,nickname,stars_balance,role,created_at,updated_at) VALUES ($1,'S',100,'user',NOW(),NOW())", [sId]);
  await pool.query("INSERT INTO users (id,nickname,stars_balance,role,created_at,updated_at) VALUES ($1,'R',50,'user',NOW(),NOW())", [rId]);
  await pool.query("INSERT INTO message_requests (id,sender_id,receiver_id,price_in_stars,text,status,created_at,updated_at) VALUES ($1,$2,$3,$4,'hi','payment_pending',NOW(),NOW())", [reqId, sId, rId, price]);

  const result = await svc.payMessageRequest({ requestId: reqId, authenticatedUserId: sId, idempotencyKey: `pgpay-${Date.now()}` });
  assert.equal(result.idempotent, false);
  assert.ok(result.request);

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
  assert.equal(ops.rows[0].gross_amount, price);
  assert.equal(entries.rows.length, expectedPayout > 0 ? 2 : 1);
});

test('PG: same-key replay idempotent', { skip }, async (t) => {
  const { pool } = await createIsolatedTestDb(t);
  const svc = await makeService(pool);

  const sId = `pgsr_${Date.now()}`;
  const rId = `pgrr_${Date.now()}`;
  const reqId = `pgrmsg_${Date.now()}`;
  const key = 'pg-replay-key-123456';

  await pool.query("INSERT INTO users (id,nickname,stars_balance,role,created_at,updated_at) VALUES ($1,'S',100,'user',NOW(),NOW())", [sId]);
  await pool.query("INSERT INTO users (id,nickname,stars_balance,role,created_at,updated_at) VALUES ($1,'R',50,'user',NOW(),NOW())", [rId]);
  await pool.query("INSERT INTO message_requests (id,sender_id,receiver_id,price_in_stars,text,status,created_at,updated_at) VALUES ($1,$2,$3,50,'hi','payment_pending',NOW(),NOW())", [reqId, sId, rId]);

  const r1 = await svc.payMessageRequest({ requestId: reqId, authenticatedUserId: sId, idempotencyKey: key });
  assert.equal(r1.idempotent, false);
  assert.ok(r1.request);

  const r2 = await svc.payMessageRequest({ requestId: reqId, authenticatedUserId: sId, idempotencyKey: key });
  assert.equal(r2.idempotent, true);
  assert.ok(r2.request);

  const ops = await pool.query("SELECT * FROM stars_operations WHERE idempotency_key=$1 AND actor_user_id=$2", [key, sId]);
  assert.equal(ops.rows.length, 1);

  const entries = await pool.query("SELECT * FROM stars_ledger_entries WHERE operation_id=$1", [ops.rows[0].id]);
  const expectedPayout = Math.floor(50 * 80 / 100);
  assert.equal(entries.rows.length, expectedPayout > 0 ? 2 : 1);
});

test('PG: concurrent same-key — two fulfilled, one normal, one idempotent', { skip }, async (t) => {
  const { pool } = await createIsolatedTestDb(t);

  const sId = `pgcs_${Date.now()}`;
  const rId = `pgcr_${Date.now()}`;
  const reqId = `pgcmsg_${Date.now()}`;
  const key = `pg-cc-key-${Date.now()}`;
  const price = 50;

  await pool.query("INSERT INTO users (id,nickname,stars_balance,role,created_at,updated_at) VALUES ($1,'S',200,'user',NOW(),NOW())", [sId]);
  await pool.query("INSERT INTO users (id,nickname,stars_balance,role,created_at,updated_at) VALUES ($1,'R',50,'user',NOW(),NOW())", [rId]);
  await pool.query("INSERT INTO message_requests (id,sender_id,receiver_id,price_in_stars,text,status,created_at,updated_at) VALUES ($1,$2,$3,$4,'hi','payment_pending',NOW(),NOW())", [reqId, sId, rId, price]);

  const { createStarsTransactionsService } = await import('../services/stars-transactions.js');
  const { withTransaction } = await import('../database/transaction.js');
  const makeSvc = () => createStarsTransactionsService({ withTransaction: (cb) => withTransaction({ mode: 'postgres', pool }, cb), mode: 'postgres' });

  const results = await Promise.allSettled([
    makeSvc().payMessageRequest({ requestId: reqId, authenticatedUserId: sId, idempotencyKey: key }),
    makeSvc().payMessageRequest({ requestId: reqId, authenticatedUserId: sId, idempotencyKey: key }),
  ]);

  const fulfilled = results.filter(r => r.status === 'fulfilled');
  assert.equal(fulfilled.length, 2, 'Both should be fulfilled');

  const normal = fulfilled.find(r => r.value.idempotent === false);
  const replay = fulfilled.find(r => r.value.idempotent === true);
  assert.ok(normal, 'One normal');
  assert.ok(replay, 'One idempotent');
  assert.equal(replay.value.operation_id, normal.value.operation_id);

  const s = await pool.query('SELECT stars_balance FROM users WHERE id=$1', [sId]);
  const r = await pool.query('SELECT stars_balance FROM users WHERE id=$1', [rId]);
  const mr = await pool.query('SELECT status FROM message_requests WHERE id=$1', [reqId]);
  const ops = await pool.query("SELECT COUNT(*) as cnt FROM stars_operations WHERE idempotency_key=$1 AND actor_user_id=$2", [key, sId]);
  const entries = await pool.query("SELECT COUNT(*) as cnt FROM stars_ledger_entries WHERE operation_id IN (SELECT id FROM stars_operations WHERE idempotency_key=$1 AND actor_user_id=$2)", [key, sId]);

  assert.equal(s.rows[0].stars_balance, 200 - price);
  const expectedPayout = Math.floor(price * 80 / 100);
  assert.equal(r.rows[0].stars_balance, 50 + expectedPayout);
  assert.equal(mr.rows[0].status, 'delivered');
  assert.equal(parseInt(ops.rows[0].cnt, 10), 1);
  assert.equal(parseInt(entries.rows[0].cnt, 10), expectedPayout > 0 ? 2 : 1);
});

test('PG: concurrent different-key — one success, one ALREADY_PROCESSED', { skip }, async (t) => {
  const { pool } = await createIsolatedTestDb(t);

  const sId = `pgds_${Date.now()}`;
  const rId = `pgdr_${Date.now()}`;
  const reqId = `pgdmsg_${Date.now()}`;
  const price = 50;

  await pool.query("INSERT INTO users (id,nickname,stars_balance,role,created_at,updated_at) VALUES ($1,'S',200,'user',NOW(),NOW())", [sId]);
  await pool.query("INSERT INTO users (id,nickname,stars_balance,role,created_at,updated_at) VALUES ($1,'R',50,'user',NOW(),NOW())", [rId]);
  await pool.query("INSERT INTO message_requests (id,sender_id,receiver_id,price_in_stars,text,status,created_at,updated_at) VALUES ($1,$2,$3,$4,'hi','payment_pending',NOW(),NOW())", [reqId, sId, rId, price]);

  const { createStarsTransactionsService } = await import('../services/stars-transactions.js');
  const { withTransaction } = await import('../database/transaction.js');
  const { StarsTransactionError } = await import('../services/stars-transactions.js');
  const makeSvc = () => createStarsTransactionsService({ withTransaction: (cb) => withTransaction({ mode: 'postgres', pool }, cb), mode: 'postgres' });

  const results = await Promise.allSettled([
    makeSvc().payMessageRequest({ requestId: reqId, authenticatedUserId: sId, idempotencyKey: `pg-diff-a-${Date.now()}` }),
    makeSvc().payMessageRequest({ requestId: reqId, authenticatedUserId: sId, idempotencyKey: `pg-diff-b-${Date.now()}` }),
  ]);

  const fulfilled = results.filter(r => r.status === 'fulfilled');
  const rejected = results.filter(r => r.status === 'rejected');
  assert.equal(fulfilled.length, 1);
  assert.equal(rejected.length, 1);

  const rejection = rejected[0].reason;
  assert.ok(rejection instanceof StarsTransactionError);
  assert.equal(rejection.code, 'ALREADY_PROCESSED');
  assert.equal(rejection.statusCode, 409);

  const s = await pool.query('SELECT stars_balance FROM users WHERE id=$1', [sId]);
  assert.equal(s.rows[0].stars_balance, 200 - price);

  const ops = await pool.query("SELECT COUNT(*) as cnt FROM stars_operations WHERE actor_user_id=$1", [sId]);
  assert.equal(parseInt(ops.rows[0].cnt, 10), 1);
});

test('PG: same key different natural references', { skip }, async (t) => {
  const { pool } = await createIsolatedTestDb(t);

  const sId = `pgsk_${Date.now()}`;
  const rId = `pgskr_${Date.now()}`;
  const req1 = `pgsk1_${Date.now()}`;
  const req2 = `pgsk2_${Date.now()}`;
  const key = `pg-sk-key-${Date.now()}`;

  await pool.query("INSERT INTO users (id,nickname,stars_balance,role,created_at,updated_at) VALUES ($1,'S',400,'user',NOW(),NOW())", [sId]);
  await pool.query("INSERT INTO users (id,nickname,stars_balance,role,created_at,updated_at) VALUES ($1,'R',50,'user',NOW(),NOW())", [rId]);
  await pool.query("INSERT INTO message_requests (id,sender_id,receiver_id,price_in_stars,text,status,created_at,updated_at) VALUES ($1,$2,$3,50,'a','payment_pending',NOW(),NOW())", [req1, sId, rId]);
  await pool.query("INSERT INTO message_requests (id,sender_id,receiver_id,price_in_stars,text,status,created_at,updated_at) VALUES ($1,$2,$3,50,'b','payment_pending',NOW(),NOW())", [req2, sId, rId]);

  const { createStarsTransactionsService } = await import('../services/stars-transactions.js');
  const { withTransaction } = await import('../database/transaction.js');
  const { StarsTransactionError } = await import('../services/stars-transactions.js');
  const makeSvc = () => createStarsTransactionsService({ withTransaction: (cb) => withTransaction({ mode: 'postgres', pool }, cb), mode: 'postgres' });

  const r1 = await makeSvc().payMessageRequest({ requestId: req1, authenticatedUserId: sId, idempotencyKey: key });
  assert.equal(r1.idempotent, false);

  try {
    await makeSvc().payMessageRequest({ requestId: req2, authenticatedUserId: sId, idempotencyKey: key });
    assert.fail('Should have thrown');
  } catch (e) {
    assert.ok(e instanceof StarsTransactionError);
    assert.equal(e.code, 'IDEMPOTENCY_KEY_REUSED');
    assert.equal(e.statusCode, 409);
  }

  const mr2 = await pool.query('SELECT status FROM message_requests WHERE id=$1', [req2]);
  assert.equal(mr2.rows[0].status, 'payment_pending');
});

test('PG: cross-payment A→B and B→A no deadlock', { skip }, async (t) => {
  const { pool } = await createIsolatedTestDb(t);
  const svc = await makeService(pool);

  const uA = `pgxa_${Date.now()}`;
  const uB = `pgxb_${Date.now()}`;
  const ab = `pgxab_${Date.now()}`;
  const ba = `pgxba_${Date.now()}`;
  const price = 30;

  await pool.query("INSERT INTO users (id,nickname,stars_balance,role,created_at,updated_at) VALUES ($1,'A',200,'user',NOW(),NOW())", [uA]);
  await pool.query("INSERT INTO users (id,nickname,stars_balance,role,created_at,updated_at) VALUES ($1,'B',200,'user',NOW(),NOW())", [uB]);
  await pool.query("INSERT INTO message_requests (id,sender_id,receiver_id,price_in_stars,text,status,created_at,updated_at) VALUES ($1,$2,$3,$4,'ab','payment_pending',NOW(),NOW())", [ab, uA, uB, price]);
  await pool.query("INSERT INTO message_requests (id,sender_id,receiver_id,price_in_stars,text,status,created_at,updated_at) VALUES ($1,$2,$3,$4,'ba','payment_pending',NOW(),NOW())", [ba, uB, uA, price]);

  const results = await Promise.allSettled([
    svc.payMessageRequest({ requestId: ab, authenticatedUserId: uA, idempotencyKey: `pg-xab-${Date.now()}` }),
    svc.payMessageRequest({ requestId: ba, authenticatedUserId: uB, idempotencyKey: `pg-xba-${Date.now()}` }),
  ]);

  assert.equal(results.filter(r => r.status === 'fulfilled').length, 2, 'Both succeed');

  const a = await pool.query('SELECT stars_balance FROM users WHERE id=$1', [uA]);
  const b = await pool.query('SELECT stars_balance FROM users WHERE id=$1', [uB]);
  const payout = Math.floor(price * 80 / 100);

  assert.equal(a.rows[0].stars_balance, 200 - price + payout);
  assert.equal(b.rows[0].stars_balance, 200 - price + payout);

  const ops = await pool.query("SELECT COUNT(*) as cnt FROM stars_operations WHERE actor_user_id IN ($1,$2)", [uA, uB]);
  assert.equal(parseInt(ops.rows[0].cnt, 10), 2);
});

test('PG: forced rollback after debit via hooks', { skip }, async (t) => {
  const { pool } = await createIsolatedTestDb(t);

  const sId = `pgfs_${Date.now()}`;
  const rId = `pgfr_${Date.now()}`;
  const reqId = `pgfmsg_${Date.now()}`;
  const price = 50;

  await pool.query("INSERT INTO users (id,nickname,stars_balance,role,created_at,updated_at) VALUES ($1,'S',100,'user',NOW(),NOW())", [sId]);
  await pool.query("INSERT INTO users (id,nickname,stars_balance,role,created_at,updated_at) VALUES ($1,'R',50,'user',NOW(),NOW())", [rId]);
  await pool.query("INSERT INTO message_requests (id,sender_id,receiver_id,price_in_stars,text,status,created_at,updated_at) VALUES ($1,$2,$3,$4,'test','payment_pending',NOW(),NOW())", [reqId, sId, rId, price]);

  const { createStarsTransactionsService } = await import('../services/stars-transactions.js');
  const { withTransaction } = await import('../database/transaction.js');

  const svc = createStarsTransactionsService({
    withTransaction: (cb) => withTransaction({ mode: 'postgres', pool }, cb),
    mode: 'postgres',
    hooks: { afterDebit: () => { throw new Error('Simulated failure after debit'); } },
  });

  await assert.rejects(
    () => svc.payMessageRequest({ requestId: reqId, authenticatedUserId: sId, idempotencyKey: `pg-fail-${Date.now()}` }),
    (e) => e.message === 'Simulated failure after debit',
  );

  const s = await pool.query('SELECT stars_balance FROM users WHERE id=$1', [sId]);
  const r = await pool.query('SELECT stars_balance FROM users WHERE id=$1', [rId]);
  const mr = await pool.query('SELECT status FROM message_requests WHERE id=$1', [reqId]);
  const ops = await pool.query("SELECT COUNT(*) as cnt FROM stars_operations WHERE actor_user_id=$1", [sId]);

  assert.equal(s.rows[0].stars_balance, 100);
  assert.equal(r.rows[0].stars_balance, 50);
  assert.equal(mr.rows[0].status, 'payment_pending');
  assert.equal(parseInt(ops.rows[0].cnt, 10), 0);
});

test('PG: premium collection purchase', { skip }, async (t) => {
  const { pool } = await createIsolatedTestDb(t);
  const svc = await makeService(pool);

  const uId = `pgcu_${Date.now()}`;
  const cId = `pgcol_${Date.now()}`;
  const price = 30;

  await pool.query("INSERT INTO users (id,nickname,stars_balance,role,created_at,updated_at) VALUES ($1,'U',100,'user',NOW(),NOW())", [uId]);
  await pool.query("INSERT INTO collections (id,title,pack_type,price_in_stars) VALUES ($1,'Test','premium',$2)", [cId, price]);

  const result = await svc.purchaseCollection({ collectionId: cId, authenticatedUserId: uId, idempotencyKey: `pg-buy-${Date.now()}` });
  assert.equal(result.idempotent, false);

  const u = await pool.query('SELECT stars_balance FROM users WHERE id=$1', [uId]);
  const own = await pool.query('SELECT * FROM collection_ownerships WHERE user_id=$1 AND collection_id=$2', [uId, cId]);
  const ops = await pool.query("SELECT COUNT(*) as cnt FROM stars_operations WHERE operation_type='collection_purchase' AND actor_user_id=$1", [uId]);
  const entries = await pool.query("SELECT COUNT(*) as cnt FROM stars_ledger_entries WHERE operation_id IN (SELECT id FROM stars_operations WHERE actor_user_id=$1)", [uId]);
  const arts = await pool.query("SELECT COUNT(*) as cnt FROM artworks WHERE owner_id=$1 AND collection_id=$2", [uId, cId]);

  assert.equal(u.rows[0].stars_balance, 100 - price);
  assert.equal(own.rows.length, 1);
  assert.equal(own.rows[0].acquisition_type, 'premium');
  assert.equal(own.rows[0].price_paid, price);
  assert.equal(parseInt(ops.rows[0].cnt, 10), 1);
  assert.equal(parseInt(entries.rows[0].cnt, 10), 1);
  assert.equal(parseInt(arts.rows[0].cnt, 10), 2);
});

test('PG: concurrent premium purchase — one success, one ALREADY_PROCESSED', { skip }, async (t) => {
  const { pool } = await createIsolatedTestDb(t);

  const uId = `pgcpu_${Date.now()}`;
  const cId = `pgcpcol_${Date.now()}`;
  const price = 30;

  await pool.query("INSERT INTO users (id,nickname,stars_balance,role,created_at,updated_at) VALUES ($1,'U',100,'user',NOW(),NOW())", [uId]);
  await pool.query("INSERT INTO collections (id,title,pack_type,price_in_stars) VALUES ($1,'Test','premium',$2)", [cId, price]);

  const { createStarsTransactionsService } = await import('../services/stars-transactions.js');
  const { withTransaction } = await import('../database/transaction.js');
  const { StarsTransactionError } = await import('../services/stars-transactions.js');
  const makeSvc = () => createStarsTransactionsService({ withTransaction: (cb) => withTransaction({ mode: 'postgres', pool }, cb), mode: 'postgres' });

  const results = await Promise.allSettled([
    makeSvc().purchaseCollection({ collectionId: cId, authenticatedUserId: uId, idempotencyKey: `pg-cp-a-${Date.now()}` }),
    makeSvc().purchaseCollection({ collectionId: cId, authenticatedUserId: uId, idempotencyKey: `pg-cp-b-${Date.now()}` }),
  ]);

  const fulfilled = results.filter(r => r.status === 'fulfilled');
  const rejected = results.filter(r => r.status === 'rejected');
  assert.equal(fulfilled.length, 1);
  assert.equal(rejected.length, 1);

  assert.ok(rejected[0].reason instanceof StarsTransactionError);
  assert.equal(rejected[0].reason.code, 'ALREADY_PROCESSED');

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

test('PG: append-only triggers block UPDATE/DELETE on both tables', { skip }, async (t) => {
  const { pool } = await createIsolatedTestDb(t);

  const uId = `pgao_${Date.now()}`;
  const opId = `pgaoop_${Date.now()}`;
  const leId = `pgaole_${Date.now()}`;

  await pool.query("INSERT INTO users (id,nickname,stars_balance,role,created_at,updated_at) VALUES ($1,'U',100,'user',NOW(),NOW())", [uId]);
  await pool.query("INSERT INTO stars_operations (id,idempotency_key,request_fingerprint,operation_type,reference_key,actor_user_id,gross_amount,fee_amount,created_at) VALUES ($1,$2,'fp','collection_purchase','ref:pg', $3,10,0,NOW())", [opId, `pgaok-${Date.now()}`, uId]);
  await pool.query("INSERT INTO stars_ledger_entries (id,operation_id,user_id,entry_type,delta,balance_after,created_at) VALUES ($1,$2,$3,'collection_debit',-10,90,NOW())", [leId, opId, uId]);

  await assert.rejects(() => pool.query("UPDATE stars_operations SET gross_amount=20 WHERE id=$1", [opId]), /append-only|UPDATE is not allowed/);
  await assert.rejects(() => pool.query("DELETE FROM stars_operations WHERE id=$1", [opId]), /append-only|DELETE is not allowed/);
  await assert.rejects(() => pool.query("UPDATE stars_ledger_entries SET delta=-20 WHERE id=$1", [leId]), /append-only|UPDATE is not allowed/);
  await assert.rejects(() => pool.query("DELETE FROM stars_ledger_entries WHERE id=$1", [leId]), /append-only|DELETE is not allowed/);
});

test('PG: pool usable after conflict and rollback', { skip }, async (t) => {
  const { pool } = await createIsolatedTestDb(t);

  const sId = `pgpr_${Date.now()}`;
  const rId = `pgprr_${Date.now()}`;
  const reqId = `pgprm_${Date.now()}`;

  await pool.query("INSERT INTO users (id,nickname,stars_balance,role,created_at,updated_at) VALUES ($1,'S',200,'user',NOW(),NOW())", [sId]);
  await pool.query("INSERT INTO users (id,nickname,stars_balance,role,created_at,updated_at) VALUES ($1,'R',50,'user',NOW(),NOW())", [rId]);
  await pool.query("INSERT INTO message_requests (id,sender_id,receiver_id,price_in_stars,text,status,created_at,updated_at) VALUES ($1,$2,$3,50,'hi','payment_pending',NOW(),NOW())", [reqId, sId, rId]);

  const { createStarsTransactionsService } = await import('../services/stars-transactions.js');
  const { withTransaction } = await import('../database/transaction.js');

  const svcFail = createStarsTransactionsService({
    withTransaction: (cb) => withTransaction({ mode: 'postgres', pool }, cb),
    mode: 'postgres',
    hooks: { afterDebit: () => { throw new Error('Simulated failure'); } },
  });

  await assert.rejects(
    () => svcFail.payMessageRequest({ requestId: reqId, authenticatedUserId: sId, idempotencyKey: `pg-rc-${Date.now()}` }),
    (e) => e.message === 'Simulated failure',
  );

  const alive = await pool.query('SELECT 1 as ok');
  assert.equal(alive.rows[0].ok, 1);

  const svcOk = createStarsTransactionsService({ withTransaction: (cb) => withTransaction({ mode: 'postgres', pool }, cb), mode: 'postgres' });
  const result = await svcOk.payMessageRequest({ requestId: reqId, authenticatedUserId: sId, idempotencyKey: `pg-ok-${Date.now()}` });
  assert.equal(result.idempotent, false);
});

test('PG: migration 005 second run skipped', { skip }, async (t) => {
  const { pool } = await createIsolatedTestDb(t);

  const { runMigrations } = await import('../database/migrations.js');
  const result = await runMigrations({
    mode: 'postgres', pool, sqlite: null, persistFn: null,
    migrationsDir: join(serverDir, 'migrations'),
  });

  assert.equal(result.applied, 0);
  assert.ok(result.skipped >= 5);
});

test('PG: price=1 returns controlled error', { skip }, async (t) => {
  const { pool } = await createIsolatedTestDb(t);
  const svc = await makeService(pool);

  const sId = `pgp1_${Date.now()}`;
  const rId = `pgp1r_${Date.now()}`;
  const reqId = `pgp1m_${Date.now()}`;

  await pool.query("INSERT INTO users (id,nickname,stars_balance,role,created_at,updated_at) VALUES ($1,'S',100,'user',NOW(),NOW())", [sId]);
  await pool.query("INSERT INTO users (id,nickname,stars_balance,role,created_at,updated_at) VALUES ($1,'R',50,'user',NOW(),NOW())", [rId]);
  await pool.query("INSERT INTO message_requests (id,sender_id,receiver_id,price_in_stars,text,status,created_at,updated_at) VALUES ($1,$2,$3,1,'hi','payment_pending',NOW(),NOW())", [reqId, sId, rId]);

  await assert.rejects(
    () => svc.payMessageRequest({ requestId: reqId, authenticatedUserId: sId, idempotencyKey: `pg-p1-${Date.now()}` }),
    (e) => e.code === 'INVALID_FINANCIAL_STATE' && e.statusCode === 409,
  );

  const s = await pool.query('SELECT stars_balance FROM users WHERE id=$1', [sId]);
  assert.equal(s.rows[0].stars_balance, 100);
});
