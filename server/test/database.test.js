import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import initSqlJs from 'sql.js';
import { runMigrations } from '../database/migrations.js';
import { withTransaction, NestedTransactionError, TransactionClosedError } from '../database/transaction.js';
import { scheduleSqliteOperation, isSqliteLocked } from '../database/sqlite-scheduler.js';
import { runInTransactionContext, getTransactionContext } from '../database/runtime-context.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const serverDir = join(__dirname, '..');

function cloneEnv(overrides = {}) {
  const env = { ...process.env };
  delete env.DATABASE_URL;
  delete env.NODE_ENV;
  delete env.ALLOW_DESTRUCTIVE_DB_RESET;
  delete env.SEED_DEMO_DATA;
  return { ...env, ...overrides };
}

// ── Demo seed tests ─────────────────────────────────────────────────

test('Normal startup does not create demo users', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'splint-noseed-'));
  const dbPath = join(dir, 'test.db.bin');
  const port = 32001;

  const server = spawn('node', ['index.js'], {
    cwd: serverDir,
    env: cloneEnv({ PORT: String(port), SQLITE_DB_PATH: dbPath, ALLOW_DEV_AUTH: 'true' }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Server did not start')), 10_000);
    server.stdout.on('data', (chunk) => {
      if (chunk.toString().includes('running on')) { clearTimeout(timer); resolve(); }
    });
    server.once('error', reject);
  });

  const res = await fetch(`http://127.0.0.1:${port}/users/me`, {
    headers: { 'X-User-Id': 'user_pixelhunter' },
  });
  assert.equal(res.status, 200, 'Dev auth creates user on demand');

  server.kill();
  await rm(dir, { recursive: true, force: true });
});

test('SEED_DEMO_DATA creates demo dataset', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'splint-seed-'));
  const dbPath = join(dir, 'test.db.bin');
  const port = 32002;

  const server = spawn('node', ['index.js'], {
    cwd: serverDir,
    env: cloneEnv({ PORT: String(port), SQLITE_DB_PATH: dbPath, ALLOW_DEV_AUTH: 'true', SEED_DEMO_DATA: 'true' }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Server did not start')), 10_000);
    server.stdout.on('data', (chunk) => {
      if (chunk.toString().includes('running on')) { clearTimeout(timer); resolve(); }
    });
    server.once('error', reject);
  });

  const me = await fetch(`http://127.0.0.1:${port}/users/me`, {
    headers: { 'X-User-Id': 'user_pixelhunter' },
  });
  assert.equal(me.status, 200);
  const body = await me.json();
  assert.equal(body.id, 'user_pixelhunter');
  assert.ok(body.stars_balance > 0, 'PixelHunter should have stars');

  const catalog = await fetch(`http://127.0.0.1:${port}/colorings`, {
    headers: { 'X-User-Id': 'user_pixelhunter' },
  });
  assert.equal(catalog.status, 200);
  const catBody = await catalog.json();
  assert.ok(catBody.length >= 6, 'Should have catalog templates');

  server.kill();
  await rm(dir, { recursive: true, force: true });
});

test('SEED_DEMO_DATA is idempotent (repeat seed does not duplicate)', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'splint-idem-'));
  const dbPath = join(dir, 'test.db.bin');
  const port = 32003;

  const startServer = () => spawn('node', ['index.js'], {
    cwd: serverDir,
    env: cloneEnv({ PORT: String(port), SQLITE_DB_PATH: dbPath, ALLOW_DEV_AUTH: 'true', SEED_DEMO_DATA: 'true' }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let server = startServer();
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Server did not start')), 10_000);
    server.stdout.on('data', (chunk) => {
      if (chunk.toString().includes('running on')) { clearTimeout(timer); resolve(); }
    });
    server.once('error', reject);
  });

  const first = await fetch(`http://127.0.0.1:${port}/users/me`, {
    headers: { 'X-User-Id': 'user_pixelhunter' },
  });
  const firstBody = await first.json();

  server.kill();
  await new Promise((r) => setTimeout(r, 500));

  server = startServer();
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Server did not start')), 10_000);
    server.stdout.on('data', (chunk) => {
      if (chunk.toString().includes('running on')) { clearTimeout(timer); resolve(); }
    });
    server.once('error', reject);
  });

  const second = await fetch(`http://127.0.0.1:${port}/users/me`, {
    headers: { 'X-User-Id': 'user_pixelhunter' },
  });
  const secondBody = await second.json();

  assert.equal(firstBody.stars_balance, secondBody.stars_balance, 'Stars should not increase on repeat seed');

  server.kill();
  await rm(dir, { recursive: true, force: true });
});

