import test from 'node:test';
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import initSqlJs from 'sql.js';
import { runMigrations } from '../database/migrations.js';
import { withTransaction } from '../database/transaction.js';
import { createTelegramStarsPurchaseGate } from '../services/telegram-stars-purchase-gate.js';
import { createTelegramStarsRuntime } from '../services/telegram-stars-runtime.js';

async function harness() {
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  await runMigrations({ mode: 'sqlite', sqlite: db, pool: null, persistFn: null,
    migrationsDir: join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations', 'sqlite') });
  const transaction = callback => withTransaction({ mode: 'sqlite', sqlite: db }, callback);
  const get = (sql, params = []) => transaction(tx => tx.get(sql, params));
  const make = () => createTelegramStarsPurchaseGate({
    dbGet: get, withTransaction: transaction,
    allowlistedUserIds: ['123'], allowlistedProductIds: ['col_premium-gallery'],
  });
  return { db, make, get, transaction };
}

test('gate defaults to controlled, public removes only user restriction, and disabled is immediate', async () => {
  const { db, make } = await harness();
  const firstRuntime = make();
  const secondRuntime = make();
  assert.equal((await firstRuntime.getAccess({ telegramUserId: 123, productId: 'col_premium-gallery' })).allowed, true);
  assert.equal((await firstRuntime.getAccess({ telegramUserId: 999, productId: 'col_premium-gallery' })).allowed, false);

  const controlled = await firstRuntime.getState();
  await firstRuntime.setState({ mode: 'public', expectedVersion: controlled.version, reason: 'test public activation', actor: 'test' });
  assert.throws(() => db.run("UPDATE telegram_stars_purchase_gate_audit SET reason='tampered'"), /append-only/);
  assert.throws(() => db.run('DELETE FROM telegram_stars_purchase_gate_audit'), /append-only/);
  assert.equal((await secondRuntime.getAccess({ telegramUserId: 999, productId: 'col_premium-gallery' })).clientMode, 'telegram_stars');
  assert.equal((await secondRuntime.getAccess({ telegramUserId: 999, productId: 'other' })).allowed, false);

  await secondRuntime.stop('test kill switch');
  assert.equal((await firstRuntime.getAccess({ telegramUserId: 123, productId: 'col_premium-gallery' })).allowed, false);
  assert.equal((await firstRuntime.getState()).mode, 'disabled');
  db.close();
});

test('gate fails closed without schema and rejects stale operator writes', async () => {
  const { db, make } = await harness();
  const gate = make();
  const current = await gate.getState();
  await gate.setState({ mode: 'controlled', expectedVersion: current.version, reason: 'first writer', actor: 'test' });
  await assert.rejects(
    () => gate.setState({ mode: 'public', expectedVersion: current.version, reason: 'stale writer', actor: 'test' }),
    /VERSION_CONFLICT/,
  );
  db.run('DROP TABLE telegram_stars_purchase_gate');
  assert.deepEqual(await gate.getState(), { mode: 'disabled', version: 0, failClosed: true });
  db.close();
});

test('critical reconciliation automatically disables new purchases', async () => {
  const { db, get, transaction } = await harness();
  const env = {
    NODE_ENV: 'production',
    PAYMENTS_MODE: 'telegram_stars_controlled',
    TELEGRAM_BOT_TOKEN: 'test-bot-token',
    TELEGRAM_PAYMENTS_WEBHOOK_URL: 'https://example.test/payments/telegram-stars/webhook',
    TELEGRAM_PAYMENTS_WEBHOOK_SECRET: 'test_secret',
    TELEGRAM_PAYMENT_SUPPORT: 'https://t.me/test_bot',
    TELEGRAM_PAYMENT_REFUND_CONTACT: 'https://t.me/test_bot',
    TELEGRAM_STARS_ALLOWLIST_USER_IDS: '123',
    TELEGRAM_STARS_ALLOWLIST_PRODUCT_IDS: 'col_premium-gallery',
  };
  const runtime = createTelegramStarsRuntime({
    env,
    dbMode: 'sqlite',
    dbGet: get,
    dbWithTransaction: transaction,
    fetchImpl: async (_url, options) => {
      const body = JSON.parse(options.body);
      assert.equal(body.offset, 0);
      return {
        ok: true,
        async json() {
          return {
            ok: true,
            result: {
              transactions: [{
                id: 'provider-only-charge',
                amount: 120,
                source: {
                  type: 'user',
                  transaction_type: 'invoice_payment',
                  user: { id: 123 },
                  invoice_payload: 'splint:xtr:v1:unknown-order',
                },
              }],
            },
          };
        },
      };
    },
  });
  const report = await runtime.reconcileAndProtect();
  assert.equal(report.issues.some((issue) => issue.severity === 'critical'), true);
  assert.equal((await runtime.purchaseGate.getState()).mode, 'disabled');
  db.close();
});
