import test from 'node:test';
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';

const databaseUrl = process.env.DATABASE_URL;

if (databaseUrl) {
  process.env.ALLOW_DEV_AUTH = 'true';
}

if (!databaseUrl) {
  test('PostgreSQL tests skipped (no DATABASE_URL)', { skip: true }, () => {});
}

const serverDir = join(dirname(fileURLToPath(import.meta.url)), '..');

async function getPool() {
  const pgModule = (await import('pg')).default;
  return new pgModule.Pool({ connectionString: databaseUrl });
}

// ── Low-level transaction tests (use withTransaction, not withDbTransaction) ───

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

async function dropAllTables(pool) {
  await pool.query(`
    DROP TABLE IF EXISTS
      analytics_events,
      user_achievements,
      coloring_zones,
      daily_streaks,
      reports,
      message_requests,
      likes,
      follows,
      comments,
      posts,
      artworks,
      coloring_progress,
      coloring_templates,
      achievements,
      collections,
      users,
      schema_migrations
    CASCADE
  `);
}

test('PostgreSQL runMigrations is idempotent', { skip: !databaseUrl }, async (t) => {
  const { runMigrations } = await import('../database/migrations.js');
  const pool = await getPool();

  t.after(async () => {
    try { await dropAllTables(pool); } finally { await pool.end(); }
  });

  await dropAllTables(pool);

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
    try { await dropAllTables(pool); } finally { await pool.end(); }
  });

  await dropAllTables(pool);

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

  try {
    await withTransaction({ mode: 'postgres', pool }, async (tx) => {
      await tx.run(`INSERT INTO ${tableName} (value) VALUES ($1)`, ['tx-scope']);
      throw new Error('Rollback to verify client isolation');
    });
  } catch (e) {
    assert.equal(e.message, 'Rollback to verify client isolation');
  }

  const result = await pool.query(`SELECT COUNT(*) as cnt FROM ${tableName}`);
  assert.equal(parseInt(result.rows[0].cnt, 10), 0, 'Dedicated client: insert rolled back');

  await withTransaction({ mode: 'postgres', pool }, async (tx) => {
    await tx.run(`INSERT INTO ${tableName} (value) VALUES ($1)`, ['committed']);
  });

  const after = await pool.query(`SELECT COUNT(*) as cnt FROM ${tableName}`);
  assert.equal(parseInt(after.rows[0].cnt, 10), 1, 'Dedicated client: commit works');
});

// ── Nested transaction test (must be rejected, not savepoints) ───────

test('PostgreSQL nested transaction is rejected with NestedTransactionError', { skip: !databaseUrl }, async (t) => {
  const { withTransaction, NestedTransactionError } = await import('../database/transaction.js');
  const pool = await getPool();
  const tableName = `test_nested_${Date.now()}`;

  t.after(async () => {
    await pool.query(`DROP TABLE IF EXISTS ${tableName}`);
    await pool.end();
  });

  await pool.query(`CREATE TABLE IF NOT EXISTS ${tableName} (id SERIAL PRIMARY KEY, value TEXT)`);

  await assert.rejects(
    () => withTransaction({ mode: 'postgres', pool }, async () => {
      await withTransaction({ mode: 'postgres', pool }, async () => {
      });
    }),
    NestedTransactionError,
    'Nested PostgreSQL transactions must throw NestedTransactionError',
  );

  const result = await pool.query(`SELECT COUNT(*) as cnt FROM ${tableName}`);
  assert.equal(parseInt(result.rows[0].cnt, 10), 0, 'Outer transaction fully rolled back');
});

// ── SQL utilities tests ──────────────────────────────────────────────

test('POSTGRES: toPostgres preserves ? in string literals', async () => {
  const { toPostgres } = await import('../database/sql.js');

  assert.equal(
    toPostgres("SELECT * FROM x WHERE a=? AND b=?"),
    "SELECT * FROM x WHERE a=$1 AND b=$2",
    'Basic placeholder conversion',
  );

  assert.equal(
    toPostgres("SELECT * FROM x WHERE id=$1"),
    "SELECT * FROM x WHERE id=$1",
    'Native $1 preserved',
  );

  assert.equal(
    toPostgres("SELECT '$1', value FROM x WHERE id=?"),
    "SELECT '$1', value FROM x WHERE id=$1",
    'Literal $1 in string preserved, placeholder converted',
  );

  assert.equal(
    toPostgres("SELECT '?' AS literal, value FROM x WHERE id=?"),
    "SELECT '?' AS literal, value FROM x WHERE id=$1",
    '? in string literal preserved',
  );

  assert.equal(
    toPostgres("SELECT 'it''s ?' AS literal, value FROM x WHERE id=?"),
    "SELECT 'it''s ?' AS literal, value FROM x WHERE id=$1",
    '? with escaped quote preserved',
  );
});

