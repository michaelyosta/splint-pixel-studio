import test from 'node:test';
import assert from 'node:assert/strict';

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  test('PostgreSQL tests skipped (no DATABASE_URL)', { skip: true }, () => {});
} else {
  runPostgresTests();
}

function runPostgresTests() {
  let pool;
  let { Pool } = {};

  async function setup() {
    if (!Pool) {
      const pg = await import('pg');
      Pool = pg.Pool;
    }
    if (!pool) {
      pool = new Pool({ connectionString: databaseUrl });
    }
    return pool;
  }

  async function cleanup() {
    if (pool) {
      await pool.end();
      pool = null;
    }
  }

  test('PostgreSQL withTransaction commit saves all operations', async (t) => {
    const { withTransaction, runMigrations } = await import('../database/transaction.js').then();
    const p = await setup();
    const tableName = `test_tx_commit_${Date.now()}`;
    const { runMigrations: runMig } = await import('../database/migrations.js');

    await p.query(`CREATE TABLE IF NOT EXISTS ${tableName} (id SERIAL PRIMARY KEY, value TEXT)`);

    const { withTransaction: withTx } = await import('../database/transaction.js');

    await withTx({ mode: 'postgres', pool: p }, async (tx) => {
      await tx.run(`INSERT INTO ${tableName} (value) VALUES ($1)`, ['one']);
      await tx.run(`INSERT INTO ${tableName} (value) VALUES ($1)`, ['two']);
    });

    const result = await p.query(`SELECT COUNT(*) as cnt FROM ${tableName}`);
    assert.equal(parseInt(result.rows[0].cnt), 2, 'Both inserts committed');

    await p.query(`DROP TABLE IF EXISTS ${tableName}`);
  });

  test('PostgreSQL withTransaction rollback on error', async (t) => {
    const p = await setup();
    const tableName = `test_tx_rollback_${Date.now()}`;
    const { withTransaction } = await import('../database/transaction.js');

    await p.query(`CREATE TABLE IF NOT EXISTS ${tableName} (id SERIAL PRIMARY KEY, value TEXT)`);

    try {
      await withTransaction({ mode: 'postgres', pool: p }, async (tx) => {
        await tx.run(`INSERT INTO ${tableName} (value) VALUES ($1)`, ['before']);
        throw new Error('Intentional rollback');
      });
    } catch (e) {
      if (e.message !== 'Intentional rollback') throw e;
    }

    const result = await p.query(`SELECT COUNT(*) as cnt FROM ${tableName}`);
    assert.equal(parseInt(result.rows[0].cnt), 0, 'No inserts after rollback');

    await p.query(`DROP TABLE IF EXISTS ${tableName}`);
  });

  test('PostgreSQL connection works after rollback', async (t) => {
    const p = await setup();
    const tableName = `test_tx_recover_${Date.now()}`;
    const { withTransaction } = await import('../database/transaction.js');

    await p.query(`CREATE TABLE IF NOT EXISTS ${tableName} (id SERIAL PRIMARY KEY, value TEXT)`);

    try {
      await withTransaction({ mode: 'postgres', pool: p }, async (tx) => {
        await tx.run(`INSERT INTO ${tableName} (value) VALUES ($1)`, ['will rollback']);
        throw new Error('Rollback');
      });
    } catch { /* expected */ }

    const result = await p.query(`SELECT COUNT(*) as cnt FROM ${tableName}`);
    assert.equal(parseInt(result.rows[0].cnt), 0, 'Clean state after rollback');

    await p.query(`INSERT INTO ${tableName} (value) VALUES ('after')`);
    const after = await p.query(`SELECT COUNT(*) as cnt FROM ${tableName}`);
    assert.equal(parseInt(after.rows[0].cnt), 1, 'Subsequent operations work');

    await p.query(`DROP TABLE IF EXISTS ${tableName}`);
  });

  test('PostgreSQL tx adapter closes after commit', async (t) => {
    const p = await setup();
    const { withTransaction, TransactionClosedError } = await import('../database/transaction.js');
    const tableName = `test_tx_closed_c_${Date.now()}`;

    await p.query(`CREATE TABLE IF NOT EXISTS ${tableName} (id SERIAL PRIMARY KEY, value TEXT)`);

    let capturedTx;
    await withTransaction({ mode: 'postgres', pool: p }, async (tx) => {
      capturedTx = tx;
      await tx.run(`INSERT INTO ${tableName} (value) VALUES ($1)`, ['test']);
    });

    try {
      await capturedTx.run(`INSERT INTO ${tableName} (value) VALUES ($1)`, ['bad']);
      assert.fail('Should throw TransactionClosedError');
    } catch (e) {
      assert.ok(e instanceof TransactionClosedError, 'Closed after commit');
    }

    await p.query(`DROP TABLE IF EXISTS ${tableName}`);
  });

  test('PostgreSQL tx adapter closes after rollback', async (t) => {
    const p = await setup();
    const { withTransaction, TransactionClosedError } = await import('../database/transaction.js');
    const tableName = `test_tx_closed_r_${Date.now()}`;

    await p.query(`CREATE TABLE IF NOT EXISTS ${tableName} (id SERIAL PRIMARY KEY, value TEXT)`);

    let capturedTx;
    try {
      await withTransaction({ mode: 'postgres', pool: p }, async (tx) => {
        capturedTx = tx;
        await tx.run(`INSERT INTO ${tableName} (value) VALUES ($1)`, ['test']);
        throw new Error('Rollback');
      });
    } catch { /* expected */ }

    try {
      await capturedTx.run(`INSERT INTO ${tableName} (value) VALUES ($1)`, ['bad']);
      assert.fail('Should throw TransactionClosedError');
    } catch (e) {
      assert.ok(e instanceof TransactionClosedError, 'Closed after rollback');
    }

    await p.query(`DROP TABLE IF EXISTS ${tableName}`);
  });

  test('PostgreSQL financial constraints reject negative values', async (t) => {
    const p = await setup();
    const { runMigrations } = await import('../database/migrations.js');
    const { dirname, join } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const serverDir = join(dirname(fileURLToPath(import.meta.url)), '..');

    await runMigrations({
      mode: 'postgres',
      pool: p,
      sqlite: null,
      persistFn: null,
      migrationsDir: join(serverDir, 'migrations'),
    });

    try {
      await p.query("INSERT INTO users (id,nickname,stars_balance,role,created_at,updated_at) VALUES ('pg_bad1','Bad',-5,'user',NOW(),NOW())");
      assert.fail('Should reject negative stars_balance');
    } catch (e) {
      assert.ok(e.message.includes('stars_balance') || e.code === '23514', 'Rejected by CHECK constraint');
    }

    try {
      await p.query("INSERT INTO users (id,nickname,price_in_stars,role,created_at,updated_at) VALUES ('pg_bad2','Bad',-10,'user',NOW(),NOW())");
      assert.fail('Should reject negative price_in_stars');
    } catch (e) {
      assert.ok(e.message.includes('price_in_stars') || e.code === '23514', 'Rejected by CHECK constraint');
    }
  });

  console.log('PostgreSQL tests completed');
}
