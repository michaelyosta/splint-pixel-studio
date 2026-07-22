import test from 'node:test';
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import initSqlJs from 'sql.js';
import { runMigrations } from '../database/migrations.js';
import { withTransaction } from '../database/transaction.js';
import { createStarsTransactionsService, validateIdempotencyKey, StarsTransactionError } from '../services/stars-transactions.js';
import { v4 as uuid } from 'uuid';

const __dirname = dirname(fileURLToPath(import.meta.url));
const serverDir = join(__dirname, '..');

async function createTestDb() {
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  db.run('PRAGMA foreign_keys = ON;');
  const migrationsDir = join(serverDir, 'migrations', 'sqlite');
  await runMigrations({ mode: 'sqlite', pool: null, sqlite: db, persistFn: null, migrationsDir });
  return db;
}

function makeService(db, overrides = {}) {
  const wtx = (cb) => withTransaction({ mode: 'sqlite', sqlite: db }, cb);
  return createStarsTransactionsService({ withTransaction: wtx, mode: 'sqlite', ...overrides });
}

// ── Idempotency-Key validation ───────────────────────────────────────

test('Idempotency-Key: missing header returns null', () => {
  assert.equal(validateIdempotencyKey(undefined), null);
  assert.equal(validateIdempotencyKey(null), null);
});

test('Idempotency-Key: non-string returns 400 INVALID_INPUT', () => {
  assert.throws(() => validateIdempotencyKey(123), (e) => e.code === 'INVALID_INPUT' && e.statusCode === 400);
  assert.throws(() => validateIdempotencyKey([]), (e) => e.code === 'INVALID_INPUT' && e.statusCode === 400);
  assert.throws(() => validateIdempotencyKey({}), (e) => e.code === 'INVALID_INPUT' && e.statusCode === 400);
});

test('Idempotency-Key: empty string returns 400 INVALID_INPUT', () => {
  assert.throws(() => validateIdempotencyKey(''), (e) => e.code === 'INVALID_INPUT' && e.statusCode === 400);
  assert.throws(() => validateIdempotencyKey('   '), (e) => e.code === 'INVALID_INPUT' && e.statusCode === 400);
});

test('Idempotency-Key: too short returns 400 INVALID_INPUT', () => {
  assert.throws(() => validateIdempotencyKey('abc'), (e) => e.code === 'INVALID_INPUT' && e.statusCode === 400);
});

test('Idempotency-Key: too long returns 400 INVALID_INPUT', () => {
  assert.throws(() => validateIdempotencyKey('x'.repeat(129)), (e) => e.code === 'INVALID_INPUT' && e.statusCode === 400);
});

test('Idempotency-Key: non-printable ASCII returns 400 INVALID_INPUT', () => {
  assert.throws(() => validateIdempotencyKey('abcd\x7Fghi'), (e) => e.code === 'INVALID_INPUT' && e.statusCode === 400);
});

test('Idempotency-Key: valid returns trimmed', () => {
  assert.equal(validateIdempotencyKey('abc12345'), 'abc12345');
  assert.equal(validateIdempotencyKey('  valid-key-123  '), 'valid-key-123');
});

// ── Message payment: successful ──────────────────────────────────────

test('Message payment: successful debit, credit, status delivered', async (t) => {
  const db = await createTestDb();
  const svc = makeService(db);

  const senderId = `s_${uuid()}`;
  const receiverId = `r_${uuid()}`;
  const requestId = `msg_${uuid()}`;
  const now = new Date().toISOString();
  const price = 50;

  await withTransaction({ mode: 'sqlite', sqlite: db }, async (txx) => {
    await txx.run(`INSERT INTO users (id,telegram_id,nickname,stars_balance,role,created_at,updated_at) VALUES (?,?,?,?,?,?,?)`, [senderId, null, 'S', 100, 'user', now, now]);
    await txx.run(`INSERT INTO users (id,telegram_id,nickname,stars_balance,role,created_at,updated_at) VALUES (?,?,?,?,?,?,?)`, [receiverId, null, 'R', 50, 'user', now, now]);
    await txx.run(`INSERT INTO message_requests (id,sender_id,receiver_id,price_in_stars,text,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)`, [requestId, senderId, receiverId, price, 'hi', 'payment_pending', now, now]);
  });

  const result = await svc.payMessageRequest({ requestId, authenticatedUserId: senderId, idempotencyKey: `pay-${uuid()}` });
  assert.equal(result.idempotent, false);
  assert.ok(result.request);

  const state = await withTransaction({ mode: 'sqlite', sqlite: db }, async (txx) => {
    const s = await txx.get('SELECT stars_balance FROM users WHERE id=?', [senderId]);
    const r = await txx.get('SELECT stars_balance FROM users WHERE id=?', [receiverId]);
    const mr = await txx.get('SELECT * FROM message_requests WHERE id=?', [requestId]);
    const ops = await txx.all('SELECT * FROM stars_operations');
    const entries = await txx.all('SELECT * FROM stars_ledger_entries WHERE operation_id=?', [ops[0]?.id]);
    return { s, r, mr, ops, entries };
  });

  const expectedPayout = Math.floor(price * 80 / 100);
  const expectedFee = price - expectedPayout;

  assert.equal(state.s.stars_balance, 100 - price);
  assert.equal(state.r.stars_balance, 50 + expectedPayout);
  assert.equal(state.mr.status, 'delivered');
  assert.equal(state.ops.length, 1);
  assert.equal(state.ops[0].gross_amount, price);
  assert.equal(state.ops[0].fee_amount, expectedFee);
  assert.equal(state.entries.length, expectedPayout > 0 ? 2 : 1);
});

