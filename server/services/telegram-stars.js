import { createHash } from 'node:crypto';
import { v4 as uuid } from 'uuid';

/**
 * Telegram Stars (XTR) state machine.
 *
 * There is deliberately no Bot API implementation in this module.  Callers
 * must inject an adapter (the repository ships only a deterministic mock
 * adapter) and explicitly opt in with `enabled: true`.  The application does
 * not construct this service in its normal server bootstrap, so the public
 * alpha remains payment-disabled.
 */

export const TELEGRAM_STARS_CURRENCY = 'XTR';

export const TELEGRAM_STARS_ORDER_STATUSES = Object.freeze([
  'invoice_pending',
  'invoice_issued',
  'checkout_pending',
  'paid',
  'cancelled',
  'partially_refunded',
  'refunded',
]);

export const TELEGRAM_STARS_TRANSITIONS = Object.freeze({
  invoice_pending: Object.freeze(['invoice_issued', 'checkout_pending', 'paid', 'cancelled']),
  invoice_issued: Object.freeze(['checkout_pending', 'paid', 'cancelled']),
  checkout_pending: Object.freeze(['paid', 'cancelled']),
  paid: Object.freeze(['partially_refunded', 'refunded']),
  partially_refunded: Object.freeze(['refunded']),
  cancelled: Object.freeze(['paid']),
  refunded: Object.freeze([]),
});

const PRECHECKOUT_STATUSES = new Set(['invoice_pending', 'invoice_issued', 'checkout_pending']);
// A provider capture can arrive after the client timed out/cancelled its
// local order. It is still money received and must be recorded exactly once.
const CAPTURE_ACCEPTING_STATUSES = new Set(['invoice_pending', 'invoice_issued', 'checkout_pending', 'cancelled']);
const CAPTURED_STATUSES = new Set(['paid', 'partially_refunded', 'refunded']);
const IDEMPOTENCY_KEY_PATTERN = /^[\x21-\x7E]{8,128}$/;
const MAX_PRODUCT_ID = 200;
const MAX_MESSAGE = 4_000;
const MAX_XTR_AMOUNT = 1_000_000;

const ERROR_STATUS = Object.freeze({
  PAYMENTS_DISABLED: 503,
  PROVIDER_UNAVAILABLE: 503,
  INVALID_INPUT: 400,
  ORDER_NOT_FOUND: 404,
  PAYMENT_NOT_FOUND: 404,
  SUPPORT_CASE_NOT_FOUND: 404,
  IDEMPOTENCY_KEY_REUSED: 409,
  EVENT_ID_REUSED: 409,
  ORDER_NOT_PAYABLE: 409,
  ORDER_ALREADY_PAID: 409,
  CHARGE_ID_REUSED: 409,
  PAYMENT_ALREADY_CAPTURED: 409,
  REFUND_CONFLICT: 409,
  REFUND_EXCEEDS_CAPTURE: 409,
  INVALID_PROVIDER_DATA: 422,
});

export class TelegramStarsError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = 'TelegramStarsError';
    this.code = code;
    this.statusCode = ERROR_STATUS[code] || 500;
    this.details = details;
  }
}

function fail(code, message, details) {
  return new TelegramStarsError(code, message, details);
}

function asString(value, name, { min = 1, max = 500 } = {}) {
  if (typeof value !== 'string') throw fail('INVALID_INPUT', `${name} must be a string`);
  const result = value.trim();
  if (result.length < min || result.length > max) throw fail('INVALID_INPUT', `${name} must be between ${min} and ${max} characters`);
  return result;
}

function optionalString(value, name, max = 500) {
  if (value === undefined || value === null || value === '') return null;
  return asString(value, name, { max });
}

function positiveInteger(value, name) {
  if (!Number.isInteger(value) || value <= 0) throw fail('INVALID_INPUT', `${name} must be a positive integer`);
  if (value > MAX_XTR_AMOUNT) throw fail('INVALID_INPUT', `${name} exceeds the maximum supported amount`);
  return value;
}

function normalizeUserId(value, telegramUserId) {
  if (value !== undefined && value !== null) return asString(String(value), 'userId', { max: 200 });
  if (telegramUserId !== undefined && telegramUserId !== null) {
    const id = String(telegramUserId);
    if (!/^\d{1,30}$/.test(id)) throw fail('INVALID_INPUT', 'telegramUserId must be a positive Telegram id');
    return `tg_${id}`;
  }
  throw fail('INVALID_INPUT', 'userId is required');
}

export function validateTelegramStarsIdempotencyKey(value) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || !IDEMPOTENCY_KEY_PATTERN.test(value.trim())) {
    throw fail('INVALID_INPUT', 'Idempotency-Key must contain 8-128 printable ASCII characters');
  }
  return value.trim();
}

function effectiveIdempotencyKey(value, userId, productId) {
  return validateTelegramStarsIdempotencyKey(value) || `xtr:${userId}:${productId}`;
}

