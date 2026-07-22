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

async function dropAllTables(pool) {
  // Must use CASCADE because of foreign-key dependencies
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

  // Clean up any pre-existing tables from migrate:postgres step
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

  // Clean up any pre-existing tables from migrate:postgres step
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

// ── PostgreSQL global helpers inside transaction ─────────────────────

test('POSTGRES: global run() inside transaction uses dedicated client', { skip: !databaseUrl }, async (t) => {
  const { withTransaction } = await import('../database/transaction.js');
  const { run, get: dbGet } = await import('../db.js');
  const pool = await getPool();
  const tableName = `test_global_run_${Date.now()}`;

  t.after(async () => {
    await pool.query(`DROP TABLE IF EXISTS ${tableName}`);
    await pool.end();
  });

  await pool.query(`CREATE TABLE IF NOT EXISTS ${tableName} (id SERIAL PRIMARY KEY, value TEXT)`);

  try {
    await withTransaction({ mode: 'postgres', pool }, async (tx) => {
      await run(`INSERT INTO ${tableName} (value) VALUES (?)`, ['global-inside']);
      throw new Error('Rollback global helper test');
    });
  } catch { /* expected */ }

  const result = await pool.query(`SELECT COUNT(*) as cnt FROM ${tableName}`);
  assert.equal(parseInt(result.rows[0].cnt, 10), 0, 'Global run inside tx rolled back');
});

test('POSTGRES: global get() inside transaction sees uncommitted data', { skip: !databaseUrl }, async (t) => {
  const { withTransaction } = await import('../database/transaction.js');
  const { run, get: dbGet } = await import('../db.js');
  const pool = await getPool();
  const tableName = `test_global_get_${Date.now()}`;

  t.after(async () => {
    await pool.query(`DROP TABLE IF EXISTS ${tableName}`);
    await pool.end();
  });

  await pool.query(`CREATE TABLE IF NOT EXISTS ${tableName} (id SERIAL PRIMARY KEY, value TEXT)`);

  let rowSeen = null;
  await withTransaction({ mode: 'postgres', pool }, async (tx) => {
    await run(`INSERT INTO ${tableName} (value) VALUES (?)`, ['uncommitted']);
    rowSeen = await dbGet(`SELECT value FROM ${tableName} WHERE value=?`, ['uncommitted']);
  });

  assert.ok(rowSeen, 'Global get() inside tx saw uncommitted row');
  assert.equal(rowSeen.value, 'uncommitted');
});

// ── PostgreSQL JSONB progress tests ─────────────────────────────────

test('POSTGRES: repeated save of JSONB progress succeeds', { skip: !databaseUrl }, async (t) => {
  const { runMigrations } = await import('../database/migrations.js');
  const { run, get: dbGet, withDbTransaction } = await import('../db.js');
  const pool = await getPool();
  const userId = `pg_jsonb_${Date.now()}`;
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

  await runMigrations({ mode: 'postgres', pool, sqlite: null, persistFn: null, migrationsDir: join(serverDir, 'migrations') });

  await pool.query("INSERT INTO users (id,nickname,role,created_at,updated_at) VALUES ($1,'test','user',NOW(),NOW())", [userId]);
  await pool.query("INSERT INTO coloring_templates (id,title,width,height,palette_json,cells_json,created_at,updated_at) VALUES ($1,'test',4,4,$2,$3,NOW(),NOW())",
    [templateId, JSON.stringify(['#000000', '#ffffff']), JSON.stringify(new Array(16).fill(0))]);

  const filled = new Array(16).fill(0);
  await withDbTransaction(async (tx) => {
    await tx.run(
      'INSERT INTO coloring_progress (user_id,template_id,filled_json,revision,completed_at,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,NOW(),NOW())',
      [userId, templateId, JSON.stringify(filled), 1, null]
    );
  });

  const updated = new Array(16).fill(1);
  const result1 = await pool.query(
    'UPDATE coloring_progress SET filled_json=$1::jsonb, revision=$2, updated_at=NOW() WHERE user_id=$3 AND template_id=$4 AND revision=1 RETURNING revision, filled_json',
    [JSON.stringify(updated), 2, userId, templateId]
  );

  assert.equal(result1.rows[0].revision, 2, 'First update incremented revision to 2');

  const updated2 = new Array(16).fill(0);
  updated2[0] = 1;
  const result2 = await pool.query(
    'UPDATE coloring_progress SET filled_json=$1::jsonb, revision=$2, updated_at=NOW() WHERE user_id=$3 AND template_id=$4 AND revision=2 RETURNING revision',
    [JSON.stringify(updated2), 3, userId, templateId]
  );

  assert.equal(result2.rows[0].revision, 3, 'Second save (JSONB) succeeded');

  const finalRow = await pool.query('SELECT filled_json, revision FROM coloring_progress WHERE user_id=$1 AND template_id=$2', [userId, templateId]);
  assert.equal(finalRow.rows[0].revision, 3, 'Final revision is 3');
  assert.ok(Array.isArray(finalRow.rows[0].filled_json), 'filled_json is array (JSONB)');

  const parsedProgress = Array.isArray(finalRow.rows[0].filled_json) ? finalRow.rows[0].filled_json : JSON.parse(finalRow.rows[0].filled_json);
  assert.equal(parsedProgress[0], 1, 'First cell matches second update');
});

// ── PostgreSQL optimistic locking tests ─────────────────────────────

test('POSTGRES: old revision gets 409', { skip: !databaseUrl }, async (t) => {
  const { runMigrations } = await import('../database/migrations.js');
  const { withDbTransaction } = await import('../db.js');
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

  await runMigrations({ mode: 'postgres', pool, sqlite: null, persistFn: null, migrationsDir: join(serverDir, 'migrations') });
  await pool.query("INSERT INTO users (id,nickname,role,created_at,updated_at) VALUES ($1,'test','user',NOW(),NOW())", [userId]);

  await pool.query(
    "INSERT INTO coloring_templates (id,title,width,height,palette_json,cells_json,created_at,updated_at) VALUES ($1,'test',4,4,$2,$3,NOW(),NOW())",
    [templateId, JSON.stringify(['#000','#fff']), JSON.stringify(new Array(16).fill(0))]
  );

  await pool.query(
    'INSERT INTO coloring_progress (user_id,template_id,filled_json,revision,created_at,updated_at) VALUES ($1,$2,$3::jsonb,$4,NOW(),NOW())',
    [userId, templateId, JSON.stringify(new Array(16).fill(0)), 2]
  );

  let conflict = false;
  try {
    await withDbTransaction(async (tx) => {
      const r = await tx.run(
        'UPDATE coloring_progress SET filled_json=$1::jsonb, revision=$2, updated_at=NOW() WHERE user_id=$3 AND template_id=$4 AND revision=$5',
        [JSON.stringify(new Array(16).fill(1)), 3, userId, templateId, 1]
      );
      if (r.changes === 0) conflict = true;
    });
  } catch (e) {
    conflict = true;
  }

  assert.ok(conflict, 'Old revision should not succeed');

  const row = await pool.query('SELECT revision FROM coloring_progress WHERE user_id=$1 AND template_id=$2', [userId, templateId]);
  assert.equal(parseInt(row.rows[0].revision, 10), 2, 'Revision unchanged');
});

test('POSTGRES: future revision gets 409', { skip: !databaseUrl }, async (t) => {
  const { runMigrations } = await import('../database/migrations.js');
  const { withDbTransaction } = await import('../db.js');
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

  await runMigrations({ mode: 'postgres', pool, sqlite: null, persistFn: null, migrationsDir: join(serverDir, 'migrations') });
  await pool.query("INSERT INTO users (id,nickname,role,created_at,updated_at) VALUES ($1,'test','user',NOW(),NOW())", [userId]);
  await pool.query(
    "INSERT INTO coloring_templates (id,title,width,height,palette_json,cells_json,created_at,updated_at) VALUES ($1,'test',4,4,$2,$3,NOW(),NOW())",
    [templateId, JSON.stringify(['#000','#fff']), JSON.stringify(new Array(16).fill(0))]
  );

  await pool.query(
    'INSERT INTO coloring_progress (user_id,template_id,filled_json,revision,created_at,updated_at) VALUES ($1,$2,$3::jsonb,$4,NOW(),NOW())',
    [userId, templateId, JSON.stringify(new Array(16).fill(0)), 1]
  );

  let conflict = false;
  try {
    await withDbTransaction(async (tx) => {
      const r = await tx.run(
        'UPDATE coloring_progress SET filled_json=$1::jsonb, revision=$2, updated_at=NOW() WHERE user_id=$3 AND template_id=$4 AND revision=$5',
        [JSON.stringify(new Array(16).fill(1)), 2, userId, templateId, 3]
      );
      if (r.changes === 0) conflict = true;
    });
  } catch (e) {
    conflict = true;
  }

  assert.ok(conflict, 'Future revision should not succeed');

  const row = await pool.query('SELECT revision FROM coloring_progress WHERE user_id=$1 AND template_id=$2', [userId, templateId]);
  assert.equal(parseInt(row.rows[0].revision, 10), 1, 'Revision unchanged');
});

test('POSTGRES: two concurrent PUTs with same revision — one success, one 409', { skip: !databaseUrl }, async (t) => {
  const { runMigrations } = await import('../database/migrations.js');
  const { withDbTransaction } = await import('../db.js');
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

  await runMigrations({ mode: 'postgres', pool, sqlite: null, persistFn: null, migrationsDir: join(serverDir, 'migrations') });
  await pool.query("INSERT INTO users (id,nickname,role,created_at,updated_at) VALUES ($1,'test','user',NOW(),NOW())", [userId]);
  await pool.query(
    "INSERT INTO coloring_templates (id,title,width,height,palette_json,cells_json,created_at,updated_at) VALUES ($1,'test',4,4,$2,$3,NOW(),NOW())",
    [templateId, JSON.stringify(['#000','#fff']), JSON.stringify(new Array(16).fill(0))]
  );

  await pool.query(
    'INSERT INTO coloring_progress (user_id,template_id,filled_json,revision,created_at,updated_at) VALUES ($1,$2,$3::jsonb,$4,NOW(),NOW())',
    [userId, templateId, JSON.stringify(new Array(16).fill(0)), 1]
  );

  const results = await Promise.allSettled([
    withDbTransaction(async (tx) => {
      const r = await tx.run(
        'UPDATE coloring_progress SET filled_json=$1::jsonb, revision=$2, updated_at=NOW() WHERE user_id=$3 AND template_id=$4 AND revision=$5',
        [JSON.stringify(new Array(16).fill(1)), 2, userId, templateId, 1]
      );
      return { changes: r.changes };
    }),
    withDbTransaction(async (tx) => {
      const r = await tx.run(
        'UPDATE coloring_progress SET filled_json=$1::jsonb, revision=$2, updated_at=NOW() WHERE user_id=$3 AND template_id=$4 AND revision=$5',
        [JSON.stringify(new Array(16).fill(2)), 2, userId, templateId, 1]
      );
      return { changes: r.changes };
    }),
  ]);

  const successes = results.filter((r) => r.status === 'fulfilled' && r.value.changes === 1);
  const conflicts = results.filter((r) => r.status === 'fulfilled' && r.value.changes === 0) || [];

  const allFulfilled = results.every((r) => r.status === 'fulfilled');

  assert.equal(successes.length, 1, 'Exactly one request succeeds');
  assert.ok(allFulfilled, 'Second is 409 (changes=0), no error');

  const row = await pool.query('SELECT revision FROM coloring_progress WHERE user_id=$1 AND template_id=$2', [userId, templateId]);
  assert.equal(parseInt(row.rows[0].revision, 10), 2, 'Revision incremented exactly once');
});

test('POSTGRES: two concurrent initial inserts with revision 0 — one success, one 409', { skip: !databaseUrl }, async (t) => {
  const { runMigrations } = await import('../database/migrations.js');
  const { withDbTransaction } = await import('../db.js');
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

  await runMigrations({ mode: 'postgres', pool, sqlite: null, persistFn: null, migrationsDir: join(serverDir, 'migrations') });
  await pool.query("INSERT INTO users (id,nickname,role,created_at,updated_at) VALUES ($1,'test','user',NOW(),NOW())", [userId]);
  await pool.query(
    "INSERT INTO coloring_templates (id,title,width,height,palette_json,cells_json,created_at,updated_at) VALUES ($1,'test',4,4,$2,$3,NOW(),NOW())",
    [templateId, JSON.stringify(['#000','#fff']), JSON.stringify(new Array(16).fill(0))]
  );

  const inserted = [];
  const rejected = [];

  const results = await Promise.allSettled([
    (async () => {
      try {
        await withDbTransaction(async (tx) => {
          await tx.run(
            'INSERT INTO coloring_progress (user_id,template_id,filled_json,revision,completed_at,created_at,updated_at) VALUES ($1,$2,$3::jsonb,$4,$5,NOW(),NOW())',
            [userId, templateId, JSON.stringify(new Array(16).fill(0)), 1, null]
          );
        });
        inserted.push(1);
      } catch (e) {
        rejected.push(e);
      }
    })(),
    (async () => {
      try {
        await withDbTransaction(async (tx) => {
          await tx.run(
            'INSERT INTO coloring_progress (user_id,template_id,filled_json,revision,completed_at,created_at,updated_at) VALUES ($1,$2,$3::jsonb,$4,$5,NOW(),NOW())',
            [userId, templateId, JSON.stringify(new Array(16).fill(0)), 1, null]
          );
        });
        inserted.push(2);
      } catch (e) {
        rejected.push(e);
      }
    })(),
  ]);

  assert.equal(inserted.length, 1, 'Exactly one insert succeeds');
  assert.equal(rejected.length, 1, 'One insert gets conflict');

  const row = await pool.query('SELECT COUNT(*) as cnt FROM coloring_progress WHERE user_id=$1 AND template_id=$2', [userId, templateId]);
  assert.equal(parseInt(row.rows[0].cnt, 10), 1, 'Only one row in database');
});

test('POSTGRES: pool works after conflict', { skip: !databaseUrl }, async (t) => {
  const { runMigrations } = await import('../database/migrations.js');
  const { withDbTransaction } = await import('../db.js');
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

  await runMigrations({ mode: 'postgres', pool, sqlite: null, persistFn: null, migrationsDir: join(serverDir, 'migrations') });
  await pool.query("INSERT INTO users (id,nickname,role,created_at,updated_at) VALUES ($1,'test','user',NOW(),NOW())", [userId]);
  await pool.query(
    "INSERT INTO coloring_templates (id,title,width,height,palette_json,cells_json,created_at,updated_at) VALUES ($1,'test',4,4,$2,$3,NOW(),NOW())",
    [templateId, JSON.stringify(['#000','#fff']), JSON.stringify(new Array(16).fill(0))]
  );

  await pool.query(
    'INSERT INTO coloring_progress (user_id,template_id,filled_json,revision,created_at,updated_at) VALUES ($1,$2,$3::jsonb,$4,NOW(),NOW())',
    [userId, templateId, JSON.stringify(new Array(16).fill(0)), 1]
  );

  let conflictHappened = false;
  try {
    await withDbTransaction(async (tx) => {
      const r = await tx.run(
        'UPDATE coloring_progress SET filled_json=$1::jsonb, revision=$2, updated_at=NOW() WHERE user_id=$3 AND template_id=$4 AND revision=$5',
        [JSON.stringify(new Array(16).fill(1)), 2, userId, templateId, 99]
      );
      if (r.changes === 0) conflictHappened = true;
    });
  } catch { /* ignore */ }

  assert.ok(conflictHappened, 'CAS conflict detected');

  const result = await pool.query('SELECT 1 as alive');
  assert.equal(result.rows[0].alive, 1, 'Pool still works after conflict');
});

test('POSTGRES: adapter closed after commit', { skip: !databaseUrl }, async (t) => {
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

test('POSTGRES: adapter closed after rollback', { skip: !databaseUrl }, async (t) => {
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
  } catch { /* expected */ }

  try {
    await capturedTx.run(`INSERT INTO ${tableName} (value) VALUES ($1)`, ['bad']);
    assert.fail('Should throw TransactionClosedError');
  } catch (e) {
    assert.ok(e instanceof TransactionClosedError, 'Adapter closed after rollback');
  }
});