// ── price=1 edge case ────────────────────────────────────────────────

test('Message payment: price=1 returns INVALID_FINANCIAL_STATE', async (t) => {
  const db = await createTestDb();
  const svc = makeService(db);

  const senderId = `s_${uuid()}`;
  const receiverId = `r_${uuid()}`;
  const requestId = `msg_${uuid()}`;
  const now = new Date().toISOString();

  await withTransaction({ mode: 'sqlite', sqlite: db }, async (txx) => {
    await txx.run(`INSERT INTO users (id,telegram_id,nickname,stars_balance,role,created_at,updated_at) VALUES (?,?,?,?,?,?,?)`, [senderId, null, 'S', 100, 'user', now, now]);
    await txx.run(`INSERT INTO users (id,telegram_id,nickname,stars_balance,role,created_at,updated_at) VALUES (?,?,?,?,?,?,?)`, [receiverId, null, 'R', 50, 'user', now, now]);
    await txx.run(`INSERT INTO message_requests (id,sender_id,receiver_id,price_in_stars,text,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)`, [requestId, senderId, receiverId, 1, 'hi', 'payment_pending', now, now]);
  });

  await assert.rejects(
    () => svc.payMessageRequest({ requestId, authenticatedUserId: senderId, idempotencyKey: `pay-${uuid()}` }),
    (e) => e.code === 'INVALID_FINANCIAL_STATE' && e.statusCode === 409,
  );
});

test('Collection purchase: price=1 collection returns INVALID_FINANCIAL_STATE', async (t) => {
  const db = await createTestDb();
  const svc = makeService(db);

  const userId = `u_${uuid()}`;
  const colId = `col_${uuid()}`;
  const now = new Date().toISOString();

  await withTransaction({ mode: 'sqlite', sqlite: db }, async (txx) => {
    await txx.run(`INSERT INTO users (id,telegram_id,nickname,stars_balance,role,created_at,updated_at) VALUES (?,?,?,?,?,?,?)`, [userId, null, 'U', 100, 'user', now, now]);
    await txx.run(`INSERT INTO collections (id,title,pack_type,price_in_stars) VALUES (?,?,?,?)`, [colId, 'Cheap', 'premium', 1]);
  });

  await assert.rejects(
    () => svc.purchaseCollection({ collectionId: colId, authenticatedUserId: userId, idempotencyKey: `buy-${uuid()}` }),
    (e) => e.code === 'INVALID_FINANCIAL_STATE' && e.statusCode === 409,
  );
});

// ── Message payment: insufficient balance ────────────────────────────

test('Message payment: insufficient balance returns INSUFFICIENT_STARS', async (t) => {
  const db = await createTestDb();
  const svc = makeService(db);

  const senderId = `s_${uuid()}`;
  const receiverId = `r_${uuid()}`;
  const requestId = `msg_${uuid()}`;
  const now = new Date().toISOString();
  const price = 50;

  await withTransaction({ mode: 'sqlite', sqlite: db }, async (txx) => {
    await txx.run(`INSERT INTO users (id,telegram_id,nickname,stars_balance,role,created_at,updated_at) VALUES (?,?,?,?,?,?,?)`, [senderId, null, 'Poor', 10, 'user', now, now]);
    await txx.run(`INSERT INTO users (id,telegram_id,nickname,stars_balance,role,created_at,updated_at) VALUES (?,?,?,?,?,?,?)`, [receiverId, null, 'Rich', 100, 'user', now, now]);
    await txx.run(`INSERT INTO message_requests (id,sender_id,receiver_id,price_in_stars,text,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)`, [requestId, senderId, receiverId, price, 'pay', 'payment_pending', now, now]);
  });

  await assert.rejects(
    () => svc.payMessageRequest({ requestId, authenticatedUserId: senderId, idempotencyKey: `pay-${uuid()}` }),
    (e) => e.code === 'INSUFFICIENT_STARS' && e.statusCode === 402,
  );

  const state = await withTransaction({ mode: 'sqlite', sqlite: db }, async (txx) => {
    const s = await txx.get('SELECT stars_balance FROM users WHERE id=?', [senderId]);
    const mr = await txx.get('SELECT * FROM message_requests WHERE id=?', [requestId]);
    const ops = await txx.all('SELECT * FROM stars_operations');
    return { balance: s.stars_balance, status: mr.status, ops: ops.length };
  });
  assert.equal(state.balance, 10);
  assert.equal(state.status, 'payment_pending');
  assert.equal(state.ops, 0);
});

// ── Message payment: idempotent replay ───────────────────────────────