test('POSTGRES: toPostgres converts MAX to GREATEST', async () => {
  const { toPostgres } = await import('../database/sql.js');

  assert.equal(
    toPostgres("UPDATE t SET x=MAX(0, column)"),
    "UPDATE t SET x=GREATEST(0, column)",
    'MAX converted to GREATEST',
  );
});

test('POSTGRES: isUniqueConstraintError detects postgres unique violation', async () => {
  const { isUniqueConstraintError } = await import('../database/sql.js');

  assert.equal(isUniqueConstraintError({ code: '23505' }, 'postgres'), true, 'Code 23505 is unique violation');
  assert.equal(isUniqueConstraintError({ code: '23502' }, 'postgres'), false, 'Code 23502 is not');
  assert.equal(isUniqueConstraintError(null, 'postgres'), false, 'null is not');
  assert.equal(isUniqueConstraintError(undefined, 'postgres'), false, 'undefined is not');
});

test('POSTGRES: isUniqueConstraintError detects sqlite unique violation', async () => {
  const { isUniqueConstraintError } = await import('../database/sql.js');

  assert.equal(isUniqueConstraintError(new Error('UNIQUE constraint failed: users.email'), 'sqlite'), true);
  assert.equal(isUniqueConstraintError(new Error('NOT NULL constraint'), 'sqlite'), false);
  assert.equal(isUniqueConstraintError(null, 'sqlite'), false);
});

// ── CAS low-level tests (use withTransaction, not withDbTransaction) ─

async function setupTestData(pool, userId, templateId) {
  const { runMigrations } = await import('../database/migrations.js');
  await runMigrations({
    mode: 'postgres',
    pool,
    sqlite: null,
    persistFn: null,
    migrationsDir: join(serverDir, 'migrations'),
  });

  await pool.query("INSERT INTO users (id,nickname,role,created_at,updated_at) VALUES ($1,'test','user',NOW(),NOW()) ON CONFLICT DO NOTHING", [userId]);
  await pool.query(
    "INSERT INTO coloring_templates (id,title,width,height,palette_json,cells_json,created_at,updated_at) VALUES ($1,'test',8,8,$2,$3,NOW(),NOW()) ON CONFLICT DO NOTHING",
    [templateId, JSON.stringify(['#000000', '#ffffff']), JSON.stringify(new Array(64).fill(0))]
  );
}

test('POSTGRES: old revision fails CAS with changes=0, not throw', { skip: !databaseUrl }, async (t) => {
  const { withTransaction } = await import('../database/transaction.js');
  const pool = await getPool();
  const userId = `pg_oldrev_${Date.now()}`;
  const templateId = `tpl_${Date.now()}`;

  t.after(async () => {
    try {
      await pool.query('DELETE FROM coloring_progress WHERE user_id=$1', [userId]);
      await pool.query('DELETE FROM coloring_templates WHERE id=$1', [templateId]);
      await pool.query('DELETE FROM users WHERE id=$1', [userId]);
    } finally {
      await pool.end();
    }
  });

  await setupTestData(pool, userId, templateId);

  await pool.query(
    'INSERT INTO coloring_progress (user_id,template_id,filled_json,revision,created_at,updated_at) VALUES ($1,$2,$3::jsonb,$4,NOW(),NOW())',
    [userId, templateId, JSON.stringify(new Array(64).fill(0)), 2]
  );

  const changes = await withTransaction({ mode: 'postgres', pool }, async (tx) => {
    const r = await tx.run(
      'UPDATE coloring_progress SET filled_json=$1::jsonb, revision=$2, updated_at=NOW() WHERE user_id=$3 AND template_id=$4 AND revision=$5',
      [JSON.stringify(new Array(64).fill(1)), 3, userId, templateId, 1]
    );
    return r.changes;
  });

  assert.equal(changes, 0, 'CAS returns changes=0 for old revision');

  const row = await pool.query('SELECT revision FROM coloring_progress WHERE user_id=$1 AND template_id=$2', [userId, templateId]);
  assert.equal(parseInt(row.rows[0].revision, 10), 2, 'Revision unchanged');
});

