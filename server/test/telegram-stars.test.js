import test from 'node:test';
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import initSqlJs from 'sql.js';
import { runMigrations } from '../database/migrations.js';
import { withTransaction } from '../database/transaction.js';
import {
  createTelegramStarsService,
  TelegramStarsError,
  buildTelegramStarsSupportContract,
} from '../services/telegram-stars.js';
import { createMockTelegramStarsAdapter } from '../services/telegram-stars-mock-adapter.js';

async function createDb() {
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  db.run('PRAGMA foreign_keys = ON');
  await runMigrations({ mode: 'sqlite', pool: null, sqlite: db, persistFn: null, migrationsDir: join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations', 'sqlite') });
  return db;
}

function tx(db, callback) {
  return withTransaction({ mode: 'sqlite', sqlite: db }, callback);
}

async function seedUser(db, id = 'tg_123') {
  const now = new Date().toISOString();
  await tx(db, (database) => database.run(
    `INSERT INTO users (id,telegram_id,nickname,stars_balance,role,created_at,updated_at)
     VALUES (?,?,?,?,?,?,?)`,
    [id, Number(id.replace(/\D/g, '') || 123), id, 0, 'user', now, now],
  ));
  return id;
}

function service(db, adapter = createMockTelegramStarsAdapter(), overrides = {}) {
  return {
    svc: createTelegramStarsService({
      enabled: true,
      adapter,
      mode: 'sqlite',
      withTransaction: (callback) => tx(db, callback),
      ...overrides,
    }),
    adapter,
  };
}

function errorCode(error, code) {
  return error instanceof TelegramStarsError && error.code === code;
}

test('XTR remains disabled unless a caller explicitly opts in', async () => {
  const db = await createDb();
  await seedUser(db);
  const svc = createTelegramStarsService({
    adapter: createMockTelegramStarsAdapter(),
    withTransaction: (callback) => tx(db, callback),
  });
  await assert.rejects(
    () => svc.createOrder({ userId: 'tg_123', productId: 'premium', amountXtr: 120, idempotencyKey: 'disabled-key' }),
    (error) => errorCode(error, 'PAYMENTS_DISABLED'),
  );
});

test('order price is server-derived and create/retry/idempotency are durable', async () => {
  const db = await createDb();
  await seedUser(db);
  const { svc, adapter } = service(db, undefined, {
    priceResolver: ({ productId }) => (productId === 'premium' ? 120 : 7),
  });

  const first = await svc.createOrder({ userId: 'tg_123', productId: 'premium', amountXtr: 1, idempotencyKey: 'order-key-1' });
  assert.equal(first.order.amount_xtr, 120);
  assert.equal(first.order.status, 'invoice_issued');
  assert.equal(adapter.getInvoices().length, 1);

  const replay = await svc.createOrder({ userId: 'tg_123', productId: 'premium', amountXtr: 999_999, idempotencyKey: 'order-key-1' });
  assert.equal(replay.idempotent, true);
  assert.equal(replay.order.id, first.order.id);
  assert.equal(adapter.getInvoices().length, 1);

  await assert.rejects(
    () => svc.createOrder({ userId: 'tg_123', productId: 'other', amountXtr: 120, idempotencyKey: 'order-key-1' }),
    (error) => errorCode(error, 'IDEMPOTENCY_KEY_REUSED'),
  );

  const stored = await tx(db, (database) => database.get('SELECT amount_xtr,invoice_payload,status FROM telegram_stars_orders WHERE id=?', [first.order.id]));
  assert.deepEqual(stored, { amount_xtr: 120, invoice_payload: first.order.invoice_payload, status: 'invoice_issued' });
});

test('a non-mock provider cannot fall back to a client-supplied Stars price', async () => {
  const db = await createDb();
  await seedUser(db);
  const realShapedAdapter = {
    async createInvoice() { return { invoiceUrl: 'https://provider.invalid/invoice' }; },
  };
  const svc = createTelegramStarsService({
    enabled: true,
    adapter: realShapedAdapter,
    mode: 'sqlite',
    withTransaction: (callback) => tx(db, callback),
  });

  await assert.rejects(
    () => svc.createOrder({ userId: 'tg_123', productId: 'premium', amountXtr: 1, idempotencyKey: 'price-boundary' }),
    (error) => errorCode(error, 'INVALID_INPUT') && /server (product|price) resolver/i.test(error.message),
  );
  assert.equal((await tx(db, (database) => database.get('SELECT COUNT(*) AS c FROM telegram_stars_orders'))).c, 0);
});

test('a non-mock provider requires a published premium catalog product', async () => {
  const db = await createDb();
  await seedUser(db);
  const adapter = { providerName: 'telegram_stars_provider', async createInvoice() { return { invoiceUrl: 'https://provider.invalid/invoice' }; } };
  const base = {
    enabled: true,
    adapter,
    mode: 'sqlite',
    withTransaction: (callback) => tx(db, callback),
    priceResolver: () => 120,
  };
  const unpublished = createTelegramStarsService({
    ...base,
    productResolver: () => ({ id: 'premium', pack_type: 'premium', status: 'draft', visibility: 'private', price_in_stars: 120 }),
  });
  await assert.rejects(
    () => unpublished.createOrder({ userId: 'tg_123', productId: 'premium', amountXtr: 1, idempotencyKey: 'unpublished-product' }),
    (error) => errorCode(error, 'PRODUCT_NOT_PURCHASABLE'),
  );
  const published = createTelegramStarsService({
    ...base,
    productResolver: () => ({ id: 'premium', pack_type: 'premium', status: 'published', visibility: 'public', price_in_stars: 120 }),
  });
  const created = await published.createOrder({ userId: 'tg_123', productId: 'premium', amountXtr: 1, idempotencyKey: 'published-product' });
  assert.equal(created.order.amount_xtr, 120);
});

test('provider invoice failure leaves a retryable pending order without granting access', async () => {
  const db = await createDb();
  await seedUser(db);
  const { svc, adapter } = service(db);
  const originalCreateInvoice = adapter.createInvoice;
  adapter.createInvoice = async () => { throw new Error('mock provider down'); };
  await assert.rejects(
    () => svc.createOrder({ userId: 'tg_123', productId: 'provider-down', amountXtr: 7, idempotencyKey: 'provider-failure-key' }),
    (error) => errorCode(error, 'PROVIDER_UNAVAILABLE'),
  );
  const pending = await tx(db, (database) => database.get('SELECT status FROM telegram_stars_orders WHERE idempotency_key=?', ['provider-failure-key']));
  assert.equal(pending.status, 'invoice_pending');
  adapter.createInvoice = originalCreateInvoice;
  const retry = await svc.createOrder({ userId: 'tg_123', productId: 'provider-down', amountXtr: 7, idempotencyKey: 'provider-failure-key' });
  assert.equal(retry.order.status, 'invoice_issued');
  assert.equal((await tx(db, (database) => database.get('SELECT COUNT(*) AS c FROM telegram_stars_entitlements'))).c, 0);
});

test('pre_checkout is server-authoritative, rejects mismatch, and replays the same decision', async () => {
  const db = await createDb();
  await seedUser(db);
  const { svc, adapter } = service(db);
  const created = await svc.createOrder({ userId: 'tg_123', productId: 'premium', amountXtr: 120, idempotencyKey: 'precheckout-key' });
  const base = {
    userId: 'tg_123',
    updateId: 'pre-update-1',
    preCheckoutQueryId: 'query-1',
    invoicePayload: created.order.invoice_payload,
    currency: 'XTR',
    totalAmount: 120,
  };

  const approved = await svc.preCheckout(base);
  assert.equal(approved.ok, true);
  assert.equal(approved.code, 'PRE_CHECKOUT_APPROVED');
  const replay = await svc.preCheckout(base);
  assert.equal(replay.idempotent, true);
  assert.equal(adapter.getAnswers().length, 2);
  assert.equal(adapter.getAnswers()[0].ok, true);

  const bad = await svc.preCheckout({ ...base, updateId: 'pre-update-bad', preCheckoutQueryId: 'query-bad', totalAmount: 121 });
  assert.equal(bad.ok, false);
  assert.equal(bad.code, 'ORDER_AMOUNT_MISMATCH');
  assert.equal(adapter.getAnswers().at(-1).ok, false);
});

test('numeric Telegram update ids normalize and a second pre-checkout query is rejected', async () => {
  const db = await createDb();
  await seedUser(db);
  const { svc, adapter } = service(db);
  const created = await svc.createOrder({ userId: 'tg_123', productId: 'single-checkout', amountXtr: 12, idempotencyKey: 'numeric-update' });
  const first = await svc.preCheckout({
    userId: 'tg_123', updateId: 1001, preCheckoutQueryId: 'query-first',
    invoicePayload: created.order.invoice_payload, currency: 'XTR', totalAmount: 12,
  });
  assert.equal(first.code, 'PRE_CHECKOUT_APPROVED');
  const second = await svc.preCheckout({
    userId: 'tg_123', updateId: 1002, preCheckoutQueryId: 'query-second',
    invoicePayload: created.order.invoice_payload, currency: 'XTR', totalAmount: 12,
  });
  assert.equal(second.code, 'ORDER_CHECKOUT_IN_PROGRESS');
  assert.equal(adapter.getAnswers().at(-1).ok, false);
});

test('a refund delivered before capture is durable and prevents later access', async () => {
  const db = await createDb();
  await seedUser(db);
  const { svc } = service(db);
  const created = await svc.createOrder({ userId: 'tg_123', productId: 'reordered-refund', amountXtr: 20, idempotencyKey: 'reordered-order' });
  const pending = await svc.recordRefund({
    userId: 'tg_123', updateId: 2001, refundId: 'refund-before-capture',
    telegramPaymentChargeId: 'reordered-charge', invoicePayload: created.order.invoice_payload,
    amountXtr: 20, currency: 'XTR',
  });
  assert.equal(pending.status, 'pending_capture');
  const captured = await svc.successfulPayment({
    userId: 'tg_123', updateId: 2002, invoicePayload: created.order.invoice_payload,
    currency: 'XTR', totalAmount: 20, telegramPaymentChargeId: 'reordered-charge',
  });
  assert.equal(captured.refundStatus, 'refunded');
  assert.equal(captured.refundedAmountXtr, 20);
  assert.equal((await svc.getEntitlement({ userId: 'tg_123', orderId: created.order.id })).status, 'revoked');
  assert.equal((await svc.getOrder({ userId: 'tg_123', orderId: created.order.id })).status, 'refunded');
});

test('one-time products reject a second active order even with a new idempotency key', async () => {
  const db = await createDb();
  await seedUser(db);
  const { svc } = service(db);
  const first = await svc.createOrder({ userId: 'tg_123', productId: 'one-time-product', amountXtr: 10, idempotencyKey: 'one-time-first' });
  await svc.successfulPayment({ userId: 'tg_123', invoicePayload: first.order.invoice_payload, currency: 'XTR', totalAmount: 10, telegramPaymentChargeId: 'one-time-charge' });
  await assert.rejects(
    () => svc.createOrder({ userId: 'tg_123', productId: 'one-time-product', amountXtr: 10, idempotencyKey: 'one-time-second' }),
    (error) => errorCode(error, 'PRODUCT_ALREADY_OWNED'),
  );
});

test('successful_payment grants one entitlement and duplicate/retry cannot double-capture', async () => {
  const db = await createDb();
  await seedUser(db);
  const { svc, adapter } = service(db);
  const created = await svc.createOrder({ userId: 'tg_123', productId: 'premium', amountXtr: 120, idempotencyKey: 'capture-key' });
  const payment = {
    userId: 'tg_123',
    updateId: 'success-update-1',
    invoicePayload: created.order.invoice_payload,
    currency: 'XTR',
    totalAmount: 120,
    telegramPaymentChargeId: 'charge-1',
    providerPaymentChargeId: 'provider-charge-1',
  };
  const first = await svc.successfulPayment(payment);
  assert.equal(first.ok, true);
  assert.equal(first.idempotent, false);
  assert.equal((await svc.getEntitlement({ userId: 'tg_123', orderId: created.order.id })).status, 'active');

  const replay = await svc.successfulPayment(payment);
  assert.equal(replay.idempotent, true);
  const retryWithNewUpdate = await svc.successfulPayment({ ...payment, updateId: 'success-update-retry' });
  assert.equal(retryWithNewUpdate.idempotent, true);
  const counts = await tx(db, async (database) => ({
    payments: await database.get('SELECT COUNT(*) AS c FROM telegram_stars_payments WHERE order_id=?', [created.order.id]),
    entitlements: await database.get('SELECT COUNT(*) AS c FROM telegram_stars_entitlements WHERE order_id=?', [created.order.id]),
  }));
  assert.equal(Number(counts.payments.c), 1);
  assert.equal(Number(counts.entitlements.c), 1);
  adapter.seedCapture({ telegramPaymentChargeId: 'charge-1', invoicePayload: created.order.invoice_payload, amountXtr: 120, currency: 'XTR' });
});

test('cancelled order accepts delayed provider success but pre_checkout cannot resurrect it', async () => {
  const db = await createDb();
  await seedUser(db);
  const { svc } = service(db);
  const created = await svc.createOrder({ userId: 'tg_123', productId: 'delayed', amountXtr: 9, idempotencyKey: 'cancel-key' });
  const cancelled = await svc.cancelOrder({ userId: 'tg_123', orderId: created.order.id });
  assert.equal(cancelled.cancelled, true);

  const rejected = await svc.preCheckout({
    userId: 'tg_123', preCheckoutQueryId: 'late-query', updateId: 'late-pre',
    invoicePayload: created.order.invoice_payload, currency: 'XTR', totalAmount: 9,
  });
  assert.equal(rejected.ok, false);
  assert.equal(rejected.code, 'ORDER_NOT_PAYABLE');

  const delayed = await svc.successfulPayment({
    userId: 'tg_123', updateId: 'late-success', invoicePayload: created.order.invoice_payload,
    currency: 'XTR', totalAmount: 9, telegramPaymentChargeId: 'late-charge',
  });
  assert.equal(delayed.ok, true);
  assert.equal(delayed.paidAfterCancelled, true);
  const order = await svc.getOrder({ userId: 'tg_123', orderId: created.order.id });
  assert.equal(order.status, 'paid');
  assert.equal(order.paid_after_cancelled, true);
});

test('charge ids are immutable and cannot be replayed onto another order', async () => {
  const db = await createDb();
  await seedUser(db);
  const { svc } = service(db);
  const first = await svc.createOrder({ userId: 'tg_123', productId: 'one', amountXtr: 10, idempotencyKey: 'charge-key-1' });
  const second = await svc.createOrder({ userId: 'tg_123', productId: 'two', amountXtr: 11, idempotencyKey: 'charge-key-2' });
  await svc.successfulPayment({ userId: 'tg_123', updateId: 'charge-update-1', invoicePayload: first.order.invoice_payload, currency: 'XTR', totalAmount: 10, telegramPaymentChargeId: 'immutable-charge' });
  await assert.rejects(
    () => svc.successfulPayment({ userId: 'tg_123', updateId: 'charge-update-2', invoicePayload: second.order.invoice_payload, currency: 'XTR', totalAmount: 11, telegramPaymentChargeId: 'immutable-charge' }),
    (error) => errorCode(error, 'CHARGE_ID_REUSED'),
  );
});

test('XTR database guards keep price, payload, and charge identity immutable', async () => {
  const db = await createDb();
  await seedUser(db);
  const { svc } = service(db);
  const created = await svc.createOrder({ userId: 'tg_123', productId: 'immutable', amountXtr: 12, idempotencyKey: 'identity-key' });
  await svc.successfulPayment({ userId: 'tg_123', invoicePayload: created.order.invoice_payload, currency: 'XTR', totalAmount: 12, telegramPaymentChargeId: 'identity-charge' });
  await assert.rejects(
    () => tx(db, (database) => database.run('UPDATE telegram_stars_orders SET amount_xtr=? WHERE id=?', [13, created.order.id])),
    /identity is immutable/i,
  );
  await assert.rejects(
    () => tx(db, (database) => database.run('UPDATE telegram_stars_payments SET telegram_payment_charge_id=? WHERE order_id=?', ['forged-charge', created.order.id])),
    /charge identity is immutable/i,
  );
  await svc.recordRefund({ userId: 'tg_123', refundId: 'identity-refund', telegramPaymentChargeId: 'identity-charge', amountXtr: 12, currency: 'XTR' });
  await assert.rejects(
    () => tx(db, (database) => database.run('DELETE FROM telegram_stars_refunds WHERE refund_id=?', ['identity-refund'])),
    /append-only/i,
  );
});

test('full and partial refunds are idempotent and revoke only after full refund', async () => {
  const db = await createDb();
  await seedUser(db);
  const { svc } = service(db);
  const created = await svc.createOrder({ userId: 'tg_123', productId: 'refund-me', amountXtr: 100, idempotencyKey: 'refund-key' });
  await svc.successfulPayment({ userId: 'tg_123', invoicePayload: created.order.invoice_payload, currency: 'XTR', totalAmount: 100, telegramPaymentChargeId: 'refund-charge' });
  const partial = await svc.recordRefund({ userId: 'tg_123', refundId: 'refund-1', telegramPaymentChargeId: 'refund-charge', amountXtr: 40, currency: 'XTR' });
  assert.equal(partial.status, 'partially_refunded');
  assert.equal((await svc.getEntitlement({ userId: 'tg_123', orderId: created.order.id })).status, 'active');
  const partialReplay = await svc.recordRefund({ userId: 'tg_123', refundId: 'refund-1', telegramPaymentChargeId: 'refund-charge', amountXtr: 40, currency: 'XTR' });
  assert.equal(partialReplay.idempotent, true);
  const full = await svc.recordRefund({ userId: 'tg_123', refundId: 'refund-2', telegramPaymentChargeId: 'refund-charge', amountXtr: 60, currency: 'XTR' });
  assert.equal(full.status, 'refunded');
  assert.equal((await svc.getEntitlement({ userId: 'tg_123', orderId: created.order.id })).status, 'revoked');
  await assert.rejects(
    () => svc.recordRefund({ userId: 'tg_123', refundId: 'refund-3', telegramPaymentChargeId: 'refund-charge', amountXtr: 1, currency: 'XTR' }),
    (error) => errorCode(error, 'REFUND_EXCEEDS_CAPTURE'),
  );
});

test('refund requests reserve the remaining capture before the mock provider call', async () => {
  const db = await createDb();
  await seedUser(db);
  const { svc, adapter } = service(db);
  const created = await svc.createOrder({ userId: 'tg_123', productId: 'reserved-refund', amountXtr: 30, idempotencyKey: 'reserved-order' });
  await svc.successfulPayment({ userId: 'tg_123', invoicePayload: created.order.invoice_payload, currency: 'XTR', totalAmount: 30, telegramPaymentChargeId: 'reserved-charge' });

  const first = await svc.requestRefund({ userId: 'tg_123', idempotencyKey: 'refund-request-1', telegramPaymentChargeId: 'reserved-charge', amountXtr: 10 });
  assert.equal(first.ok, true);
  const replay = await svc.requestRefund({ userId: 'tg_123', idempotencyKey: 'refund-request-1', telegramPaymentChargeId: 'reserved-charge', amountXtr: 10 });
  assert.equal(replay.idempotent, true);
  assert.equal(adapter.getRefunds().filter((refund) => refund.refundId.startsWith('mock_refund_')).length, 1);
  await assert.rejects(
    () => svc.requestRefund({ userId: 'tg_123', idempotencyKey: 'refund-request-too-large', telegramPaymentChargeId: 'reserved-charge', amountXtr: 21 }),
    (error) => errorCode(error, 'REFUND_EXCEEDS_CAPTURE'),
  );
});

test('support cases and reconciliation have stable contracts and no entitlement auto-grant', async () => {
  const db = await createDb();
  await seedUser(db);
  const { svc, adapter } = service(db);
  const created = await svc.createOrder({ userId: 'tg_123', productId: 'support-product', amountXtr: 8, idempotencyKey: 'support-order' });
  await svc.successfulPayment({ userId: 'tg_123', invoicePayload: created.order.invoice_payload, currency: 'XTR', totalAmount: 8, telegramPaymentChargeId: 'support-charge' });
  adapter.seedCapture({ telegramPaymentChargeId: 'support-charge', invoicePayload: created.order.invoice_payload, amountXtr: 8, currency: 'XTR' });
  adapter.seedCapture({ telegramPaymentChargeId: 'provider-only', invoicePayload: 'unknown-payload', amountXtr: 999, currency: 'XTR' });
  const report = await svc.reconcile();
  assert.equal(report.run.status, 'completed');
  assert.ok(report.issues.some((issue) => issue.issue_type === 'provider_capture_missing_local_payment'));
  assert.equal((await svc.getEntitlement({ userId: 'tg_123', orderId: created.order.id })).status, 'active');

  const support = await svc.openSupportCase({ userId: 'tg_123', idempotencyKey: 'support-case-key', category: 'payment_question', contact: '@support-user', message: 'Please check this payment', orderId: created.order.id });
  const replay = await svc.openSupportCase({ userId: 'tg_123', idempotencyKey: 'support-case-key', category: 'payment_question', contact: '@support-user', message: 'Please check this payment', orderId: created.order.id });
  assert.equal(support.idempotent, false);
  assert.equal(replay.idempotent, true);
  assert.equal(buildTelegramStarsSupportContract({ TELEGRAM_PAYMENT_SUPPORT: '@splint_support', TELEGRAM_PAYMENT_REFUND_CONTACT: 'refunds@example.test' }).paysupport_command, '/paysupport');
});
