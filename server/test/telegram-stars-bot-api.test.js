import test from 'node:test';
import assert from 'node:assert/strict';
import { TelegramStarsError } from '../services/telegram-stars.js';
import { createTelegramStarsBotApiAdapter } from '../services/telegram-stars-bot-api.js';

function response(result, ok = true, status = 200) {
  return { ok, status, json: async () => ({ ok, result }) };
}

test('Bot API adapter creates XTR invoice links with one server-priced item', async () => {
  const calls = [];
  const adapter = createTelegramStarsBotApiAdapter({
    token: 'test-token-123',
    apiBase: 'https://telegram.example.test',
    fetchImpl: async (url, options) => {
      calls.push({ url, options, body: JSON.parse(options.body) });
      return response('https://t.me/$test_invoice');
    },
  });

  const invoice = await adapter.createInvoice({
    invoicePayload: 'splint:xtr:v1:order-1',
    productId: 'col_premium-gallery',
    title: 'Премиум-галерея',
    description: 'Доступ к премиум-галерее',
    currency: 'XTR',
    amountXtr: 120,
  });
  assert.equal(invoice.invoiceUrl, 'https://t.me/$test_invoice');
  assert.equal(calls[0].url, 'https://telegram.example.test/bottest-token-123/createInvoiceLink');
  assert.deepEqual(calls[0].body, {
    title: 'Премиум-галерея',
    description: 'Доступ к премиум-галерее',
    payload: 'splint:xtr:v1:order-1',
    provider_token: '',
    currency: 'XTR',
    prices: [{ label: 'Премиум-галерея', amount: 120 }],
  });
});

test('Bot API adapter routes the isolated Telegram test environment under /test', async () => {
  const calls = [];
  const adapter = createTelegramStarsBotApiAdapter({
    token: 'test-token-environment',
    apiEnvironment: 'test',
    fetchImpl: async (url, options) => {
      calls.push({ url, body: JSON.parse(options.body) });
      return response(true);
    },
  });

  await adapter.answerPreCheckoutQuery({ queryId: 'query-test-1', ok: true });
  assert.equal(calls[0].url, 'https://api.telegram.org/bottest-token-environment/test/answerPreCheckoutQuery');
});

test('Bot API adapter answers pre-checkout and performs only full refunds', async () => {
  const calls = [];
  const adapter = createTelegramStarsBotApiAdapter({
    token: 'test-token-456',
    apiBase: 'https://telegram.example.test',
    fetchImpl: async (url, options) => {
      calls.push({ url, body: JSON.parse(options.body) });
      return response(true);
    },
  });

  assert.deepEqual(await adapter.answerPreCheckoutQuery({ queryId: 'query-1', ok: true }), { ok: true });
  const refund = await adapter.refundStarPayment({
    telegramUserId: '123456',
    telegramPaymentChargeId: 'charge-1',
    amountXtr: 120,
    currency: 'XTR',
  });
  assert.equal(adapter.supportsPartialRefund, false);
  assert.deepEqual(refund, {
    refundId: 'telegram_refund:charge-1',
    telegramPaymentChargeId: 'charge-1',
    amountXtr: 120,
  });
  assert.deepEqual(calls[0].body, { pre_checkout_query_id: 'query-1', ok: true });
  assert.deepEqual(calls[1].body, { user_id: 123456, telegram_payment_charge_id: 'charge-1' });
});

test('Bot API adapter aggregates capture/refund transactions by Telegram charge id', async () => {
  let requestCount = 0;
  const adapter = createTelegramStarsBotApiAdapter({
    token: 'test-token-789',
    apiBase: 'https://telegram.example.test',
    fetchImpl: async (_url, options) => {
      requestCount += 1;
      const body = JSON.parse(options.body);
      assert.equal(body.offset, 0);
      assert.equal(body.limit, 100);
      return response([
        { id: 'charge-1', amount: 120, source: { type: 'user', user: { id: 123 }, invoice_payload: 'splint:xtr:v1:order-1', transaction_type: 'invoice_payment' } },
        { id: 'charge-1', amount: -120, source: { type: 'user', user: { id: 123 }, transaction_type: 'refund' } },
      ]);
    },
  });
  const captures = await adapter.listCapturedPayments();
  assert.equal(requestCount, 1);
  assert.deepEqual(captures, [{
    telegramPaymentChargeId: 'charge-1',
    amountXtr: 120,
    refundedAmountXtr: 120,
    currency: 'XTR',
    invoicePayload: 'splint:xtr:v1:order-1',
    telegramUserId: '123',
  }]);
});

test('Bot API adapter registers only the payment webhook update types', async () => {
  const calls = [];
  const adapter = createTelegramStarsBotApiAdapter({
    token: 'test-token-webhook',
    apiBase: 'https://telegram.example.test',
    fetchImpl: async (url, options) => {
      calls.push({ url, body: JSON.parse(options.body) });
      return response(true);
    },
  });

  assert.deepEqual(await adapter.setWebhook({ url: 'https://api.example.test/payments/telegram-stars/webhook', secretToken: 'secret_123' }), { ok: true });
  assert.deepEqual(calls[0], {
    url: 'https://telegram.example.test/bottest-token-webhook/setWebhook',
    body: {
      url: 'https://api.example.test/payments/telegram-stars/webhook',
      secret_token: 'secret_123',
      allowed_updates: ['pre_checkout_query', 'message'],
    },
  });
});

test('Bot API failures are normalized without exposing the bot token', async () => {
  const adapter = createTelegramStarsBotApiAdapter({
    token: 'super-secret-token',
    fetchImpl: async () => response({ description: 'secret response' }, false, 500),
  });
  await assert.rejects(
    () => adapter.answerPreCheckoutQuery({ queryId: 'query-1', ok: true }),
    (error) => error instanceof TelegramStarsError
      && error.code === 'PROVIDER_UNAVAILABLE'
      && !error.message.includes('super-secret-token'),
  );
});