test('POSTGRES: future revision fails CAS with changes=0', { skip: !databaseUrl }, async (t) => {
  const { withTransaction } = await import('../database/transaction.js');
  const pool = await getPool();
  const userId = `pg_futrev_${Date.now()}`;
  const templateId = `tpl_${Date.now()}`;

  t.after(async () => {
    try {
      await pool.query('DELETE FROM coloring_progress WHERE user_id=$1', [userId]);
      await pool.query('DELETE FROM coloring_templates WHERE id=$1', [templateId]);
      await pool.query('DELETE FROM users WHERE id=$1', [userId]);
    } finally {
      await pool.end();
    }
  });

  await setupTestData(pool, userId, templateId);

  await pool.query(
    'INSERT INTO coloring_progress (user_id,template_id,filled_json,revision,created_at,updated_at) VALUES ($1,$2,$3::jsonb,$4,NOW(),NOW())',
    [userId, templateId, JSON.stringify(new Array(64).fill(0)), 1]
  );

  const changes = await withTransaction({ mode: 'postgres', pool }, async (tx) => {
    const r = await tx.run(
      'UPDATE coloring_progress SET filled_json=$1::jsonb, revision=$2, updated_at=NOW() WHERE user_id=$3 AND template_id=$4 AND revision=$5',
      [JSON.stringify(new Array(64).fill(1)), 2, userId, templateId, 3]
    );
    return r.changes;
  });

  assert.equal(changes, 0, 'CAS returns changes=0 for future revision');

  const row = await pool.query('SELECT revision FROM coloring_progress WHERE user_id=$1 AND template_id=$2', [userId, templateId]);
  assert.equal(parseInt(row.rows[0].revision, 10), 1, 'Revision unchanged');
});

test('POSTGRES: two concurrent PUTs with same revision — one success, one changes=0', { skip: !databaseUrl }, async (t) => {
  const { withTransaction } = await import('../database/transaction.js');
  const pool = await getPool();
  const userId = `pg_concur_${Date.now()}`;
  const templateId = `tpl_${Date.now()}`;

  t.after(async () => {
    try {
      await pool.query('DELETE FROM coloring_progress WHERE user_id=$1', [userId]);
      await pool.query('DELETE FROM coloring_templates WHERE id=$1', [templateId]);
      await pool.query('DELETE FROM users WHERE id=$1', [userId]);
    } finally {
      await pool.end();
    }
  });

  await setupTestData(pool, userId, templateId);

  await pool.query(
    'INSERT INTO coloring_progress (user_id,template_id,filled_json,revision,created_at,updated_at) VALUES ($1,$2,$3::jsonb,$4,NOW(),NOW())',
    [userId, templateId, JSON.stringify(new Array(64).fill(0)), 1]
  );

  const results = await Promise.allSettled([
    withTransaction({ mode: 'postgres', pool }, async (tx) => {
      const r = await tx.run(
        'UPDATE coloring_progress SET filled_json=$1::jsonb, revision=$2, updated_at=NOW() WHERE user_id=$3 AND template_id=$4 AND revision=$5',
        [JSON.stringify(new Array(64).fill(1)), 2, userId, templateId, 1]
      );
      return { changes: r.changes };
    }),
    withTransaction({ mode: 'postgres', pool }, async (tx) => {
      const r = await tx.run(
        'UPDATE coloring_progress SET filled_json=$1::jsonb, revision=$2, updated_at=NOW() WHERE user_id=$3 AND template_id=$4 AND revision=$5',
        [JSON.stringify(new Array(64).fill(2)), 2, userId, templateId, 1]
      );
      return { changes: r.changes };
    }),
  ]);

  assert.equal(results.length, 2, 'Both promises settled');
  assert.ok(results.every((r) => r.status === 'fulfilled'), 'Both operations completed without error');

  const successCount = results.filter((r) => r.value.changes === 1).length;
  const conflictCount = results.filter((r) => r.value.changes === 0).length;

  assert.equal(successCount, 1, 'Exactly one request returns changes=1');
  assert.equal(conflictCount, 1, 'Exactly one request returns changes=0');
  assert.equal(successCount + conflictCount, 2, 'All results are either success or conflict');

  const row = await pool.query('SELECT revision FROM coloring_progress WHERE user_id=$1 AND template_id=$2', [userId, templateId]);
  assert.equal(parseInt(row.rows[0].revision, 10), 2, 'Revision incremented exactly once');
});

