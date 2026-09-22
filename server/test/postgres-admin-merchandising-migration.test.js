import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const databaseUrl = process.env.DATABASE_URL;
const serverDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const migrationsDir = join(serverDir, 'migrations');

function migrationSql(filename) {
  return readFileSync(join(migrationsDir, filename), 'utf8')
    .replace(/^\s*BEGIN\s*;\s*/i, '')
    .replace(/\s*COMMIT\s*;?\s*$/i, '');
}

test('PostgreSQL migration 033 backfills issued orders before installing the guard', { skip: !databaseUrl }, async (t) => {
  const pg = (await import('pg')).default;
  const schema = `admin_merch_rehearsal_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  const adminPool = new pg.Pool({ connectionString: databaseUrl });
  await adminPool.query(`CREATE SCHEMA "${schema}"`);
  const pool = new pg.Pool({
    connectionString: databaseUrl,
    options: `-c search_path="${schema}",public`,
  });

  t.after(async () => {
    await pool.end();
    await adminPool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await adminPool.end();
  });

  const preAdminMigrations = readdirSync(migrationsDir)
    .filter((filename) => /^\d+_.+\.sql$/.test(filename) && Number(filename.slice(0, 3)) <= 32)
    .sort();
  for (const filename of preAdminMigrations) {
    await pool.query(migrationSql(filename));
  }

  const now = new Date().toISOString();
  await pool.query('INSERT INTO users (id,nickname,created_at,updated_at) VALUES ($1,$2,$3,$3)', ['tg_1', 'User', now]);
  await pool.query(
    "INSERT INTO collections (id,title,pack_type,price_in_stars) VALUES ('col_premium-gallery','Premium','premium',120)",
  );
  await pool.query(
    `INSERT INTO telegram_stars_orders
      (id,user_id,product_id,currency,amount_xtr,idempotency_key,request_fingerprint,invoice_payload,status,created_at,updated_at)
     VALUES ('order_1','tg_1','col_premium-gallery','XTR',120,'idem-1','fp-1','payload-1','invoice_issued',$1,$1)`,
    [now],
  );

  // The original migration installed the extended identity guard before the
  // price backfill, so it aborted on any database that already had orders.
  await pool.query(migrationSql('033_admin_merchandising.sql'));

  const order = await pool.query("SELECT price_xtr, price_version, invoice_created_at, created_at FROM telegram_stars_orders WHERE id='order_1'");
  assert.equal(order.rows.length, 1, 'existing order must survive migration 033');
  assert.equal(Number(order.rows[0].price_xtr), 120);
  assert.equal(Number(order.rows[0].price_version), 1);
  assert.equal(
    new Date(order.rows[0].invoice_created_at).getTime(),
    new Date(order.rows[0].created_at).getTime(),
    'invoice_created_at must be backfilled from the durable created_at',
  );

  const price = await pool.query("SELECT price_xtr FROM catalog_product_prices WHERE product_id='col_premium-gallery'");
  assert.equal(Number(price.rows[0].price_xtr), 120);

  await assert.rejects(
    pool.query("UPDATE telegram_stars_orders SET price_xtr = 999 WHERE id='order_1'"),
    /identity is immutable/,
  );
});
