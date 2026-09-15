import test from 'node:test';
import assert from 'node:assert/strict';
import {
  logPaymentEvent,
  metricsSnapshot,
  paymentCorrelation,
  requestObservability,
} from '../observability.js';

async function captureLogs(callback) {
  const previous = console.log;
  const lines = [];
  console.log = (...args) => lines.push(args.join(' '));
  try { await callback(); } finally { console.log = previous; }
  return lines;
}

test('Stars event telemetry keeps only bounded correlations and safe fields', async () => {
  const before = metricsSnapshot();
  const secretCharge = 'secret-telegram-charge-id';
  const lines = await captureLogs(() => logPaymentEvent('entitlement_created', {
    outcome: 'active',
    correlationId: secretCharge,
    productId: 'col_premium-gallery',
    token: 'must-not-appear',
    webhookSecret: 'must-not-appear-either',
    payload: { user: 123 },
  }));
  const after = metricsSnapshot();
  assert.equal(after.starsEntitlementCreated, before.starsEntitlementCreated + 1);
  assert.equal(lines.length, 1);
  assert.match(lines[0], /telegram_stars_event/);
  assert.match(lines[0], new RegExp(paymentCorrelation(secretCharge)));
  assert.doesNotMatch(lines[0], /secret-telegram-charge-id|must-not-appear|webhookSecret|"user":123/);
});

test('Stars HTTP observability ignores a caller-controlled request id', async () => {
  const finishHandlers = [];
  const headers = {};
  const req = {
    headers: { 'x-request-id': 'payer-name-and-private-data' },
    originalUrl: '/payments/telegram-stars/orders',
    route: { path: '/orders' },
    path: '/orders',
    method: 'POST',
    userId: 'tg_123',
  };
  const res = {
    statusCode: 201,
    setHeader(name, value) { headers[name] = value; },
    on(event, callback) { if (event === 'finish') finishHandlers.push(callback); },
  };
  let nextCalled = false;
  const lines = await captureLogs(() => {
    requestObservability(req, res, () => { nextCalled = true; });
    finishHandlers.forEach((callback) => callback());
  });
  assert.equal(nextCalled, true);
  assert.match(headers['X-Request-Id'], /^[0-9a-f-]{36}$/);
  assert.notEqual(headers['X-Request-Id'], req.headers['x-request-id']);
  assert.doesNotMatch(lines.join('\n'), /payer-name-and-private-data|tg_123/);
});
