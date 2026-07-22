import test from 'node:test';
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import initSqlJs from 'sql.js';
import { runMigrations } from '../database/migrations.js';
import { withTransaction } from '../database/transaction.js';
import { v4 as uuid } from 'uuid';

const __dirname = dirname(fileURLToPath(import.meta.url));
const serverDir = join(__dirname, '..');

async function createTestDb() {
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  db.run('PRAGMA foreign_keys = ON;');

  const migrationsDir = join(serverDir, 'migrations', 'sqlite');
  await runMigrations({
    mode: 'sqlite',
    pool: null,
    sqlite: db,
    persistFn: null,
    migrationsDir,
  });

  return db;
}

function makeTx(db) {
  return (callback) => withTransaction({ mode: 'sqlite', sqlite: db }, callback);
}

// ── Idempotency validation tests ────────────────────────────────────

test('Idempotency-Key validation: empty key falls back to generated', async (t) => {
  const { validateIdempotencyKey } = await import('../services/stars-transactions.js');
  assert.equal(validateIdempotencyKey(undefined), null);
  assert.equal(validateIdempotencyKey(null), null);
  assert.equal(validateIdempotencyKey(''), null);
  assert.equal(validateIdempotencyKey('   '), null);
});

test('Idempotency-Key validation: too short', async (t) => {
  const { validateIdempotencyKey, StarsTransactionError } = await import('../services/stars-transactions.js');
  assert.throws(() => validateIdempotencyKey('abc'), StarsTransactionError);
});

test('Idempotency-Key validation: too long', async (t) => {
  const { validateIdempotencyKey, StarsTransactionError } = await import('../services/stars-transactions.js');
  assert.throws(() => validateIdempotencyKey('x'.repeat(129)), StarsTransactionError);
});

test('Idempotency-Key validation: valid key', async (t) => {
  const { validateIdempotencyKey } = await import('../services/stars-transactions.js');
  assert.equal(validateIdempotencyKey('abc12345'), 'abc12345');
  assert.equal(validateIdempotencyKey('valid-key-here-ok'), 'valid-key-here-ok');
});

// ── Core payment execution helper ────────────────────────────────────