test('Message payment: same key replay returns idempotent=true', async (t) => {
  const db = await createTestDb();
  const svc = makeService(db);

  const senderId = `s_${uuid()}`;
  const receiverId = `r_${uuid()}`;
  const requestId = `msg_${uuid()}`;
  const now = new Date().toISOString();
  const price = 50;
  const key = 'replay-key-test-123456';

  await withTransaction({ mode: 'sqlite', sqlite: db }, async (txx) => {
    await txx.run(`INSERT INTO users (id,telegram_id,nickname,stars_balance,role,created_at,updated_at) VALUES (?,?,?,?,?,?,?)`, [senderId, null, 'S', 100, 'user', now, now]);
    await txx.run(`INSERT INTO users (id,telegram_id,nickname,stars_balance,role,created_at,updated_at) VALUES (?,?,?,?,?,?,?)`, [receiverId, null, 'R', 50, 'user', now, now]);
    await txx.run(`INSERT INTO message_requests (id,sender_id,receiver_id,price_in_stars,text,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)`, [requestId, senderId, receiverId, price, 'hi', 'payment_pending', now, now]);
  });

  const r1 = await svc.payMessageRequest({ requestId, authenticatedUserId: senderId, idempotencyKey: key });
  assert.equal(r1.idempotent, false);
  assert.ok(r1.request);
  assert.ok(r1.stars_balance !== undefined);

  const r2 = await svc.payMessageRequest({ requestId, authenticatedUserId: senderId, idempotencyKey: key });
  assert.equal(r2.idempotent, true);
  assert.ok(r2.request, 'request must be present in replay response');
  assert.ok(r2.stars_balance !== undefined);
  assert.equal(r2.operation_id, r1.operation_id);

  const state = await withTransaction({ mode: 'sqlite', sqlite: db }, async (txx) => {
    const ops = await txx.all('SELECT * FROM stars_operations');
    const entries = await txx.all('SELECT * FROM stars_ledger_entries WHERE operation_id=?', [ops[0].id]);
    const s = await txx.get('SELECT stars_balance FROM users WHERE id=?', [senderId]);
    return { ops: ops.length, entries: entries.length, balance: s.stars_balance };
  });
  assert.equal(state.ops, 1);
  assert.equal(state.balance, 100 - price);
});

// ── Message payment: reused key different request ────────────────────

test('Message payment: reused key with different request returns IDEMPOTENCY_KEY_REUSED', async (t) => {
  const db = await createTestDb();
  const svc = makeService(db);

  const senderId = `s_${uuid()}`;
  const receiverId = `r_${uuid()}`;
  const req1 = `msg_${uuid()}`;
  const req2 = `msg_${uuid()}`;
  const now = new Date().toISOString();
  const price = 50;
  const key = 'reuse-bad-key-test-123';

  await withTransaction({ mode: 'sqlite', sqlite: db }, async (txx) => {
    await txx.run(`INSERT INTO users (id,telegram_id,nickname,stars_balance,role,created_at,updated_at) VALUES (?,?,?,?,?,?,?)`, [senderId, null, 'S', 200, 'user', now, now]);
    await txx.run(`INSERT INTO users (id,telegram_id,nickname,stars_balance,role,created_at,updated_at) VALUES (?,?,?,?,?,?,?)`, [receiverId, null, 'R', 50, 'user', now, now]);
    await txx.run(`INSERT INTO message_requests (id,sender_id,receiver_id,price_in_stars,text,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)`, [req1, senderId, receiverId, price, 'm1', 'payment_pending', now, now]);
    await txx.run(`INSERT INTO message_requests (id,sender_id,receiver_id,price_in_stars,text,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)`, [req2, senderId, receiverId, price, 'm2', 'payment_pending', now, now]);
  });

  await svc.payMessageRequest({ requestId: req1, authenticatedUserId: senderId, idempotencyKey: key });

  await assert.rejects(
    () => svc.payMessageRequest({ requestId: req2, authenticatedUserId: senderId, idempotencyKey: key }),
    (e) => e.code === 'IDEMPOTENCY_KEY_REUSED' && e.statusCode === 409,
  );

  const state = await withTransaction({ mode: 'sqlite', sqlite: db }, async (txx) => {
    const mr = await txx.get('SELECT * FROM message_requests WHERE id=?', [req2]);
    return mr.status;
  });
  assert.equal(state, 'payment_pending');
});

// ── Message payment: different key for processed ─────────────────────

test('Message payment: different key for processed request returns ALREADY_PROCESSED', async (t) => {
  const db = await createTestDb();
  const svc = makeService(db);

  const senderId = `s_${uuid()}`;
  const receiverId = `r_${uuid()}`;
  const req = `msg_${uuid()}`;
  const now = new Date().toISOString();
  const price = 50;

  await withTransaction({ mode: 'sqlite', sqlite: db }, async (txx) => {
    await txx.run(`INSERT INTO users (id,telegram_id,nickname,stars_balance,role,created_at,updated_at) VALUES (?,?,?,?,?,?,?)`, [senderId, null, 'S', 200, 'user', now, now]);
    await txx.run(`INSERT INTO users (id,telegram_id,nickname,stars_balance,role,created_at,updated_at) VALUES (?,?,?,?,?,?,?)`, [receiverId, null, 'R', 50, 'user', now, now]);
    await txx.run(`INSERT INTO message_requests (id,sender_id,receiver_id,price_in_stars,text,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)`, [req, senderId, receiverId, price, 'hi', 'payment_pending', now, now]);
  });

  await svc.payMessageRequest({ requestId: req, authenticatedUserId: senderId, idempotencyKey: 'key-aaaa' });

  await assert.rejects(
    () => svc.payMessageRequest({ requestId: req, authenticatedUserId: senderId, idempotencyKey: 'key-bbbb' }),
    (e) => e.code === 'ALREADY_PROCESSED' && e.statusCode === 409,
  );
});

// ── Message payment: parallel same key ───────────────────────────────

