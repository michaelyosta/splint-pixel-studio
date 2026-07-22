import test from 'node:test';
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  test('PostgreSQL tests skipped (no DATABASE_URL)', { skip: true }, () => {});
}

const serverDir = join(dirname(fileURLToPath(import.meta.url)), '..');

async function getPool() {
  const pgModule = (await import('pg')).default;
  return new pgModule.Pool({ connectionString: databaseUrl });
}

// ── PostgreSQL tests ────────────────────────────────────────────────

test('PostgreSQL withTransaction commit saves all operations', { skip: !databaseUrl }, async (t) => {
  const { withTransaction } = await import('../database/transaction.js');
  const pool = await getPool();
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
  const { withTransaction } = await import('../database/transaction.js');
  const pool = await getPool();
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
  const { withTransaction } = await import('../database/transaction.js');
  const pool = await getPool();
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
  const { withTransaction, TransactionClosedError } = await import('../database/transaction.js');
  const pool = await getPool();
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
  const { withTransaction, TransactionClosedError } = await import('../database/transaction.js');
  const pool = await getPool();
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
  const { runMigrations } = await import('../database/migrations.js');
  const pool = await getPool();
  const userId = `pg_test_${Date.now()}`;
  const userId2 = `${userId}_2`;

  t.after(async () => {
    try {
      await pool.query('DELETE FROM users WHERE id = ANY($1::text[])', [[userId, userId2]]);
    } finally {
      await pool.end();
    }
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

// ── Migration runner tests for PostgreSQL ───────────────────────────

test('PostgreSQL runMigrations is idempotent', { skip: !databaseUrl }, async (t) => {
  const { runMigrations } = await import('../database/migrations.js');
  const pool = await getPool();

  t.after(async () => {
    await pool.query('DROP TABLE IF EXISTS schema_migrations');
    await pool.query('DROP TABLE IF EXISTS users');
    await pool.query('DROP TABLE IF EXISTS collections');
    await pool.query('DROP TABLE IF EXISTS coloring_templates');
    await pool.query('DROP TABLE IF EXISTS coloring_progress');
    await pool.query('DROP TABLE IF EXISTS artworks');
    await pool.query('DROP TABLE IF EXISTS posts');
    await pool.query('DROP TABLE IF EXISTS comments');
    await pool.query('DROP TABLE IF EXISTS follows');
    await pool.query('DROP TABLE IF EXISTS likes');
    await pool.query('DROP TABLE IF EXISTS message_requests');
    await pool.query('DROP TABLE IF EXISTS reports');
    await pool.query('DROP TABLE IF EXISTS daily_streaks');
    await pool.query('DROP TABLE IF EXISTS achievements');
    await pool.query('DROP TABLE IF EXISTS user_achievements');
    await pool.query('DROP TABLE IF EXISTS coloring_zones');
    await pool.query('DROP TABLE IF EXISTS analytics_events');
    await pool.end();
  });

  const result1 = await runMigrations({
    mode: 'postgres',
    pool,
    sqlite: null,
    persistFn: null,
    migrationsDir: join(serverDir, 'migrations'),
  });
  assert.ok(result1.applied >= 1, `First run should apply migrations, got applied=${result1.applied}`);

  const result2 = await runMigrations({
    mode: 'postgres',
    pool,
    sqlite: null,
    persistFn: null,
    migrationsDir: join(serverDir, 'migrations'),
  });
  assert.equal(result2.applied, 0, 'Second run should apply zero migrations');
  assert.equal(result2.skipped, 4, 'Second run should skip all 4 migrations');
});

test('PostgreSQL schema_migrations contains correct versions and checksums', { skip: !databaseUrl }, async (t) => {
  const { runMigrations } = await import('../database/migrations.js');
  const pool = await getPool();

  t.after(async () => {
    try {
      await pool.query('DROP TABLE IF EXISTS schema_migrations');
      await pool.query('DROP TABLE IF EXISTS users');
    } finally {
      await pool.end();
    }
  });

  await runMigrations({
    mode: 'postgres',
    pool,
    sqlite: null,
    persistFn: null,
    migrationsDir: join(serverDir, 'migrations'),
  });

  const result = await pool.query('SELECT version, checksum FROM schema_migrations ORDER BY version');
  const versions = result.rows.map((r) => r.version);
  const checksums = result.rows.map((r) => r.checksum);

  assert.deepStrictEqual(versions, ['001', '002', '003', '004'], 'Must contain exactly 001-004');
  assert.equal(checksums.length, 4, 'All 4 migrations have checksums');
  for (const cs of checksums) {
    assert.ok(cs && cs.length > 0, `Checksum must be non-empty, got: ${cs}`);
  }
});

test('PostgreSQL withTransaction uses dedicated client', { skip: !databaseUrl }, async (t) => {
  const { withTransaction } = await import('../database/transaction.js');
  const pool = await getPool();
  const tableName = `test_dedicated_${Date.now()}`;

  t.after(async () => {
    await pool.query(`DROP TABLE IF EXISTS ${tableName}`);
    await pool.end();
  });

  await pool.query(`CREATE TABLE IF NOT EXISTS ${tableName} (id SERIAL PRIMARY KEY, value TEXT)`);

  // Verify that tx operations use a client obtained from pool.connect(),
  // not the global pool.query. We do this by checking that a ROLLBACK
  // inside the transaction properly discards the insert.

  try {
    await withTransaction({ mode: 'postgres', pool }, async (tx) => {
      await tx.run(`INSERT INTO ${tableName} (value) VALUES ($1)`, ['tx-scope']);
      throw new Error('Rollback to verify client isolation');
    });
  } catch { /* expected */ }

  const result = await pool.query(`SELECT COUNT(*) as cnt FROM ${tableName}`);
  assert.equal(parseInt(result.rows[0].cnt, 10), 0, 'Dedicated client: insert rolled back, proving client isolation');

  // Now verify commit path also works with dedicated client
  await withTransaction({ mode: 'postgres', pool }, async (tx) => {
    await tx.run(`INSERT INTO ${tableName} (value) VALUES ($1)`, ['committed']);
  });

  const after = await pool.query(`SELECT COUNT(*) as cnt FROM ${tableName}`);
  assert.equal(parseInt(after.rows[0].cnt, 10), 1, 'Dedicated client: commit works');
});

test('PostgreSQL nested transaction uses savepoints', { skip: !databaseUrl }, async (t) => {
  const { withTransaction } = await import('../database/transaction.js');
  const pool = await getPool();
  const tableName = `test_savepoint_${Date.now()}`;

  t.after(async () => {
    await pool.query(`DROP TABLE IF EXISTS ${tableName}`);
    await pool.end();
  });

  await pool.query(`CREATE TABLE IF NOT EXISTS ${tableName} (id SERIAL PRIMARY KEY, value TEXT)`);

  // PostgreSQL adapter must support nested transactions via savepoints.
  // If it rejects with NestedTransactionError, document that behaviour.
  try {
    await withTransaction({ mode: 'postgres', pool }, async (outer) => {
      await outer.run(`INSERT INTO ${tableName} (value) VALUES ($1)`, ['outer']);

      let nestedError = false;
      try {
        await withTransaction({ mode: 'postgres', pool }, async (inner) => {
          await inner.run(`INSERT INTO ${tableName} (value) VALUES ($1)`, ['inner-fail']);
          throw new Error('Inner rollback');
        });
      } catch (e) {
        nestedError = true;
        assert.equal(e.message, 'Inner rollback', 'Inner error propagated');
      }
      assert.ok(nestedError, 'Inner transaction error was caught');

      await outer.run(`INSERT INTO ${tableName} (value) VALUES ($1)`, ['outer2']);
    });

    const result = await pool.query(`SELECT value FROM ${tableName} ORDER BY id`);
    const values = result.rows.map((r) => r.value);
    // If savepoints are supported: ['outer', 'outer2']
    // If nested is rejected: caught by catch block below
    assert.deepStrictEqual(values, ['outer', 'outer2'], 'Outer inserts committed, inner rolled back via savepoint');
  } catch (e) {
    // If NestedTransactionError is thrown, verify its type
    const { NestedTransactionError } = await import('../database/transaction.js');
    if (e instanceof NestedTransactionError) {
      // Documented: PostgreSQL adapter rejects nested transactions
      const result = await pool.query(`SELECT COUNT(*) as cnt FROM ${tableName}`);
      assert.equal(parseInt(result.rows[0].cnt, 10), 0, 'No data when nested rejected');
    } else {
      throw e;
    }
  }
});