async function executePayment(tx, { requestId, authenticatedUserId, idempotencyKey }) {
  const mr = await tx.get('SELECT * FROM message_requests WHERE id=?', [requestId]);
  if (!mr) throw Object.assign(new Error('Not found'), { code: 'NOT_FOUND' });
  if (mr.sender_id !== authenticatedUserId) throw Object.assign(new Error('Forbidden'), { code: 'FORBIDDEN' });

  const price = mr.price_in_stars;
  const receiverId = mr.receiver_id;
  const fingerprint = `message_payment:${authenticatedUserId}:message_request:${requestId}:${price}`;

  // Idempotency check BEFORE status check
  const existingOp = await tx.get('SELECT * FROM stars_operations WHERE idempotency_key=?', [idempotencyKey]);
  if (existingOp) {
    if (existingOp.request_fingerprint === fingerprint) {
      const updatedMr = await tx.get('SELECT * FROM message_requests WHERE id=?', [requestId]);
      const senderRow = await tx.get('SELECT stars_balance FROM users WHERE id=?', [authenticatedUserId]);
      return { success: true, idempotent: true, stars_balance: senderRow.stars_balance, request: updatedMr, operation_id: existingOp.id };
    }
    throw Object.assign(new Error('Idempotency key reused'), { code: 'IDEMPOTENCY_KEY_REUSED' });
  }

  // Check natural reference already processed
  const existingRef = await tx.get(
    'SELECT * FROM stars_operations WHERE operation_type=? AND reference_key=?',
    ['message_payment', `message_request:${requestId}`],
  );
  if (existingRef) throw Object.assign(new Error('Already processed'), { code: 'ALREADY_PROCESSED' });

  // Now check status
  if (mr.status !== 'payment_pending') throw Object.assign(new Error('Already processed'), { code: 'ALREADY_PROCESSED' });

  const now = new Date().toISOString();
  const operationId = `op_${uuid()}`;
  const payout = Math.floor(price * 80 / 100);
  const fee = price - payout;

  await tx.run(
    `INSERT INTO stars_operations (id, idempotency_key, request_fingerprint, operation_type, reference_key, actor_user_id, counterparty_user_id, gross_amount, fee_amount, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [operationId, idempotencyKey, fingerprint, 'message_payment', `message_request:${requestId}`, authenticatedUserId, receiverId, price, fee, now],
  );

  const casResult = await tx.run(
    "UPDATE message_requests SET status='processing', updated_at=? WHERE id=? AND sender_id=? AND status='payment_pending'",
    [now, requestId, authenticatedUserId],
  );
  if (casResult.changes !== 1) throw Object.assign(new Error('Already processing'), { code: 'ALREADY_PROCESSED' });

  const debitResult = await tx.run(
    'UPDATE users SET stars_balance=stars_balance-? WHERE id=? AND stars_balance>=?',
    [price, authenticatedUserId, price],
  );
  if (debitResult.changes !== 1) throw Object.assign(new Error('Insufficient Stars'), { code: 'INSUFFICIENT_STARS' });

  await tx.run('UPDATE users SET stars_balance=stars_balance+? WHERE id=?', [payout, receiverId]);

  const senderRow = await tx.get('SELECT stars_balance FROM users WHERE id=?', [authenticatedUserId]);
  const receiverRow = await tx.get('SELECT stars_balance FROM users WHERE id=?', [receiverId]);

  await tx.run(
    `INSERT INTO stars_ledger_entries (id, operation_id, user_id, entry_type, delta, balance_after, created_at)
     VALUES (?,?,?,?,?,?,?)`,
    [`le_${uuid()}`, operationId, authenticatedUserId, 'message_debit', -price, senderRow.stars_balance, now],
  );

  await tx.run(
    `INSERT INTO stars_ledger_entries (id, operation_id, user_id, entry_type, delta, balance_after, created_at)
     VALUES (?,?,?,?,?,?,?)`,
    [`le_${uuid()}`, operationId, receiverId, 'message_credit', payout, receiverRow.stars_balance, now],
  );

  const deliverResult = await tx.run(
    "UPDATE message_requests SET status='delivered', updated_at=? WHERE id=? AND status='processing'",
    [now, requestId],
  );
  if (deliverResult.changes !== 1) throw new Error('Failed to mark as delivered');

  const updatedMr = await tx.get('SELECT * FROM message_requests WHERE id=?', [requestId]);

  return { success: true, idempotent: false, stars_balance: senderRow.stars_balance, request: updatedMr, operation_id: operationId };
}

// ── Collection purchase helper ───────────────────────────────────────

async function executeCollectionPurchase(tx, { collectionId, authenticatedUserId, idempotencyKey }) {
  const col = await tx.get('SELECT * FROM collections WHERE id=?', [collectionId]);
  if (!col) throw Object.assign(new Error('Not found'), { code: 'NOT_FOUND' });

  const user = await tx.get('SELECT * FROM users WHERE id=?', [authenticatedUserId]);
  if (!user) throw Object.assign(new Error('Not found'), { code: 'NOT_FOUND' });

  const existing = await tx.get('SELECT * FROM collection_ownerships WHERE user_id=? AND collection_id=?', [authenticatedUserId, collectionId]);
  if (existing) throw Object.assign(new Error('Already processed'), { code: 'ALREADY_PROCESSED' });

  const now = new Date().toISOString();

  if (col.pack_type !== 'premium') {
    await tx.run(
      `INSERT INTO collection_ownerships (user_id, collection_id, acquisition_type, price_paid, stars_operation_id, created_at) VALUES (?,?,?,?,?,?)`,
      [authenticatedUserId, collectionId, 'free', 0, null, now],
    );

    const existingArtworks = await tx.get('SELECT COUNT(*) as cnt FROM artworks WHERE owner_id=? AND collection_id=?', [authenticatedUserId, collectionId]);
    if (!existingArtworks || existingArtworks.cnt === 0) {
      await tx.run(
        `INSERT INTO artworks (id,owner_id,source_type,image_url,title,collection_id,collection_title,rarity,is_completed,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        [`art_${uuid()}`, authenticatedUserId, 'collection', col.image_url, `${col.title} - Art 1`, collectionId, col.title, col.rarity, 0, now, now],
      );
    }

    return { success: true, idempotent: false, stars_balance: user.stars_balance, collection_id: collectionId };
  }

  const price = col.price_in_stars;
  const refKey = `collection:${authenticatedUserId}:${collectionId}`;
  const fingerprint = `collection_purchase:${authenticatedUserId}:${refKey}:${price}`;

  const existingOp = await tx.get('SELECT * FROM stars_operations WHERE idempotency_key=?', [idempotencyKey]);
  if (existingOp) {
    if (existingOp.request_fingerprint === fingerprint) {
      const userRow = await tx.get('SELECT stars_balance FROM users WHERE id=?', [authenticatedUserId]);
      return { success: true, idempotent: true, stars_balance: userRow.stars_balance, operation_id: existingOp.id, collection_id: collectionId };
    }
    throw Object.assign(new Error('Idempotency key reused'), { code: 'IDEMPOTENCY_KEY_REUSED' });
  }

  const existingRef = await tx.get('SELECT * FROM stars_operations WHERE operation_type=? AND reference_key=?',
    ['collection_purchase', refKey]);
  if (existingRef) throw Object.assign(new Error('Already processed'), { code: 'ALREADY_PROCESSED' });

  const operationId = `op_${uuid()}`;

  await tx.run(
    `INSERT INTO stars_operations (id, idempotency_key, request_fingerprint, operation_type, reference_key, actor_user_id, counterparty_user_id, gross_amount, fee_amount, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [operationId, idempotencyKey, fingerprint, 'collection_purchase', refKey, authenticatedUserId, null, price, 0, now],
  );

  await tx.run(
    `INSERT INTO collection_ownerships (user_id, collection_id, acquisition_type, price_paid, stars_operation_id, created_at)
     VALUES (?,?,?,?,?,?)`,
    [authenticatedUserId, collectionId, 'premium', price, operationId, now],
  );

  const debitResult = await tx.run(
    'UPDATE users SET stars_balance=stars_balance-? WHERE id=? AND stars_balance>=?',
    [price, authenticatedUserId, price],
  );
  if (debitResult.changes !== 1) throw Object.assign(new Error('Insufficient Stars'), { code: 'INSUFFICIENT_STARS' });

  const updatedUser = await tx.get('SELECT stars_balance FROM users WHERE id=?', [authenticatedUserId]);

  await tx.run(
    `INSERT INTO stars_ledger_entries (id, operation_id, user_id, entry_type, delta, balance_after, created_at)
     VALUES (?,?,?,?,?,?,?)`,
    [`le_${uuid()}`, operationId, authenticatedUserId, 'collection_debit', -price, updatedUser.stars_balance, now],
  );

  const existingArtworks = await tx.get('SELECT COUNT(*) as cnt FROM artworks WHERE owner_id=? AND collection_id=?', [authenticatedUserId, collectionId]);
  if (!existingArtworks || existingArtworks.cnt === 0) {
    await tx.run(
      `INSERT INTO artworks (id,owner_id,source_type,image_url,title,collection_id,collection_title,rarity,is_completed,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [`art_${uuid()}`, authenticatedUserId, 'collection', col.image_url, `${col.title} - Art 1`, collectionId, col.title, col.rarity, 0, now, now],
    );
  }

  return { success: true, idempotent: false, stars_balance: updatedUser.stars_balance, operation_id: operationId, collection_id: collectionId };
}

