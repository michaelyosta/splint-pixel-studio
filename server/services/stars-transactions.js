import { v4 as uuid } from 'uuid';
import { withDbTransaction, getDb } from '../db.js';
import { isUniqueConstraintError } from '../database/sql.js';

export class StarsTransactionError extends Error {
  constructor(code, message, statusCode = 500) {
    super(message);
    this.name = 'StarsTransactionError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

const ERROR_CODES = {
  NOT_FOUND: 404,
  FORBIDDEN: 403,
  INSUFFICIENT_STARS: 402,
  ALREADY_PROCESSED: 409,
  IDEMPOTENCY_KEY_REUSED: 409,
  INVALID_FINANCIAL_STATE: 409,
};

function makeError(code, message) {
  return new StarsTransactionError(code, message, ERROR_CODES[code] || 500);
}

const IDEMPOTENCY_KEY_PATTERN = /^[\x21-\x7E]{8,128}$/;

export function validateIdempotencyKey(key) {
  if (key === undefined || key === null) return null;
  const trimmed = String(key).trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length < 8 || trimmed.length > 128) {
    throw makeError('NOT_FOUND', 'Idempotency-Key must be between 8 and 128 characters');
  }
  if (!IDEMPOTENCY_KEY_PATTERN.test(trimmed)) {
    throw makeError('NOT_FOUND', 'Idempotency-Key contains invalid characters');
  }
  return trimmed;
}

function buildFallbackIdempotencyKey(operationType, actorUserId, referenceKey) {
  return `${operationType}:${actorUserId}:${referenceKey}`;
}

function buildReferenceKey(operationType, data) {
  if (operationType === 'message_payment') {
    return `message_request:${data.requestId}`;
  }
  if (operationType === 'collection_purchase') {
    return `collection:${data.userId}:${data.collectionId}`;
  }
  throw new Error(`Unknown operation_type: ${operationType}`);
}

function buildRequestFingerprint(operationType, actorUserId, referenceKey, grossAmount) {
  return `${operationType}:${actorUserId}:${referenceKey}:${grossAmount}`;
}

function deterministicUserOrder(userIdA, userIdB) {
  if (userIdA < userIdB) return [userIdA, userIdB];
  return [userIdB, userIdA];
}

function idFactory() {
  return uuid();
}

let _idFactory = idFactory;

export function setIdFactory(fn) {
  _idFactory = fn;
}

export function resetIdFactory() {
  _idFactory = idFactory;
}

function newId() {
  return _idFactory();
}

// ── Message payment ──────────────────────────────────────────────────

export async function payMessageRequest({
  requestId,
  authenticatedUserId,
  idempotencyKey,
}) {
  const db = getDb();
  const mode = db.mode;

  const referenceKey = buildReferenceKey('message_payment', { requestId });
  const effectiveIdemKey = validateIdempotencyKey(idempotencyKey)
    || buildFallbackIdempotencyKey('message_payment', authenticatedUserId, referenceKey);

  return withDbTransaction(async (tx) => {
    // 1. Lock message request row (FOR UPDATE on PostgreSQL)
    let mr;
    if (mode === 'postgres') {
      mr = await tx.get(
        'SELECT * FROM message_requests WHERE id=? FOR UPDATE',
        [requestId],
      );
    } else {
      mr = await tx.get(
        'SELECT * FROM message_requests WHERE id=?',
        [requestId],
      );
    }

    if (!mr) throw makeError('NOT_FOUND', 'Запрос не найден');
    if (mr.sender_id !== authenticatedUserId) throw makeError('FORBIDDEN', 'Нет прав');
    if (mr.status !== 'payment_pending') throw makeError('ALREADY_PROCESSED', 'Запрос уже оплачен или обработан');

    const price = mr.price_in_stars;
    if (typeof price !== 'number' || price <= 0 || !Number.isInteger(price)) {
      throw makeError('INVALID_FINANCIAL_STATE', 'Некорректная цена запроса');
    }

    const receiverId = mr.receiver_id;
    if (authenticatedUserId === receiverId) {
      throw makeError('INVALID_FINANCIAL_STATE', 'Отправитель и получатель совпадают');
    }

    // 2. Lock user rows in deterministic order (PostgreSQL only)
    const [firstUser, secondUser] = deterministicUserOrder(authenticatedUserId, receiverId);

    if (mode === 'postgres') {
      await tx.all(
        'SELECT id FROM users WHERE id IN (?,?) ORDER BY id FOR UPDATE',
        [firstUser, secondUser],
      );
    } else {
      // SQLite: verify both users exist
      const users = await tx.all(
        'SELECT id, stars_balance FROM users WHERE id IN (?,?)',
        [firstUser, secondUser],
      );
      if (users.length !== 2) throw makeError('NOT_FOUND', 'Пользователь не найден');
    }

    // 3. Resolve idempotency
    const idemResult = await resolveIdempotency(tx, mode, effectiveIdemKey, {
      operationType: 'message_payment',
      referenceKey,
    }, () => buildRequestFingerprint('message_payment', authenticatedUserId, referenceKey, price));

    if (idemResult.resolved) {
      return idemResult;
    }

    // 4. Create stars_operations
    const operationId = `op_${newId()}`;
    const now = new Date().toISOString();
    const fingerprint = buildRequestFingerprint('message_payment', authenticatedUserId, referenceKey, price);

    await tx.run(
      `INSERT INTO stars_operations (id, idempotency_key, request_fingerprint, operation_type, reference_key, actor_user_id, counterparty_user_id, gross_amount, fee_amount, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [operationId, effectiveIdemKey, fingerprint, 'message_payment', referenceKey, authenticatedUserId, receiverId, price, 0, now],
    );

    // 5. Transition request: payment_pending → processing via CAS
    const casResult = await tx.run(
      "UPDATE message_requests SET status='processing', updated_at=? WHERE id=? AND sender_id=? AND status='payment_pending'",
      [now, requestId, authenticatedUserId],
    );
    if (casResult.changes !== 1) {
      throw makeError('ALREADY_PROCESSED', 'Запрос уже обрабатывается');
    }

    // 6. Conditional debit sender
    const debitResult = await tx.run(
      'UPDATE users SET stars_balance=stars_balance-? WHERE id=? AND stars_balance>=?',
      [price, authenticatedUserId, price],
    );
    if (debitResult.changes !== 1) {
      // Rollback transaction
      throw makeError('INSUFFICIENT_STARS', 'Недостаточно Stars');
    }

    // 7. Compute payout and fee
    const payout = Math.floor(price * 80 / 100);
    const fee = price - payout;

    // Update fee_amount
    await tx.run('UPDATE stars_operations SET fee_amount=? WHERE id=?', [fee, operationId]);

    // 8. Credit receiver
    await tx.run(
      'UPDATE users SET stars_balance=stars_balance+? WHERE id=?',
      [payout, receiverId],
    );

    // 9. Read new balances
    const senderRow = await tx.get('SELECT stars_balance FROM users WHERE id=?', [authenticatedUserId]);
    const receiverRow = await tx.get('SELECT stars_balance FROM users WHERE id=?', [receiverId]);

    // 10. Create ledger entries
    const senderEntryId = `le_${newId()}`;
    await tx.run(
      `INSERT INTO stars_ledger_entries (id, operation_id, user_id, entry_type, delta, balance_after, created_at)
       VALUES (?,?,?,?,?,?,?)`,
      [senderEntryId, operationId, authenticatedUserId, 'message_debit', -price, senderRow.stars_balance, now],
    );

    const receiverEntryId = `le_${newId()}`;
    await tx.run(
      `INSERT INTO stars_ledger_entries (id, operation_id, user_id, entry_type, delta, balance_after, created_at)
       VALUES (?,?,?,?,?,?,?)`,
      [receiverEntryId, operationId, receiverId, 'message_credit', payout, receiverRow.stars_balance, now],
    );

    // 11. Transition request: processing → delivered via CAS
    const deliverResult = await tx.run(
      "UPDATE message_requests SET status='delivered', updated_at=? WHERE id=? AND status='processing'",
      [now, requestId],
    );
    if (deliverResult.changes !== 1) {
      throw new Error('Failed to mark request as delivered');
    }

    // 12. Get updated request
    const updatedMr = await tx.get('SELECT * FROM message_requests WHERE id=?', [requestId]);

    return {
      success: true,
      idempotent: false,
      stars_balance: senderRow.stars_balance,
      request: updatedMr,
      operation_id: operationId,
    };
  });
}

// ── Collection purchase ──────────────────────────────────────────────

export async function purchaseCollection({
  collectionId,
  authenticatedUserId,
  idempotencyKey,
}) {
  const db = getDb();
  const mode = db.mode;

  const referenceKey = buildReferenceKey('collection_purchase', {
    userId: authenticatedUserId,
    collectionId,
  });
  const effectiveIdemKey = validateIdempotencyKey(idempotencyKey)
    || buildFallbackIdempotencyKey('collection_purchase', authenticatedUserId, referenceKey);

  return withDbTransaction(async (tx) => {
    // 1. Read collection
    const col = await tx.get('SELECT * FROM collections WHERE id=?', [collectionId]);
    if (!col) throw makeError('NOT_FOUND', 'Коллекция не найдена');

    // 2. Lock user row (PostgreSQL only)
    if (mode === 'postgres') {
      await tx.get('SELECT id FROM users WHERE id=? FOR UPDATE', [authenticatedUserId]);
    }

    // 3. Verify user exists and read balance
    const user = await tx.get('SELECT * FROM users WHERE id=?', [authenticatedUserId]);
    if (!user) throw makeError('NOT_FOUND', 'Пользователь не найден');

    // 4. Check ownership
    const existingOwnership = await tx.get(
      'SELECT * FROM collection_ownerships WHERE user_id=? AND collection_id=?',
      [authenticatedUserId, collectionId],
    );

    if (existingOwnership) {
      if (existingOwnership.acquisition_type === 'legacy') {
        throw makeError('ALREADY_PROCESSED', 'Коллекция уже добавлена в ваш профиль');
      }
      if (existingOwnership.acquisition_type === 'free' || existingOwnership.acquisition_type === 'premium') {
        throw makeError('ALREADY_PROCESSED', 'Коллекция уже добавлена в ваш профиль');
      }
    }

    const packType = col.pack_type;

    // 5. Free collection
    if (packType !== 'premium') {
      return processFreeCollection(tx, { collectionId, authenticatedUserId, collection: col });
    }

    // 6. Premium collection
    const price = col.price_in_stars;
    if (typeof price !== 'number' || price <= 0 || !Number.isInteger(price)) {
      throw makeError('INVALID_FINANCIAL_STATE', 'Некорректная цена коллекции');
    }

    // 7. Resolve idempotency for premium
    const idemResult = await resolveIdempotency(tx, mode, effectiveIdemKey, {
      operationType: 'collection_purchase',
      referenceKey,
    }, () => buildRequestFingerprint('collection_purchase', authenticatedUserId, referenceKey, price));

    if (idemResult.resolved) {
      return idemResult;
    }

    // 8. Create stars_operations
    const operationId = `op_${newId()}`;
    const now = new Date().toISOString();
    const fingerprint = buildRequestFingerprint('collection_purchase', authenticatedUserId, referenceKey, price);

    await tx.run(
      `INSERT INTO stars_operations (id, idempotency_key, request_fingerprint, operation_type, reference_key, actor_user_id, counterparty_user_id, gross_amount, fee_amount, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [operationId, effectiveIdemKey, fingerprint, 'collection_purchase', referenceKey, authenticatedUserId, null, price, 0, now],
    );

    // 9. Insert collection_ownerships
    await tx.run(
      `INSERT INTO collection_ownerships (user_id, collection_id, acquisition_type, price_paid, stars_operation_id, created_at)
       VALUES (?,?,?,?,?,?)`,
      [authenticatedUserId, collectionId, 'premium', price, operationId, now],
    );

    // 10. Conditional debit
    const debitResult = await tx.run(
      'UPDATE users SET stars_balance=stars_balance-? WHERE id=? AND stars_balance>=?',
      [price, authenticatedUserId, price],
    );
    if (debitResult.changes !== 1) {
      throw makeError('INSUFFICIENT_STARS', 'Недостаточно Stars');
    }

    // 11. Read new balance
    const updatedUser = await tx.get('SELECT stars_balance FROM users WHERE id=?', [authenticatedUserId]);

    // 12. Create ledger entry
    const ledgerEntryId = `le_${newId()}`;
    await tx.run(
      `INSERT INTO stars_ledger_entries (id, operation_id, user_id, entry_type, delta, balance_after, created_at)
       VALUES (?,?,?,?,?,?,?)`,
      [ledgerEntryId, operationId, authenticatedUserId, 'collection_debit', -price, updatedUser.stars_balance, now],
    );

    // 13. Create artworks
    await createArtworks(tx, authenticatedUserId, col, now);

    return {
      success: true,
      idempotent: false,
      stars_balance: updatedUser.stars_balance,
      operation_id: operationId,
      collection_id: collectionId,
    };
  });
}

// ── Idempotency resolution ───────────────────────────────────────────

async function resolveIdempotency(tx, mode, idempotencyKey, naturalRef, buildFingerprint) {
  const { operationType, referenceKey } = naturalRef;

  // Check if this idempotency key was already used
  const existingOp = await tx.get(
    'SELECT * FROM stars_operations WHERE idempotency_key=?',
    [idempotencyKey],
  );

  if (existingOp) {
    const currentFingerprint = buildFingerprint();

    if (existingOp.request_fingerprint === currentFingerprint) {
      // Same key + same fingerprint = idempotent replay
      return { resolved: true, idempotent: true, success: true, operation_id: existingOp.id };
    }

    // Same key + different fingerprint = conflict
    throw makeError('IDEMPOTENCY_KEY_REUSED', 'Idempotency-Key reused for a different request');
  }

  // Check if natural reference was already done with a different key
  const existingRef = await tx.get(
    'SELECT * FROM stars_operations WHERE operation_type=? AND reference_key=?',
    [operationType, referenceKey],
  );

  if (existingRef) {
    throw makeError('ALREADY_PROCESSED', 'Операция уже выполнена');
  }

  return { resolved: false };
}

// ── Free collection ──────────────────────────────────────────────────

async function processFreeCollection(tx, { collectionId, authenticatedUserId, collection }) {
  const now = new Date().toISOString();

  // Check ownership exists
  const existing = await tx.get(
    'SELECT * FROM collection_ownerships WHERE user_id=? AND collection_id=?',
    [authenticatedUserId, collectionId],
  );

  if (existing) {
    throw makeError('ALREADY_PROCESSED', 'Коллекция уже добавлена в ваш профиль');
  }

  // Insert ownership
  await tx.run(
    `INSERT INTO collection_ownerships (user_id, collection_id, acquisition_type, price_paid, stars_operation_id, created_at)
     VALUES (?,?,?,?,?,?)`,
    [authenticatedUserId, collectionId, 'free', 0, null, now],
  );

  // Create artworks
  await createArtworks(tx, authenticatedUserId, collection, now);

  const userRow = await tx.get('SELECT stars_balance FROM users WHERE id=?', [authenticatedUserId]);

  return {
    success: true,
    idempotent: false,
    stars_balance: userRow.stars_balance,
    collection_id: collectionId,
  };
}

// ── Artwork creation ─────────────────────────────────────────────────

async function createArtworks(tx, ownerId, collection, now) {
  // Check if artworks already exist for this user+collection
  const existingArtworks = await tx.get(
    'SELECT COUNT(*) as cnt FROM artworks WHERE owner_id=? AND collection_id=?',
    [ownerId, collection.id],
  );

  if (existingArtworks && existingArtworks.cnt > 0) {
    return;
  }

  const art1Id = `art_${newId()}`;
  const art2Id = `art_${newId()}`;

  await tx.run(
    `INSERT INTO artworks (id,owner_id,source_type,image_url,title,collection_id,collection_title,rarity,is_completed,created_at,updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    [art1Id, ownerId, 'collection', collection.image_url, `${collection.title} — Арт 1`, collection.id, collection.title, collection.rarity, 0, now, now],
  );

  await tx.run(
    `INSERT INTO artworks (id,owner_id,source_type,image_url,title,collection_id,collection_title,rarity,is_completed,created_at,updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    [art2Id, ownerId, 'collection', collection.image_url, `${collection.title} — Арт 2`, collection.id, collection.title, collection.rarity, 1, now, now],
  );
}

// ── Idempotent replay helpers ────────────────────────────────────────

export async function getOperationByKey(idempotencyKey) {
  const db = getDb();
  const { get } = await import('../db.js');
  return get('SELECT * FROM stars_operations WHERE idempotency_key=?', [idempotencyKey]);
}

export async function getOperationByReference(operationType, referenceKey) {
  const db = getDb();
  const { get } = await import('../db.js');
  return get(
    'SELECT * FROM stars_operations WHERE operation_type=? AND reference_key=?',
    [operationType, referenceKey],
  );
}

export async function getLedgerEntries(operationId) {
  const db = getDb();
  const { all } = await import('../db.js');
  return all('SELECT * FROM stars_ledger_entries WHERE operation_id=?', [operationId]);
}

export async function getOwnership(userId, collectionId) {
  const db = getDb();
  const { get } = await import('../db.js');
  return get(
    'SELECT * FROM collection_ownerships WHERE user_id=? AND collection_id=?',
    [userId, collectionId],
  );
}