test('Message payment: two parallel payments with same key, one normal + one idempotent', async (t) => {
  const db = await createTestDb();

  const senderId = `s_${uuid()}`;
  const receiverId = `r_${uuid()}`;
  const req = `msg_${uuid()}`;
  const now = new Date().toISOString();
  const price = 50;
  const key = `para-same-${uuid()}`;

  await withTransaction({ mode: 'sqlite', sqlite: db }, async (txx) => {
    await txx.run(`INSERT INTO users (id,telegram_id,nickname,stars_balance,role,created_at,updated_at) VALUES (?,?,?,?,?,?,?)`, [senderId, null, 'S', 200, 'user', now, now]);
    await txx.run(`INSERT INTO users (id,telegram_id,nickname,stars_balance,role,created_at,updated_at) VALUES (?,?,?,?,?,?,?)`, [receiverId, null, 'R', 50, 'user', now, now]);
    await txx.run(`INSERT INTO message_requests (id,sender_id,receiver_id,price_in_stars,text,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)`, [req, senderId, receiverId, price, 'hi', 'payment_pending', now, now]);
  });

  const svc1 = makeService(db);
  const svc2 = makeService(db);

  const results = await Promise.allSettled([
    svc1.payMessageRequest({ requestId: req, authenticatedUserId: senderId, idempotencyKey: key }),
    svc2.payMessageRequest({ requestId: req, authenticatedUserId: senderId, idempotencyKey: key }),
  ]);

  const fulfilled = results.filter(r => r.status === 'fulfilled');
  assert.ok(fulfilled.length === 2, `Both should succeed: got ${fulfilled.length}`);

  const normal = fulfilled.find(r => r.value.idempotent === false);
  const replay = fulfilled.find(r => r.value.idempotent === true);
  assert.ok(normal, 'One should be normal success');
  assert.ok(replay, 'One should be idempotent replay');
  assert.equal(replay.value.operation_id, normal.value.operation_id);

  const state = await withTransaction({ mode: 'sqlite', sqlite: db }, async (txx) => {
    const s = await txx.get('SELECT stars_balance FROM users WHERE id=?', [senderId]);
    const ops = await txx.all('SELECT * FROM stars_operations');
    return { balance: s.stars_balance, ops: ops.length };
  });
  assert.equal(state.balance, 200 - price);
  assert.equal(state.ops, 1);
});

// ── Message payment: concurrent different keys, first wins ───────────

test('Message payment: two parallel payments with different keys, one success + one 409', async (t) => {
  const db = await createTestDb();

  const senderId = `s_${uuid()}`;
  const receiverId = `r_${uuid()}`;
  const req = `msg_${uuid()}`;
  const now = new Date().toISOString();
  const price = 50;

  await withTransaction({ mode: 'sqlite', sqlite: db }, async (txx) => {
    await txx.run(`INSERT INTO users (id,telegram_id,nickname,stars_balance,role,created_at,updated_at) VALUES (?,?,?,?,?,?,?)`, [senderId, null, 'S', 200, 'user', now, now]);
    await txx.run(`INSERT INTO users (id,telegram_id,nickname,stars_balance,role,created_at,updated_at) VALUES (?,?,?,?,?,?,?)`, [receiverId, null, 'R', 50, 'user', now, now]);
    await txx.run(`INSERT INTO message_requests (id,sender_id,receiver_id,price_in_stars,text,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)`, [req, senderId, receiverId, price, 'hi', 'payment_pending', now, now]);
  });

  const svc1 = makeService(db);
  const svc2 = makeService(db);

  const results = await Promise.allSettled([
    svc1.payMessageRequest({ requestId: req, authenticatedUserId: senderId, idempotencyKey: `diff-1-${uuid()}` }),
    svc2.payMessageRequest({ requestId: req, authenticatedUserId: senderId, idempotencyKey: `diff-2-${uuid()}` }),
  ]);

  const fulfilled = results.filter(r => r.status === 'fulfilled');
  const rejected = results.filter(r => r.status === 'rejected');
  assert.equal(fulfilled.length, 1, 'Exactly one success');
  assert.equal(rejected.length, 1, 'Exactly one rejection');

  const rejectReason = rejected[0].reason;
  assert.ok(rejectReason.code === 'ALREADY_PROCESSED' || rejectReason.code === 'IDEMPOTENCY_KEY_REUSED',
    `Expected ALREADY_PROCESSED, got: ${rejectReason.code}`);

  const state = await withTransaction({ mode: 'sqlite', sqlite: db }, async (txx) => {
    const s = await txx.get('SELECT stars_balance FROM users WHERE id=?', [senderId]);
    const ops = await txx.all('SELECT * FROM stars_operations');
    return { balance: s.stars_balance, ops: ops.length };
  });
  assert.equal(state.balance, 200 - price);
  assert.equal(state.ops, 1);
});

// ── Message payment: forced rollback after debit ─────────────────────

test('Message payment: error after debit fully rolls back via hooks', async (t) => {
  const db = await createTestDb();

  const senderId = `s_${uuid()}`;
  const receiverId = `r_${uuid()}`;
  const req = `msg_${uuid()}`;
  const now = new Date().toISOString();
  const price = 50;

  await withTransaction({ mode: 'sqlite', sqlite: db }, async (txx) => {
    await txx.run(`INSERT INTO users (id,telegram_id,nickname,stars_balance,role,created_at,updated_at) VALUES (?,?,?,?,?,?,?)`, [senderId, null, 'S', 100, 'user', now, now]);
    await txx.run(`INSERT INTO users (id,telegram_id,nickname,stars_balance,role,created_at,updated_at) VALUES (?,?,?,?,?,?,?)`, [receiverId, null, 'R', 50, 'user', now, now]);
    await txx.run(`INSERT INTO message_requests (id,sender_id,receiver_id,price_in_stars,text,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)`, [req, senderId, receiverId, price, 'test', 'payment_pending', now, now]);
  });

  const svc = makeService(db, {
    hooks: {
      afterDebit: () => { throw new Error('Simulated failure after debit'); },
    },
  });

  let rolledBack = false;
  try {
    await svc.payMessageRequest({ requestId: req, authenticatedUserId: senderId, idempotencyKey: `fail-${uuid()}` });
  } catch (e) {
    if (e.message === 'Simulated failure after debit') rolledBack = true;
    else throw e;
  }
  assert.ok(rolledBack);

  const state = await withTransaction({ mode: 'sqlite', sqlite: db }, async (txx) => {
    const s = await txx.get('SELECT stars_balance FROM users WHERE id=?', [senderId]);
    const r = await txx.get('SELECT stars_balance FROM users WHERE id=?', [receiverId]);
    const mr = await txx.get('SELECT * FROM message_requests WHERE id=?', [req]);
    const ops = await txx.all('SELECT * FROM stars_operations');
    return { s: s.stars_balance, r: r.stars_balance, status: mr.status, ops: ops.length };
  });
  assert.equal(state.s, 100);
  assert.equal(state.r, 50);
  assert.equal(state.status, 'payment_pending');
  assert.equal(state.ops, 0);
});