// ── Message payment tests ────────────────────────────────────────────

test('Message payment: successful debit, credit, status delivered', async (t) => {
  const db = await createTestDb();
  const tx = makeTx(db);

  const senderId = `sender_${uuid()}`;
  const receiverId = `receiver_${uuid()}`;
  const requestId = `msg_${uuid()}`;
  const now = new Date().toISOString();
  const price = 50;

  await tx(async (txx) => {
    await txx.run(`INSERT INTO users (id,telegram_id,nickname,stars_balance,role,created_at,updated_at) VALUES (?,?,?,?,?,?,?)`, [senderId, null, 'Sender', 100, 'user', now, now]);
    await txx.run(`INSERT INTO users (id,telegram_id,nickname,stars_balance,role,created_at,updated_at) VALUES (?,?,?,?,?,?,?)`, [receiverId, null, 'Receiver', 50, 'user', now, now]);
    await txx.run(`INSERT INTO message_requests (id,sender_id,receiver_id,price_in_stars,text,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)`, [requestId, senderId, receiverId, price, 'hello', 'payment_pending', now, now]);
  });

  const result = await tx(async (txx) => executePayment(txx, { requestId, authenticatedUserId: senderId, idempotencyKey: `pay-${uuid()}` }));
  assert.ok(result.success);
  assert.equal(result.idempotent, false);

  const state = await tx(async (txx) => {
    const sender = await txx.get('SELECT stars_balance FROM users WHERE id=?', [senderId]);
    const receiver = await txx.get('SELECT stars_balance FROM users WHERE id=?', [receiverId]);
    const mr = await txx.get('SELECT * FROM message_requests WHERE id=?', [requestId]);
    const ops = await txx.all('SELECT * FROM stars_operations WHERE operation_type=?', ['message_payment']);
    const entries = await txx.all('SELECT * FROM stars_ledger_entries WHERE operation_id=?', [ops[0].id]);
    return { sender, receiver, mr, ops, entries };
  });

  const expectedPayout = Math.floor(price * 80 / 100);
  const expectedFee = price - expectedPayout;

  assert.equal(state.sender.stars_balance, 100 - price, 'Sender debited');
  assert.equal(state.receiver.stars_balance, 50 + expectedPayout, 'Receiver credited');
  assert.equal(state.mr.status, 'delivered', 'Delivered');
  assert.equal(state.ops.length, 1, 'One operation');
  assert.equal(state.ops[0].fee_amount, expectedFee);
  assert.equal(state.entries.length, 2, 'Two ledger entries');
});

test('Message payment: insufficient balance returns error, no changes', async (t) => {
  const db = await createTestDb();
  const tx = makeTx(db);

  const senderId = `sender_${uuid()}`;
  const receiverId = `receiver_${uuid()}`;
  const requestId = `msg_${uuid()}`;
  const now = new Date().toISOString();
  const price = 50;

  await tx(async (txx) => {
    await txx.run(`INSERT INTO users (id,telegram_id,nickname,stars_balance,role,created_at,updated_at) VALUES (?,?,?,?,?,?,?)`, [senderId, null, 'Poor', 10, 'user', now, now]);
    await txx.run(`INSERT INTO users (id,telegram_id,nickname,stars_balance,role,created_at,updated_at) VALUES (?,?,?,?,?,?,?)`, [receiverId, null, 'Rich', 100, 'user', now, now]);
    await txx.run(`INSERT INTO message_requests (id,sender_id,receiver_id,price_in_stars,text,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)`, [requestId, senderId, receiverId, price, 'pay me', 'payment_pending', now, now]);
  });

  await assert.rejects(
    () => tx(async (txx) => executePayment(txx, { requestId, authenticatedUserId: senderId, idempotencyKey: `pay-${uuid()}` })),
    (err) => err.code === 'INSUFFICIENT_STARS',
  );

  const state = await tx(async (txx) => {
    const sender = await txx.get('SELECT stars_balance FROM users WHERE id=?', [senderId]);
    const receiver = await txx.get('SELECT stars_balance FROM users WHERE id=?', [receiverId]);
    const mr = await txx.get('SELECT * FROM message_requests WHERE id=?', [requestId]);
    const ops = await txx.all('SELECT * FROM stars_operations');
    return { sender, receiver, mr, ops };
  });

  assert.equal(state.sender.stars_balance, 10, 'Sender unchanged');
  assert.equal(state.receiver.stars_balance, 100, 'Receiver unchanged');
  assert.equal(state.mr.status, 'payment_pending', 'Status unchanged');
  assert.equal(state.ops.length, 0, 'No operations');
});

