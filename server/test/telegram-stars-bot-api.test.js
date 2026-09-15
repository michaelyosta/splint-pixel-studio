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
    currency: 'XTR',
    prices: [{ label: 'Премиум-галерея', amount: 120 }],
  });
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
      return response({ transactions: [
        { id: 'charge-1', amount: 120, source: { type: 'user', user: { id: 123 }, invoice_payload: 'splint:xtr:v1:order-1', transaction_type: 'invoice_payment' } },
        { id: 'charge-1', amount: 120, receiver: { type: 'user', user: { id: 123 }, transaction_type: 'invoice_payment' } },
      ] });
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

function transaction(id, outgoing = false, overrides = {}) {
  return { id, amount: 120, date: 1,
    [outgoing ? 'receiver' : 'source']: { type: 'user', transaction_type: 'invoice_payment',
      user: { id: 123 }, invoice_payload: `invoice:${id}` }, ...overrides };
}

function transactionAdapter(pages) {
  const calls = [];
  const adapter = createTelegramStarsBotApiAdapter({ token: 'test-token',
    fetchImpl: async (_url, options) => {
      calls.push(JSON.parse(options.body));
      return response(pages[calls.length - 1]);
    } });
  return { adapter, calls };
}

test('documented empty transaction envelope returns an empty capture list', async () => {
  const { adapter, calls } = transactionAdapter([{ transactions: [] }]);
  assert.deepEqual(await adapter.listCapturedPayments(), []);
  assert.deepEqual(calls, [{ offset: 0, limit: 100 }]);
});

test('multiple pages deduplicate captures and refunds across page boundaries in either order', async () => {
  const first = Array.from({ length: 99 }, (_, i) => transaction(`charge-${i}`));
  first.push(transaction('later', true));
  const { adapter, calls } = transactionAdapter([{ transactions: first }, { transactions: [
    transaction('charge-0'), transaction('later', true), transaction('later'),
    transaction('charge-0', true), transaction('charge-0', true),
    { id: 'withdrawal', amount: 1, receiver: { type: 'fragment' } },
  ] }]);
  const captures = await adapter.listCapturedPayments();
  assert.deepEqual(calls, [{ offset: 0, limit: 100 }, { offset: 100, limit: 100 }]);
  assert.equal(captures.length, 100);
  for (const id of ['charge-0', 'later']) {
    assert.deepEqual(captures.find(c => c.telegramPaymentChargeId === id), {
      telegramPaymentChargeId: id, amountXtr: 120, refundedAmountXtr: 120,
      currency: 'XTR', invoicePayload: `invoice:${id}`, telegramUserId: '123',
    });
  }
});

test('malformed envelopes and transaction data fail closed', async () => {
  for (const page of [[], null, {}, { transactions: null }, { transactions: {} },
    { transactions: Array.from({ length: 101 }, () => transaction('a')) },
    ...[null, {}, transaction('a', false, { amount: '120' }),
      transaction('a', false, { amount: -120 }), transaction('a', false, { nanostar_amount: 1 }),
      transaction('a', false, { receiver: { type: 'user' } })].map(t => ({ transactions: [t] }))]) {
    await assert.rejects(transactionAdapter([page]).adapter.listCapturedPayments(), { code: 'PROVIDER_UNAVAILABLE' });
  }
});

test('conflicting duplicates and ambiguous refunds fail without a partial capture list', async () => {
  for (const rows of [
    [transaction('a'), transaction('a', false, { amount: 121 })],
    [transaction('a', true)],
    [transaction('a'), transaction('a', true, { amount: 60 })],
    [transaction('a'), transaction('a', true, { receiver: {
      type: 'user', transaction_type: 'invoice_payment', user: { id: 999 } } })],
    [transaction('a'), transaction('a', true, { receiver: {
      type: 'user', transaction_type: 'invoice_payment', user: { id: 123 }, invoice_payload: 'different' } })],
  ]) {
    await assert.rejects(transactionAdapter([{ transactions: rows }]).adapter.listCapturedPayments(), { code: 'PROVIDER_UNAVAILABLE' });
  }
});

test('pagination stops on repeated full pages and at a fixed scan bound', async () => {
  const page = { transactions: Array.from({ length: 100 }, (_, i) => transaction(`c-${i}`)) };
  const repeated = transactionAdapter([page, page]);
  await assert.rejects(repeated.adapter.listCapturedPayments(), /no progress/);
  assert.equal(repeated.calls.length, 2);
  const bounded = transactionAdapter(Array.from({ length: 100 }, (_, p) => ({
    transactions: Array.from({ length: 100 }, (_, i) => transaction(`${p}-${i}`)),
  })));
  await assert.rejects(bounded.adapter.listCapturedPayments(), /scan limit/);
  assert.equal(bounded.calls.length, 100);
});

test('refund success requires literal true; ambiguous results are not retried', async () => {
  for (const result of [false, null, undefined, {}, 'true', 1]) {
    let calls = 0;
    const adapter = createTelegramStarsBotApiAdapter({ token: 'test-token', fetchImpl: async () => {
      calls += 1;
      return response(result);
    } });
    await assert.rejects(adapter.refundStarPayment({ telegramUserId: 123,
      telegramPaymentChargeId: 'charge', amountXtr: 120, currency: 'XTR' }), { code: 'PROVIDER_UNAVAILABLE' });
    assert.equal(calls, 1);
  }
});

test('precheckout aborts below ten seconds even with a larger configured timeout', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let signal;
  const adapter = createTelegramStarsBotApiAdapter({ token: 'test-token', timeoutMs: 60_000,
    fetchImpl: async (_url, options) => {
      signal = options.signal;
      return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted'))));
    } });
  const pending = assert.rejects(adapter.answerPreCheckoutQuery({ queryId: 'q', ok: true }), { code: 'PROVIDER_UNAVAILABLE' });
  t.mock.timers.tick(4_999);
  assert.equal(signal.aborted, false);
  t.mock.timers.tick(1);
  assert.equal(signal.aborted, true);
  await pending;
});

test('refund transport and malformed JSON responses remain ambiguous failures without retry', async () => {
  for (const fetchResult of [
    async () => { throw new Error('transport lost'); },
    async () => ({ ok: true, json: async () => { throw new SyntaxError('bad JSON'); } }),
    async () => ({ ok: true, json: async () => ({ ok: 'true', result: true }) }),
  ]) {
    let calls = 0;
    const adapter = createTelegramStarsBotApiAdapter({ token: 'test-token', fetchImpl: async () => {
      calls += 1;
      return fetchResult();
    } });
    await assert.rejects(adapter.refundStarPayment({ telegramUserId: 123,
      telegramPaymentChargeId: 'charge', amountXtr: 120, currency: 'XTR' }), { code: 'PROVIDER_UNAVAILABLE' });
    assert.equal(calls, 1);
  }
});

test('transaction scan rejects results beyond its total time budget', async (t) => {
  let now = 0;
  t.mock.method(performance, 'now', () => now);
  const adapter = createTelegramStarsBotApiAdapter({ token: 'test-token', fetchImpl: async () => {
    now = 30_001;
    return response({ transactions: [] });
  } });
  await assert.rejects(adapter.listCapturedPayments(), /scan timed out/);
});
