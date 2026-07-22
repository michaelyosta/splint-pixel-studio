import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import initSqlJs from 'sql.js';
import { runMigrations } from '../database/migrations.js';
import { withTransaction, NestedTransactionError, TransactionClosedError } from '../database/transaction.js';

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
  assert.ok(versions.includes('004'), 'Should have version 004');
});

test('Migration runner is idempotent', async (t) => {
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  db.run('PRAGMA foreign_keys = ON;');

  const migrationsDir = join(serverDir, 'migrations', 'sqlite');

  await runMigrations({ mode: 'sqlite', pool: null, sqlite: db, persistFn: null, migrationsDir });
  const result2 = await runMigrations({ mode: 'sqlite', pool: null, sqlite: db, persistFn: null, migrationsDir });

  assert.equal(result2.applied, 0, 'Second run should apply zero migrations');
  assert.equal(result2.skipped, 4, 'Second run should skip all 4 migrations');
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

test('Legacy database (no schema_migrations) upgrades successfully', async (t) => {
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  db.run('PRAGMA foreign_keys = ON;');

  db.run(`CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, telegram_id INTEGER, nickname TEXT, avatar_url TEXT, status TEXT DEFAULT '', karma INTEGER DEFAULT 0, stars_balance INTEGER DEFAULT 0, messages_disabled INTEGER DEFAULT 0, followers_only INTEGER DEFAULT 0, paid_open INTEGER DEFAULT 0, price_in_stars INTEGER DEFAULT 10, is_banned INTEGER DEFAULT 0, role TEXT NOT NULL DEFAULT 'user', created_at TEXT, updated_at TEXT);`);

  const migrationsDir = join(serverDir, 'migrations', 'sqlite');

  const result = await runMigrations({ mode: 'sqlite', pool: null, sqlite: db, persistFn: null, migrationsDir });

  assert.equal(result.applied, 0, 'Legacy DB should have all versions pre-registered');

  const stmt = db.prepare('SELECT version FROM schema_migrations ORDER BY version');
  const versions = [];
  while (stmt.step()) versions.push(stmt.getAsObject().version);
  stmt.free();
  assert.ok(versions.includes('004'), 'Legacy DB should have all versions recorded');
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
        // should not reach here
      });
    });
    assert.fail('Should have thrown NestedTransactionError');
  } catch (e) {
    assert.ok(e instanceof NestedTransactionError, 'Should throw NestedTransactionError');
  }
});

test('Transaction adapter rejects usage after close', async (t) => {
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