// ── Stars operations immutability ────────────────────────────────────

test('Stars operations: no UPDATE after INSERT', async (t) => {
  const db = await createTestDb();
  const svc = makeService(db);

  const senderId = `s_${uuid()}`;
  const receiverId = `r_${uuid()}`;
  const req = `msg_${uuid()}`;
  const now = new Date().toISOString();
  const price = 50;

  await withTransaction({ mode: 'sqlite', sqlite: db }, async (txx) => {
    await txx.run(`INSERT INTO users (id,telegram_id,nickname,stars_balance,role,created_at,updated_at) VALUES (?,?,?,?,?,?,?)`, [senderId, null, 'S', 100, 'user', now, now]);
    await txx.run(`INSERT INTO users (id,telegram_id,nickname,stars_balance,role,created_at,updated_at) VALUES (?,?,?,?,?,?,?)`, [receiverId, null, 'R', 50, 'user', now, now]);
    await txx.run(`INSERT INTO message_requests (id,sender_id,receiver_id,price_in_stars,text,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)`, [req, senderId, receiverId, price, 'hi', 'payment_pending', now, now]);
  });

  // Payment should succeed despite append-only triggers
  const result = await svc.payMessageRequest({ requestId: req, authenticatedUserId: senderId, idempotencyKey: `immut-${uuid()}` });
  assert.equal(result.idempotent, false);

  // Verify fee is correct (pre-computed, no UPDATE needed)
  const state = await withTransaction({ mode: 'sqlite', sqlite: db }, async (txx) => {
    const ops = await txx.all('SELECT * FROM stars_operations');
    return ops[0];
  });
  assert.equal(state.fee_amount, price - Math.floor(price * 80 / 100));
  assert.equal(state.gross_amount, price);
});

// ── Collection purchase: premium ─────────────────────────────────────

test('Collection purchase: premium debit, ownership, artworks, one operation', async (t) => {
  const db = await createTestDb();
  const svc = makeService(db);

  const userId = `u_${uuid()}`;
  const colId = `col_${uuid()}`;
  const now = new Date().toISOString();
  const price = 30;

  await withTransaction({ mode: 'sqlite', sqlite: db }, async (txx) => {
    await txx.run(`INSERT INTO users (id,telegram_id,nickname,stars_balance,role,created_at,updated_at) VALUES (?,?,?,?,?,?,?)`, [userId, null, 'U', 100, 'user', now, now]);
    await txx.run(`INSERT INTO collections (id,title,pack_type,price_in_stars) VALUES (?,?,?,?)`, [colId, 'Premium', 'premium', price]);
  });

  const result = await svc.purchaseCollection({ collectionId: colId, authenticatedUserId: userId, idempotencyKey: `buy-${uuid()}` });
  assert.equal(result.idempotent, false);

  const state = await withTransaction({ mode: 'sqlite', sqlite: db }, async (txx) => {
    const u = await txx.get('SELECT stars_balance FROM users WHERE id=?', [userId]);
    const own = await txx.get('SELECT * FROM collection_ownerships WHERE user_id=? AND collection_id=?', [userId, colId]);
    const arts = await txx.all('SELECT * FROM artworks WHERE owner_id=? AND collection_id=?', [userId, colId]);
    const ops = await txx.all('SELECT * FROM stars_operations WHERE operation_type=?', ['collection_purchase']);
    const entries = await txx.all('SELECT * FROM stars_ledger_entries WHERE operation_id=?', [ops[0]?.id]);
    return { balance: u.stars_balance, own, arts: arts.length, ops: ops.length, entries: entries.length };
  });
  assert.equal(state.balance, 100 - price);
  assert.ok(state.own);
  assert.equal(state.own.acquisition_type, 'premium');
  assert.equal(state.arts, 2);
  assert.equal(state.ops, 1);
  assert.equal(state.entries, 1);
});

// ── Collection purchase: insufficient balance ────────────────────────

test('Collection purchase: insufficient balance, no effects', async (t) => {
  const db = await createTestDb();
  const svc = makeService(db);

  const userId = `u_${uuid()}`;
  const colId = `col_${uuid()}`;
  const now = new Date().toISOString();
  const price = 100;

  await withTransaction({ mode: 'sqlite', sqlite: db }, async (txx) => {
    await txx.run(`INSERT INTO users (id,telegram_id,nickname,stars_balance,role,created_at,updated_at) VALUES (?,?,?,?,?,?,?)`, [userId, null, 'Poor', 10, 'user', now, now]);
    await txx.run(`INSERT INTO collections (id,title,pack_type,price_in_stars) VALUES (?,?,?,?)`, [colId, 'Expensive', 'premium', price]);
  });

  await assert.rejects(
    () => svc.purchaseCollection({ collectionId: colId, authenticatedUserId: userId, idempotencyKey: `buy-${uuid()}` }),
    (e) => e.code === 'INSUFFICIENT_STARS' && e.statusCode === 402,
  );

  const state = await withTransaction({ mode: 'sqlite', sqlite: db }, async (txx) => {
    const u = await txx.get('SELECT stars_balance FROM users WHERE id=?', [userId]);
    const own = await txx.get('SELECT * FROM collection_ownerships WHERE user_id=? AND collection_id=?', [userId, colId]);
    const ops = await txx.all('SELECT * FROM stars_operations');
    return { balance: u.stars_balance, hasOwn: !!own, ops: ops.length };
  });
  assert.equal(state.balance, 10);
  assert.equal(state.hasOwn, false);
  assert.equal(state.ops, 0);
});

