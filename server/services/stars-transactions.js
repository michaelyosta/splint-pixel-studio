import { v4 as uuid } from 'uuid';
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
  INVALID_INPUT: 400,
};

function makeError(code, message) {
  return new StarsTransactionError(code, message, ERROR_CODES[code] || 500);
}

const MIN_PAID_PRICE = 2;

const IDEMPOTENCY_KEY_PATTERN = /^[\x21-\x7E]{8,128}$/;

export function validateIdempotencyKey(key) {
  // Missing header
  if (key === undefined || key === null) return null;

  // Must be string
  if (typeof key !== 'string') {
    throw makeError('INVALID_INPUT', 'Idempotency-Key must be a string');
  }

  // Empty string is not "missing" — it's invalid
  const trimmed = key.trim();
  if (trimmed.length === 0) {
    throw makeError('INVALID_INPUT', 'Idempotency-Key must not be empty');
  }
  if (trimmed.length < 8 || trimmed.length > 128) {
    throw makeError('INVALID_INPUT', 'Idempotency-Key must be between 8 and 128 characters');
  }
  if (!IDEMPOTENCY_KEY_PATTERN.test(trimmed)) {
    throw makeError('INVALID_INPUT', 'Idempotency-Key contains invalid characters');
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

// ── Service factory ──────────────────────────────────────────────────

function defaultIdFactory() {
  return uuid();
}

export function createStarsTransactionsService(deps = {}) {
  const {
    withTransaction,
    idFactory = defaultIdFactory,
    hooks = {},
  } = deps;

  function newId() {
    return idFactory();
  }

  // ── Idempotency resolution using INSERT ON CONFLICT DO NOTHING ────

  async function tryCreateOperation(tx, {
    operationId, idempotencyKey, fingerprint, operationType, referenceKey,
    actorUserId, counterpartyUserId, grossAmount, feeAmount, createdAt,
  }) {
    const result = await tx.run(
      `INSERT INTO stars_operations (id, idempotency_key, request_fingerprint, operation_type, reference_key, actor_user_id, counterparty_user_id, gross_amount, fee_amount, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT DO NOTHING`,
      [operationId, idempotencyKey, fingerprint, operationType, referenceKey, actorUserId, counterpartyUserId || null, grossAmount, feeAmount, createdAt],
    );
    return result.changes === 1;
  }

  async function resolveConcurrentConflict(tx, idempotencyKey, expectedFingerprint, operationType, referenceKey) {
    const existingOp = await tx.get(
      'SELECT * FROM stars_operations WHERE idempotency_key=?',
      [idempotencyKey],
    );

    if (existingOp) {
      if (existingOp.request_fingerprint === expectedFingerprint) {
        return { resolved: true, idempotent: true, success: true, operation_id: existingOp.id };
      }
      throw makeError('IDEMPOTENCY_KEY_REUSED', 'Idempotency-Key reused for a different request');
    }

    const existingRef = await tx.get(
      'SELECT * FROM stars_operations WHERE operation_type=? AND reference_key=?',
      [operationType, referenceKey],
    );

    if (existingRef) {
      throw makeError('ALREADY_PROCESSED', 'Операция уже выполнена');
    }

    throw new Error('Unexpected ON CONFLICT: operation not found but insert was refused');
  }

  // ── Message payment ────────────────────────────────────────────────

  async function payMessageRequest({ requestId, authenticatedUserId, idempotencyKey }) {
    const referenceKey = buildReferenceKey('message_payment', { requestId });
    const effectiveIdemKey = validateIdempotencyKey(idempotencyKey)
      || buildFallbackIdempotencyKey('message_payment', authenticatedUserId, referenceKey);

    return withTransaction(async (tx) => {
      const mode = deps.mode;

      let mr;
      if (mode === 'postgres') {
        mr = await tx.get('SELECT * FROM message_requests WHERE id=? FOR UPDATE', [requestId]);
      } else {
        mr = await tx.get('SELECT * FROM message_requests WHERE id=?', [requestId]);
      }

      if (!mr) throw makeError('NOT_FOUND', 'Запрос не найден');
      if (mr.sender_id !== authenticatedUserId) throw makeError('FORBIDDEN', 'Нет прав');

      const price = mr.price_in_stars;
      if (typeof price !== 'number' || !Number.isInteger(price) || price < MIN_PAID_PRICE) {
        throw makeError('INVALID_FINANCIAL_STATE', `Минимальная платная цена — ${MIN_PAID_PRICE} Stars`);
      }

      const receiverId = mr.receiver_id;
      if (authenticatedUserId === receiverId) {
        throw makeError('INVALID_FINANCIAL_STATE', 'Отправитель и получатель совпадают');
      }

      const payout = Math.floor(price * 80 / 100);
      const fee = price - payout;

      // Compute fingerprint BEFORE idempotency check
      const fingerprint = buildRequestFingerprint('message_payment', authenticatedUserId, referenceKey, price);

      // Check idempotency BEFORE status validation
      const existingOp = await tx.get(
        'SELECT * FROM stars_operations WHERE idempotency_key=?',
        [effectiveIdemKey],
      );

      if (existingOp) {
        if (existingOp.request_fingerprint === fingerprint) {
          // Same key + same fingerprint = idempotent replay
          // Don't require payment_pending status for replay
          const currentMr = await tx.get('SELECT * FROM message_requests WHERE id=?', [requestId]);
          const senderRow = await tx.get('SELECT stars_balance FROM users WHERE id=?', [authenticatedUserId]);
          return {
            success: true,
            idempotent: true,
            stars_balance: senderRow.stars_balance,
            request: currentMr,
            operation_id: existingOp.id,
          };
        }
        throw makeError('IDEMPOTENCY_KEY_REUSED', 'Idempotency-Key reused for a different request');
      }

      // Check natural reference
      const existingRef = await tx.get(
        'SELECT * FROM stars_operations WHERE operation_type=? AND reference_key=?',
        ['message_payment', referenceKey],
      );
      if (existingRef) {
        throw makeError('ALREADY_PROCESSED', 'Операция уже выполнена');
      }

      // Now check status (only for new operations)
      if (mr.status !== 'payment_pending') {
        throw makeError('ALREADY_PROCESSED', 'Запрос уже оплачен или обработан');
      }

      // Lock user rows
      const [firstUser, secondUser] = deterministicUserOrder(authenticatedUserId, receiverId);
      if (mode === 'postgres') {
        await tx.all('SELECT id FROM users WHERE id IN (?,?) ORDER BY id FOR UPDATE', [firstUser, secondUser]);
      } else {
        const users = await tx.all('SELECT id, stars_balance FROM users WHERE id IN (?,?)', [firstUser, secondUser]);
        if (users.length !== 2) throw makeError('NOT_FOUND', 'Пользователь не найден');
      }

      const now = new Date().toISOString();
      const operationId = `op_${newId()}`;

      // Use INSERT ON CONFLICT DO NOTHING for concurrent safety
      const created = await tryCreateOperation(tx, {
        operationId, idempotencyKey: effectiveIdemKey, fingerprint,
        operationType: 'message_payment', referenceKey,
        actorUserId: authenticatedUserId, counterpartyUserId: receiverId,
        grossAmount: price, feeAmount: fee, createdAt: now,
      });

      if (!created) {
        return resolveConcurrentConflict(tx, effectiveIdemKey, fingerprint, 'message_payment', referenceKey);
      }

      // Transition: payment_pending → processing
      const casResult = await tx.run(
        "UPDATE message_requests SET status='processing', updated_at=? WHERE id=? AND sender_id=? AND status='payment_pending'",
        [now, requestId, authenticatedUserId],
      );
      if (casResult.changes !== 1) {
        throw makeError('ALREADY_PROCESSED', 'Запрос уже обрабатывается');
      }

      // Conditional debit
      const debitResult = await tx.run(
        'UPDATE users SET stars_balance=stars_balance-? WHERE id=? AND stars_balance>=?',
        [price, authenticatedUserId, price],
      );
      if (debitResult.changes !== 1) {
        throw makeError('INSUFFICIENT_STARS', 'Недостаточно Stars');
      }

      // Failure injection hook (test-only, not used in production)
      if (hooks.afterDebit) await hooks.afterDebit({ tx, operationId, price, authenticatedUserId, receiverId, requestId });

      // Credit receiver
      if (payout > 0) {
        await tx.run('UPDATE users SET stars_balance=stars_balance+? WHERE id=?', [payout, receiverId]);
      }

      // Read new balances
      const senderRow = await tx.get('SELECT stars_balance FROM users WHERE id=?', [authenticatedUserId]);
      const receiverRow = await tx.get('SELECT stars_balance FROM users WHERE id=?', [receiverId]);

      // Ledger entries
      await tx.run(
        `INSERT INTO stars_ledger_entries (id, operation_id, user_id, entry_type, delta, balance_after, created_at)
         VALUES (?,?,?,?,?,?,?)`,
        [`le_${newId()}`, operationId, authenticatedUserId, 'message_debit', -price, senderRow.stars_balance, now],
      );

      if (payout > 0) {
        await tx.run(
          `INSERT INTO stars_ledger_entries (id, operation_id, user_id, entry_type, delta, balance_after, created_at)
           VALUES (?,?,?,?,?,?,?)`,
          [`le_${newId()}`, operationId, receiverId, 'message_credit', payout, receiverRow.stars_balance, now],
        );
      }

      // Transition: processing → delivered
      const deliverResult = await tx.run(
        "UPDATE message_requests SET status='delivered', updated_at=? WHERE id=? AND status='processing'",
        [now, requestId],
      );
      if (deliverResult.changes !== 1) {
        throw new Error('Failed to mark request as delivered');
      }

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

  // ── Collection purchase ────────────────────────────────────────────

  async function purchaseCollection({ collectionId, authenticatedUserId, idempotencyKey }) {
    const referenceKey = buildReferenceKey('collection_purchase', {
      userId: authenticatedUserId,
      collectionId,
    });
    const effectiveIdemKey = validateIdempotencyKey(idempotencyKey)
      || buildFallbackIdempotencyKey('collection_purchase', authenticatedUserId, referenceKey);

    return withTransaction(async (tx) => {
      const mode = deps.mode;

      const col = await tx.get('SELECT * FROM collections WHERE id=?', [collectionId]);
      if (!col) throw makeError('NOT_FOUND', 'Коллекция не найдена');

      if (mode === 'postgres') {
        await tx.get('SELECT id FROM users WHERE id=? FOR UPDATE', [authenticatedUserId]);
      }

      const user = await tx.get('SELECT * FROM users WHERE id=?', [authenticatedUserId]);
      if (!user) throw makeError('NOT_FOUND', 'Пользователь не найден');

      const packType = col.pack_type;

      const price = packType === 'premium' ? col.price_in_stars : 0;

      // Idempotency BEFORE ownership check (for both free and premium)
      const fingerprint = buildRequestFingerprint('collection_purchase', authenticatedUserId, referenceKey, price);

      const existingOp = await tx.get(
        'SELECT * FROM stars_operations WHERE idempotency_key=?',
        [effectiveIdemKey],
      );

      if (existingOp) {
        if (existingOp.request_fingerprint === fingerprint) {
          const userRow = await tx.get('SELECT stars_balance FROM users WHERE id=?', [authenticatedUserId]);
          return { success: true, idempotent: true, stars_balance: userRow.stars_balance, operation_id: existingOp.id, collection_id: collectionId };
        }
        throw makeError('IDEMPOTENCY_KEY_REUSED', 'Idempotency-Key reused for a different request');
      }

      if (packType !== 'premium') {
        return processFreeCollection(tx, { collectionId, authenticatedUserId, collection: col, effectiveIdemKey, fingerprint, referenceKey });
      }

      if (typeof price !== 'number' || !Number.isInteger(price) || price < MIN_PAID_PRICE) {
        throw makeError('INVALID_FINANCIAL_STATE', `Минимальная платная цена коллекции — ${MIN_PAID_PRICE} Stars`);
      }

      // Check natural reference already processed
      const existingRef = await tx.get(
        'SELECT * FROM stars_operations WHERE operation_type=? AND reference_key=?',
        ['collection_purchase', referenceKey],
      );
      if (existingRef) {
        throw makeError('ALREADY_PROCESSED', 'Операция уже выполнена');
      }

      // Now check ownership
      const existingOwnership = await tx.get(
        'SELECT * FROM collection_ownerships WHERE user_id=? AND collection_id=?',
        [authenticatedUserId, collectionId],
      );

      if (existingOwnership) {
        throw makeError('ALREADY_PROCESSED', 'Коллекция уже добавлена в ваш профиль');
      }

      const now = new Date().toISOString();
      const operationId = `op_${newId()}`;

      // INSERT ON CONFLICT DO NOTHING
      const created = await tryCreateOperation(tx, {
        operationId, idempotencyKey: effectiveIdemKey, fingerprint,
        operationType: 'collection_purchase', referenceKey,
        actorUserId: authenticatedUserId, counterpartyUserId: null,
        grossAmount: price, feeAmount: 0, createdAt: now,
      });

      if (!created) {
        return resolveConcurrentConflict(tx, effectiveIdemKey, fingerprint, 'collection_purchase', referenceKey);
      }

      // Insert ownership
      await tx.run(
        `INSERT INTO collection_ownerships (user_id, collection_id, acquisition_type, price_paid, stars_operation_id, created_at)
         VALUES (?,?,?,?,?,?)`,
        [authenticatedUserId, collectionId, 'premium', price, operationId, now],
      );

      // Conditional debit
      const debitResult = await tx.run(
        'UPDATE users SET stars_balance=stars_balance-? WHERE id=? AND stars_balance>=?',
        [price, authenticatedUserId, price],
      );
      if (debitResult.changes !== 1) {
        throw makeError('INSUFFICIENT_STARS', 'Недостаточно Stars');
      }

      if (hooks.afterDebit) await hooks.afterDebit({ tx, operationId, price, authenticatedUserId, collectionId });

      const updatedUser = await tx.get('SELECT stars_balance FROM users WHERE id=?', [authenticatedUserId]);

      // Ledger entry
      await tx.run(
        `INSERT INTO stars_ledger_entries (id, operation_id, user_id, entry_type, delta, balance_after, created_at)
         VALUES (?,?,?,?,?,?,?)`,
        [`le_${newId()}`, operationId, authenticatedUserId, 'collection_debit', -price, updatedUser.stars_balance, now],
      );

      // Create artworks
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

  // ── Free collection ────────────────────────────────────────────────

  async function processFreeCollection(tx, { collectionId, authenticatedUserId, collection, effectiveIdemKey, fingerprint }) {
    const now = new Date().toISOString();

    const existing = await tx.get(
      'SELECT * FROM collection_ownerships WHERE user_id=? AND collection_id=?',
      [authenticatedUserId, collectionId],
    );

    if (existing) {
      throw makeError('ALREADY_PROCESSED', 'Коллекция уже добавлена в ваш профиль');
    }

    // Create a stars_operations entry for idempotency tracking (free collections still need it)
    const referenceKey = buildReferenceKey('collection_purchase', { userId: authenticatedUserId, collectionId });
    // effectiveIdemKey and fingerprint come from the parent scope
    const operationId = `op_${newId()}`;

    const created = await tryCreateOperation(tx, {
      operationId,
      idempotencyKey: effectiveIdemKey,
      fingerprint,
      operationType: 'collection_purchase',
      referenceKey,
      actorUserId: authenticatedUserId,
      counterpartyUserId: null,
      grossAmount: 0,
      feeAmount: 0,
      createdAt: now,
    });

    if (!created) {
      const conflictResult = await resolveConcurrentConflict(tx, effectiveIdemKey, fingerprint, 'collection_purchase', referenceKey);
      if (conflictResult.resolved) return conflictResult;
    }

    await tx.run(
      `INSERT INTO collection_ownerships (user_id, collection_id, acquisition_type, price_paid, stars_operation_id, created_at)
       VALUES (?,?,?,?,?,?)`,
      [authenticatedUserId, collectionId, 'free', 0, operationId, now],
    );

    await createArtworks(tx, authenticatedUserId, collection, now);

    const userRow = await tx.get('SELECT stars_balance FROM users WHERE id=?', [authenticatedUserId]);

    return {
      success: true,
      idempotent: false,
      stars_balance: userRow.stars_balance,
      collection_id: collectionId,
    };
  }

  // ── Artwork creation ───────────────────────────────────────────────

  async function createArtworks(tx, ownerId, collection, now) {
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

  return {
    payMessageRequest,
    purchaseCollection,
  };
}

// ── Production singleton ──────────────────────────────────────────────

let _servicePromise = null;
let _serviceResolved = null;

async function ensureService() {
  if (_serviceResolved) return _serviceResolved;
  if (_servicePromise) return _servicePromise;

  _servicePromise = (async () => {
    const { withDbTransaction, getDb } = await import('../db.js');
    const { mode } = getDb();
    _serviceResolved = createStarsTransactionsService({ withTransaction: withDbTransaction, mode });
    return _serviceResolved;
  })();
  return _servicePromise;
}

// ── Re-export production service functions for route consumption ─────

export async function payMessageRequest(params) {
  const svc = await ensureService();
  return svc.payMessageRequest(params);
}

export async function purchaseCollection(params) {
  const svc = await ensureService();
  return svc.purchaseCollection(params);
}