test('POSTGRES: two concurrent initial inserts — one success, one unique violation', { skip: !databaseUrl }, async (t) => {
  const { withTransaction } = await import('../database/transaction.js');
  const { isUniqueConstraintError } = await import('../database/sql.js');
  const pool = await getPool();
  const userId = `pg_ins2_${Date.now()}`;
  const templateId = `tpl_${Date.now()}`;

  t.after(async () => {
    try {
      await pool.query('DELETE FROM coloring_progress WHERE user_id=$1', [userId]);
      await pool.query('DELETE FROM coloring_templates WHERE id=$1', [templateId]);
      await pool.query('DELETE FROM users WHERE id=$1', [userId]);
    } finally {
      await pool.end();
    }
  });

  await setupTestData(pool, userId, templateId);

  const results = await Promise.allSettled([
    withTransaction({ mode: 'postgres', pool }, async (tx) => {
      await tx.run(
        'INSERT INTO coloring_progress (user_id,template_id,filled_json,revision,completed_at,created_at,updated_at) VALUES ($1,$2,$3::jsonb,$4,$5,NOW(),NOW())',
        [userId, templateId, JSON.stringify(new Array(64).fill(0)), 1, null]
      );
    }),
    withTransaction({ mode: 'postgres', pool }, async (tx) => {
      await tx.run(
        'INSERT INTO coloring_progress (user_id,template_id,filled_json,revision,completed_at,created_at,updated_at) VALUES ($1,$2,$3::jsonb,$4,$5,NOW(),NOW())',
        [userId, templateId, JSON.stringify(new Array(64).fill(0)), 1, null]
      );
    }),
  ]);

  const fulfilled = results.filter((r) => r.status === 'fulfilled');
  const rejected = results.filter((r) => r.status === 'rejected');

  assert.equal(fulfilled.length, 1, 'Exactly one insert succeeds');
  assert.equal(rejected.length, 1, 'One insert rejected');

  const rejection = rejected[0].reason;
  assert.ok(isUniqueConstraintError(rejection, 'postgres'), `Expected unique violation, got: ${rejection.message || rejection.code || rejection}`);

  const row = await pool.query('SELECT COUNT(*) as cnt FROM coloring_progress WHERE user_id=$1 AND template_id=$2', [userId, templateId]);
  assert.equal(parseInt(row.rows[0].cnt, 10), 1, 'Only one row in database');
});

test('POSTGRES: pool works after CAS conflict', { skip: !databaseUrl }, async (t) => {
  const { withTransaction } = await import('../database/transaction.js');
  const pool = await getPool();
  const userId = `pg_afterconf_${Date.now()}`;
  const templateId = `tpl_${Date.now()}`;

  t.after(async () => {
    try {
      await pool.query('DELETE FROM coloring_progress WHERE user_id=$1', [userId]);
      await pool.query('DELETE FROM coloring_templates WHERE id=$1', [templateId]);
      await pool.query('DELETE FROM users WHERE id=$1', [userId]);
    } finally {
      await pool.end();
    }
  });

  await setupTestData(pool, userId, templateId);

  await pool.query(
    'INSERT INTO coloring_progress (user_id,template_id,filled_json,revision,created_at,updated_at) VALUES ($1,$2,$3::jsonb,$4,NOW(),NOW())',
    [userId, templateId, JSON.stringify(new Array(64).fill(0)), 1]
  );

  const changes = await withTransaction({ mode: 'postgres', pool }, async (tx) => {
    const r = await tx.run(
      'UPDATE coloring_progress SET filled_json=$1::jsonb, revision=$2, updated_at=NOW() WHERE user_id=$3 AND template_id=$4 AND revision=$5',
      [JSON.stringify(new Array(64).fill(1)), 2, userId, templateId, 99]
    );
    return r.changes;
  });

  assert.equal(changes, 0, 'CAS conflict returns changes=0');

  const result = await pool.query('SELECT 1 as alive');
  assert.equal(result.rows[0].alive, 1, 'Pool still works after conflict');
});

