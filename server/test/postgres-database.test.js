import test from 'node:test';
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  test('PostgreSQL tests skipped (no DATABASE_URL)', { skip: true }, () => {});
}

const serverDir = join(dirname(fileURLToPath(import.meta.url)), '..');

// ── PostgreSQL tests ────────────────────────────────────────────────

test('PostgreSQL withTransaction commit saves all operations', { skip: !databaseUrl }, async (t) => {
  const pg = await import('pg');
  const { withTransaction } = await import('../database/transaction.js');
  const pool = new pg.Pool({ connectionString: databaseUrl });
  const tableName = `test_tx_commit_${Date.now()}`;

  t.after(async () => {
    await pool.query(`DROP TABLE IF EXISTS ${tableName}`);
    await pool.end();
  });

  await pool.query(`CREATE TABLE IF NOT EXISTS ${tableName} (id SERIAL PRIMARY KEY, value TEXT)`);

  await withTransaction({ mode: 'postgres', pool }, async (tx) => {
    await tx.run(`INSERT INTO ${tableName} (value) VALUES ($1)`, ['one']);
    await tx.run(`INSERT INTO ${tableName} (value) VALUES ($1)`, ['two']);
  });

  const result = await pool.query(`SELECT COUNT(*) as cnt FROM ${tableName}`);
  assert.equal(parseInt(result.rows[0].cnt, 10), 2, 'Both inserts committed');
});

test('PostgreSQL withTransaction rollback on error', { skip: !databaseUrl }, async (t) => {
  const pg = await import('pg');
  const { withTransaction } = await import('../database/transaction.js');
  const pool = new pg.Pool({ connectionString: databaseUrl });
  const tableName = `test_tx_rollback_${Date.now()}`;

  t.after(async () => {
    await pool.query(`DROP TABLE IF EXISTS ${tableName}`);
    await pool.end();
  });

  await pool.query(`CREATE TABLE IF NOT EXISTS ${tableName} (id SERIAL PRIMARY KEY, value TEXT)`);

  let caught = false;
  try {
    await withTransaction({ mode: 'postgres', pool }, async (tx) => {
      await tx.run(`INSERT INTO ${tableName} (value) VALUES ($1)`, ['before']);
      throw new Error('Intentional rollback');
    });
  } catch (e) {
    caught = true;
    assert.equal(e.message, 'Intentional rollback', 'Should propagate error');
  }
  assert.ok(caught, 'Error should have been thrown');

  const result = await pool.query(`SELECT COUNT(*) as cnt FROM ${tableName}`);
  assert.equal(parseInt(result.rows[0].cnt, 10), 0, 'No inserts after rollback');
});

test('PostgreSQL connection works after rollback', { skip: !databaseUrl }, async (t) => {
  const pg = await import('pg');
  const { withTransaction } = await import('../database/transaction.js');
  const pool = new pg.Pool({ connectionString: databaseUrl });
  const tableName = `test_tx_recover_${Date.now()}`;

  t.after(async () => {
    await pool.query(`DROP TABLE IF EXISTS ${tableName}`);
    await pool.end();
  });

  await pool.query(`CREATE TABLE IF NOT EXISTS ${tableName} (id SERIAL PRIMARY KEY, value TEXT)`);

  let caught = false;
  try {
    await withTransaction({ mode: 'postgres', pool }, async (tx) => {
      await tx.run(`INSERT INTO ${tableName} (value) VALUES ($1)`, ['will rollback']);
      throw new Error('Rollback');
    });
  } catch (e) {
    caught = true;
    assert.equal(e.message, 'Rollback', 'Should propagate');
  }
  assert.ok(caught, 'Error should have been caught');

  const result = await pool.query(`SELECT COUNT(*) as cnt FROM ${tableName}`);
  assert.equal(parseInt(result.rows[0].cnt, 10), 0, 'Clean state after rollback');

  await pool.query(`INSERT INTO ${tableName} (value) VALUES ($1)`, ['after']);
  const after = await pool.query(`SELECT COUNT(*) as cnt FROM ${tableName}`);
  assert.equal(parseInt(after.rows[0].cnt, 10), 1, 'Subsequent operations work');
});

