import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runMigrations } from '../database/migrations.js';
import { createFreshSqliteDbAsync } from './helpers/database.js';

const serverDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const sqliteMigrationsDir = join(serverDir, 'migrations', 'sqlite');

function migrationVersion(filename) {
  return filename.slice(0, 3);
}

test('migration 033 backfills issued orders before installing the immutable guard', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'splint-033-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  for (const filename of readdirSync(sqliteMigrationsDir)) {
    if (filename.endsWith('.sql') && migrationVersion(filename) <= '032') {
      copyFileSync(join(sqliteMigrationsDir, filename), join(dir, filename));
    }
  }

  const db = await createFreshSqliteDbAsync();
  await runMigrations({ mode: 'sqlite', sqlite: db, migrationsDir: dir });

  const now = new Date().toISOString();
  db.run('INSERT INTO users (id,nickname,created_at,updated_at) VALUES (?,?,?,?)', ['tg_1', 'User', now, now]);
  db.run(
    "INSERT INTO collections (id,title,pack_type,price_in_stars) VALUES ('col_premium-gallery','Premium','premium',120)",
  );
  db.run(
    `INSERT INTO telegram_stars_orders
      (id,user_id,product_id,currency,amount_xtr,idempotency_key,request_fingerprint,invoice_payload,status,created_at,updated_at)
     VALUES ('order_1','tg_1','col_premium-gallery','XTR',120,'idem-1','fp-1','payload-1','invoice_issued',?,?)`,
    [now, now],
  );

  // The original migration installed the extended identity guard before the
  // price backfill, so it aborted on any database that already had orders.
  copyFileSync(join(sqliteMigrationsDir, '033_admin_merchandising.sql'), join(dir, '033_admin_merchandising.sql'));
  await runMigrations({ mode: 'sqlite', sqlite: db, migrationsDir: dir });

  const order = db.prepare("SELECT price_xtr, price_version, invoice_created_at FROM telegram_stars_orders WHERE id='order_1'");
  assert.ok(order.step(), 'existing order must survive migration 033');
  const row = order.getAsObject();
  order.free();
  assert.equal(row.price_xtr, 120);
  assert.equal(row.price_version, 1);
  assert.equal(row.invoice_created_at, now);

  const price = db.prepare("SELECT price_xtr FROM catalog_product_prices WHERE product_id='col_premium-gallery'");
  assert.ok(price.step(), 'product price snapshot must be recorded');
  assert.equal(price.getAsObject().price_xtr, 120);
  price.free();

  assert.throws(
    () => db.run("UPDATE telegram_stars_orders SET price_xtr = 999 WHERE id='order_1'"),
    /identity is immutable/,
    'the installed guard must still protect the price snapshot',
  );
});