function hash(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function json(value, name = 'payload') {
  try {
    const result = JSON.stringify(value === undefined ? null : value);
    if (result.length > 32_000) throw fail('INVALID_INPUT', `${name} is too large`);
    return result;
  } catch (error) {
    if (error instanceof TelegramStarsError) throw error;
    throw fail('INVALID_INPUT', `${name} must be JSON serializable`);
  }
}

function parseJson(value, fallback = null) {
  if (!value) return fallback;
  try { return JSON.parse(value); } catch { return fallback; }
}

function timestamp(clock) {
  const value = clock();
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function publicOrder(row) {
  if (!row) return null;
  return {
    id: row.id,
    user_id: row.user_id,
    product_id: row.product_id,
    currency: row.currency,
    amount_xtr: Number(row.amount_xtr),
    invoice_payload: row.invoice_payload,
    invoice_url: row.invoice_url || null,
    provider_invoice_id: row.provider_invoice_id || null,
    status: row.status,
    pre_checkout_query_id: row.pre_checkout_query_id || null,
    checkout_approved_at: row.checkout_approved_at || null,
    paid_at: row.paid_at || null,
    cancelled_at: row.cancelled_at || null,
    paid_after_cancelled: row.paid_after_cancelled === true || Number(row.paid_after_cancelled) === 1,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function safeProviderEvent(input = {}) {
  // The raw event persisted for audit is intentionally a small allow-list.
  // It must not become a dump of Telegram initData, tokens, or user text.
  return {
    updateId: input.updateId || input.providerUpdateId || null,
    invoicePayload: input.invoicePayload || input.orderPayload || null,
    currency: input.currency || null,
    totalAmount: input.totalAmount ?? input.amountXtr ?? null,
    telegramPaymentChargeId: input.telegramPaymentChargeId || null,
    providerPaymentChargeId: input.providerPaymentChargeId || null,
    refundId: input.refundId || null,
    amountXtr: input.amountXtr ?? null,
  };
}

function adapterMethod(adapter, method) {
  if (!adapter || typeof adapter[method] !== 'function') {
    throw fail('PROVIDER_UNAVAILABLE', `Telegram Stars adapter does not implement ${method}`);
  }
  return adapter[method].bind(adapter);
}

function lockSql(sql, mode) {
  return mode === 'postgres' ? `${sql} FOR UPDATE` : sql;
}

function eventDecision(row) {
  const parsed = parseJson(row?.decision_json);
  return parsed && typeof parsed === 'object' ? parsed : null;
}

function eventResult(row) {
  const decision = eventDecision(row);
  if (!decision) return null;
  return { ...decision, idempotent: true };
}

function assertSameFingerprint(existing, fingerprint, keyName = 'event') {
  if (existing && existing.request_fingerprint !== fingerprint) {
    throw fail(keyName === 'idempotency' ? 'IDEMPOTENCY_KEY_REUSED' : 'EVENT_ID_REUSED', `${keyName} was reused for a different request`);
  }
}

function providerAmount(input) {
  return input.totalAmount ?? input.amountXtr;
}

function providerPayload(input) {
  return input.invoicePayload || input.orderPayload;
}

function providerCharge(input) {
  return input.telegramPaymentChargeId || input.chargeId;
}

function validateProviderShape(input, { requireCharge = false, requireQuery = false, requireRefund = false } = {}) {
  if (!input || typeof input !== 'object') throw fail('INVALID_PROVIDER_DATA', 'Provider update must be an object');
  const payload = providerPayload(input);
  if (payload !== undefined && payload !== null && typeof payload !== 'string') throw fail('INVALID_PROVIDER_DATA', 'invoice_payload must be a string');
  if (input.currency !== TELEGRAM_STARS_CURRENCY) throw fail('INVALID_PROVIDER_DATA', 'Telegram Stars currency must be XTR');
  const amount = Number(providerAmount(input));
  positiveInteger(amount, 'total_amount');
  if (requireQuery) asString(input.preCheckoutQueryId || input.queryId, 'preCheckoutQueryId', { max: 256 });
  if (requireCharge) asString(providerCharge(input), 'telegramPaymentChargeId', { max: 256 });
  if (requireRefund) asString(input.refundId, 'refundId', { max: 256 });
  return { payload, amount: Number(amount), chargeId: providerCharge(input) || null };
}

export function buildTelegramStarsSupportContract(env = process.env) {
  return Object.freeze({
    provider: 'telegram_stars',
    currency: TELEGRAM_STARS_CURRENCY,
    support_contact: String(env.TELEGRAM_PAYMENT_SUPPORT || '').trim() || null,
    refund_contact: String(env.TELEGRAM_PAYMENT_REFUND_CONTACT || '').trim() || null,
    paysupport_command: '/paysupport',
    required_case_fields: Object.freeze(['idempotency_key', 'category', 'contact', 'message']),
    accepted_categories: Object.freeze(['payment_missing', 'refund_request', 'payment_question', 'other']),
    activation: 'disabled_until_payment_mode_and_provider_review',
  });
}

export function createTelegramStarsService(deps = {}) {
  const {
    withTransaction,
    mode = 'sqlite',
    idFactory = uuid,
    clock = () => new Date(),
    adapter = null,
    // Explicit opt-in is required even when a caller has set PAYMENTS_MODE.
    // This prevents an imported test/mock service from activating production.
    enabled = false,
    priceResolver = null,
    supportContact = process.env.TELEGRAM_PAYMENT_SUPPORT || null,
    refundContact = process.env.TELEGRAM_PAYMENT_REFUND_CONTACT || null,
  } = deps;

  if (typeof withTransaction !== 'function') throw new TypeError('withTransaction is required');

  function assertEnabled() {
    if (!enabled) throw fail('PAYMENTS_DISABLED', 'Telegram Stars payments are disabled');
  }

  function newId(prefix) {
    return `${prefix}_${idFactory()}`;
  }

  async function readOrder(tx, orderId, forUpdate = false) {
    return tx.get(lockSql('SELECT * FROM telegram_stars_orders WHERE id=?', mode && forUpdate ? mode : null), [orderId]);
  }

  async function getOrderByPayload(tx, payload, forUpdate = false) {
    return tx.get(lockSql('SELECT * FROM telegram_stars_orders WHERE invoice_payload=?', mode && forUpdate ? mode : null), [payload]);
  }

  async function loadEvent(tx, eventKey, forUpdate = false) {
    return tx.get(lockSql('SELECT * FROM telegram_stars_events WHERE event_key=?', mode && forUpdate ? mode : null), [eventKey]);
  }

  async function insertEvent(tx, {
    eventId,
    eventKey,
    eventType,
    providerUpdateId,
    requestFingerprint,
    orderId,
    chargeId,
    payloadJson,
    status,
    decisionJson,
    now,
  }) {
    const result = await tx.run(
      `INSERT INTO telegram_stars_events
        (id,event_key,event_type,provider_update_id,request_fingerprint,order_id,telegram_payment_charge_id,payload_json,decision_json,status,received_at,processed_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT DO NOTHING`,
      [eventId, eventKey, eventType, providerUpdateId || null, requestFingerprint, orderId || null, chargeId || null, payloadJson, decisionJson || null, status, now, status === 'received' ? null : now],
    );
    if (result.changes === 1) return null;
    const existing = await loadEvent(tx, eventKey, true);
    if (existing) {
      assertSameFingerprint(existing, requestFingerprint);
      return existing;
    }
    // A provider update id can collide with a different event key.  Resolve
    // that case explicitly instead of turning it into a generic 500.
    if (providerUpdateId) {
      const byUpdate = await tx.get(lockSql('SELECT * FROM telegram_stars_events WHERE provider_update_id=?', mode), [providerUpdateId]);
      if (byUpdate) {
        assertSameFingerprint(byUpdate, requestFingerprint);
        return byUpdate;
      }
    }
    throw new Error('Telegram Stars event insert conflicted without a readable row');
  }

  async function resolveServerAmount({ userId, productId, amountXtr, priceXtr }) {
    // A provider-facing service must never allow a client-supplied amount to
    // become the order price.  The mock adapter is the only intentionally
    // permissive boundary: it exists for deterministic local contract tests
    // and has no path to Telegram or a real entitlement.  Every other adapter
    // requires an injected catalog resolver before an order can be created.
    if (typeof priceResolver !== 'function' && adapter?.providerName !== 'telegram_stars_mock') {
      throw fail('INVALID_INPUT', 'A server price resolver is required for Telegram Stars orders');
    }
    const resolved = typeof priceResolver === 'function'
      ? await priceResolver({ userId, productId })
      : (priceXtr ?? amountXtr);
    const amount = typeof resolved === 'object' && resolved !== null
      ? (resolved.amountXtr ?? resolved.amount_xtr ?? resolved.priceXtr)
      : resolved;
    return positiveInteger(Number(amount), 'server price in XTR');
  }

  async function issueInvoice(orderId) {
    const createInvoice = adapterMethod(adapter, 'createInvoice');
    const existing = await withTransaction(async (tx) => readOrder(tx, orderId, mode === 'postgres'));
    if (!existing) throw fail('ORDER_NOT_FOUND', 'Telegram Stars order not found');
    if (existing.invoice_url) return { order: publicOrder(existing), idempotent: true };
    if (!['invoice_pending', 'invoice_issued'].includes(existing.status)) {
      return { order: publicOrder(existing), idempotent: true };
    }

    const invoice = await createInvoice({
      invoicePayload: existing.invoice_payload,
      productId: existing.product_id,
      currency: TELEGRAM_STARS_CURRENCY,
      amountXtr: Number(existing.amount_xtr),
    });
    if (!invoice || typeof invoice !== 'object') throw fail('PROVIDER_UNAVAILABLE', 'Telegram Stars adapter returned an invalid invoice');
    const invoiceUrl = asString(invoice.invoiceUrl || invoice.invoice_url, 'invoiceUrl', { max: 2_000 });
    const now = timestamp(clock);

    const updated = await withTransaction(async (tx) => {
      await tx.run(
        `UPDATE telegram_stars_orders
            SET invoice_url=?, provider_invoice_id=?, status='invoice_issued', updated_at=?
          WHERE id=? AND status IN ('invoice_pending','invoice_issued') AND invoice_url IS NULL`,
        [invoiceUrl, optionalString(invoice.providerInvoiceId || invoice.provider_invoice_id, 'providerInvoiceId', 500), now, orderId],
      );
      return readOrder(tx, orderId);
    });
    return { order: publicOrder(updated), idempotent: Boolean(existing.invoice_url || updated?.invoice_url !== invoiceUrl) };
  }

  async function createOrder({ userId: rawUserId, telegramUserId, productId: rawProductId, amountXtr, priceXtr, idempotencyKey }) {
    assertEnabled();
    const userId = normalizeUserId(rawUserId, telegramUserId);
    const productId = asString(String(rawProductId || ''), 'productId', { max: MAX_PRODUCT_ID });
    const amount = await resolveServerAmount({ userId, productId, amountXtr, priceXtr });
    const key = effectiveIdempotencyKey(idempotencyKey, userId, productId);
    const fingerprint = hash({ operation: 'telegram_stars_order', userId, productId, currency: TELEGRAM_STARS_CURRENCY, amountXtr: amount });
    const now = timestamp(clock);

    const created = await withTransaction(async (tx) => {
      const user = await tx.get(lockSql('SELECT id FROM users WHERE id=?', mode), [userId]);
      if (!user) throw fail('ORDER_NOT_FOUND', 'User not found');

      const existing = await tx.get(lockSql('SELECT * FROM telegram_stars_orders WHERE user_id=? AND idempotency_key=?', mode), [userId, key]);
      if (existing) {
        assertSameFingerprint(existing, fingerprint, 'idempotency');
        return { row: existing, idempotent: true };
      }

      const orderId = newId('xtr_order');
      const invoicePayload = `splint:xtr:v1:${orderId}`;
      const inserted = await tx.run(
        `INSERT INTO telegram_stars_orders
          (id,user_id,product_id,currency,amount_xtr,idempotency_key,request_fingerprint,invoice_payload,status,created_at,updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT DO NOTHING`,
        [orderId, userId, productId, TELEGRAM_STARS_CURRENCY, amount, key, fingerprint, invoicePayload, 'invoice_pending', now, now],
      );
      if (inserted.changes === 1) return { row: await tx.get('SELECT * FROM telegram_stars_orders WHERE id=?', [orderId]), idempotent: false };

      const raced = await tx.get(lockSql('SELECT * FROM telegram_stars_orders WHERE user_id=? AND idempotency_key=?', mode), [userId, key]);
      if (!raced) throw new Error('Telegram Stars order insert conflicted without a readable row');
      assertSameFingerprint(raced, fingerprint, 'idempotency');
      return { row: raced, idempotent: true };
    });

    if (created.row.invoice_url) return { success: true, idempotent: created.idempotent, order: publicOrder(created.row) };
    let issued;
    try {
      issued = await issueInvoice(created.row.id);
    } catch (error) {
      // The order remains durable in invoice_pending, so a retry can issue
      // exactly the same provider payload.  Never grant an entitlement here.
      if (error instanceof TelegramStarsError) throw error;
      throw fail('PROVIDER_UNAVAILABLE', 'Telegram Stars invoice provider unavailable');
    }
    return { success: true, idempotent: created.idempotent || issued.idempotent, order: issued.order };
  }

  async function getOrder({ orderId, userId: rawUserId, telegramUserId }) {
    assertEnabled();
    const userId = normalizeUserId(rawUserId, telegramUserId);
    const id = asString(String(orderId || ''), 'orderId', { max: 256 });
    const row = await withTransaction(async (tx) => tx.get('SELECT * FROM telegram_stars_orders WHERE id=? AND user_id=?', [id, userId]));
    if (!row) throw fail('ORDER_NOT_FOUND', 'Telegram Stars order not found');
    return publicOrder(row);
  }

  async function preCheckout(input = {}) {
    assertEnabled();
    const queryId = input.preCheckoutQueryId || input.queryId;
    const userId = normalizeUserId(input.userId, input.telegramUserId);
    const updateId = optionalString(input.updateId || input.providerUpdateId, 'updateId', 256);
    const payload = providerPayload(input);
    const eventKey = updateId ? `update:${updateId}` : `pre_checkout:${String(queryId || '')}`;
    let shape;
    try {
      shape = validateProviderShape(input, { requireQuery: true });
    } catch (error) {
      const message = error instanceof TelegramStarsError ? error.message : 'Invalid pre-checkout data';
      const rejected = { ok: false, code: 'INVALID_PROVIDER_DATA', errorMessage: message, idempotent: false };
      // A malformed query may not contain an answerable query id. When it
      // does, still send Telegram the negative answer; never let malformed
      // client/provider data turn into an approval.
      if (queryId !== undefined && queryId !== null && String(queryId).trim()) {
        await adapterMethod(adapter, 'answerPreCheckoutQuery')({ queryId: String(queryId), ok: false, errorMessage: message });
      }
      return rejected;
    }
    const fingerprint = hash({ event: 'pre_checkout_query', userId, queryId, payload, currency: input.currency, amount: shape.amount });
    const now = timestamp(clock);

    let decision;
    try {
      decision = await withTransaction(async (tx) => {
        const previous = await loadEvent(tx, eventKey, true);
        if (previous) {
          assertSameFingerprint(previous, fingerprint);
          return eventResult(previous) || { ok: false, code: 'EVENT_REPLAY_UNAVAILABLE', idempotent: true };
        }

        let order = payload ? await getOrderByPayload(tx, payload, true) : null;
        let result;
        if (!order) {
          result = { ok: false, code: 'ORDER_NOT_FOUND', errorMessage: 'Order not found' };
        } else if (order.user_id !== userId) {
          result = { ok: false, code: 'ORDER_USER_MISMATCH', errorMessage: 'Order does not belong to this user' };
        } else if (order.currency !== input.currency || Number(order.amount_xtr) !== shape.amount) {
          result = { ok: false, code: 'ORDER_AMOUNT_MISMATCH', errorMessage: 'Order amount or currency mismatch' };
        } else if (!PRECHECKOUT_STATUSES.has(order.status)) {
          result = order.status === 'paid'
            ? { ok: true, code: 'ALREADY_PAID', orderId: order.id }
            : { ok: false, code: 'ORDER_NOT_PAYABLE', errorMessage: 'Order is no longer payable' };
        } else {
          const update = await tx.run(
            `UPDATE telegram_stars_orders
                SET status='checkout_pending', pre_checkout_query_id=?, checkout_approved_at=?, updated_at=?
              WHERE id=? AND status IN ('invoice_pending','invoice_issued','checkout_pending','cancelled')`,
            [asString(String(queryId), 'preCheckoutQueryId', { max: 256 }), now, now, order.id],
          );
          if (update.changes !== 1) {
            order = await readOrder(tx, order.id, true);
            result = order?.status === 'paid'
              ? { ok: true, code: 'ALREADY_PAID', orderId: order.id }
              : { ok: false, code: 'ORDER_NOT_PAYABLE', errorMessage: 'Order changed while checking out' };
          } else {
            result = { ok: true, code: 'PRE_CHECKOUT_APPROVED', orderId: order.id };
          }
        }

        const inserted = await insertEvent(tx, {
          eventId: newId('xtr_event'),
          eventKey,
          eventType: 'pre_checkout_query',
          providerUpdateId: updateId,
          requestFingerprint: fingerprint,
          orderId: order?.id,
          chargeId: null,
          payloadJson: json(safeProviderEvent(input)),
          status: result.ok ? 'processed' : 'rejected',
          decisionJson: json(result),
          now,
        });
        return inserted ? (eventResult(inserted) || result) : result;
      });
    } catch (error) {
      if (error instanceof TelegramStarsError) throw error;
      throw error;
    }

    // Telegram requires an answer even for rejected validation.  A provider
    // retry is safe because the durable event decision above is idempotent.
    const answer = adapterMethod(adapter, 'answerPreCheckoutQuery');
    const providerAnswer = await answer({ queryId: String(queryId), ok: Boolean(decision.ok), errorMessage: decision.ok ? undefined : decision.errorMessage });
    if (providerAnswer && providerAnswer.ok === false) throw fail('PROVIDER_UNAVAILABLE', 'Telegram Stars pre-checkout answer was not accepted');
    return decision;
  }

  async function successfulPayment(input = {}) {
    assertEnabled();
    const userId = normalizeUserId(input.userId, input.telegramUserId);
    const updateId = optionalString(input.updateId || input.providerUpdateId, 'updateId', 256);
    const { payload, amount, chargeId } = validateProviderShape(input, { requireCharge: true });
    const providerChargeId = optionalString(input.providerPaymentChargeId, 'providerPaymentChargeId', 256);
    const eventKey = updateId ? `update:${updateId}` : `charge:${chargeId}`;
    const fingerprint = hash({ event: 'successful_payment', userId, payload, currency: input.currency, amount, chargeId, providerChargeId });
    const now = timestamp(clock);
    const rawEventJson = json(safeProviderEvent(input));

    return withTransaction(async (tx) => {
      const previous = await loadEvent(tx, eventKey, true);
      if (previous) {
        assertSameFingerprint(previous, fingerprint);
        return eventResult(previous) || { ok: true, idempotent: true };
      }

      const order = payload ? await getOrderByPayload(tx, payload, true) : null;
      if (!order) throw fail('ORDER_NOT_FOUND', 'Order not found for successful_payment');
      if (order.user_id !== userId) throw fail('INVALID_PROVIDER_DATA', 'successful_payment user does not own the order');
      if (order.currency !== input.currency || Number(order.amount_xtr) !== amount) throw fail('INVALID_PROVIDER_DATA', 'successful_payment amount or currency mismatch');

      const byCharge = await tx.get(lockSql('SELECT * FROM telegram_stars_payments WHERE telegram_payment_charge_id=?', mode), [chargeId]);
      if (byCharge && byCharge.order_id !== order.id) throw fail('CHARGE_ID_REUSED', 'telegram_payment_charge_id is already bound to another order');
      const byOrder = await tx.get(lockSql('SELECT * FROM telegram_stars_payments WHERE order_id=?', mode), [order.id]);
      if (byOrder) {
        if (byOrder.telegram_payment_charge_id !== chargeId) throw fail('PAYMENT_ALREADY_CAPTURED', 'Order already has a different payment charge');
        const result = { ok: true, idempotent: true, orderId: order.id, paymentId: byOrder.id, entitlementId: (await tx.get('SELECT id FROM telegram_stars_entitlements WHERE order_id=?', [order.id]))?.id || null };
        await insertEvent(tx, {
          eventId: newId('xtr_event'), eventKey, eventType: 'successful_payment', providerUpdateId: updateId,
          requestFingerprint: fingerprint, orderId: order.id, chargeId, payloadJson: rawEventJson,
          status: 'processed', decisionJson: json(result), now,
        });
        return result;
      }

      if (!CAPTURE_ACCEPTING_STATUSES.has(order.status)) throw fail('ORDER_NOT_PAYABLE', `Order status ${order.status} cannot be captured`);
      const paymentId = newId('xtr_payment');
      const paymentInsert = await tx.run(
        `INSERT INTO telegram_stars_payments
          (id,order_id,telegram_payment_charge_id,provider_payment_charge_id,currency,amount_xtr,status,refunded_amount_xtr,raw_event_json,captured_at,updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT DO NOTHING`,
        [paymentId, order.id, chargeId, providerChargeId, TELEGRAM_STARS_CURRENCY, amount, 'captured', 0, rawEventJson, now, now],
      );
      if (paymentInsert.changes !== 1) {
        const raced = await tx.get(lockSql('SELECT * FROM telegram_stars_payments WHERE telegram_payment_charge_id=?', mode), [chargeId]);
        if (raced?.order_id === order.id) return { ok: true, idempotent: true, orderId: order.id, paymentId: raced.id };
        throw fail('CHARGE_ID_REUSED', 'telegram_payment_charge_id is already bound to another order');
      }

      const paidAfterCancelled = order.status === 'cancelled';
      const transition = await tx.run(
        `UPDATE telegram_stars_orders
            SET status='paid', paid_at=?, paid_after_cancelled=?, updated_at=?
          WHERE id=? AND status IN ('invoice_pending','invoice_issued','checkout_pending','cancelled')`,
        [now, paidAfterCancelled, now, order.id],
      );
      if (transition.changes !== 1) throw fail('ORDER_NOT_PAYABLE', 'Order changed while processing successful_payment');

      const entitlementId = newId('xtr_entitlement');
      await tx.run(
        `INSERT INTO telegram_stars_entitlements
          (id,order_id,user_id,product_id,status,granted_at)
         VALUES (?,?,?,?,?,?) ON CONFLICT DO NOTHING`,
        [entitlementId, order.id, order.user_id, order.product_id, 'active', now],
      );
      const entitlement = await tx.get('SELECT * FROM telegram_stars_entitlements WHERE order_id=?', [order.id]);
      if (!entitlement || entitlement.user_id !== order.user_id || entitlement.product_id !== order.product_id) throw new Error('Telegram Stars entitlement invariant failed');

      const result = {
        ok: true,
        idempotent: false,
        orderId: order.id,
        paymentId,
        entitlementId: entitlement.id,
        paidAfterCancelled,
      };
      const previousEvent = await insertEvent(tx, {
        eventId: newId('xtr_event'), eventKey, eventType: 'successful_payment', providerUpdateId: updateId,
        requestFingerprint: fingerprint, orderId: order.id, chargeId, payloadJson: rawEventJson,
        status: 'processed', decisionJson: json(result), now,
      });
      if (previousEvent) return eventResult(previousEvent) || result;
      return result;
    });
  }

  async function cancelOrder({ orderId, userId: rawUserId, telegramUserId, reason = 'client_cancelled' }) {
    assertEnabled();
    const userId = normalizeUserId(rawUserId, telegramUserId);
    const id = asString(String(orderId || ''), 'orderId', { max: 256 });
    const cleanReason = optionalString(reason, 'reason', 500) || 'client_cancelled';
    const now = timestamp(clock);
    return withTransaction(async (tx) => {
      let order = await tx.get(lockSql('SELECT * FROM telegram_stars_orders WHERE id=? AND user_id=?', mode), [id, userId]);
      if (!order) throw fail('ORDER_NOT_FOUND', 'Telegram Stars order not found');
      if (order.status === 'cancelled') return { ok: true, cancelled: true, idempotent: true, order: publicOrder(order) };
      if (CAPTURED_STATUSES.has(order.status)) throw fail('ORDER_ALREADY_PAID', 'A captured order cannot be cancelled; request a refund');
      const updated = await tx.run(
        `UPDATE telegram_stars_orders SET status='cancelled', cancelled_at=?, updated_at=?
          WHERE id=? AND user_id=? AND status IN ('invoice_pending','invoice_issued','checkout_pending')`,
        [now, now, id, userId],
      );
      if (updated.changes !== 1) {
        order = await tx.get('SELECT * FROM telegram_stars_orders WHERE id=? AND user_id=?', [id, userId]);
        if (order?.status === 'cancelled') return { ok: true, cancelled: true, idempotent: true, order: publicOrder(order) };
        throw fail('ORDER_ALREADY_PAID', 'Order changed and can no longer be cancelled');
      }
      order = await tx.get('SELECT * FROM telegram_stars_orders WHERE id=?', [id]);
      return { ok: true, cancelled: true, idempotent: false, reason: cleanReason, order: publicOrder(order) };
    });
  }

  async function recordRefund(input = {}) {
    assertEnabled();
    const userId = normalizeUserId(input.userId, input.telegramUserId);
    const { payload, amount, chargeId } = validateProviderShape({ ...input, amountXtr: input.amountXtr, totalAmount: input.amountXtr }, { requireCharge: true, requireRefund: true });
    const refundId = asString(input.refundId, 'refundId', { max: 256 });
    const updateId = optionalString(input.updateId || input.providerUpdateId, 'updateId', 256);
    const eventKey = updateId ? `update:${updateId}` : `refund:${refundId}`;
    const fingerprint = hash({ event: 'refund', userId, payload, currency: input.currency, amount, chargeId, refundId });
    const rawEventJson = json(safeProviderEvent(input));
    const now = timestamp(clock);

    return withTransaction(async (tx) => {
      const previous = await loadEvent(tx, eventKey, true);
      if (previous) {
        assertSameFingerprint(previous, fingerprint);
        return eventResult(previous) || { ok: true, idempotent: true };
      }

      const payment = await tx.get(lockSql('SELECT p.*,o.user_id,o.id AS order_id,o.amount_xtr AS order_amount FROM telegram_stars_payments p JOIN telegram_stars_orders o ON o.id=p.order_id WHERE p.telegram_payment_charge_id=?', mode), [chargeId]);
      if (!payment) throw fail('PAYMENT_NOT_FOUND', 'Payment charge not found');
      if (payment.user_id !== userId) throw fail('INVALID_PROVIDER_DATA', 'Refund user does not own the payment');
      if (payment.currency !== input.currency || payment.amount_xtr !== payment.order_amount) throw fail('INVALID_PROVIDER_DATA', 'Stored payment data is inconsistent');
      if (amount > Number(payment.amount_xtr) - Number(payment.refunded_amount_xtr)) throw fail('REFUND_EXCEEDS_CAPTURE', 'Refund amount exceeds the captured amount');

      const existingRefund = await tx.get(lockSql('SELECT * FROM telegram_stars_refunds WHERE refund_id=?', mode), [refundId]);
      if (existingRefund) {
        if (Number(existingRefund.amount_xtr) !== amount || existingRefund.payment_id !== payment.id) throw fail('REFUND_CONFLICT', 'refund_id was reused for a different payment');
        const result = { ok: true, idempotent: true, orderId: payment.order_id, paymentId: payment.id, refundId, refundedAmountXtr: amount };
        await insertEvent(tx, {
          eventId: newId('xtr_event'), eventKey, eventType: 'refund', providerUpdateId: updateId,
          requestFingerprint: fingerprint, orderId: payment.order_id, chargeId, payloadJson: rawEventJson,
          status: 'processed', decisionJson: json(result), now,
        });
        return result;
      }

      const refundInsert = await tx.run(
        `INSERT INTO telegram_stars_refunds
          (id,payment_id,refund_id,amount_xtr,currency,reason,support_case_id,raw_event_json,applied_at)
         VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT DO NOTHING`,
        [newId('xtr_refund'), payment.id, refundId, amount, TELEGRAM_STARS_CURRENCY, optionalString(input.reason, 'reason', 500), optionalString(input.supportCaseId, 'supportCaseId', 256), rawEventJson, now],
      );
      if (refundInsert.changes !== 1) {
        const raced = await tx.get('SELECT amount_xtr,payment_id FROM telegram_stars_refunds WHERE refund_id=?', [refundId]);
        if (!raced || Number(raced.amount_xtr) !== amount || raced.payment_id !== payment.id) throw fail('REFUND_CONFLICT', 'refund_id was reused for a different payment');
      }

      const refundedTotal = Number(payment.refunded_amount_xtr) + amount;
      const paymentStatus = refundedTotal === Number(payment.amount_xtr) ? 'refunded' : 'partially_refunded';
      await tx.run('UPDATE telegram_stars_payments SET refunded_amount_xtr=?, status=?, updated_at=? WHERE id=?', [refundedTotal, paymentStatus, now, payment.id]);
      if (paymentStatus === 'refunded') {
        await tx.run(
          `UPDATE telegram_stars_orders SET status='refunded', updated_at=? WHERE id=? AND status IN ('paid','partially_refunded')`,
          [now, payment.order_id],
        );
        await tx.run(
          `UPDATE telegram_stars_entitlements SET status='revoked', revoked_at=?, revoked_reason=?
            WHERE order_id=? AND status='active'`,
          [now, 'telegram_stars_refund', payment.order_id],
        );
      } else {
        await tx.run(`UPDATE telegram_stars_orders SET status='partially_refunded', updated_at=? WHERE id=? AND status='paid'`, [now, payment.order_id]);
      }

      const result = { ok: true, idempotent: false, orderId: payment.order_id, paymentId: payment.id, refundId, refundedAmountXtr: amount, refundedTotalXtr: refundedTotal, status: paymentStatus };
      const previousEvent = await insertEvent(tx, {
        eventId: newId('xtr_event'), eventKey, eventType: 'refund', providerUpdateId: updateId,
        requestFingerprint: fingerprint, orderId: payment.order_id, chargeId, payloadJson: rawEventJson,
        status: 'processed', decisionJson: json(result), now,
      });
      return previousEvent ? (eventResult(previousEvent) || result) : result;
    });
  }

  async function requestRefund(input = {}) {
    assertEnabled();
    const userId = normalizeUserId(input.userId, input.telegramUserId);
    const chargeId = asString(input.telegramPaymentChargeId, 'telegramPaymentChargeId', { max: 256 });
    const amountXtr = positiveInteger(input.amountXtr, 'amountXtr');
    const requestKey = effectiveIdempotencyKey(input.idempotencyKey, userId, `refund:${chargeId}:${amountXtr}`);
    const requestFingerprint = hash({ operation: 'telegram_stars_refund_request', userId, chargeId, amountXtr });
    const reservation = await withTransaction(async (tx) => {
      // Lock the payment while reserving this amount. Different request keys
      // for one charge therefore cannot both reserve the same remainder.
      const payment = await tx.get(lockSql(
        'SELECT p.id,p.amount_xtr,p.refunded_amount_xtr,o.user_id FROM telegram_stars_payments p JOIN telegram_stars_orders o ON o.id=p.order_id WHERE p.telegram_payment_charge_id=?',
        mode,
      ), [chargeId]);
      if (!payment) throw fail('PAYMENT_NOT_FOUND', 'Payment charge not found');
      if (payment.user_id !== userId) throw fail('INVALID_PROVIDER_DATA', 'Refund user does not own the payment');

      let existing = await tx.get(lockSql('SELECT * FROM telegram_stars_refund_requests WHERE request_key=?', mode), [requestKey]);
      if (existing) {
        assertSameFingerprint(existing, requestFingerprint, 'idempotency');
        if (existing.status === 'applied') return { status: 'applied', refundId: existing.provider_refund_id };
      } else {
        existing = null;
      }

      const reservedRow = await tx.get(
        `SELECT COALESCE(SUM(amount_xtr),0) AS reserved_xtr
           FROM telegram_stars_refund_requests
          WHERE payment_id=? AND status IN ('requested','submitted')${existing ? ' AND id<>?' : ''}`,
        existing ? [payment.id, existing.id] : [payment.id],
      );
      const remaining = Number(payment.amount_xtr) - Number(payment.refunded_amount_xtr) - Number(reservedRow?.reserved_xtr || 0);
      if (amountXtr > remaining) throw fail('REFUND_EXCEEDS_CAPTURE', 'Refund amount exceeds the captured amount or a pending refund reservation');

      const now = timestamp(clock);
      if (existing) {
        await tx.run(`UPDATE telegram_stars_refund_requests SET status='requested', failure_code=NULL, updated_at=? WHERE id=?`, [now, existing.id]);
        return { status: 'requested', requestId: existing.id };
      }

      const requestId = newId('xtr_refund_request');
      const inserted = await tx.run(
        `INSERT INTO telegram_stars_refund_requests
          (id,payment_id,request_key,request_fingerprint,amount_xtr,status,created_at,updated_at)
         VALUES (?,?,?,?,?,?,?,?) ON CONFLICT DO NOTHING`,
        [requestId, payment.id, requestKey, requestFingerprint, amountXtr, 'requested', now, now],
      );
      if (inserted.changes !== 1) {
        const raced = await tx.get('SELECT * FROM telegram_stars_refund_requests WHERE request_key=?', [requestKey]);
        assertSameFingerprint(raced, requestFingerprint, 'idempotency');
        return raced.status === 'applied'
          ? { status: 'applied', refundId: raced.provider_refund_id }
          : { status: 'requested', requestId: raced.id };
      }
      return { status: 'requested', requestId };
    });

    if (reservation.status === 'applied') return { ok: true, idempotent: true, refundId: reservation.refundId };
    await withTransaction(async (tx) => tx.run(`UPDATE telegram_stars_refund_requests SET status='submitted', updated_at=? WHERE id=? AND status='requested'`, [timestamp(clock), reservation.requestId]));

    let refund;
    try {
      refund = await adapterMethod(adapter, 'refundStarPayment')({
        telegramPaymentChargeId: chargeId,
        amountXtr,
        currency: TELEGRAM_STARS_CURRENCY,
      });
    } catch {
      await withTransaction(async (tx) => tx.run(`UPDATE telegram_stars_refund_requests SET status='failed', failure_code=?, updated_at=? WHERE id=? AND status='submitted'`, ['provider_unavailable', timestamp(clock), reservation.requestId]));
      throw fail('PROVIDER_UNAVAILABLE', 'Telegram Stars refund provider unavailable');
    }
    if (!refund?.refundId || refund.telegramPaymentChargeId !== chargeId || Number(refund.amountXtr) !== amountXtr) {
      throw fail('PROVIDER_UNAVAILABLE', 'Telegram Stars adapter returned an invalid refund');
    }
    const result = await recordRefund({ ...input, ...refund, refundId: refund.refundId, currency: TELEGRAM_STARS_CURRENCY });
    await withTransaction(async (tx) => tx.run(
      `UPDATE telegram_stars_refund_requests SET status='applied', provider_refund_id=?, updated_at=? WHERE id=?`,
      [refund.refundId, timestamp(clock), reservation.requestId],
    ));
    return result;
  }

  async function getEntitlement({ orderId, userId: rawUserId, telegramUserId }) {
    assertEnabled();
    const userId = normalizeUserId(rawUserId, telegramUserId);
    const id = asString(String(orderId || ''), 'orderId', { max: 256 });
    return withTransaction(async (tx) => tx.get('SELECT * FROM telegram_stars_entitlements WHERE order_id=? AND user_id=?', [id, userId]));
  }

  async function openSupportCase(input = {}) {
    assertEnabled();
    const userId = normalizeUserId(input.userId, input.telegramUserId);
    const key = validateTelegramStarsIdempotencyKey(input.idempotencyKey);
    if (!key) throw fail('INVALID_INPUT', 'Support cases require an Idempotency-Key');
    const category = asString(input.category || 'other', 'category', { max: 64 });
    if (!['payment_missing', 'refund_request', 'payment_question', 'other'].includes(category)) throw fail('INVALID_INPUT', 'Unsupported support category');
    const contact = asString(input.contact, 'contact', { max: 500 });
    const message = asString(input.message, 'message', { max: MAX_MESSAGE });
    const orderId = optionalString(input.orderId, 'orderId', 256);
    const chargeId = optionalString(input.telegramPaymentChargeId, 'telegramPaymentChargeId', 256);
    const fingerprint = hash({ userId, category, contact, message, orderId, chargeId });
    const now = timestamp(clock);

    return withTransaction(async (tx) => {
      const existing = await tx.get('SELECT * FROM telegram_stars_support_cases WHERE idempotency_key=?', [key]);
      if (existing) {
        assertSameFingerprint(existing, fingerprint, 'idempotency');
        return { case: existing, idempotent: true };
      }
      if (orderId) {
        const order = await tx.get('SELECT id,user_id FROM telegram_stars_orders WHERE id=?', [orderId]);
        if (!order) throw fail('ORDER_NOT_FOUND', 'Support order not found');
        if (order.user_id !== userId) throw fail('INVALID_PROVIDER_DATA', 'Support order does not belong to this user');
      }
      if (chargeId) {
        const payment = await tx.get(
          'SELECT p.telegram_payment_charge_id,o.user_id FROM telegram_stars_payments p JOIN telegram_stars_orders o ON o.id=p.order_id WHERE p.telegram_payment_charge_id=?',
          [chargeId],
        );
        if (payment && payment.user_id !== userId) throw fail('INVALID_PROVIDER_DATA', 'Support payment does not belong to this user');
      }
      const id = newId('xtr_support');
      const result = await tx.run(
        `INSERT INTO telegram_stars_support_cases
          (id,user_id,order_id,telegram_payment_charge_id,idempotency_key,request_fingerprint,category,contact,message,status,created_at,updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT DO NOTHING`,
        [id, userId, orderId, chargeId, key, fingerprint, category, contact, message, 'open', now, now],
      );
      if (result.changes !== 1) {
        const raced = await tx.get('SELECT * FROM telegram_stars_support_cases WHERE idempotency_key=?', [key]);
        assertSameFingerprint(raced, fingerprint, 'idempotency');
        return { case: raced, idempotent: true };
      }
      return { case: await tx.get('SELECT * FROM telegram_stars_support_cases WHERE id=?', [id]), idempotent: false };
    });
  }

  async function reconcile() {
    assertEnabled();
    const listCapturedPayments = adapterMethod(adapter, 'listCapturedPayments');
    const runId = newId('xtr_reconciliation');
    const startedAt = timestamp(clock);
    await withTransaction(async (tx) => {
      await tx.run(
        `INSERT INTO telegram_stars_reconciliation_runs (id,status,provider_name,started_at) VALUES (?,?,?,?)`,
        [runId, 'running', adapter.providerName || 'telegram_stars_mock', startedAt],
      );
    });

    let providerCaptures;
    try {
      providerCaptures = await listCapturedPayments();
      if (!Array.isArray(providerCaptures)) throw new Error('Provider capture list must be an array');
    } catch {
      await withTransaction(async (tx) => tx.run(`UPDATE telegram_stars_reconciliation_runs SET status='failed', error_message=?, finished_at=? WHERE id=?`, ['provider_list_failed', timestamp(clock), runId]));
      throw fail('PROVIDER_UNAVAILABLE', 'Telegram Stars reconciliation provider unavailable');
    }

    const report = await withTransaction(async (tx) => {
      const localRows = await tx.all(
        `SELECT p.*,o.user_id,o.product_id,o.invoice_payload,o.amount_xtr AS order_amount,o.currency AS order_currency
           FROM telegram_stars_payments p JOIN telegram_stars_orders o ON o.id=p.order_id`,
      );
      const localByCharge = new Map(localRows.map((row) => [row.telegram_payment_charge_id, row]));
      const providerByCharge = new Map();
      const issues = [];
      const addIssue = (issue) => {
        const fingerprint = hash({ issue_type: issue.issue_type, charge: issue.charge, orderId: issue.orderId || null, details: issue.details });
        issues.push({ ...issue, fingerprint });
      };

      for (const capture of providerCaptures) {
        const charge = capture?.telegramPaymentChargeId || capture?.chargeId;
        if (typeof charge !== 'string' || !charge) {
          addIssue({ issue_type: 'provider_capture_missing_charge_id', severity: 'critical', charge: null, details: { provider_record: 'invalid' } });
          continue;
        }
        if (providerByCharge.has(charge)) {
          addIssue({ issue_type: 'provider_duplicate_charge_id', severity: 'critical', charge, details: { duplicate: true } });
          continue;
        }
        providerByCharge.set(charge, capture);
        const local = localByCharge.get(charge);
        if (!local) {
          addIssue({ issue_type: 'provider_capture_missing_local_payment', severity: 'critical', charge, details: { amountXtr: capture.amountXtr ?? capture.totalAmount, currency: capture.currency, invoicePayload: capture.invoicePayload || null } });
          continue;
        }
        const providerAmountValue = capture.amountXtr ?? capture.totalAmount;
        if (Number(providerAmountValue) !== Number(local.amount_xtr) || capture.currency !== local.currency) {
          addIssue({ issue_type: 'payment_amount_or_currency_mismatch', severity: 'critical', charge, orderId: local.order_id, details: { localAmountXtr: Number(local.amount_xtr), providerAmountXtr: Number(providerAmountValue), localCurrency: local.currency, providerCurrency: capture.currency } });
        }
        const providerPayloadValue = capture.invoicePayload || capture.orderPayload;
        if (providerPayloadValue && providerPayloadValue !== local.invoice_payload) {
          addIssue({ issue_type: 'payment_payload_mismatch', severity: 'critical', charge, orderId: local.order_id, details: { localPayload: local.invoice_payload, providerPayload: providerPayloadValue } });
        }
      }

      for (const local of localRows) {
        if (!providerByCharge.has(local.telegram_payment_charge_id)) {
          addIssue({ issue_type: 'local_payment_missing_provider_capture', severity: 'warning', charge: local.telegram_payment_charge_id, orderId: local.order_id, details: { localStatus: local.status } });
        }
      }

      const now = timestamp(clock);
      for (const issue of issues) {
        await tx.run(
          `INSERT INTO telegram_stars_reconciliation_issues
            (id,run_id,issue_type,severity,fingerprint,order_id,payment_id,details_json,created_at)
           VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT DO NOTHING`,
          [newId('xtr_reconciliation_issue'), runId, issue.issue_type, issue.severity, issue.fingerprint, issue.orderId || null, localByCharge.get(issue.charge)?.id || null, json(issue.details), now],
        );
      }
      await tx.run(
        `UPDATE telegram_stars_reconciliation_runs
            SET status='completed', checked_at=?, checked_count=?, issue_count=?, finished_at=?
          WHERE id=?`,
        [now, providerCaptures.length, issues.length, now, runId],
      );
      const run = await tx.get('SELECT * FROM telegram_stars_reconciliation_runs WHERE id=?', [runId]);
      const storedIssues = await tx.all('SELECT * FROM telegram_stars_reconciliation_issues WHERE run_id=? ORDER BY created_at,id', [runId]);
      return { run, issues: storedIssues };
    });
    return report;
  }

  return Object.freeze({
    createOrder,
    issueInvoice,
    getOrder,
    preCheckout,
    handlePreCheckout: preCheckout,
    successfulPayment,
    handleSuccessfulPayment: successfulPayment,
    cancelOrder,
    recordRefund,
    handleRefund: recordRefund,
    requestRefund,
    getEntitlement,
    openSupportCase,
    reconcile,
    reconcilePayments: reconcile,
    supportContract: buildTelegramStarsSupportContract({
      TELEGRAM_PAYMENT_SUPPORT: supportContact,
      TELEGRAM_PAYMENT_REFUND_CONTACT: refundContact,
    }),
  });
}

export default createTelegramStarsService;
