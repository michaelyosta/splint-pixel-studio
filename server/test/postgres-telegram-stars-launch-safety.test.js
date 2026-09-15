import test from 'node:test';
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const databaseUrl = process.env.DATABASE_URL;
const skip = !databaseUrl;
const serverDir = join(dirname(fileURLToPath(import.meta.url)), '..');

if (!databaseUrl) test('PostgreSQL Telegram Stars launch safety tests skipped (no DATABASE_URL)', { skip: true }, () => {});

async function isolatedDatabase(t) {
  const schema = `xtr_launch_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  const pg = (await import('pg')).default;
  const admin = new pg.Pool({ connectionString: databaseUrl });
  await admin.query(`CREATE SCHEMA "${schema}"`);
  const pool = new pg.Pool({ connectionString: databaseUrl, options: `-c search_path="${schema}",public` });
  const { runMigrations } = await import('../database/migrations.js');
  await runMigrations({ mode: 'postgres', pool, sqlite: null, persistFn: null, migrationsDir: join(serverDir, 'migrations') });
  t.after(async () => {
    await pool.end();
    await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin.end();
  });
  return pool;
}

async function transactionFor(pool) {
  const { withTransaction } = await import('../database/transaction.js');
  return (callback) => withTransaction({ mode: 'postgres', pool }, callback);
}

test('PG launch gate has one CAS winner and stops across runtime instances', { skip }, async (t) => {
  const pool = await isolatedDatabase(t);
  const transaction = await transactionFor(pool);
  const dbGet = (sql, params = []) => transaction((tx) => tx.get(sql, params));
  const { createTelegramStarsPurchaseGate } = await import('../services/telegram-stars-purchase-gate.js');
  const makeGate = () => createTelegramStarsPurchaseGate({
    dbGet, withTransaction: transaction, dbMode: 'postgres',
    allowlistedUserIds: ['123'], allowlistedProductIds: ['col_premium-gallery'],
  });
  const first = makeGate();
  const second = makeGate();
  const state = await first.getState();
  const contenders = await Promise.allSettled([
    first.setState({ mode: 'public', expectedVersion: state.version, reason: 'postgres race one', actor: 'test' }),
    second.setState({ mode: 'public', expectedVersion: state.version, reason: 'postgres race two', actor: 'test' }),
  ]);
  assert.equal(contenders.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(contenders.filter((result) => result.status === 'rejected').length, 1);
  assert.equal((await second.getAccess({ telegramUserId: '999', productId: 'col_premium-gallery' })).allowed, true);
  await first.stop('postgres kill-switch drill');
  assert.equal((await second.getState()).mode, 'disabled');
});

test('PG same-key refund race calls the provider exactly once', { skip }, async (t) => {
  const pool = await isolatedDatabase(t);
  const transaction = await transactionFor(pool);
  const now = new Date().toISOString();
  await pool.query(
    `INSERT INTO users (id,telegram_id,nickname,stars_balance,role,created_at,updated_at)
     VALUES ($1,$2,$3,0,'user',$4,$4)`,
    ['tg_123', 123, 'payment-user', now],
  );
  const { createTelegramStarsService } = await import('../services/telegram-stars.js');
  let providerCalls = 0;
  const adapter = {
    providerName: 'telegram_stars_mock',
    supportsPartialRefund: false,
    async createInvoice() { return { invoiceUrl: 'https://t.me/$postgres-launch' }; },
    async refundStarPayment({ telegramPaymentChargeId, amountXtr }) {
      providerCalls += 1;
      await new Promise((resolve) => setTimeout(resolve, 20));
      return { refundId: `pg-refund:${telegramPaymentChargeId}`, telegramPaymentChargeId, amountXtr };
    },
    async listCapturedPayments() { return []; },
  };
  const service = createTelegramStarsService({
    enabled: true, adapter, mode: 'postgres', withTransaction: transaction,
    priceResolver: () => 120,
  });
  const created = await service.createOrder({ userId: 'tg_123', productId: 'col_premium-gallery', idempotencyKey: 'pg-launch-order' });
  await service.successfulPayment({ userId: 'tg_123', invoicePayload: created.order.invoice_payload, currency: 'XTR', totalAmount: 120, telegramPaymentChargeId: 'pg-launch-charge' });
  const results = await Promise.allSettled([
    service.requestRefund({ userId: 'tg_123', telegramPaymentChargeId: 'pg-launch-charge', amountXtr: 120, idempotencyKey: 'pg-launch-refund' }),
    service.requestRefund({ userId: 'tg_123', telegramPaymentChargeId: 'pg-launch-charge', amountXtr: 120, idempotencyKey: 'pg-launch-refund' }),
  ]);
  assert.equal(providerCalls, 1);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(results.filter((result) => result.status === 'rejected').length, 1);
  const rows = await pool.query("SELECT status FROM telegram_stars_entitlements WHERE product_id='col_premium-gallery'");
  assert.deepEqual(rows.rows.map((row) => row.status), ['revoked']);
});