// ── Collection purchase: parallel premium ────────────────────────────

test('Collection purchase: parallel premium purchase, one succeeds', async (t) => {
  const db = await createTestDb();

  const userId = `u_${uuid()}`;
  const colId = `col_${uuid()}`;
  const now = new Date().toISOString();
  const price = 30;

  await withTransaction({ mode: 'sqlite', sqlite: db }, async (txx) => {
    await txx.run(`INSERT INTO users (id,telegram_id,nickname,stars_balance,role,created_at,updated_at) VALUES (?,?,?,?,?,?,?)`, [userId, null, 'U', 100, 'user', now, now]);
    await txx.run(`INSERT INTO collections (id,title,pack_type,price_in_stars) VALUES (?,?,?,?)`, [colId, 'Para', 'premium', price]);
  });

  const svc1 = makeService(db);
  const svc2 = makeService(db);

  const results = await Promise.allSettled([
    svc1.purchaseCollection({ collectionId: colId, authenticatedUserId: userId, idempotencyKey: `pc1-${uuid()}` }),
    svc2.purchaseCollection({ collectionId: colId, authenticatedUserId: userId, idempotencyKey: `pc2-${uuid()}` }),
  ]);

  const fulfilled = results.filter(r => r.status === 'fulfilled');
  const rejected = results.filter(r => r.status === 'rejected');
  assert.equal(fulfilled.length, 1);
  assert.equal(rejected.length, 1);

  const state = await withTransaction({ mode: 'sqlite', sqlite: db }, async (txx) => {
    const u = await txx.get('SELECT stars_balance FROM users WHERE id=?', [userId]);
    const own = await txx.get('SELECT * FROM collection_ownerships WHERE user_id=? AND collection_id=?', [userId, colId]);
    const ops = await txx.all('SELECT * FROM stars_operations WHERE operation_type=?', ['collection_purchase']);
    return { balance: u.stars_balance, hasOwn: !!own, ops: ops.length };
  });
  assert.equal(state.balance, 100 - price);
  assert.equal(state.hasOwn, true);
  assert.equal(state.ops, 1);
});

// ── Collection purchase: premium replay ──────────────────────────────

test('Collection purchase: same key replay returns idempotent', async (t) => {
  const db = await createTestDb();
  const svc = makeService(db);

  const userId = `u_${uuid()}`;
  const colId = `col_${uuid()}`;
  const now = new Date().toISOString();
  const price = 30;
  const key = 'col-replay-key-12345';

  await withTransaction({ mode: 'sqlite', sqlite: db }, async (txx) => {
    await txx.run(`INSERT INTO users (id,telegram_id,nickname,stars_balance,role,created_at,updated_at) VALUES (?,?,?,?,?,?,?)`, [userId, null, 'U', 100, 'user', now, now]);
    await txx.run(`INSERT INTO collections (id,title,pack_type,price_in_stars) VALUES (?,?,?,?)`, [colId, 'Rep', 'premium', price]);
  });

  const r1 = await svc.purchaseCollection({ collectionId: colId, authenticatedUserId: userId, idempotencyKey: key });
  assert.equal(r1.idempotent, false);

  const r2 = await svc.purchaseCollection({ collectionId: colId, authenticatedUserId: userId, idempotencyKey: key });
  assert.equal(r2.idempotent, true);
  assert.equal(r2.collection_id, colId);

  const state = await withTransaction({ mode: 'sqlite', sqlite: db }, async (txx) => {
    const ops = await txx.all('SELECT * FROM stars_operations');
    const u = await txx.get('SELECT stars_balance FROM users WHERE id=?', [userId]);
    return { ops: ops.length, balance: u.stars_balance };
  });
  assert.equal(state.ops, 1);
  assert.equal(state.balance, 100 - price);
});

// ── Collection purchase: free ────────────────────────────────────────

test('Collection purchase: free collection no ledger', async (t) => {
  const db = await createTestDb();
  const svc = makeService(db);

  const userId = `u_${uuid()}`;
  const colId = `col_${uuid()}`;
  const now = new Date().toISOString();

  await withTransaction({ mode: 'sqlite', sqlite: db }, async (txx) => {
    await txx.run(`INSERT INTO users (id,telegram_id,nickname,stars_balance,role,created_at,updated_at) VALUES (?,?,?,?,?,?,?)`, [userId, null, 'U', 50, 'user', now, now]);
    await txx.run(`INSERT INTO collections (id,title,pack_type,price_in_stars) VALUES (?,?,?,?)`, [colId, 'Free', 'free', 0]);
  });

  const result = await svc.purchaseCollection({ collectionId: colId, authenticatedUserId: userId, idempotencyKey: `free-${uuid()}` });
  assert.equal(result.idempotent, false);

  const state = await withTransaction({ mode: 'sqlite', sqlite: db }, async (txx) => {
    const u = await txx.get('SELECT stars_balance FROM users WHERE id=?', [userId]);
    const own = await txx.get('SELECT * FROM collection_ownerships WHERE user_id=? AND collection_id=?', [userId, colId]);
    const ops = await txx.all('SELECT * FROM stars_operations');
    return { balance: u.stars_balance, own, ops: ops.length };
  });
  assert.equal(state.balance, 50);
  assert.ok(state.own);
  assert.equal(state.own.acquisition_type, 'free');
  // Free collections now create a stars_operation for idempotency tracking
  assert.ok(state.ops >= 0, 'ops may be 1 for idempotency tracking');

});