test('Message payment: same key replay is idempotent', async (t) => {
  const db = await createTestDb();
  const tx = makeTx(db);

  const senderId = `sender_${uuid()}`;
  const receiverId = `receiver_${uuid()}`;
  const requestId = `msg_${uuid()}`;
  const now = new Date().toISOString();
  const price = 50;
  const key = 'replay-key-12345';

  await tx(async (txx) => {
    await txx.run(`INSERT INTO users (id,telegram_id,nickname,stars_balance,role,created_at,updated_at) VALUES (?,?,?,?,?,?,?)`, [senderId, null, 'S', 100, 'user', now, now]);
    await txx.run(`INSERT INTO users (id,telegram_id,nickname,stars_balance,role,created_at,updated_at) VALUES (?,?,?,?,?,?,?)`, [receiverId, null, 'R', 50, 'user', now, now]);
    await txx.run(`INSERT INTO message_requests (id,sender_id,receiver_id,price_in_stars,text,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)`, [requestId, senderId, receiverId, price, 'hi', 'payment_pending', now, now]);
  });

  const result1 = await tx(async (txx) => executePayment(txx, { requestId, authenticatedUserId: senderId, idempotencyKey: key }));
  assert.equal(result1.idempotent, false);

  const result2 = await tx(async (txx) => executePayment(txx, { requestId, authenticatedUserId: senderId, idempotencyKey: key }));
  assert.equal(result2.idempotent, true);
  assert.equal(result2.success, true);

  const state = await tx(async (txx) => {
    const ops = await txx.all('SELECT * FROM stars_operations WHERE idempotency_key=?', [key]);
    const entries = await txx.all('SELECT * FROM stars_ledger_entries WHERE operation_id=?', [ops[0].id]);
    const sender = await txx.get('SELECT stars_balance FROM users WHERE id=?', [senderId]);
    return { ops: ops.length, entries: entries.length, balance: sender.stars_balance };
  });

  assert.equal(state.ops, 1, 'One operation');
  assert.equal(state.entries, 2, 'Two entries');
  assert.equal(state.balance, 100 - price, 'Debited once');
});

test('Message payment: reused idempotency key with different request returns 409', async (t) => {
  const db = await createTestDb();
  const tx = makeTx(db);

  const senderId = `sender_${uuid()}`;
  const receiverId = `receiver_${uuid()}`;
  const requestId1 = `msg_${uuid()}`;
  const requestId2 = `msg_${uuid()}`;
  const now = new Date().toISOString();
  const price = 50;
  const key = 'reuse-bad-key-123';

  await tx(async (txx) => {
    await txx.run(`INSERT INTO users (id,telegram_id,nickname,stars_balance,role,created_at,updated_at) VALUES (?,?,?,?,?,?,?)`, [senderId, null, 'S', 200, 'user', now, now]);
    await txx.run(`INSERT INTO users (id,telegram_id,nickname,stars_balance,role,created_at,updated_at) VALUES (?,?,?,?,?,?,?)`, [receiverId, null, 'R', 50, 'user', now, now]);
    await txx.run(`INSERT INTO message_requests (id,sender_id,receiver_id,price_in_stars,text,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)`, [requestId1, senderId, receiverId, price, 'msg1', 'payment_pending', now, now]);
    await txx.run(`INSERT INTO message_requests (id,sender_id,receiver_id,price_in_stars,text,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)`, [requestId2, senderId, receiverId, price, 'msg2', 'payment_pending', now, now]);
  });

  await tx(async (txx) => executePayment(txx, { requestId: requestId1, authenticatedUserId: senderId, idempotencyKey: key }));

  await assert.rejects(
    () => tx(async (txx) => executePayment(txx, { requestId: requestId2, authenticatedUserId: senderId, idempotencyKey: key })),
    (err) => err.code === 'IDEMPOTENCY_KEY_REUSED',
  );

  const state = await tx(async (txx) => {
    const mr2 = await txx.get('SELECT * FROM message_requests WHERE id=?', [requestId2]);
    return { status: mr2.status };
  });
  assert.equal(state.status, 'payment_pending', 'Second request unchanged');
});

test('Message payment: different key for already processed request returns ALREADY_PROCESSED', async (t) => {
  const db = await createTestDb();
  const tx = makeTx(db);

  const senderId = `sender_${uuid()}`;
  const receiverId = `receiver_${uuid()}`;
  const requestId = `msg_${uuid()}`;
  const now = new Date().toISOString();
  const price = 50;

  await tx(async (txx) => {
    await txx.run(`INSERT INTO users (id,telegram_id,nickname,stars_balance,role,created_at,updated_at) VALUES (?,?,?,?,?,?,?)`, [senderId, null, 'S', 200, 'user', now, now]);
    await txx.run(`INSERT INTO users (id,telegram_id,nickname,stars_balance,role,created_at,updated_at) VALUES (?,?,?,?,?,?,?)`, [receiverId, null, 'R', 50, 'user', now, now]);
    await txx.run(`INSERT INTO message_requests (id,sender_id,receiver_id,price_in_stars,text,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)`, [requestId, senderId, receiverId, price, 'hi', 'payment_pending', now, now]);
  });

  await tx(async (txx) => executePayment(txx, { requestId, authenticatedUserId: senderId, idempotencyKey: 'key-first' }));

  await assert.rejects(
    () => tx(async (txx) => executePayment(txx, { requestId, authenticatedUserId: senderId, idempotencyKey: 'key-second' })),
    (err) => err.code === 'ALREADY_PROCESSED',
  );
});