test('POSTGRES: adapter closed after commit (low-level)', { skip: !databaseUrl }, async (t) => {
  const { withTransaction, TransactionClosedError } = await import('../database/transaction.js');
  const pool = await getPool();
  const tableName = `test_adapter_commit_${Date.now()}`;

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
    assert.ok(e instanceof TransactionClosedError, 'Adapter closed after commit');
  }
});

test('POSTGRES: adapter closed after rollback (low-level)', { skip: !databaseUrl }, async (t) => {
  const { withTransaction, TransactionClosedError } = await import('../database/transaction.js');
  const pool = await getPool();
  const tableName = `test_adapter_rollback_${Date.now()}`;

  t.after(async () => {
    await pool.query(`DROP TABLE IF EXISTS ${tableName}`);
    await pool.end();
  });

  await pool.query(`CREATE TABLE IF NOT EXISTS ${tableName} (id SERIAL PRIMARY KEY, value TEXT)`);

  let capturedTx;
  try {
    await withTransaction({ mode: 'postgres', pool }, async (tx) => {
      capturedTx = tx;
      await tx.run(`INSERT INTO ${tableName} (value) VALUES ($1)`, ['test']);
      throw new Error('Rollback');
    });
  } catch (e) {
    assert.equal(e.message, 'Rollback');
  }

  try {
    await capturedTx.run(`INSERT INTO ${tableName} (value) VALUES ($1)`, ['bad']);
    assert.fail('Should throw TransactionClosedError');
  } catch (e) {
    assert.ok(e instanceof TransactionClosedError, 'Closed after rollback');
  }
});

// ── HTTP integration tests (real Express routes against PostgreSQL) ──

async function createTestApp() {
  const { initDb, getDb } = await import('../db.js');
  await initDb();

  const { default: coloringsRouter } = await import('../routes/colorings.js');

  const app = express();
  app.use(express.json());
  app.use('/colorings', coloringsRouter);

  return app;
}

async function createTestServer() {
  const app = await createTestApp();
  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const { port } = server.address();
      resolve({ server, port, url: `http://127.0.0.1:${port}` });
    });
    server.on('error', reject);
  });
}

test('HTTP: initial save revision=0 returns 200 with revision=1', { skip: !databaseUrl }, async (t) => {
  const userId = `http_init_${Date.now()}`;
  const templateId = `tpl_${Date.now()}`;

  const { server, url } = await createTestServer();

  t.after(async () => {
    await new Promise((r) => server.close(r));
    const pool = await getPool();
    try {
      await pool.query('DELETE FROM coloring_progress WHERE user_id=$1', [userId]);
      await pool.query('DELETE FROM coloring_templates WHERE id=$1', [templateId]);
      await pool.query('DELETE FROM users WHERE id=$1', [userId]);
    } finally {
      await pool.end();
    }
  });

  const pool = await getPool();
  await setupTestData(pool, userId, templateId);
  await pool.end();

  const res = await fetch(`${url}/colorings/${templateId}/progress`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'X-User-Id': userId },
    body: JSON.stringify({ filled: new Array(64).fill(0), revision: 0, resultDataUrl: null }),
  });

  assert.equal(res.status, 200, 'Initial save returns 200');

  const body = await res.json();
  assert.equal(body.revision, 1, 'Response revision is 1');
  assert.ok(Array.isArray(body.filled), 'filled is array');
});

test('HTTP: second save revision=1 for JSONB returns 200 with revision=2', { skip: !databaseUrl }, async (t) => {
  const userId = `http_second_${Date.now()}`;
  const templateId = `tpl_${Date.now()}`;

  const { server, url } = await createTestServer();

  t.after(async () => {
    await new Promise((r) => server.close(r));
    const pool = await getPool();
    try {
      await pool.query('DELETE FROM coloring_progress WHERE user_id=$1', [userId]);
      await pool.query('DELETE FROM coloring_templates WHERE id=$1', [templateId]);
      await pool.query('DELETE FROM users WHERE id=$1', [userId]);
    } finally {
      await pool.end();
    }
  });

  const pool = await getPool();
  await setupTestData(pool, userId, templateId);
  await pool.end();

  const first = await fetch(`${url}/colorings/${templateId}/progress`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'X-User-Id': userId },
    body: JSON.stringify({ filled: new Array(64).fill(0), revision: 0, resultDataUrl: null }),
  });
  assert.equal(first.status, 200);

  const firstBody = await first.json();
  assert.equal(firstBody.revision, 1);

  const secondFilled = new Array(64).fill(1);
  const second = await fetch(`${url}/colorings/${templateId}/progress`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'X-User-Id': userId },
    body: JSON.stringify({ filled: secondFilled, revision: 1, resultDataUrl: null }),
  });

  assert.equal(second.status, 200, 'Second save returns 200 (no 500)');

  const secondBody = await second.json();
  assert.equal(secondBody.revision, 2, 'Response revision is 2');

  const filledArray = Array.isArray(secondBody.filled) ? secondBody.filled : JSON.parse(secondBody.filled);
  assert.equal(filledArray[0], 1, 'First cell matches second request');
});

