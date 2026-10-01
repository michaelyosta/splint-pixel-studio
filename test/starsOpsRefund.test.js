import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
function source(relativePath) {
  return readFileSync(resolve(repoRoot, relativePath), 'utf8');
}

test('operator refund surfaces behind the allowlisted ops panel only', () => {
  const api = source('src/api/client.js');
  assert.match(api, /payments: \(\) => request\('\/payments\/telegram-stars\/ops\/payments'\)/);
  assert.match(api, /refund: \(orderId\) => request\('\/payments\/telegram-stars\/ops\/refund'/);
  const profile = source('src/views/ProfileView.jsx');
  assert.match(profile, /ВОЗВРАТЫ/);
  assert.match(profile, /Подтвердить возврат/);
  assert.match(profile, /pendingRefundOrderId/);
  assert.match(profile, /payments=\{starsOpsPayments\} onRefund=\{onStarsOpsRefund\}/);
  const app = source('src/App.jsx');
  assert.match(app, /telegramStarsOpsApi\.payments\(\)/);
  assert.match(app, /telegramStarsOpsApi\.refund\(orderId\)/);
  assert.match(app, /starsOpsPayments=\{starsOpsPayments\}/);
  const routes = readFileSync(resolve(repoRoot, 'server/routes/telegram-stars.js'), 'utf8');
  assert.match(routes, /router\.get\('\/ops\/payments'/);
  assert.match(routes, /router\.post\('\/ops\/refund'/);
  assert.match(routes, /getPaymentByOrder/);
  assert.match(routes, /requestRefund/);
  const service = readFileSync(resolve(repoRoot, 'server/services/telegram-stars.js'), 'utf8');
  assert.match(service, /listOperatorPayments/);
});