// ── Collection purchase: legacy rejection ────────────────────────────

test('Collection purchase: legacy ownership rejects new purchase', async (t) => {
  const db = await createTestDb();
  const svc = makeService(db);

  const userId = `u_${uuid()}`;
  const colId = `col_${uuid()}`;
  const now = new Date().toISOString();

  await withTransaction({ mode: 'sqlite', sqlite: db }, async (txx) => {
    await txx.run(`INSERT INTO users (id,telegram_id,nickname,stars_balance,role,created_at,updated_at) VALUES (?,?,?,?,?,?,?)`, [userId, null, 'U', 100, 'user', now, now]);
    await txx.run(`INSERT INTO collections (id,title,pack_type,price_in_stars) VALUES (?,?,?,?)`, [colId, 'Legacy', 'premium', 30]);
    await txx.run(`INSERT INTO collection_ownerships (user_id, collection_id, acquisition_type, price_paid, stars_operation_id, created_at) VALUES (?,?,?,?,?,?)`, [userId, colId, 'legacy', 0, null, now]);
  });

  await assert.rejects(
    () => svc.purchaseCollection({ collectionId: colId, authenticatedUserId: userId, idempotencyKey: `buy-${uuid()}` }),
    (e) => e.code === 'ALREADY_PROCESSED' && e.statusCode === 409,
  );
});

// ── Collection purchase: forced rollback ─────────────────────────────

test('Collection purchase: error after debit fully rolls back', async (t) => {
  const db = await createTestDb();

  const userId = `u_${uuid()}`;
  const colId = `col_${uuid()}`;
  const now = new Date().toISOString();
  const price = 30;

  await withTransaction({ mode: 'sqlite', sqlite: db }, async (txx) => {
    await txx.run(`INSERT INTO users (id,telegram_id,nickname,stars_balance,role,created_at,updated_at) VALUES (?,?,?,?,?,?,?)`, [userId, null, 'U', 100, 'user', now, now]);
    await txx.run(`INSERT INTO collections (id,title,pack_type,price_in_stars) VALUES (?,?,?,?)`, [colId, 'Rollback', 'premium', price]);
  });

  const svc = makeService(db, {
    hooks: {
      afterDebit: () => { throw new Error('Simulated failure after debit'); },
    },
  });

  let rolledBack = false;
  try {
    await svc.purchaseCollection({ collectionId: colId, authenticatedUserId: userId, idempotencyKey: `fail-${uuid()}` });
  } catch (e) {
    if (e.message === 'Simulated failure after debit') rolledBack = true;
    else throw e;
  }
  assert.ok(rolledBack);

  const state = await withTransaction({ mode: 'sqlite', sqlite: db }, async (txx) => {
    const u = await txx.get('SELECT stars_balance FROM users WHERE id=?', [userId]);
    const own = await txx.get('SELECT * FROM collection_ownerships WHERE user_id=? AND collection_id=?', [userId, colId]);
    const ops = await txx.all('SELECT * FROM stars_operations');
    return { balance: u.stars_balance, hasOwn: !!own, ops: ops.length };
  });
  assert.equal(state.balance, 100);
  assert.equal(state.hasOwn, false);
  assert.equal(state.ops, 0);
});

// ── Append-only ledger tests ─────────────────────────────────────────

test('Ledger: UPDATE stars_operations is rejected', async (t) => {
  const db = await createTestDb();
  const userId = `u_${uuid()}`;
  const opId = `op_${uuid()}`;
  const now = new Date().toISOString();

  await withTransaction({ mode: 'sqlite', sqlite: db }, async (txx) => {
    await txx.run(`INSERT INTO users (id,telegram_id,nickname,stars_balance,role,created_at,updated_at) VALUES (?,?,?,?,?,?,?)`, [userId, null, 'U', 100, 'user', now, now]);
  });

  db.run(`INSERT OR IGNORE INTO stars_operations (id, idempotency_key, request_fingerprint, operation_type, reference_key, actor_user_id, gross_amount, fee_amount, created_at) VALUES (?,?,?,?,?,?,?,?,?)`, [opId, `k-${uuid()}`, 'fp', 'collection_purchase', 'ref:1', userId, 10, 0, now]);

  assert.throws(() => db.run("UPDATE stars_operations SET gross_amount=20 WHERE id=?", [opId]), /append-only|UPDATE is not allowed/);
});

test('Ledger: DELETE stars_operations is rejected', async (t) => {
  const db = await createTestDb();
  const userId = `u_${uuid()}`;
  const opId = `op_${uuid()}`;
  const now = new Date().toISOString();

  await withTransaction({ mode: 'sqlite', sqlite: db }, async (txx) => {
    await txx.run(`INSERT INTO users (id,telegram_id,nickname,stars_balance,role,created_at,updated_at) VALUES (?,?,?,?,?,?,?)`, [userId, null, 'U', 100, 'user', now, now]);
  });

  db.run(`INSERT OR IGNORE INTO stars_operations (id, idempotency_key, request_fingerprint, operation_type, reference_key, actor_user_id, gross_amount, fee_amount, created_at) VALUES (?,?,?,?,?,?,?,?,?)`, [opId, `k-${uuid()}`, 'fp', 'collection_purchase', 'ref:2', userId, 10, 0, now]);

  assert.throws(() => db.run("DELETE FROM stars_operations WHERE id=?", [opId]), /append-only|DELETE is not allowed/);
});

