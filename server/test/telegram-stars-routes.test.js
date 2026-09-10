import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createTelegramStarsCommerceRouter, createTelegramStarsWebhookRouter } from '../routes/telegram-stars.js';
import { createTelegramStarsRuntime } from '../services/telegram-stars-runtime.js';

async function withServer(app, callback) {
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  try {
    return await callback(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function authFor(telegramId) {
  return (req, _res, next) => {
    req.userId = `tg_${telegramId}`;
    req.authMode = 'telegram';
    req.user = { id: req.userId, telegram_id: telegramId, is_banned: 0 };
    next();
  };
}

test('controlled Bot API runtime is production-only', () => {
  const runtime = createTelegramStarsRuntime({
    env: { NODE_ENV: 'test', PAYMENTS_MODE: 'telegram_stars_controlled' },
  });
  assert.equal(runtime.enabled, false);
});

test('controlled production runtime rejects the Telegram test Bot API environment', () => {
  assert.throws(() => createTelegramStarsRuntime({
    env: {
      NODE_ENV: 'production',
      PAYMENTS_MODE: 'telegram_stars_controlled',
      TELEGRAM_BOT_TOKEN: 'test-token',
      TELEGRAM_BOT_API_ENVIRONMENT: 'test',
      TELEGRAM_PAYMENTS_WEBHOOK_URL: 'https://production.example.com/payments/telegram-stars/webhook',
      TELEGRAM_PAYMENTS_WEBHOOK_SECRET: 'production_webhook_secret',
      TELEGRAM_PAYMENT_SUPPORT: '@support',
      TELEGRAM_PAYMENT_REFUND_CONTACT: '@refunds',
      TELEGRAM_STARS_ALLOWLIST_USER_IDS: '123',
      TELEGRAM_STARS_ALLOWLIST_PRODUCT_IDS: 'col_premium-gallery',
    },
  }), /must use TELEGRAM_BOT_API_ENVIRONMENT=production/);
});

test('controlled Bot API runtime enables only an explicit staging test environment', async () => {
  const calls = [];
  const runtime = createTelegramStarsRuntime({
    env: {
      NODE_ENV: 'staging',
      PAYMENTS_MODE: 'telegram_stars_controlled',
      TELEGRAM_BOT_TOKEN: 'test-token',
      TELEGRAM_BOT_API_ENVIRONMENT: 'test',
      TELEGRAM_PAYMENTS_WEBHOOK_URL: 'https://staging.example.com/payments/telegram-stars/webhook',
      TELEGRAM_PAYMENTS_WEBHOOK_SECRET: 'test_webhook_secret',
      TELEGRAM_PAYMENT_SUPPORT: '@test_support',
      TELEGRAM_PAYMENT_REFUND_CONTACT: '@test_refunds',
      TELEGRAM_STARS_ALLOWLIST_USER_IDS: '123',
      TELEGRAM_STARS_ALLOWLIST_PRODUCT_IDS: 'col_premium-gallery',
    },
    fetchImpl: async (url, options) => {
      calls.push({ url, body: JSON.parse(options.body) });
      return { ok: true, status: 200, json: async () => ({ ok: true, result: true }) };
    },
  });
  assert.equal(runtime.enabled, true);
  assert.equal(runtime.config.botApiEnvironment, 'test');
  await runtime.adapter.answerPreCheckoutQuery({ queryId: 'query-test-1', ok: true });
  assert.equal(calls[0].url, 'https://api.telegram.org/bottest-token/test/answerPreCheckoutQuery');
});

test('controlled commerce route exposes checkout only to the Telegram allowlist and ignores client price', async () => {
  const calls = [];
  const runtime = {
    enabled: true,
    mode: 'telegram_stars_controlled',
    config: { allowlistedProductIds: ['col_premium-gallery'] },
    isAllowlistedUser: (id) => String(id) === '123',
    isAllowlistedProduct: (id) => id === 'col_premium-gallery',
    service: {
      createOrder: async (input) => { calls.push(input); return { success: true, order: { id: 'xtr_order_1', invoice_url: 'https://t.me/$invoice' } }; },
      getOrder: async () => ({ id: 'xtr_order_1', status: 'paid' }),
      openSupportCase: async () => ({ case: { id: 'case-1' } }),
    },
  };
  const app = express();
  app.use(express.json());
  app.use('/payments/telegram-stars', createTelegramStarsCommerceRouter({ runtime, auth: authFor(123) }));
  await withServer(app, async (base) => {
    const config = await fetch(`${base}/payments/telegram-stars/config`);
    assert.deepEqual(await config.json(), { mode: 'telegram_stars_controlled', product_ids: ['col_premium-gallery'] });
    const order = await fetch(`${base}/payments/telegram-stars/orders`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': 'route-order-1' },
      body: JSON.stringify({ product_id: 'col_premium-gallery', amount_xtr: 1, price_in_stars: 1 }),
    });
    assert.equal(order.status, 201);
    assert.deepEqual(calls[0], { userId: 'tg_123', telegramUserId: 123, productId: 'col_premium-gallery', idempotencyKey: 'route-order-1' });
  });
});

test('non-allowlisted commerce route is fail-closed and webhook dispatches real update shapes', async () => {
  const seen = [];
  const runtime = {
    enabled: true,
    mode: 'telegram_stars_controlled',
    config: { allowlistedProductIds: ['col_premium-gallery'] },
    isAllowlistedUser: (id) => String(id) === '123',
    isAllowlistedProduct: () => true,
    service: {
      preCheckout: async (input) => { seen.push(['pre', input]); return { ok: true, code: 'PRE_CHECKOUT_APPROVED' }; },
      successfulPayment: async (input) => { seen.push(['success', input]); return { ok: true, entitlementId: 'ent-1' }; },
    },
  };
  const app = express();
  app.use(express.json());
  app.use('/payments/telegram-stars', createTelegramStarsCommerceRouter({ runtime, auth: authFor(999) }));
  app.use('/payments/telegram-stars/webhook', createTelegramStarsWebhookRouter({ service: runtime.service, webhookSecret: 'webhook_secret' }));
  await withServer(app, async (base) => {
    const config = await fetch(`${base}/payments/telegram-stars/config`);
    assert.deepEqual(await config.json(), { mode: 'disabled', product_ids: [] });
    const denied = await fetch(`${base}/payments/telegram-stars/orders`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ product_id: 'col_premium-gallery' }),
    });
    assert.equal(denied.status, 403);
    const badSecret = await fetch(`${base}/payments/telegram-stars/webhook`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-telegram-bot-api-secret-token': 'wrong' }, body: '{}',
    });
    assert.equal(badSecret.status, 401);
    const ignored = await fetch(`${base}/payments/telegram-stars/webhook`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-telegram-bot-api-secret-token': 'webhook_secret' }, body: JSON.stringify({ update_id: 1, message: { text: 'hello' } }),
    });
    assert.deepEqual(await ignored.json(), { ok: true, ignored: true });
    const pre = await fetch(`${base}/payments/telegram-stars/webhook`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-telegram-bot-api-secret-token': 'webhook_secret' },
      body: JSON.stringify({ update_id: 2, pre_checkout_query: { id: 'query-1', from: { id: 123 }, invoice_payload: 'splint:xtr:v1:order-1', currency: 'XTR', total_amount: 120 } }),
    });
    assert.equal(pre.status, 200);
    const success = await fetch(`${base}/payments/telegram-stars/webhook`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-telegram-bot-api-secret-token': 'webhook_secret' },
      body: JSON.stringify({ update_id: 3, message: { from: { id: 123 }, successful_payment: { invoice_payload: 'splint:xtr:v1:order-1', currency: 'XTR', total_amount: 120, telegram_payment_charge_id: 'charge-1' } } }),
    });
    assert.equal(success.status, 200);
    assert.equal(seen[0][1].telegramUserId, '123');
    assert.equal(seen[1][1].telegramPaymentChargeId, 'charge-1');
  });
});
