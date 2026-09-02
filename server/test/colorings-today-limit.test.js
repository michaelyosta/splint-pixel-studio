import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import initSqlJs from 'sql.js';
import { runMigrations } from '../database/migrations.js';
import { withTransaction } from '../database/transaction.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const serverDir = join(__dirname, '..');
const migrationsDir = join(serverDir, 'migrations', 'sqlite');
const basePort = 31967;
const NOW = '2026-08-07T10:00:00.000Z';

async function seedDatabase(dbPath) {
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  db.run('PRAGMA foreign_keys = ON;');
  await runMigrations({ mode: 'sqlite', pool: null, sqlite: db, persistFn: null, migrationsDir });

  await withTransaction({ mode: 'sqlite', sqlite: db, persistFn: null }, async (tx) => {
    await tx.run(`INSERT INTO users (id,nickname,role,created_at,updated_at)
      VALUES ('today_tester','Today tester','user',?,?)`, [NOW, NOW]);

    const baseTime = Date.parse(NOW);
    for (let index = 0; index < 12; index += 1) {
      const id = `today_${String(index).padStart(2, '0')}`;
      const addedAt = new Date(baseTime + (11 - index) * 1_000).toISOString();
      await tx.run(`INSERT INTO coloring_templates
        (id,owner_id,title,description,category,difficulty,width,height,palette_json,cells_json,
         preview_url,original_media_key,source_type,visibility,status,created_at,updated_at,mood,
         theme,est_minutes,collection_id,zone_count,daily_featured,added_at,storage_mode,tile_size)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [
        id,
        null,
        `Today ${index}`,
        '',
        'featured',
        'easy',
        2,
        2,
        JSON.stringify(['#000000', '#ffffff']),
        JSON.stringify([0, 0, 0, 0]),
        null,
        null,
        'catalog',
        'public',
        'active',
        addedAt,
        addedAt,
        'calm',
        'featured',
        3,
        null,
        1,
        index === 10 ? 1 : 0,
        addedAt,
        'legacy',
        32,
      ]);
    }
  });

  writeFileSync(dbPath, Buffer.from(db.export()));
  db.close();
}

async function stopServer(server) {
  if (server.exitCode !== null) return;
  const exited = new Promise((resolve) => server.once('exit', resolve));
  server.kill();
  await Promise.race([
    exited,
    new Promise((resolve) => setTimeout(resolve, 5_000)),
  ]);
}

async function request(port, path) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    headers: { 'X-User-Id': 'today_tester' },
  });
  const json = await response.json().catch(() => ({}));
  return { response, json };
}

async function withServer(t, fn) {
  const directory = await mkdtemp(join(tmpdir(), 'splint-colorings-today-'));
  const dbPath = join(directory, 'fixture.db.bin');
  await seedDatabase(dbPath);
  const server = spawn('node', ['index.js'], {
    cwd: serverDir,
    env: {
      ...process.env,
      DATABASE_URL: '',
      PORT: String(basePort),
      SQLITE_DB_PATH: dbPath,
      MEDIA_STORAGE_ROOT: join(directory, 'uploads'),
      ALLOW_DEV_AUTH: 'true',
      GUIDANCE_BACKFILL_AUTO: 'false',
      RATE_LIMIT_MAX: '10000',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Colorings today API server did not start')), 15_000);
    server.stdout.on('data', (chunk) => {
      if (chunk.toString().includes('running on')) {
        clearTimeout(timer);
        resolve();
      }
    });
    server.once('error', reject);
  });
  t.after(async () => {
    await stopServer(server);
    await rm(directory, { recursive: true, force: true });
  });
  return fn(basePort);
}

test('today newest is capped in SQL while preserving editorial response shape and order', async (t) => {
  await withServer(t, async (port) => {
    const result = await request(port, '/colorings/today');
    assert.equal(result.response.status, 200);
    assert.deepEqual(Object.keys(result.json), ['for_you', 'quick', 'newest']);
    assert.equal(result.json.for_you.id, 'today_10');
    assert.deepEqual(
      result.json.quick.map((item) => item.id),
      ['today_00', 'today_01', 'today_02', 'today_03', 'today_04', 'today_05'],
    );
    assert.equal(result.json.newest.length, 8);
    assert.deepEqual(
      result.json.newest.map((item) => item.id),
      ['today_00', 'today_01', 'today_02', 'today_03', 'today_04', 'today_05', 'today_06', 'today_07'],
    );
    assert.deepEqual(
      result.json.newest.map((item) => item.added_at),
      [...result.json.newest].sort((left, right) => right.added_at.localeCompare(left.added_at)).map((item) => item.added_at),
    );
  });
});