test('HTTP: old revision returns 409 with current progress', { skip: !databaseUrl }, async (t) => {
  const userId = `http_old_${Date.now()}`;
  const templateId = `tpl_${Date.now()}`;

  const { server, url } = await createTestServer();

  t.after(async () => {
    await new Promise((r) => server.close(r));
    const pool = await getPool();
    try {
      await pool.query('DELETE FROM coloring_progress WHERE user_id=$1', [userId]);
      await pool.query('DELETE FROM coloring_templates WHERE id=$1', [templateId]);
      await pool.query('DELETE FROM users WHERE id=$1', [userId]);
    } finally {
      await pool.end();
    }
  });

  const pool = await getPool();
  await setupTestData(pool, userId, templateId);
  await pool.end();

  const first = await fetch(`${url}/colorings/${templateId}/progress`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'X-User-Id': userId },
    body: JSON.stringify({ filled: new Array(64).fill(0), revision: 0, resultDataUrl: null }),
  });
  assert.equal(first.status, 200);
  const firstBody = await first.json();
  assert.equal(firstBody.revision, 1);

  const second = await fetch(`${url}/colorings/${templateId}/progress`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'X-User-Id': userId },
    body: JSON.stringify({ filled: new Array(64).fill(1), revision: 1, resultDataUrl: null }),
  });
  assert.equal(second.status, 200);
  const secondBody = await second.json();
  assert.equal(secondBody.revision, 2);

  const third = await fetch(`${url}/colorings/${templateId}/progress`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'X-User-Id': userId },
    body: JSON.stringify({ filled: new Array(64).fill(2), revision: 1, resultDataUrl: null }),
  });

  assert.equal(third.status, 409, 'Old revision returns 409');

  const thirdBody = await third.json();
  assert.ok(thirdBody.error, 'Error message present');
  assert.ok(thirdBody.progress, 'Current progress included');
  assert.equal(thirdBody.progress.revision, 2, 'Response has current revision=2');

  const getRes = await fetch(`${url}/colorings/${templateId}/progress`, {
    headers: { 'X-User-Id': userId },
  });
  const getBody = await getRes.json();
  assert.equal(getBody.revision, 2, 'DB revision unchanged at 2');
});

test('HTTP: future revision returns 409', { skip: !databaseUrl }, async (t) => {
  const userId = `http_fut_${Date.now()}`;
  const templateId = `tpl_${Date.now()}`;

  const { server, url } = await createTestServer();

  t.after(async () => {
    await new Promise((r) => server.close(r));
    const pool = await getPool();
    try {
      await pool.query('DELETE FROM coloring_progress WHERE user_id=$1', [userId]);
      await pool.query('DELETE FROM coloring_templates WHERE id=$1', [templateId]);
      await pool.query('DELETE FROM users WHERE id=$1', [userId]);
    } finally {
      await pool.end();
    }
  });

  const pool = await getPool();
  await setupTestData(pool, userId, templateId);
  await pool.end();

  const first = await fetch(`${url}/colorings/${templateId}/progress`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'X-User-Id': userId },
    body: JSON.stringify({ filled: new Array(64).fill(0), revision: 0, resultDataUrl: null }),
  });
  assert.equal(first.status, 200);
  assert.equal((await first.json()).revision, 1);

  const second = await fetch(`${url}/colorings/${templateId}/progress`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'X-User-Id': userId },
    body: JSON.stringify({ filled: new Array(64).fill(1), revision: 5, resultDataUrl: null }),
  });

  assert.equal(second.status, 409, 'Future revision returns 409');

  const getRes = await fetch(`${url}/colorings/${templateId}/progress`, {
    headers: { 'X-User-Id': userId },
  });
  const getBody = await getRes.json();
  assert.equal(getBody.revision, 1, 'DB revision unchanged');
});