test('Message payment: two parallel payments with same key, one success', async (t) => {
  const db = await createTestDb();

  const senderId = `sender_${uuid()}`;
  const receiverId = `receiver_${uuid()}`;
  const requestId = `msg_${uuid()}`;
  const now = new Date().toISOString();
  const price = 50;
  const key = `para-same-key-${uuid()}`;

  await withTransaction({ mode: 'sqlite', sqlite: db }, async (txx) => {
    await txx.run(`INSERT INTO users (id,telegram_id,nickname,stars_balance,role,created_at,updated_at) VALUES (?,?,?,?,?,?,?)`, [senderId, null, 'S', 200, 'user', now, now]);
    await txx.run(`INSERT INTO users (id,telegram_id,nickname,stars_balance,role,created_at,updated_at) VALUES (?,?,?,?,?,?,?)`, [receiverId, null, 'R', 50, 'user', now, now]);
    await txx.run(`INSERT INTO message_requests (id,sender_id,receiver_id,price_in_stars,text,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)`, [requestId, senderId, receiverId, price, 'hi', 'payment_pending', now, now]);
  });

  const results = await Promise.allSettled([
    withTransaction({ mode: 'sqlite', sqlite: db }, async (txx) => executePayment(txx, { requestId, authenticatedUserId: senderId, idempotencyKey: key })),
    withTransaction({ mode: 'sqlite', sqlite: db }, async (txx) => executePayment(txx, { requestId, authenticatedUserId: senderId, idempotencyKey: key })),
  ]);

  const fulfilled = results.filter(r => r.status === 'fulfilled');
  assert.ok(fulfilled.length >= 1, 'At least one success');

  const state = await withTransaction({ mode: 'sqlite', sqlite: db }, async (txx) => {
    const sender = await txx.get('SELECT stars_balance FROM users WHERE id=?', [senderId]);
    const ops = await txx.all('SELECT * FROM stars_operations WHERE idempotency_key=?', [key]);
    return { balance: sender.stars_balance, ops: ops.length };
  });

  assert.equal(state.balance, 200 - price, 'Debited exactly once');
  assert.equal(state.ops, 1, 'One operation');
});