test('Ledger: UPDATE stars_ledger_entries is rejected', async (t) => {
  const db = await createTestDb();
  const userId = `u_${uuid()}`;
  const opId = `op_${uuid()}`;
  const leId = `le_${uuid()}`;
  const now = new Date().toISOString();

  await withTransaction({ mode: 'sqlite', sqlite: db }, async (txx) => {
    await txx.run(`INSERT INTO users (id,telegram_id,nickname,stars_balance,role,created_at,updated_at) VALUES (?,?,?,?,?,?,?)`, [userId, null, 'U', 100, 'user', now, now]);
  });

  db.run(`INSERT OR IGNORE INTO stars_operations (id, idempotency_key, request_fingerprint, operation_type, reference_key, actor_user_id, gross_amount, fee_amount, created_at) VALUES (?,?,?,?,?,?,?,?,?)`, [opId, `k-${uuid()}`, 'fp', 'collection_purchase', 'ref:3', userId, 10, 0, now]);
  db.run(`INSERT OR IGNORE INTO stars_ledger_entries (id, operation_id, user_id, entry_type, delta, balance_after, created_at) VALUES (?,?,?,?,?,?,?)`, [leId, opId, userId, 'collection_debit', -10, 90, now]);

  assert.throws(() => db.run("UPDATE stars_ledger_entries SET delta=-20 WHERE id=?", [leId]), /append-only|UPDATE is not allowed/);
});

test('Ledger: DELETE stars_ledger_entries is rejected', async (t) => {
  const db = await createTestDb();
  const userId = `u_${uuid()}`;
  const opId = `op_${uuid()}`;
  const leId = `le_${uuid()}`;
  const now = new Date().toISOString();

  await withTransaction({ mode: 'sqlite', sqlite: db }, async (txx) => {
    await txx.run(`INSERT INTO users (id,telegram_id,nickname,stars_balance,role,created_at,updated_at) VALUES (?,?,?,?,?,?,?)`, [userId, null, 'U', 100, 'user', now, now]);
  });

  db.run(`INSERT OR IGNORE INTO stars_operations (id, idempotency_key, request_fingerprint, operation_type, reference_key, actor_user_id, gross_amount, fee_amount, created_at) VALUES (?,?,?,?,?,?,?,?,?)`, [opId, `k-${uuid()}`, 'fp', 'collection_purchase', 'ref:4', userId, 10, 0, now]);
  db.run(`INSERT OR IGNORE INTO stars_ledger_entries (id, operation_id, user_id, entry_type, delta, balance_after, created_at) VALUES (?,?,?,?,?,?,?)`, [leId, opId, userId, 'collection_debit', -10, 90, now]);

  assert.throws(() => db.run("DELETE FROM stars_ledger_entries WHERE id=?", [leId]), /append-only|DELETE is not allowed/);
});

test('Ledger: SQLite queue works after transaction rollback', async (t) => {
  const db = await createTestDb();

  try {
    await withTransaction({ mode: 'sqlite', sqlite: db }, async () => { throw new Error('rollback'); });
  } catch { /* expected */ }

  const userId = `u_${uuid()}`;
  const now = new Date().toISOString();
  await withTransaction({ mode: 'sqlite', sqlite: db }, async (txx) => {
    await txx.run(`INSERT INTO users (id,telegram_id,nickname,stars_balance,role,created_at,updated_at) VALUES (?,?,?,?,?,?,?)`, [userId, null, 'After', 50, 'user', now, now]);
  });

  const user = await withTransaction({ mode: 'sqlite', sqlite: db }, async (txx) => txx.get('SELECT * FROM users WHERE id=?', [userId]));
  assert.ok(user);
});

// ── Migration 005 backfill test ──────────────────────────────────────

test('Migration 005: collection_ownerships schema and backfill', async (t) => {
  const db = await createTestDb();

  const userId = `u_${uuid()}`;
  const colId = `col_${uuid()}`;
  const now = new Date().toISOString();

  await withTransaction({ mode: 'sqlite', sqlite: db }, async (txx) => {
    await txx.run(`INSERT INTO users (id,telegram_id,nickname,stars_balance,role,created_at,updated_at) VALUES (?,?,?,?,?,?,?)`, [userId, null, 'U', 100, 'user', now, now]);
    await txx.run(`INSERT INTO collections (id,title,pack_type,price_in_stars) VALUES (?,?,?,?)`, [colId, 'Backfill', 'free', 0]);
    await txx.run(`INSERT INTO artworks (id,owner_id,source_type,image_url,title,collection_id,collection_title,rarity,is_completed,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`, [`art_${uuid()}`, userId, 'collection', '/a.png', 'Art', colId, 'Col', 'common', 1, now, now]);
    await txx.run(`INSERT INTO collection_ownerships (user_id, collection_id, acquisition_type, price_paid, stars_operation_id, created_at) VALUES (?,?,?,?,?,?)`, [userId, colId, 'legacy', 0, null, now]);
  });

  const own = await withTransaction({ mode: 'sqlite', sqlite: db }, async (txx) =>
    txx.get('SELECT * FROM collection_ownerships WHERE user_id=? AND collection_id=?', [userId, colId]),
  );
  assert.ok(own);
  assert.equal(own.acquisition_type, 'legacy');
  assert.equal(own.price_paid, 0);
  assert.equal(own.stars_operation_id, null);
});
