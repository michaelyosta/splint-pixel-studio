// Characterization of launch blockers on b029b40, NOT passing acceptance tests.
// Fake provider responses and an in-memory DB only; never contacts Telegram.
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import express from 'express';
import initSqlJs from 'sql.js';
import { runMigrations } from '../database/migrations.js';
import { withTransaction } from '../database/transaction.js';
import { createTelegramStarsService } from '../services/telegram-stars.js';
import { createMockTelegramStarsAdapter } from '../services/telegram-stars-mock-adapter.js';
import { createTelegramStarsBotApiAdapter } from '../services/telegram-stars-bot-api.js';
import { createTelegramStarsRuntime } from '../services/telegram-stars-runtime.js';
import { createTelegramStarsWebhookRouter } from '../routes/telegram-stars.js';

const adapter = createTelegramStarsBotApiAdapter({ token: 'audit-fake-token',
  fetchImpl: async () => ({ ok: true, json: async () => ({ ok: true, result: { transactions: [] } }) }),
});
await assert.rejects(() => adapter.listCapturedPayments(), /transaction list is invalid/);
console.log('REPRO A1: official getStarTransactions envelope rejected');

const env = { NODE_ENV: 'production', PAYMENTS_MODE: 'telegram_stars_controlled',
  TELEGRAM_STARS_ALLOWLIST_USER_IDS: '123', TELEGRAM_STARS_ALLOWLIST_PRODUCT_IDS: 'premium',
  TELEGRAM_PAYMENTS_WEBHOOK_SECRET: 'audit_fake_secret',
  TELEGRAM_PAYMENTS_WEBHOOK_URL: 'https://example.invalid/webhook',
  TELEGRAM_PAYMENT_SUPPORT: 'https://example.invalid/support', TELEGRAM_PAYMENT_REFUND_CONTACT: 'https://example.invalid/support',
  TELEGRAM_BOT_TOKEN: 'audit-fake-token' };
const runtime = createTelegramStarsRuntime({ env });
env.PAYMENTS_MODE = 'disabled';
env.TELEGRAM_STARS_ALLOWLIST_USER_IDS = '999';
assert.equal(runtime.enabled, true);
assert.equal(runtime.isAllowlistedUser('123'), true);
assert.equal(createTelegramStarsRuntime({ env }).service, null);
console.log('REPRO A2: existing runtime ignores mode changes; disabled restart removes service');

const SQL = await initSqlJs();
const db = new SQL.Database();
db.run('PRAGMA foreign_keys=ON');
await runMigrations({ mode: 'sqlite', pool: null, sqlite: db, persistFn: null,
  migrationsDir: fileURLToPath(new URL('../migrations/sqlite', import.meta.url)) });
const tx = (cb) => withTransaction({ mode: 'sqlite', sqlite: db }, cb);
let now = Date.parse('2026-09-14T00:00:00Z');
await tx(t => t.run('INSERT INTO users (id,telegram_id,nickname,created_at,updated_at) VALUES (?,?,?,?,?)',
  ['tg_123', 123, 'audit', new Date(now).toISOString(), new Date(now).toISOString()]));
const svc = createTelegramStarsService({ enabled: true, adapter: createMockTelegramStarsAdapter(),
  mode: 'sqlite', withTransaction: tx, clock: () => new Date(now) });
const a = (await svc.createOrder({ userId: 'tg_123', productId: 'premium', amountXtr: 120, idempotencyKey: 'audit-order-a' })).order;
await svc.preCheckout({ telegramUserId: '123', updateId: 1, preCheckoutQueryId: 'audit-query-a', invoicePayload: a.invoice_payload, currency: 'XTR', totalAmount: 120 });
now += 16 * 60_000;
const b = (await svc.createOrder({ userId: 'tg_123', productId: 'premium', amountXtr: 120, idempotencyKey: 'audit-order-b' })).order;
await svc.preCheckout({ telegramUserId: '123', updateId: 2, preCheckoutQueryId: 'audit-query-b', invoicePayload: b.invoice_payload, currency: 'XTR', totalAmount: 120 });
const event = (order, id, charge) => ({ update_id: id, message: { from: { id: 123 }, successful_payment: {
  currency: 'XTR', total_amount: 120, invoice_payload: order.invoice_payload,
  telegram_payment_charge_id: charge, provider_payment_charge_id: '' } } });
const app = express();
app.use(express.json());
app.use('/', createTelegramStarsWebhookRouter({ service: svc, webhookSecret: 'audit_fake_secret' }));
const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
const post = body => fetch(`http://127.0.0.1:${server.address().port}/`, { method: 'POST',
  headers: { 'content-type': 'application/json', 'x-telegram-bot-api-secret-token': 'audit_fake_secret' }, body: JSON.stringify(body) });
try {
  assert.equal((await (await post(event(b, 3, 'audit-charge-b'))).json()).ok, true);
  const delayed = await post(event(a, 4, 'audit-charge-a'));
  assert.equal(delayed.status, 200);
  assert.equal((await delayed.json()).code, 'PRODUCT_ALREADY_OWNED');
  assert.equal((await tx(t => t.get('SELECT COUNT(*) AS n FROM telegram_stars_payments WHERE telegram_payment_charge_id=?', ['audit-charge-a']))).n, 0);
  assert.equal((await tx(t => t.get('SELECT COUNT(*) AS n FROM telegram_stars_events WHERE provider_update_id=?', ['4']))).n, 0);
  console.log('REPRO A3: delayed second capture ACK 200 with no durable charge/event record');
  const refund = await post({ update_id: 5, message: { refunded_payment: {
    currency: 'XTR', total_amount: 120, invoice_payload: b.invoice_payload, telegram_payment_charge_id: 'audit-charge-b' } } });
  assert.deepEqual(await refund.json(), { ok: true, ignored: true });
  assert.equal((await svc.getEntitlement({ orderId: b.id, userId: 'tg_123' })).status, 'active');
  console.log('REPRO A4: native refunded_payment ignored; entitlement remains active');
  let reservations = 0;
  let releaseReservations;
  const bothReserved = new Promise(resolve => { releaseReservations = resolve; });
  let refundCalls = 0;
  const refundSvc = createTelegramStarsService({ enabled: true, mode: 'sqlite',
    adapter: { ...createMockTelegramStarsAdapter(), async refundStarPayment(input) {
      refundCalls += 1;
      return { ...input, refundId: 'audit-refund-b' };
    } },
    withTransaction: async cb => {
      const result = await tx(cb);
      if (result?.status === 'requested') {
        reservations += 1;
        if (reservations === 2) releaseReservations();
        await bothReserved;
      }
      return result;
    },
  });
  const refundInput = { userId: 'tg_123', telegramPaymentChargeId: 'audit-charge-b', amountXtr: 120, idempotencyKey: 'audit-same-refund-key' };
  await Promise.allSettled([refundSvc.requestRefund(refundInput), refundSvc.requestRefund(refundInput)]);
  assert.equal(refundCalls, 2);
  console.log('REPRO A5: concurrent same-key refund requests call provider twice (no claim check)');
} finally {
  await new Promise(resolve => server.close(resolve));
  db.close();
}