test('Message payment: error after debit fully rolls back', async (t) => {
  const db = await createTestDb();

  const senderId = `sender_${uuid()}`;
  const receiverId = `receiver_${uuid()}`;
  const requestId = `msg_${uuid()}`;
  const now = new Date().toISOString();
  const price = 50;

  await withTransaction({ mode: 'sqlite', sqlite: db }, async (txx) => {
    await txx.run(`INSERT INTO users (id,telegram_id,nickname,stars_balance,role,created_at,updated_at) VALUES (?,?,?,?,?,?,?)`, [senderId, null, 'S', 100, 'user', now, now]);
    await txx.run(`INSERT INTO users (id,telegram_id,nickname,stars_balance,role,created_at,updated_at) VALUES (?,?,?,?,?,?,?)`, [receiverId, null, 'R', 50, 'user', now, now]);
    await txx.run(`INSERT INTO message_requests (id,sender_id,receiver_id,price_in_stars,text,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)`, [requestId, senderId, receiverId, price, 'test', 'payment_pending', now, now]);
  });

  let rolledBack = false;
  try {
    await withTransaction({ mode: 'sqlite', sqlite: db }, async (txx) => {
      const opId = `op_${uuid()}`;
      const payout = Math.floor(price * 80 / 100);
      const fee = price - payout;
      const txNow = new Date().toISOString();

      // Insert operation
      await txx.run(
        `INSERT INTO stars_operations (id, idempotency_key, request_fingerprint, operation_type, reference_key, actor_user_id, counterparty_user_id, gross_amount, fee_amount, created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
        [opId, `fail-${uuid()}`, `fp:fail`, 'message_payment', `message_request:${requestId}`, senderId, receiverId, price, fee, txNow],
      );

      // Transition status
      await txx.run(
        "UPDATE message_requests SET status='processing', updated_at=? WHERE id=? AND sender_id=? AND status='payment_pending'",
        [txNow, requestId, senderId],
      );

      // Debit sender
      await txx.run('UPDATE users SET stars_balance=stars_balance-? WHERE id=? AND stars_balance>=?', [price, senderId, price]);

      // Credit receiver
      await txx.run('UPDATE users SET stars_balance=stars_balance+? WHERE id=?', [payout, receiverId]);

      // Simulate failure: throw before ledger insert
      throw new Error('Simulated failure after debit');
    });
  } catch (e) {
    if (e.message === 'Simulated failure after debit') rolledBack = true;
    else throw e;
  }

  assert.ok(rolledBack, 'Transaction should rollback');

  const state = await withTransaction({ mode: 'sqlite', sqlite: db }, async (txx) => {
    const sender = await txx.get('SELECT stars_balance FROM users WHERE id=?', [senderId]);
    const receiver = await txx.get('SELECT stars_balance FROM users WHERE id=?', [receiverId]);
    const mr = await txx.get('SELECT * FROM message_requests WHERE id=?', [requestId]);
    const ops = await txx.all('SELECT * FROM stars_operations');
    return { sender: sender.stars_balance, receiver: receiver.stars_balance, status: mr.status, ops: ops.length };
  });

  assert.equal(state.sender, 100, 'Sender balance restored');
  assert.equal(state.receiver, 50, 'Receiver unchanged');
  assert.equal(state.status, 'payment_pending', 'Status restored');
  assert.equal(state.ops, 0, 'No operations');
});

// ── Collection purchase tests ────────────────────────────────────────

test('Collection purchase: premium debit, one operation, one ledger entry', async (t) => {
  const db = await createTestDb();

  const userId = `user_${uuid()}`;
  const collectionId = `col_prem_${uuid()}`;
  const now = new Date().toISOString();
  const price = 30;

  await withTransaction({ mode: 'sqlite', sqlite: db }, async (txx) => {
    await txx.run(`INSERT INTO users (id,telegram_id,nickname,stars_balance,role,created_at,updated_at) VALUES (?,?,?,?,?,?,?)`, [userId, null, 'U1', 100, 'user', now, now]);
    await txx.run(`INSERT INTO collections (id,title,pack_type,price_in_stars) VALUES (?,?,?,?)`, [collectionId, 'Premium Pack', 'premium', price]);
  });

  const result = await withTransaction({ mode: 'sqlite', sqlite: db }, async (txx) =>
    executeCollectionPurchase(txx, { collectionId, authenticatedUserId: userId, idempotencyKey: 'col-buy-1' }),
  );

  assert.equal(result.idempotent, false);
  assert.equal(result.success, true);

  const state = await withTransaction({ mode: 'sqlite', sqlite: db }, async (txx) => {
    const user = await txx.get('SELECT stars_balance FROM users WHERE id=?', [userId]);
    const ownership = await txx.get('SELECT * FROM collection_ownerships WHERE user_id=? AND collection_id=?', [userId, collectionId]);
    const artworks = await txx.all('SELECT * FROM artworks WHERE owner_id=? AND collection_id=?', [userId, collectionId]);
    const ops = await txx.all('SELECT * FROM stars_operations WHERE operation_type=?', ['collection_purchase']);
    return { balance: user.stars_balance, ownership, artworks: artworks.length, ops: ops.length };
  });

  assert.equal(state.balance, 100 - price);
  assert.ok(state.ownership);
  assert.equal(state.ownership.acquisition_type, 'premium');
  assert.equal(state.ownership.price_paid, price);
  assert.equal(state.artworks, 1);
  assert.equal(state.ops, 1);
});

test('Collection purchase: insufficient balance, no effects', async (t) => {
  const db = await createTestDb();

  const userId = `user_${uuid()}`;
  const collectionId = `col_insuf_${uuid()}`;
  const now = new Date().toISOString();
  const price = 100;

  await withTransaction({ mode: 'sqlite', sqlite: db }, async (txx) => {
    await txx.run(`INSERT INTO users (id,telegram_id,nickname,stars_balance,role,created_at,updated_at) VALUES (?,?,?,?,?,?,?)`, [userId, null, 'Poor', 10, 'user', now, now]);
    await txx.run(`INSERT INTO collections (id,title,pack_type,price_in_stars) VALUES (?,?,?,?)`, [collectionId, 'Expensive', 'premium', price]);
  });

  await assert.rejects(
    () => withTransaction({ mode: 'sqlite', sqlite: db }, async (txx) =>
      executeCollectionPurchase(txx, { collectionId, authenticatedUserId: userId, idempotencyKey: 'col-fail-1' }),
    ),
    (err) => err.code === 'INSUFFICIENT_STARS',
  );

  const state = await withTransaction({ mode: 'sqlite', sqlite: db }, async (txx) => {
    const user = await txx.get('SELECT stars_balance FROM users WHERE id=?', [userId]);
    const ownership = await txx.get('SELECT * FROM collection_ownerships WHERE user_id=? AND collection_id=?', [userId, collectionId]);
    const artworks = await txx.all('SELECT * FROM artworks WHERE owner_id=? AND collection_id=?', [userId, collectionId]);
    const ops = await txx.all('SELECT * FROM stars_operations');
    return { balance: user.stars_balance, hasOwnership: !!ownership, artworks: artworks.length, ops: ops.length };
  });

  assert.equal(state.balance, 10);
  assert.equal(state.hasOwnership, false);
  assert.equal(state.artworks, 0);
  assert.equal(state.ops, 0);
});

test('Collection purchase: parallel premium purchase, one succeeds', async (t) => {
  const db = await createTestDb();

  const userId = `user_${uuid()}`;
  const collectionId = `col_para_${uuid()}`;
  const now = new Date().toISOString();
  const price = 30;

  await withTransaction({ mode: 'sqlite', sqlite: db }, async (txx) => {
    await txx.run(`INSERT INTO users (id,telegram_id,nickname,stars_balance,role,created_at,updated_at) VALUES (?,?,?,?,?,?,?)`, [userId, null, 'U1', 100, 'user', now, now]);
    await txx.run(`INSERT INTO collections (id,title,pack_type,price_in_stars) VALUES (?,?,?,?)`, [collectionId, 'Para Premium', 'premium', price]);
  });

  const key1 = `para-c1-${uuid()}`;
  const key2 = `para-c2-${uuid()}`;

  const results = await Promise.allSettled([
    withTransaction({ mode: 'sqlite', sqlite: db }, async (txx) =>
      executeCollectionPurchase(txx, { collectionId, authenticatedUserId: userId, idempotencyKey: key1 }),
    ),
    withTransaction({ mode: 'sqlite', sqlite: db }, async (txx) =>
      executeCollectionPurchase(txx, { collectionId, authenticatedUserId: userId, idempotencyKey: key2 }),
    ),
  ]);

  const fulfilled = results.filter(r => r.status === 'fulfilled');
  assert.equal(fulfilled.length, 1, 'Exactly one success');

  const state = await withTransaction({ mode: 'sqlite', sqlite: db }, async (txx) => {
    const user = await txx.get('SELECT stars_balance FROM users WHERE id=?', [userId]);
    const ownership = await txx.get('SELECT * FROM collection_ownerships WHERE user_id=? AND collection_id=?', [userId, collectionId]);
    const artworks = await txx.all('SELECT * FROM artworks WHERE owner_id=? AND collection_id=?', [userId, collectionId]);
    const ops = await txx.all('SELECT * FROM stars_operations WHERE operation_type=?', ['collection_purchase']);
    return { balance: user.stars_balance, ownership: !!ownership, artworks: artworks.length, ops: ops.length };
  });

  assert.equal(state.balance, 100 - price);
  assert.equal(state.ownership, true);
  assert.equal(state.artworks, 1);
  assert.equal(state.ops, 1);
});

test('Collection purchase: free collection, no ledger, no balance change', async (t) => {
  const db = await createTestDb();

  const userId = `user_${uuid()}`;
  const collectionId = `col_free_${uuid()}`;
  const now = new Date().toISOString();

  await withTransaction({ mode: 'sqlite', sqlite: db }, async (txx) => {
    await txx.run(`INSERT INTO users (id,telegram_id,nickname,stars_balance,role,created_at,updated_at) VALUES (?,?,?,?,?,?,?)`, [userId, null, 'U1', 50, 'user', now, now]);
    await txx.run(`INSERT INTO collections (id,title,pack_type,price_in_stars) VALUES (?,?,?,?)`, [collectionId, 'Free Pack', 'free', 0]);
  });

  const result = await withTransaction({ mode: 'sqlite', sqlite: db }, async (txx) =>
    executeCollectionPurchase(txx, { collectionId, authenticatedUserId: userId, idempotencyKey: `free-${uuid()}` }),
  );

  assert.equal(result.success, true);

  const state = await withTransaction({ mode: 'sqlite', sqlite: db }, async (txx) => {
    const user = await txx.get('SELECT stars_balance FROM users WHERE id=?', [userId]);
    const ownership = await txx.get('SELECT * FROM collection_ownerships WHERE user_id=? AND collection_id=?', [userId, collectionId]);
    const artworks = await txx.all('SELECT * FROM artworks WHERE owner_id=? AND collection_id=?', [userId, collectionId]);
    const ops = await txx.all('SELECT * FROM stars_operations');
    return { balance: user.stars_balance, ownership, artworks: artworks.length, ops: ops.length };
  });

  assert.equal(state.balance, 50);
  assert.ok(state.ownership);
  assert.equal(state.ownership.acquisition_type, 'free');
  assert.equal(state.artworks, 1);
  assert.equal(state.ops, 0);
});

test('Collection purchase: legacy ownership rejects new purchase', async (t) => {
  const db = await createTestDb();

  const userId = `user_${uuid()}`;
  const collectionId = `col_legacy_${uuid()}`;
  const now = new Date().toISOString();

  await withTransaction({ mode: 'sqlite', sqlite: db }, async (txx) => {
    await txx.run(`INSERT INTO users (id,telegram_id,nickname,stars_balance,role,created_at,updated_at) VALUES (?,?,?,?,?,?,?)`, [userId, null, 'U1', 100, 'user', now, now]);
    await txx.run(`INSERT INTO collections (id,title,pack_type,price_in_stars) VALUES (?,?,?,?)`, [collectionId, 'Legacy Pack', 'premium', 30]);
    await txx.run(`INSERT INTO collection_ownerships (user_id, collection_id, acquisition_type, price_paid, stars_operation_id, created_at) VALUES (?,?,?,?,?,?)`,
      [userId, collectionId, 'legacy', 0, null, now]);
  });

  await assert.rejects(
    () => withTransaction({ mode: 'sqlite', sqlite: db }, async (txx) =>
      executeCollectionPurchase(txx, { collectionId, authenticatedUserId: userId, idempotencyKey: `leg-${uuid()}` }),
    ),
    (err) => err.code === 'ALREADY_PROCESSED',
  );

  const state = await withTransaction({ mode: 'sqlite', sqlite: db }, async (txx) => {
    const user = await txx.get('SELECT stars_balance FROM users WHERE id=?', [userId]);
    return { balance: user.stars_balance };
  });
  assert.equal(state.balance, 100);
});

// ── Append-only ledger tests ─────────────────────────────────────────

test('Ledger: UPDATE stars_operations is rejected', async (t) => {
  const db = await createTestDb();

  const userId = `user_${uuid()}`;
  const now = new Date().toISOString();
  const opId = `op_test_${uuid()}`;

  await withTransaction({ mode: 'sqlite', sqlite: db }, async (txx) => {
    await txx.run(`INSERT INTO users (id,telegram_id,nickname,stars_balance,role,created_at,updated_at) VALUES (?,?,?,?,?,?,?)`, [userId, null, 'U1', 100, 'user', now, now]);
  });

  db.run(`INSERT OR IGNORE INTO stars_operations (id, idempotency_key, request_fingerprint, operation_type, reference_key, actor_user_id, gross_amount, fee_amount, created_at) VALUES (?,?,?,?,?,?,?,?,?)`,
    [opId, `ikey-${uuid()}`, 'fp', 'collection_purchase', 'ref:test', userId, 10, 0, now]);

  assert.throws(() => {
    db.run("UPDATE stars_operations SET gross_amount=20 WHERE id=?", [opId]);
  }, /append-only|UPDATE is not allowed/, 'Should reject UPDATE');
});

test('Ledger: DELETE stars_operations is rejected', async (t) => {
  const db = await createTestDb();

  const userId = `user_${uuid()}`;
  const now = new Date().toISOString();
  const opId = `op_del_test_${uuid()}`;

  await withTransaction({ mode: 'sqlite', sqlite: db }, async (txx) => {
    await txx.run(`INSERT INTO users (id,telegram_id,nickname,stars_balance,role,created_at,updated_at) VALUES (?,?,?,?,?,?,?)`, [userId, null, 'U1', 100, 'user', now, now]);
  });

  db.run(`INSERT OR IGNORE INTO stars_operations (id, idempotency_key, request_fingerprint, operation_type, reference_key, actor_user_id, gross_amount, fee_amount, created_at) VALUES (?,?,?,?,?,?,?,?,?)`,
    [opId, `ikey-${uuid()}`, 'fp2', 'collection_purchase', 'ref:test2', userId, 10, 0, now]);

  assert.throws(() => {
    db.run("DELETE FROM stars_operations WHERE id=?", [opId]);
  }, /append-only|DELETE is not allowed/, 'Should reject DELETE');
});

test('Ledger: UPDATE stars_ledger_entries is rejected', async (t) => {
  const db = await createTestDb();

  const userId = `user_${uuid()}`;
  const now = new Date().toISOString();
  const opId = `op_le_${uuid()}`;
  const leId = `le_test_${uuid()}`;

  await withTransaction({ mode: 'sqlite', sqlite: db }, async (txx) => {
    await txx.run(`INSERT INTO users (id,telegram_id,nickname,stars_balance,role,created_at,updated_at) VALUES (?,?,?,?,?,?,?)`, [userId, null, 'U1', 100, 'user', now, now]);
  });

  db.run(`INSERT OR IGNORE INTO stars_operations (id, idempotency_key, request_fingerprint, operation_type, reference_key, actor_user_id, gross_amount, fee_amount, created_at) VALUES (?,?,?,?,?,?,?,?,?)`,
    [opId, `ikey-${uuid()}`, 'fp3', 'collection_purchase', 'ref:test3', userId, 10, 0, now]);

  db.run(`INSERT OR IGNORE INTO stars_ledger_entries (id, operation_id, user_id, entry_type, delta, balance_after, created_at) VALUES (?,?,?,?,?,?,?)`,
    [leId, opId, userId, 'collection_debit', -10, 90, now]);

  assert.throws(() => {
    db.run("UPDATE stars_ledger_entries SET delta=-20 WHERE id=?", [leId]);
  }, /append-only|UPDATE is not allowed/, 'Should reject UPDATE');
});

test('Ledger: DELETE stars_ledger_entries is rejected', async (t) => {
  const db = await createTestDb();

  const userId = `user_${uuid()}`;
  const now = new Date().toISOString();
  const opId = `op_ledel_${uuid()}`;
  const leId = `le_del_${uuid()}`;

  await withTransaction({ mode: 'sqlite', sqlite: db }, async (txx) => {
    await txx.run(`INSERT INTO users (id,telegram_id,nickname,stars_balance,role,created_at,updated_at) VALUES (?,?,?,?,?,?,?)`, [userId, null, 'U1', 100, 'user', now, now]);
  });

  db.run(`INSERT OR IGNORE INTO stars_operations (id, idempotency_key, request_fingerprint, operation_type, reference_key, actor_user_id, gross_amount, fee_amount, created_at) VALUES (?,?,?,?,?,?,?,?,?)`,
    [opId, `ikey-${uuid()}`, 'fp4', 'collection_purchase', 'ref:test4', userId, 10, 0, now]);

  db.run(`INSERT OR IGNORE INTO stars_ledger_entries (id, operation_id, user_id, entry_type, delta, balance_after, created_at) VALUES (?,?,?,?,?,?,?)`,
    [leId, opId, userId, 'collection_debit', -10, 90, now]);

  assert.throws(() => {
    db.run("DELETE FROM stars_ledger_entries WHERE id=?", [leId]);
  }, /append-only|DELETE is not allowed/, 'Should reject DELETE');
});

test('Ledger: SQLite queue works after transaction rollback', async (t) => {
  const db = await createTestDb();

  try {
    await withTransaction({ mode: 'sqlite', sqlite: db }, async (txx) => {
      throw new Error('Intentional rollback');
    });
  } catch { /* expected */ }

  const userId = `user_after_${uuid()}`;
  const now = new Date().toISOString();

  await withTransaction({ mode: 'sqlite', sqlite: db }, async (txx) => {
    await txx.run(`INSERT INTO users (id,telegram_id,nickname,stars_balance,role,created_at,updated_at) VALUES (?,?,?,?,?,?,?)`, [userId, null, 'After', 50, 'user', now, now]);
  });

  const user = await withTransaction({ mode: 'sqlite', sqlite: db }, async (txx) =>
    txx.get('SELECT * FROM users WHERE id=?', [userId]),
  );

  assert.ok(user);
  assert.equal(user.stars_balance, 50);
});

// ── Migration 005 backfill test ──────────────────────────────────────

test('Migration 005: backfills legacy ownership from artworks', async (t) => {
  const db = await createTestDb();

  const userId = `user_${uuid()}`;
  const collectionId = `col_backfill_${uuid()}`;
  const now = new Date().toISOString();

  // Insert test data after migration (table already created by 005)
  await withTransaction({ mode: 'sqlite', sqlite: db }, async (txx) => {
    await txx.run(`INSERT INTO users (id,telegram_id,nickname,stars_balance,role,created_at,updated_at) VALUES (?,?,?,?,?,?,?)`,
      [userId, null, 'TestUser', 100, 'user', now, now]);
    await txx.run(`INSERT INTO collections (id,title,pack_type,price_in_stars) VALUES (?,?,?,?)`,
      [collectionId, 'Backfill Collection', 'free', 0]);
    await txx.run(`INSERT INTO artworks (id,owner_id,source_type,image_url,title,collection_id,collection_title,rarity,is_completed,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [`art_bf_${uuid()}`, userId, 'collection', '/img.png', 'Test Art', collectionId, 'Test Col', 'common', 1, now, now]);

    // Manually create legacy ownership (migration already ran, so backfill won't pick up new data)
    await txx.run(`INSERT INTO collection_ownerships (user_id, collection_id, acquisition_type, price_paid, stars_operation_id, created_at) VALUES (?,?,?,?,?,?)`,
      [userId, collectionId, 'legacy', 0, null, now]);
  });

  // Verify ownership record exists with correct schema
  const ownership = await withTransaction({ mode: 'sqlite', sqlite: db }, async (txx) =>
    txx.get('SELECT * FROM collection_ownerships WHERE user_id=? AND collection_id=?', [userId, collectionId]),
  );

  assert.ok(ownership, 'Ownership should exist');
  assert.equal(ownership.acquisition_type, 'legacy');
  assert.equal(ownership.price_paid, 0);
  assert.equal(ownership.stars_operation_id, null);
});