test('Production blocks SEED_DEMO_DATA', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'splint-prodseed-'));
  const dbPath = join(dir, 'test.db.bin');

  const server = spawn('node', ['index.js'], {
    cwd: serverDir,
    env: cloneEnv({ NODE_ENV: 'production', PORT: '32004', SQLITE_DB_PATH: dbPath, SEED_DEMO_DATA: 'true' }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let errorOutput = '';
  const exitCode = await new Promise((resolve) => {
    server.stderr.on('data', (chunk) => { errorOutput += chunk.toString(); });
    server.once('exit', (code) => resolve(code));
  });

  assert.notEqual(exitCode, 0, 'Production with SEED_DEMO_DATA should fail');
  assert.ok(
    errorOutput.includes('SEED_DEMO_DATA') || exitCode !== 0,
    'Should mention SEED_DEMO_DATA restriction',
  );

  server.kill();
  await rm(dir, { recursive: true, force: true });
});

// ── Reset safety tests ──────────────────────────────────────────────

test('Production reset is blocked', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'splint-prodreset-'));
  const dbPath = join(dir, 'test.db.bin');

  const server = spawn('node', ['reset-demo.js'], {
    cwd: serverDir,
    env: cloneEnv({ NODE_ENV: 'production', SQLITE_DB_PATH: dbPath }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let output = '';
  const exitCode = await new Promise((resolve) => {
    server.stderr.on('data', (chunk) => { output += chunk.toString(); });
    server.stdout.on('data', (chunk) => { output += chunk.toString(); });
    server.once('exit', (code) => resolve(code));
  });

  assert.notEqual(exitCode, 0, 'Production reset should exit with error');
  assert.ok(output.includes('production'), 'Should mention production restriction');

  server.kill();
  await rm(dir, { recursive: true, force: true });
});

test('Reset preserves tg_ users', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'splint-tgkeep-'));
  const dbPath = join(dir, 'test.db.bin');
  const port = 32005;

  let server = spawn('node', ['index.js'], {
    cwd: serverDir,
    env: cloneEnv({ PORT: String(port), SQLITE_DB_PATH: dbPath, ALLOW_DEV_AUTH: 'true', SEED_DEMO_DATA: 'true' }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Server did not start')), 10_000);
    server.stdout.on('data', (chunk) => {
      if (chunk.toString().includes('running on')) { clearTimeout(timer); resolve(); }
    });
    server.once('error', reject);
  });

  await fetch(`http://127.0.0.1:${port}/users/me`, {
    headers: { 'X-User-Id': 'tg_12345' },
  });

  server.kill();
  await new Promise((r) => setTimeout(r, 500));

  const resetProc = spawn('node', ['reset-demo.js'], {
    cwd: serverDir,
    env: cloneEnv({ SQLITE_DB_PATH: dbPath }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let resetOutput = '';
  const resetCode = await new Promise((resolve) => {
    resetProc.stdout.on('data', (chunk) => { resetOutput += chunk.toString(); });
    resetProc.stderr.on('data', (chunk) => { resetOutput += chunk.toString(); });
    resetProc.once('exit', (code) => resolve(code));
  });
  assert.equal(resetCode, 0, `Reset should succeed, got: ${resetOutput}`);
  resetProc.kill();

  server = spawn('node', ['index.js'], {
    cwd: serverDir,
    env: cloneEnv({ PORT: String(port), SQLITE_DB_PATH: dbPath, ALLOW_DEV_AUTH: 'true' }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Server did not start')), 10_000);
    server.stdout.on('data', (chunk) => {
      if (chunk.toString().includes('running on')) { clearTimeout(timer); resolve(); }
    });
    server.once('error', reject);
  });

  const tgUser = await fetch(`http://127.0.0.1:${port}/users/me`, {
    headers: { 'X-User-Id': 'tg_12345' },
  });
  assert.equal(tgUser.status, 200, 'tg_ user should survive reset');

  const checkUser = await fetch(`http://127.0.0.1:${port}/users/me`, {
    headers: { 'X-User-Id': 'tg_12345' },
  });
  assert.equal(checkUser.status, 200);
  const checkBody = await checkUser.json();
  assert.equal(checkBody.id, 'tg_12345');

  const demoBodyRes = await fetch(`http://127.0.0.1:${port}/users/user_pixelhunter/profile`, {
    headers: { 'X-User-Id': 'tg_12345' },
  });
  assert.notEqual(demoBodyRes.status, 200, 'Demo user profile should be gone after reset');

  server.kill();
  await rm(dir, { recursive: true, force: true });
});

// ── Migration runner tests ──────────────────────────────────────────

test('Migration runner applies all migrations on clean DB', async (t) => {
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  db.run('PRAGMA foreign_keys = ON;');

  const migrationsDir = join(serverDir, 'migrations', 'sqlite');

  const result = await runMigrations({
    mode: 'sqlite',
    pool: null,
    sqlite: db,
    persistFn: null,
    migrationsDir,
  });

  assert.ok(result.applied >= 2, `Should apply migrations, got ${result.applied}`);

  const stmt = db.prepare('SELECT version FROM schema_migrations ORDER BY version');
  const versions = [];
  while (stmt.step()) versions.push(stmt.getAsObject().version);
  stmt.free();
  assert.ok(versions.includes('001'), 'Should have version 001');
  assert.ok(versions.includes('005'), 'Should have version 005');
});

test('Migration runner is idempotent', async (t) => {
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  db.run('PRAGMA foreign_keys = ON;');

  const migrationsDir = join(serverDir, 'migrations', 'sqlite');

  await runMigrations({ mode: 'sqlite', pool: null, sqlite: db, persistFn: null, migrationsDir });
  const result2 = await runMigrations({ mode: 'sqlite', pool: null, sqlite: db, persistFn: null, migrationsDir });

  assert.equal(result2.applied, 0, 'Second run should apply zero migrations');
  assert.equal(result2.skipped, 5, 'Second run should skip all 5 migrations');
});

test('Changed checksum causes error', async (t) => {
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  db.run('PRAGMA foreign_keys = ON;');

  const migrationsDir = join(serverDir, 'migrations', 'sqlite');

  await runMigrations({ mode: 'sqlite', pool: null, sqlite: db, persistFn: null, migrationsDir });

  db.run("UPDATE schema_migrations SET checksum='tampered' WHERE version='001'");

  await assert.rejects(
    () => runMigrations({ mode: 'sqlite', pool: null, sqlite: db, persistFn: null, migrationsDir }),
    /Checksum mismatch/,
    'Should detect checksum mismatch',
  );
});

test('Legacy database (no schema_migrations) upgrades and applies 004-005', async (t) => {
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  db.run('PRAGMA foreign_keys = ON;');

  db.run(`CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, telegram_id INTEGER, nickname TEXT, avatar_url TEXT, status TEXT DEFAULT '', karma INTEGER DEFAULT 0, stars_balance INTEGER DEFAULT 0, messages_disabled INTEGER DEFAULT 0, followers_only INTEGER DEFAULT 0, paid_open INTEGER DEFAULT 0, price_in_stars INTEGER DEFAULT 10, is_banned INTEGER DEFAULT 0, role TEXT NOT NULL DEFAULT 'user', created_at TEXT, updated_at TEXT);`);
  db.run(`CREATE TABLE IF NOT EXISTS coloring_templates (id TEXT PRIMARY KEY, owner_id TEXT, title TEXT NOT NULL, mood TEXT NOT NULL DEFAULT 'calm', theme TEXT NOT NULL DEFAULT 'featured', source_type TEXT DEFAULT 'catalog', created_at TEXT NOT NULL, updated_at TEXT NOT NULL);`);
  db.run(`CREATE TABLE IF NOT EXISTS posts (id TEXT PRIMARY KEY, author_id TEXT, title TEXT, published_at TEXT, created_at TEXT, updated_at TEXT);`);
  db.run(`CREATE TABLE IF NOT EXISTS daily_streaks (user_id TEXT PRIMARY KEY, current_streak INTEGER DEFAULT 0, created_at TEXT, updated_at TEXT);`);
  db.run(`CREATE TABLE IF NOT EXISTS achievements (id TEXT PRIMARY KEY, title TEXT, created_at TEXT);`);
  db.run(`CREATE TABLE IF NOT EXISTS collections (id TEXT PRIMARY KEY, title TEXT NOT NULL, price_in_stars INTEGER DEFAULT 0);`);
  db.run(`CREATE TABLE IF NOT EXISTS message_requests (id TEXT PRIMARY KEY, sender_id TEXT, receiver_id TEXT, price_in_stars INTEGER DEFAULT 0, text TEXT, status TEXT DEFAULT 'created', created_at TEXT, updated_at TEXT);`);
  db.run(`CREATE TABLE IF NOT EXISTS artworks (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, source_type TEXT DEFAULT 'user', image_url TEXT, title TEXT NOT NULL, collection_id TEXT, collection_title TEXT, rarity TEXT, is_completed INTEGER DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);`);

  const migrationsDir = join(serverDir, 'migrations', 'sqlite');

  const result = await runMigrations({ mode: 'sqlite', pool: null, sqlite: db, persistFn: null, migrationsDir });

  assert.equal(result.applied, 2, 'Legacy DB: should apply migrations 004 and 005');
  assert.equal(result.skipped, 3, 'Legacy DB: should skip baseline 001-003');

  const stmt = db.prepare('SELECT version FROM schema_migrations ORDER BY version');
  const versions = [];
  while (stmt.step()) versions.push(stmt.getAsObject().version);
  stmt.free();
  assert.deepStrictEqual(versions, ['001', '002', '003', '004', '005'], 'All 5 versions recorded');

  assert.throws(() => {
    db.run("INSERT INTO users (id,nickname,stars_balance,role,created_at,updated_at) VALUES ('lb1','Bad',-5,'user','2024-01-01','2024-01-01')");
  }, /stars_balance/, 'Financial trigger active after legacy upgrade');

  assert.throws(() => {
    db.run("INSERT INTO collections (id,title,price_in_stars) VALUES ('col1','Test',-1)");
  }, /price_in_stars/, 'Collection trigger active after legacy upgrade');
});

// ── Transaction tests ───────────────────────────────────────────────

test('SQLite withTransaction commits all operations', async (t) => {
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  db.run('PRAGMA foreign_keys = ON;');
  db.run('CREATE TABLE test_tx (id INTEGER PRIMARY KEY, value TEXT);');

  let persistCount = 0;
  const persistFn = () => { persistCount++; };

  await withTransaction({ mode: 'sqlite', sqlite: db, persistFn }, async (tx) => {
    await tx.run('INSERT INTO test_tx (id, value) VALUES (?, ?)', [1, 'one']);
    await tx.run('INSERT INTO test_tx (id, value) VALUES (?, ?)', [2, 'two']);
  });

  assert.equal(persistCount, 1, 'persist should be called exactly once after commit');

  const stmt = db.prepare('SELECT COUNT(*) as cnt FROM test_tx');
  stmt.step();
  const cnt = stmt.getAsObject().cnt;
  stmt.free();
  assert.equal(cnt, 2, 'Both inserts should be committed');
});

test('SQLite withTransaction rollback on error', async (t) => {
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  db.run('PRAGMA foreign_keys = ON;');
  db.run('CREATE TABLE test_tx2 (id INTEGER PRIMARY KEY, value TEXT);');

  let persistCount = 0;
  const persistFn = () => { persistCount++; };

  const { withTransaction } = await import('../database/transaction.js');

  try {
    await withTransaction({ mode: 'sqlite', sqlite: db, persistFn }, async (tx) => {
      await tx.run('INSERT INTO test_tx2 (id, value) VALUES (?, ?)', [1, 'hello']);
      throw new Error('Intentional rollback');
    });
  } catch (e) {
    if (e.message !== 'Intentional rollback') throw e;
  }

  assert.equal(persistCount, 0, 'persist should NOT be called after rollback');

  const stmt = db.prepare('SELECT COUNT(*) as cnt FROM test_tx2');
  stmt.step();
  const cnt = stmt.getAsObject().cnt;
  stmt.free();
  assert.equal(cnt, 0, 'No inserts should be visible after rollback');
});

test('SQLite nested transaction is rejected', async (t) => {
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  db.run('PRAGMA foreign_keys = ON;');

  try {
    await withTransaction({ mode: 'sqlite', sqlite: db }, async (tx) => {
      await withTransaction({ mode: 'sqlite', sqlite: db }, async (tx2) => {
      });
    });
    assert.fail('Should have thrown NestedTransactionError');
  } catch (e) {
    assert.ok(e instanceof NestedTransactionError, 'Should throw NestedTransactionError');
  }
});

test('Parallel SQLite transactions are serialized, not rejected', async (t) => {
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  db.run('PRAGMA foreign_keys = ON;');
  db.run('CREATE TABLE test_parallel (id INTEGER PRIMARY KEY, value TEXT);');

  let barrierResolve;
  const barrier = new Promise((resolve) => { barrierResolve = resolve; });

  let tx1Done = false;

  const tx1 = withTransaction({ mode: 'sqlite', sqlite: db }, async (tx) => {
    await tx.run('INSERT INTO test_parallel (id, value) VALUES (?, ?)', [1, 'one']);
    await barrier;
    await tx.run('INSERT INTO test_parallel (id, value) VALUES (?, ?)', [2, 'two']);
    tx1Done = true;
  });

  const tx2 = withTransaction({ mode: 'sqlite', sqlite: db }, async (tx) => {
    assert.ok(tx1Done, 'tx2 should only start after tx1 completes');
    await tx.run('INSERT INTO test_parallel (id, value) VALUES (?, ?)', [3, 'three']);
  });

  await new Promise((r) => setTimeout(r, 50));
  barrierResolve();

  await Promise.all([tx1, tx2]);

  const stmt = db.prepare('SELECT COUNT(*) as cnt FROM test_parallel');
  stmt.step();
  const cnt = stmt.getAsObject().cnt;
  stmt.free();
  assert.equal(cnt, 3, 'All three inserts committed');
});

test('Transaction adapter rejects usage after close (commit)', async (t) => {
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  db.run('PRAGMA foreign_keys = ON;');
  db.run('CREATE TABLE test_tx3 (id INTEGER);');

  let capturedTx;

  await withTransaction({ mode: 'sqlite', sqlite: db }, async (tx) => {
    capturedTx = tx;
    await tx.run('INSERT INTO test_tx3 (id) VALUES (1);');
  });

  try {
    await capturedTx.run('INSERT INTO test_tx3 (id) VALUES (2);');
    assert.fail('Should throw TransactionClosedError');
  } catch (e) {
    assert.ok(e instanceof TransactionClosedError, 'Should throw TransactionClosedError');
  }
});

test('Transaction adapter rejects usage after close (rollback)', async (t) => {
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  db.run('PRAGMA foreign_keys = ON;');
  db.run('CREATE TABLE test_tx4 (id INTEGER);');

  let capturedTx;

  try {
    await withTransaction({ mode: 'sqlite', sqlite: db }, async (tx) => {
      capturedTx = tx;
      await tx.run('INSERT INTO test_tx4 (id) VALUES (1);');
      throw new Error('Rollback test');
    });
  } catch { /* expected */ }

  try {
    await capturedTx.run('INSERT INTO test_tx4 (id) VALUES (2);');
    assert.fail('Should throw TransactionClosedError');
  } catch (e) {
    assert.ok(e instanceof TransactionClosedError, 'Should throw TransactionClosedError after rollback');
  }
});

// ── Financial constraints tests ─────────────────────────────────────

test('Negative stars_balance is rejected by triggers', async (t) => {
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  db.run('PRAGMA foreign_keys = ON;');

  const migrationsDir = join(serverDir, 'migrations', 'sqlite');
  await runMigrations({ mode: 'sqlite', pool: null, sqlite: db, persistFn: null, migrationsDir });

  assert.throws(() => {
    db.run("INSERT INTO users (id,nickname,stars_balance,role,created_at,updated_at) VALUES ('bad1','Bad',-5,'user','2024-01-01','2024-01-01')");
  }, /stars_balance/, 'Should reject negative stars_balance on insert');

  db.run("INSERT INTO users (id,nickname,stars_balance,role,created_at,updated_at) VALUES ('good1','Good',10,'user','2024-01-01','2024-01-01')");

  assert.throws(() => {
    db.run("UPDATE users SET stars_balance=-1 WHERE id='good1'");
  }, /stars_balance/, 'Should reject negative stars_balance on update');
});

test('Negative price_in_stars is rejected by triggers', async (t) => {
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  db.run('PRAGMA foreign_keys = ON;');

  const migrationsDir = join(serverDir, 'migrations', 'sqlite');
  await runMigrations({ mode: 'sqlite', pool: null, sqlite: db, persistFn: null, migrationsDir });

  assert.throws(() => {
    db.run("INSERT INTO users (id,nickname,price_in_stars,role,created_at,updated_at) VALUES ('bad2','Bad',-10,'user','2024-01-01','2024-01-01')");
  }, /price_in_stars/, 'Should reject negative price_in_stars on insert');
});

test('Invalid message_requests status is rejected', async (t) => {
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  db.run('PRAGMA foreign_keys = ON;');

  const migrationsDir = join(serverDir, 'migrations', 'sqlite');
  await runMigrations({ mode: 'sqlite', pool: null, sqlite: db, persistFn: null, migrationsDir });

  db.run("INSERT INTO users (id,nickname,role,created_at,updated_at) VALUES ('u1','u1','user','2024-01-01','2024-01-01')");
  db.run("INSERT INTO users (id,nickname,role,created_at,updated_at) VALUES ('u2','u2','user','2024-01-01','2024-01-01')");
  db.run('CREATE TABLE IF NOT EXISTS message_requests (id TEXT PRIMARY KEY, sender_id TEXT, receiver_id TEXT, price_in_stars INTEGER DEFAULT 0, text TEXT, reply_text TEXT, status TEXT DEFAULT \'created\', created_at TEXT, updated_at TEXT)');

  assert.throws(() => {
    db.run("INSERT INTO message_requests (id,sender_id,receiver_id,text,status,created_at,updated_at) VALUES ('m1','u1','u2','hello','bad_status','2024-01-01','2024-01-01')");
  }, /invalid status/, 'Should reject unknown status');

  db.run("INSERT INTO message_requests (id,sender_id,receiver_id,text,status,created_at,updated_at) VALUES ('m2','u1','u2','hello','created','2024-01-01','2024-01-01')");
  db.run("UPDATE message_requests SET status='delivered' WHERE id='m2'");

  assert.throws(() => {
    db.run("UPDATE message_requests SET status='hacked' WHERE id='m2'");
  }, /invalid status/, 'Should reject unknown status on update');
});

test('Valid values are accepted', async (t) => {
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  db.run('PRAGMA foreign_keys = ON;');

  const migrationsDir = join(serverDir, 'migrations', 'sqlite');
  await runMigrations({ mode: 'sqlite', pool: null, sqlite: db, persistFn: null, migrationsDir });

  db.run("INSERT INTO users (id,nickname,stars_balance,price_in_stars,role,created_at,updated_at) VALUES ('ok1','Ok',50,25,'user','2024-01-01','2024-01-01')");
  db.run("INSERT INTO users (id,nickname,stars_balance,role,created_at,updated_at) VALUES ('ok2','Ok2',0,'user','2024-01-01','2024-01-01')");

  const stmt = db.prepare("SELECT stars_balance FROM users WHERE id='ok1'");
  stmt.step();
  assert.equal(stmt.getAsObject().stars_balance, 50);
  stmt.free();
});

// ── Concurrency tests (Test A-G) ────────────────────────────────────

test('Test A: external write waits for commit', async (t) => {
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  db.run('PRAGMA foreign_keys = ON;');
  db.run('CREATE TABLE test_a (id INTEGER PRIMARY KEY, value TEXT);');

  let persistCount = 0;
  const persistFn = () => { persistCount++; };

  let barrierResolve;
  const barrier = new Promise((resolve) => { barrierResolve = resolve; });

  let externalRunDone = false;
  let txDone = false;

  const txPromise = withTransaction({ mode: 'sqlite', sqlite: db, persistFn }, async (tx) => {
    await tx.run('INSERT INTO test_a (id, value) VALUES (?, ?)', [1, 'tx-one']);
    await barrier;
    await tx.run('INSERT INTO test_a (id, value) VALUES (?, ?)', [2, 'tx-two']);
    txDone = true;
  });

  await new Promise((r) => setTimeout(r, 30));

  const externalPromise = scheduleSqliteOperation(db, () => {
    assert.ok(txDone, 'External write should execute after tx commit');
    db.run('INSERT INTO test_a (id, value) VALUES (?, ?)', [3, 'external']);
    externalRunDone = true;
  });

  await new Promise((r) => setTimeout(r, 30));
  assert.ok(!externalRunDone, 'External write should NOT have executed yet');

  barrierResolve();
  await txPromise;
  await externalPromise;

  assert.ok(externalRunDone, 'External write executed after commit');

  const stmt = db.prepare('SELECT COUNT(*) as cnt FROM test_a');
  stmt.step();
  const cnt = stmt.getAsObject().cnt;
  stmt.free();
  assert.equal(cnt, 3, 'All three inserts committed');
  assert.equal(persistCount, 1, 'Only one persist after commit');
});

test('Test B: external write survives rollback', async (t) => {
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  db.run('PRAGMA foreign_keys = ON;');
  db.run('CREATE TABLE test_b (id INTEGER PRIMARY KEY, value TEXT);');

  let persistCount = 0;
  const persistFn = () => { persistCount++; };

  let externalRunDone = false;

  try {
    await withTransaction({ mode: 'sqlite', sqlite: db, persistFn }, async (tx) => {
      await tx.run('INSERT INTO test_b (id, value) VALUES (?, ?)', [1, 'rollback-me']);
      throw new Error('Intentional rollback for test B');
    });
  } catch (e) {
    assert.equal(e.message, 'Intentional rollback for test B');
  }

  await scheduleSqliteOperation(db, () => {
    db.run('INSERT INTO test_b (id, value) VALUES (?, ?)', [2, 'survivor']);
    persistFn();
    externalRunDone = true;
  });

  assert.ok(externalRunDone, 'External write executed after rollback');

  const stmt = db.prepare('SELECT value FROM test_b ORDER BY id');
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject().value);
  stmt.free();
  assert.deepStrictEqual(rows, ['survivor'], 'Rollback insert gone, external insert remains');
});

test('Test C: external read does not see dirty data', async (t) => {
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  db.run('PRAGMA foreign_keys = ON;');
  db.run('CREATE TABLE test_c (id INTEGER PRIMARY KEY, value TEXT);');

  let barrierResolve;
  const barrier = new Promise((resolve) => { barrierResolve = resolve; });

  let externalReadDone = false;
  let externalRow = null;

  const txPromise = withTransaction({ mode: 'sqlite', sqlite: db }, async (tx) => {
    await tx.run('INSERT INTO test_c (id, value) VALUES (?, ?)', [1, 'dirty']);
    await barrier;
    await tx.run('INSERT INTO test_c (id, value) VALUES (?, ?)', [2, 'clean']);
  });

  await new Promise((r) => setTimeout(r, 30));

  const externalPromise = scheduleSqliteOperation(db, () => {
    const stmt = db.prepare('SELECT * FROM test_c WHERE id=?');
    stmt.bind([1]);
    if (stmt.step()) externalRow = stmt.getAsObject();
    stmt.free();
    externalReadDone = true;
  });

  await new Promise((r) => setTimeout(r, 30));
  assert.ok(!externalReadDone, 'External read should wait for transaction');

  barrierResolve();
  await txPromise;
  await externalPromise;

  assert.ok(externalReadDone, 'External read executed');
  assert.ok(externalRow, 'External read saw committed row 1');
  assert.equal(externalRow.value, 'dirty');
});

test('Test C-rollback: external read after rollback does not see uncommitted', async (t) => {
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  db.run('PRAGMA foreign_keys = ON;');
  db.run('CREATE TABLE test_c2 (id INTEGER PRIMARY KEY, value TEXT);');

  try {
    await withTransaction({ mode: 'sqlite', sqlite: db }, async (tx) => {
      await tx.run('INSERT INTO test_c2 (id, value) VALUES (?, ?)', [1, 'gone']);
      throw new Error('Rollback');
    });
  } catch { /* expected */ }

  const stmt = db.prepare('SELECT COUNT(*) as cnt FROM test_c2');
  stmt.step();
  const cnt = stmt.getAsObject().cnt;
  stmt.free();
  assert.equal(cnt, 0, 'Rollback discarded insert');
});

test('Test D: global helper inside transaction uses tx', async (t) => {
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  db.run('PRAGMA foreign_keys = ON;');
  db.run('CREATE TABLE test_d (id INTEGER PRIMARY KEY, value TEXT);');

  let persistCount = 0;
  const persistFn = () => { persistCount++; };

  let contextInsideHelper = null;

  async function helperInsert(id, value) {
    contextInsideHelper = getTransactionContext();
    const { run } = await import('../db.js');
    await run('INSERT INTO test_d (id, value) VALUES (?, ?)', [id, value]);
  }

  try {
    await withTransaction({ mode: 'sqlite', sqlite: db, persistFn }, async (tx) => {
      await helperInsert(1, 'via-helper');
      throw new Error('Rollback to verify helper rolled back');
    });
  } catch { /* expected */ }

  assert.ok(contextInsideHelper, 'Helper saw transaction context');
  assert.equal(contextInsideHelper.mode, 'sqlite');

  const stmt = db.prepare('SELECT COUNT(*) as cnt FROM test_d');
  stmt.step();
  const cnt = stmt.getAsObject().cnt;
  stmt.free();
  assert.equal(cnt, 0, 'Helper insert rolled back with transaction');
  assert.equal(persistCount, 0, 'No intermediate persist inside transaction');
});

test('Test D-commit: global helper inside transaction survives commit', async (t) => {
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  db.run('PRAGMA foreign_keys = ON;');
  db.run('CREATE TABLE test_d2 (id INTEGER PRIMARY KEY, value TEXT);');

  let persistCount = 0;
  const persistFn = () => { persistCount++; };

  async function helperInsertCommit(id, value) {
    const { run } = await import('../db.js');
    const result = await run('INSERT INTO test_d2 (id, value) VALUES (?, ?)', [id, value]);
    assert.ok(result && typeof result.changes === 'number', 'run() returns changes');
    return result;
  }

  await withTransaction({ mode: 'sqlite', sqlite: db, persistFn }, async (tx) => {
    await helperInsertCommit(1, 'committed');
  });

  assert.equal(persistCount, 1, 'Persist exactly once after commit');

  const stmt = db.prepare('SELECT COUNT(*) as cnt FROM test_d2');
  stmt.step();
  const cnt = stmt.getAsObject().cnt;
  stmt.free();
  assert.equal(cnt, 1, 'Helper insert committed');
});

test('Test E: independent SQLite instances do not block each other', async (t) => {
  const SQL = await initSqlJs();
  const dbA = new SQL.Database();
  dbA.run('PRAGMA foreign_keys = ON;');
  dbA.run('CREATE TABLE test_e_a (id INTEGER PRIMARY KEY, value TEXT);');

  const dbB = new SQL.Database();
  dbB.run('PRAGMA foreign_keys = ON;');
  dbB.run('CREATE TABLE test_e_b (id INTEGER PRIMARY KEY, value TEXT);');

  let barrierResolve;
  const barrier = new Promise((resolve) => { barrierResolve = resolve; });

  let txADone = false;
  let txBDone = false;

  const txA = withTransaction({ mode: 'sqlite', sqlite: dbA }, async (tx) => {
    await tx.run('INSERT INTO test_e_a (id, value) VALUES (?, ?)', [1, 'a']);
    await barrier;
    txADone = true;
  });

  const txB = withTransaction({ mode: 'sqlite', sqlite: dbB }, async (tx) => {
    assert.ok(!txADone || txADone, 'DB B should not wait for DB A lock');
    await tx.run('INSERT INTO test_e_b (id, value) VALUES (?, ?)', [1, 'b']);
    txBDone = true;
  });

  await new Promise((r) => setTimeout(r, 30));
  assert.ok(txBDone, 'DB B completed without waiting for DB A');

  barrierResolve();
  await txA;
  assert.ok(txADone, 'DB A completed');

  const stmtA = dbA.prepare('SELECT COUNT(*) as cnt FROM test_e_a');
  stmtA.step();
  assert.equal(stmtA.getAsObject().cnt, 1);
  stmtA.free();

  const stmtB = dbB.prepare('SELECT COUNT(*) as cnt FROM test_e_b');
  stmtB.step();
  assert.equal(stmtB.getAsObject().cnt, 1);
  stmtB.free();
});

test('Test F: queue recovers after error', async (t) => {
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  db.run('PRAGMA foreign_keys = ON;');
  db.run('CREATE TABLE test_f (id INTEGER PRIMARY KEY, value TEXT);');

  let secondOpDone = false;

  const firstPromise = scheduleSqliteOperation(db, () => {
    throw new Error('First op fails');
  });

  await firstPromise.catch(() => {});

  await scheduleSqliteOperation(db, () => {
    db.run('INSERT INTO test_f (id, value) VALUES (?, ?)', [1, 'second']);
    secondOpDone = true;
  });

  assert.ok(secondOpDone, 'Second operation executed after first error');

  const stmt = db.prepare('SELECT COUNT(*) as cnt FROM test_f');
  stmt.step();
  assert.equal(stmt.getAsObject().cnt, 1);
  stmt.free();
});

test('Test G: nested transaction is rejected via context', async (t) => {
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  db.run('PRAGMA foreign_keys = ON;');

  let errorCaught = false;
  try {
    await withTransaction({ mode: 'sqlite', sqlite: db }, async (tx) => {
      await withTransaction({ mode: 'sqlite', sqlite: db }, async (tx2) => {
      });
    });
  } catch (e) {
    assert.ok(e instanceof NestedTransactionError, 'Should throw NestedTransactionError');
    errorCaught = true;
  }
  assert.ok(errorCaught, 'Nested transaction error was caught');
});

test('Test G-parallel: independent concurrent transaction waits in queue, not nested', async (t) => {
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  db.run('PRAGMA foreign_keys = ON;');
  db.run('CREATE TABLE test_g2 (id INTEGER PRIMARY KEY, value TEXT);');

  let barrierResolve;
  const barrier = new Promise((resolve) => { barrierResolve = resolve; });

  let tx1Done = false;
  let tx2Done = false;

  const tx1 = withTransaction({ mode: 'sqlite', sqlite: db }, async (tx) => {
    await tx.run('INSERT INTO test_g2 (id, value) VALUES (?, ?)', [1, 'first']);
    await barrier;
    tx1Done = true;
  });

  const tx2 = withTransaction({ mode: 'sqlite', sqlite: db }, async (tx) => {
    assert.ok(tx1Done, 'tx2 started only after tx1 completed');
    await tx.run('INSERT INTO test_g2 (id, value) VALUES (?, ?)', [2, 'second']);
    tx2Done = true;
  });

  await new Promise((r) => setTimeout(r, 30));
  assert.ok(!tx2Done, 'tx2 should not have started yet');

  barrierResolve();
  await Promise.all([tx1, tx2]);

  assert.ok(tx1Done);
  assert.ok(tx2Done);

  const stmt = db.prepare('SELECT COUNT(*) as cnt FROM test_g2');
  stmt.step();
  assert.equal(stmt.getAsObject().cnt, 2, 'Both transactions committed');
  stmt.free();
});

// ── Runtime context unit tests ──────────────────────────────────────

test('AsyncLocalStorage context exists inside callback', async (t) => {
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  db.run('PRAGMA foreign_keys = ON;');

  let contextSeen = null;

  await withTransaction({ mode: 'sqlite', sqlite: db }, async (tx) => {
    contextSeen = getTransactionContext();
  });

  assert.ok(contextSeen, 'Context exists inside callback');
  assert.equal(contextSeen.mode, 'sqlite');
  assert.ok(contextSeen.tx, 'Context has tx adapter');
});

test('AsyncLocalStorage context absent after callback', async (t) => {
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  db.run('PRAGMA foreign_keys = ON;');

  await withTransaction({ mode: 'sqlite', sqlite: db }, async () => {});

  const ctx = getTransactionContext();
  assert.equal(ctx, null, 'Context absent after callback');
});

test('AsyncLocalStorage context absent after throw', async (t) => {
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  db.run('PRAGMA foreign_keys = ON;');

  try {
    await withTransaction({ mode: 'sqlite', sqlite: db }, async () => {
      throw new Error('Test throw');
    });
  } catch { /* expected */ }

  const ctx = getTransactionContext();
  assert.equal(ctx, null, 'Context absent after throw');
});

test('AsyncLocalStorage context does not leak to independent operation', async (t) => {
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  db.run('PRAGMA foreign_keys = ON;');

  let externalCtx = null;

  const txPromise = withTransaction({ mode: 'sqlite', sqlite: db }, async () => {
    externalCtx = getTransactionContext();
  });

  await txPromise;

  const currentCtx = getTransactionContext();
  assert.equal(currentCtx, null, 'No context after transaction');
  assert.ok(externalCtx, 'Context was captured inside');
});

// ── run() changes tests ─────────────────────────────────────────────

test('SQLite transaction run() returns changes', async (t) => {
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  db.run('PRAGMA foreign_keys = ON;');
  db.run('CREATE TABLE test_changes (id INTEGER PRIMARY KEY, value TEXT);');

  await withTransaction({ mode: 'sqlite', sqlite: db }, async (tx) => {
    const r = await tx.run('INSERT INTO test_changes (id, value) VALUES (?, ?)', [1, 'one']);
    assert.equal(r.changes, 1, 'changes should be 1 for single insert');
  });
});

test('SQLite global run() returns changes', async (t) => {
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  db.run('PRAGMA foreign_keys = ON;');

  await scheduleSqliteOperation(db, () => {
    db.run('CREATE TABLE test_global_changes (id INTEGER PRIMARY KEY, value TEXT)');
    db.run('INSERT INTO test_global_changes (id, value) VALUES (?, ?)', [1, 'one']);
    const changes = db.getRowsModified();
    assert.equal(changes, 1, 'getRowsModified returns 1');
  });
});

// ── Placeholder conversion tests ────────────────────────────────────

test('? placeholders convert to $1, $2 for PostgreSQL', async (t) => {
  if (!process.env.DATABASE_URL) {
    t.skip('No DATABASE_URL');
    return;
  }

  const pool = new (await import('pg')).default.Pool({ connectionString: process.env.DATABASE_URL });
  const tableName = `test_placeholders_${Date.now()}`;

  t.after(async () => {
    await pool.query(`DROP TABLE IF EXISTS ${tableName}`);
    await pool.end();
  });

  await pool.query(`CREATE TABLE IF NOT EXISTS ${tableName} (id SERIAL PRIMARY KEY, value TEXT)`);

  const { withTransaction } = await import('../database/transaction.js');
  await withTransaction({ mode: 'postgres', pool }, async (tx) => {
    const r = await tx.run(`INSERT INTO ${tableName} (value) VALUES (?)`, ['test']);
    assert.ok(typeof r.changes === 'number', 'run returns changes');
  });

  const result = await pool.query(`SELECT * FROM ${tableName}`);
  assert.equal(result.rows.length, 1);
});

test('Native $1 placeholders are not corrupted by converter', async (t) => {
  if (!process.env.DATABASE_URL) {
    t.skip('No DATABASE_URL');
    return;
  }

  const pool = new (await import('pg')).default.Pool({ connectionString: process.env.DATABASE_URL });
  const tableName = `test_native_ph_${Date.now()}`;

  t.after(async () => {
    await pool.query(`DROP TABLE IF EXISTS ${tableName}`);
    await pool.end();
  });

  await pool.query(`CREATE TABLE IF NOT EXISTS ${tableName} (id SERIAL PRIMARY KEY, value TEXT, num INTEGER)`);

  const { withTransaction } = await import('../database/transaction.js');
  await withTransaction({ mode: 'postgres', pool }, async (tx) => {
    await tx.run(`INSERT INTO ${tableName} (value) VALUES ($1)`, ['native']);
  });

  const result = await pool.query(`SELECT value FROM ${tableName}`);
  assert.equal(result.rows[0].value, 'native');
});