test('HTTP: two concurrent PUTs with same revision — one 200, one 409', { skip: !databaseUrl }, async (t) => {
  const userId = `http_conc_${Date.now()}`;
  const templateId = `tpl_${Date.now()}`;

  const { server, url } = await createTestServer();

  t.after(async () => {
    await new Promise((r) => server.close(r));
    const pool = await getPool();
    try {
      await pool.query('DELETE FROM coloring_progress WHERE user_id=$1', [userId]);
      await pool.query('DELETE FROM coloring_templates WHERE id=$1', [templateId]);
      await pool.query('DELETE FROM users WHERE id=$1', [userId]);
    } finally {
      await pool.end();
    }
  });

  const pool = await getPool();
  await setupTestData(pool, userId, templateId);
  await pool.end();

  const init = await fetch(`${url}/colorings/${templateId}/progress`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'X-User-Id': userId },
    body: JSON.stringify({ filled: new Array(64).fill(0), revision: 0, resultDataUrl: null }),
  });
  assert.equal(init.status, 200);
  assert.equal((await init.json()).revision, 1);

  const results = await Promise.allSettled([
    fetch(`${url}/colorings/${templateId}/progress`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'X-User-Id': userId },
      body: JSON.stringify({ filled: new Array(64).fill(1), revision: 1, resultDataUrl: null }),
    }),
    fetch(`${url}/colorings/${templateId}/progress`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'X-User-Id': userId },
      body: JSON.stringify({ filled: new Array(64).fill(2), revision: 1, resultDataUrl: null }),
    }),
  ]);

  const statuses = results.map((r) => (r.status === 'fulfilled' ? r.value.status : -1));

  const successCount = statuses.filter((s) => s === 200).length;
  const conflictCount = statuses.filter((s) => s === 409).length;

  assert.equal(successCount, 1, 'Exactly one HTTP 200');
  assert.equal(conflictCount, 1, 'Exactly one HTTP 409');
  assert.equal(successCount + conflictCount, 2, 'Both requests completed with expected statuses');

  const getRes = await fetch(`${url}/colorings/${templateId}/progress`, {
    headers: { 'X-User-Id': userId },
  });
  const getBody = await getRes.json();
  assert.equal(getBody.revision, 2, 'Revision incremented exactly once (1 -> 2)');
});

test('HTTP: two concurrent initial PUTs with revision=0 — one 200, one 409', { skip: !databaseUrl }, async (t) => {
  const userId = `http_cins_${Date.now()}`;
  const templateId = `tpl_${Date.now()}`;

  const { server, url } = await createTestServer();

  t.after(async () => {
    await new Promise((r) => server.close(r));
    const pool = await getPool();
    try {
      await pool.query('DELETE FROM coloring_progress WHERE user_id=$1', [userId]);
      await pool.query('DELETE FROM coloring_templates WHERE id=$1', [templateId]);
      await pool.query('DELETE FROM users WHERE id=$1', [userId]);
    } finally {
      await pool.end();
    }
  });

  const pool = await getPool();
  await setupTestData(pool, userId, templateId);
  await pool.end();

  const results = await Promise.allSettled([
    fetch(`${url}/colorings/${templateId}/progress`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'X-User-Id': userId },
      body: JSON.stringify({ filled: new Array(64).fill(0), revision: 0, resultDataUrl: null }),
    }),
    fetch(`${url}/colorings/${templateId}/progress`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'X-User-Id': userId },
      body: JSON.stringify({ filled: new Array(64).fill(0), revision: 0, resultDataUrl: null }),
    }),
  ]);

  const statuses = results.map((r) => (r.status === 'fulfilled' ? r.value.status : -1));

  const successCount = statuses.filter((s) => s === 200).length;
  const conflictCount = statuses.filter((s) => s === 409).length;

  assert.equal(successCount, 1, 'Exactly one HTTP 200');
  assert.equal(conflictCount, 1, 'Exactly one HTTP 409');

  for (const result of results) {
    if (result.status === 'fulfilled' && result.value.status === 200) {
      const body = await result.value.json();
      assert.equal(body.revision, 1, 'Successful save returns revision=1');
    }
  }

  const getRes = await fetch(`${url}/colorings/${templateId}/progress`, {
    headers: { 'X-User-Id': userId },
  });
  const getBody = await getRes.json();
  assert.equal(getBody.revision, 1, 'Only one row created, revision=1');
});
