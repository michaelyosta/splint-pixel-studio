import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createTelegramStarsCommerceRouter, createTelegramStarsWebhookRouter, isTelegramWebhookSecret } from '../routes/telegram-stars.js';
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

test('private paysupport persists a bounded case and returns a Telegram reply without granting access', async () => {
  const calls = [];
  const app = express();
  app.use(express.json());
  app.use('/webhook', createTelegramStarsWebhookRouter({ webhookSecret: 'test-secret', service: {
    openSupportCase: async input => { calls.push(input); return { case: { id: 'case-test' } }; },
  } }));
  await withServer(app, async base => {
    const update = { update_id: 42, message: { from: { id: 123 }, chat: { id: 123, type: 'private' }, text: '/paysupport Не открывается покупка' } };
    const post = body => fetch(`${base}/webhook`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-telegram-bot-api-secret-token': 'test-secret' }, body: JSON.stringify(body) });
    const response = await (await post(update)).json();
    assert.equal(response.method, 'sendMessage');
    assert.equal(response.chat_id, 123);
    assert.match(response.text, /case-test/);
    assert.equal(calls[0].idempotencyKey, 'telegram-support:42');
    assert.equal(calls[0].telegramUserId, '123');
    assert.equal(calls[0].message, 'Не открывается покупка');
    await post({ ...update, message: { ...update.message, text: '/paysupport' } });
    await post({ ...update, message: { ...update.message, chat: { id: -1, type: 'group' } } });
    assert.equal(calls.length, 1);
  });
});

test('break-glass gate endpoint allows only the existing Telegram operator and never public mode', async () => {
  const states = [{ mode: 'public', version: 4, failClosed: false }];
  const runtime = {
    enabled: true,
    isAllowlistedUser: id => String(id) === '123',
    purchaseGate: {
      getState: async () => states[0],
      setState: async input => { states[0] = { ...states[0], ...input, version: states[0].version + 1 }; return states[0]; },
    },
    assertPublicActivationReady: async () => ({ productId: 'col_premium-gallery', amountXtr: 120 }),
  };
  const app = express();
  app.use(express.json());
  app.use('/payments/telegram-stars', createTelegramStarsCommerceRouter({ runtime, auth: authFor(999) }));
  await withServer(app, async base => {
    const headers = { 'content-type': 'application/json' };
    const status = await fetch(`${base}/payments/telegram-stars/ops/gate`);
    assert.equal(status.status, 403);
    const forbidden = await fetch(`${base}/payments/telegram-stars/ops/gate`, { method: 'POST', headers, body: JSON.stringify({ mode: 'disabled' }) });
    assert.equal(forbidden.status, 403);
  });
  const app2 = express();
  app2.use(express.json());
  app2.use('/payments/telegram-stars', createTelegramStarsCommerceRouter({ runtime, auth: authFor(123) }));
  // Rebind a Telegram operator auth with the same allowlisted identity.
  await withServer(app2, async base => {
    const status = await fetch(`${base}/payments/telegram-stars/ops/gate`);
    assert.equal(status.status, 200);
    assert.equal((await status.json()).mode, 'public');
    const response = await fetch(`${base}/payments/telegram-stars/ops/gate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode: 'disabled', reason: 'canary_drill' }) });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).mode, 'disabled');
    const publicMode = await fetch(`${base}/payments/telegram-stars/ops/gate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode: 'public', reason: 'must_reject' }) });
    assert.equal(publicMode.status, 400);
    const publicActivation = await fetch(`${base}/payments/telegram-stars/ops/gate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode: 'public', confirm_public: 'TELEGRAM_STARS_PUBLIC', reason: 'launch' }) });
    assert.equal(publicActivation.status, 200);
  });
});

test('controlled Bot API runtime is production-only', () => {
  const runtime = createTelegramStarsRuntime({
    env: { NODE_ENV: 'test', PAYMENTS_MODE: 'telegram_stars_controlled' },
  });
  assert.equal(runtime.enabled, false);
});

test('controlled commerce route exposes checkout only to the Telegram allowlist and ignores client price', async () => {
  const calls = [];
  const runtime = {
    enabled: true,
    mode: 'telegram_stars_controlled',
    config: { allowlistedProductIds: ['col_premium-gallery'] },
    isAllowlistedUser: (id) => String(id) === '123',
    isAllowlistedProduct: (id) => id === 'col_premium-gallery',
    getPurchaseConfig: async () => ({ mode: 'telegram_stars_controlled', product_ids: ['col_premium-gallery'], gate_version: 1 }),
    isPurchaseAllowed: async (id, productId) => String(id) === '123' && productId === 'col_premium-gallery',
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
    assert.deepEqual(await config.json(), { mode: 'telegram_stars_controlled', product_ids: ['col_premium-gallery'], gate_version: 1 });
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
    getPurchaseConfig: async () => ({ mode: 'disabled', product_ids: [], gate_version: 1 }),
    isPurchaseAllowed: async () => false,
    service: {
      preCheckout: async (input) => { seen.push(['pre', input]); return { ok: true, code: 'PRE_CHECKOUT_APPROVED' }; },
      successfulPayment: async (input) => { seen.push(['success', input]); return { ok: true, entitlementId: 'ent-1' }; },
      recordRefund: async (input) => { seen.push(['refund', input]); return { ok: true, status: 'refunded', orderId: 'order-1' }; },
    },
  };
  const app = express();
  app.use(express.json());
  app.use('/payments/telegram-stars', createTelegramStarsCommerceRouter({ runtime, auth: authFor(999) }));
  app.use('/payments/telegram-stars/webhook', createTelegramStarsWebhookRouter({ service: runtime.service, webhookSecret: 'webhook_secret' }));
  await withServer(app, async (base) => {
    const config = await fetch(`${base}/payments/telegram-stars/config`);
    assert.deepEqual(await config.json(), { mode: 'disabled', product_ids: [], gate_version: 1 });
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
    const refund = await fetch(`${base}/payments/telegram-stars/webhook`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-telegram-bot-api-secret-token': 'webhook_secret' },
      body: JSON.stringify({ update_id: 4, message: { refunded_payment: { invoice_payload: 'splint:xtr:v1:order-1', currency: 'XTR', total_amount: 120, telegram_payment_charge_id: 'charge-1' } } }),
    });
    assert.equal(refund.status, 200);
    assert.equal(seen[0][1].telegramUserId, '123');
    assert.equal(seen[1][1].telegramPaymentChargeId, 'charge-1');
    assert.equal(seen[2][1].refundId, 'telegram_refund:charge-1');
  });
});

test('webhook secret comparison is exact and fail-closed', () => {
  assert.equal(isTelegramWebhookSecret('provider_secret', 'provider_secret'), true);
  assert.equal(isTelegramWebhookSecret('provider_secret_x', 'provider_secret'), false);
  assert.equal(isTelegramWebhookSecret('', 'provider_secret'), false);
  assert.equal(isTelegramWebhookSecret(undefined, 'provider_secret'), false);
});

test('public gate exposes only the configured product to any authenticated Telegram user', async () => {
  const calls = [];
  const runtime = {
    enabled: true,
    mode: 'telegram_stars_controlled',
    config: { allowlistedProductIds: ['col_premium-gallery'] },
    isAllowlistedProduct: (id) => id === 'col_premium-gallery',
    getPurchaseConfig: async () => ({ mode: 'telegram_stars', product_ids: ['col_premium-gallery'], gate_version: 2 }),
    isPurchaseAllowed: async (id, productId) => String(id) === '999' && productId === 'col_premium-gallery',
    service: {
      createOrder: async (input) => { calls.push(input); return { order: { id: 'public-order', invoice_url: 'https://t.me/$public' } }; },
      getOrder: async () => null,
      openSupportCase: async () => null,
    },
  };
  const app = express();
  app.use(express.json());
  app.use('/payments/telegram-stars', createTelegramStarsCommerceRouter({ runtime, auth: authFor(999) }));
  await withServer(app, async (base) => {
    const config = await fetch(`${base}/payments/telegram-stars/config`);
    assert.deepEqual(await config.json(), { mode: 'telegram_stars', product_ids: ['col_premium-gallery'], gate_version: 2 });
    const allowed = await fetch(`${base}/payments/telegram-stars/orders`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': 'public-order-key' },
      body: JSON.stringify({ product_id: 'col_premium-gallery' }),
    });
    assert.equal(allowed.status, 201);
    const denied = await fetch(`${base}/payments/telegram-stars/orders`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': 'other-order-key' },
      body: JSON.stringify({ product_id: 'other' }),
    });
    assert.equal(denied.status, 404);
    assert.equal(calls.length, 1);
  });
});