test('PostgreSQL tx adapter closes after commit', { skip: !databaseUrl }, async (t) => {
  const pg = await import('pg');
  const { withTransaction, TransactionClosedError } = await import('../database/transaction.js');
  const pool = new pg.Pool({ connectionString: databaseUrl });
  const tableName = `test_tx_closed_c_${Date.now()}`;

  t.after(async () => {
    await pool.query(`DROP TABLE IF EXISTS ${tableName}`);
    await pool.end();
  });

  await pool.query(`CREATE TABLE IF NOT EXISTS ${tableName} (id SERIAL PRIMARY KEY, value TEXT)`);

  let capturedTx;
  await withTransaction({ mode: 'postgres', pool }, async (tx) => {
    capturedTx = tx;
    await tx.run(`INSERT INTO ${tableName} (value) VALUES ($1)`, ['test']);
  });

  try {
    await capturedTx.run(`INSERT INTO ${tableName} (value) VALUES ($1)`, ['bad']);
    assert.fail('Should throw TransactionClosedError');
  } catch (e) {
    assert.ok(e instanceof TransactionClosedError, 'Closed adapter should error');
  }
});

test('PostgreSQL tx adapter closes after rollback', { skip: !databaseUrl }, async (t) => {
  const pg = await import('pg');
  const { withTransaction, TransactionClosedError } = await import('../database/transaction.js');
  const pool = new pg.Pool({ connectionString: databaseUrl });
  const tableName = `test_tx_closed_r_${Date.now()}`;

  t.after(async () => {
    await pool.query(`DROP TABLE IF EXISTS ${tableName}`);
    await pool.end();
  });

  await pool.query(`CREATE TABLE IF NOT EXISTS ${tableName} (id SERIAL PRIMARY KEY, value TEXT)`);

  let capturedTx;
  let caught = false;
  try {
    await withTransaction({ mode: 'postgres', pool }, async (tx) => {
      capturedTx = tx;
      await tx.run(`INSERT INTO ${tableName} (value) VALUES ($1)`, ['test']);
      throw new Error('Rollback test');
    });
  } catch (e) {
    caught = true;
    assert.equal(e.message, 'Rollback test', 'Error propagated');
  }
  assert.ok(caught, 'Error caught');

  try {
    await capturedTx.run(`INSERT INTO ${tableName} (value) VALUES ($1)`, ['bad']);
    assert.fail('Should throw TransactionClosedError');
  } catch (e) {
    assert.ok(e instanceof TransactionClosedError, 'Closed after rollback');
  }
});

test('PostgreSQL financial constraints reject negative values', { skip: !databaseUrl }, async (t) => {
  const pg = await import('pg');
  const { runMigrations } = await import('../database/migrations.js');
  const pool = new pg.Pool({ connectionString: databaseUrl });
  const userId = `pg_test_${Date.now()}`;

  t.after(async () => {
    await pool.query(`DELETE FROM users WHERE id = $1`, [userId]);
    await pool.end();
  });

  await runMigrations({
    mode: 'postgres',
    pool,
    sqlite: null,
    persistFn: null,
    migrationsDir: join(serverDir, 'migrations'),
  });

  try {
    await pool.query("INSERT INTO users (id,nickname,stars_balance,role,created_at,updated_at) VALUES ($1,'Bad',-5,'user',NOW(),NOW())", [userId]);
    assert.fail('Should reject negative stars_balance');
  } catch (e) {
    assert.ok(
      (e.message && e.message.includes('stars_balance')) || e.code === '23514',
      `Rejected by CHECK constraint: ${e.message || e.code}`,
    );
  }

  const userId2 = `${userId}_2`;
  t.after(async () => {
    await pool.query(`DELETE FROM users WHERE id = $1`, [userId2]);
  });

  try {
    await pool.query("INSERT INTO users (id,nickname,price_in_stars,role,created_at,updated_at) VALUES ($1,'Bad',-10,'user',NOW(),NOW())", [userId2]);
    assert.fail('Should reject negative price_in_stars');
  } catch (e) {
    assert.ok(
      (e.message && e.message.includes('price_in_stars')) || e.code === '23514',
      `Rejected by CHECK constraint: ${e.message || e.code}`,
    );
  }
});
