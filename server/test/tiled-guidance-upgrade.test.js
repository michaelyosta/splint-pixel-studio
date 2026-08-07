import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import initSqlJs from 'sql.js';
import { runMigrations } from '../database/migrations.js';
import { getTileGrid } from '../services/coloring-chunks.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const serverDir = join(__dirname, '..');

const port = 31913;
const baseUrl = `http://127.0.0.1:${port}`;
const PALETTE = ['#101820', '#ffffff', '#ff6b6b', '#3ecf8e', '#f7c948', '#8ab4f8'];
const WIDTH = 1200;
const HEIGHT = 1200;
const TILE_SIZE = 32;
const USER = 'user_pixelhunter';

/**
 * Build a real pre-021 SQLite database file: migrations applied, tiled
 * 1200x1200 template + existing progress, and NO static guidance rows and NO
 * index marker — the exact production state after migration 021 ran against a
 * database that already contained a tiled template.
 */
async function buildPre021DbFile(directory) {
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  db.run('PRAGMA foreign_keys = ON;');
  await runMigrations({
    mode: 'sqlite',
    pool: null,
    sqlite: db,
    persistFn: null,
    migrationsDir: join(serverDir, 'migrations', 'sqlite'),
  });

  const now = '2026-08-07T00:00:00.000Z';
  db.run('INSERT INTO users (id, telegram_id, nickname, created_at, updated_at) VALUES (?,?,?,?,?)',
    [USER, 7777, 'Pixel Hunter', now, now]);

  const templateId = 'tpl_pre021_upgrade';
  db.run(`INSERT INTO coloring_templates
    (id,owner_id,title,description,category,difficulty,width,height,palette_json,cells_json,preview_url,original_media_key,source_type,visibility,status,created_at,updated_at,storage_mode,tile_size)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [templateId, USER, 'Legacy 1200 upgrade', 'template created before migration 021',
      'custom', 'custom', WIDTH, HEIGHT, JSON.stringify(PALETTE), JSON.stringify([]),
      null, null, 'user', 'public', 'active', now, now, 'tiled', TILE_SIZE]);

  const grid = getTileGrid(WIDTH, HEIGHT, TILE_SIZE);
  let tile0cells = null;
  let tile53cells = null;
  let color1Total = 0;
  let color2Total = 0;
  for (let tileY = 0; tileY < grid.tiles_y; tileY += 1) {
    for (let tileX = 0; tileX < grid.tiles_x; tileX += 1) {
      const cells = [];
      for (let y = 0; y < TILE_SIZE; y += 1) {
        for (let x = 0; x < TILE_SIZE; x += 1) {
          cells.push((tileX * 3 + tileY * 5 + x + y * 2) % PALETTE.length);
        }
      }
      color1Total += cells.filter((color) => color === 1).length;
      color2Total += cells.filter((color) => color === 2).length;
      if (tileX === 0 && tileY === 0) tile0cells = cells;
      if (tileX === 5 && tileY === 3) tile53cells = cells;
      db.run(`INSERT INTO coloring_template_tiles
        (template_id,tile_x,tile_y,width,height,cells_json,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?)`,
        [templateId, tileX, tileY, TILE_SIZE, TILE_SIZE, JSON.stringify(cells), now, now]);
    }
  }

  // Existing progress: 900 cells of color 1 in tile (0,0), 300 of color 2 in (5,3).
  let painted = 0;
  const filled00 = tile0cells.map((color) => {
    if (color === 1 && painted < 900) { painted += 1; return 1; }
    return -1;
  });
  let painted2 = 0;
  const filled53 = tile53cells.map((color) => {
    if (color === 2 && painted2 < 300) { painted2 += 1; return 2; }
    return -1;
  });
  const completed = filled00.filter((value, index) => value === tile0cells[index]).length
    + filled53.filter((value, index) => value === tile53cells[index]).length;

  db.run(`INSERT INTO coloring_tiled_progress
    (user_id,template_id,revision,completed_cells,completed_at,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?)`,
    [USER, templateId, 5, completed, null, now, now]);
  db.run(`INSERT INTO coloring_tiled_progress_tiles
    (user_id,template_id,tile_x,tile_y,width,height,filled_json,completed_cells,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [USER, templateId, 0, 0, 32, 32, JSON.stringify(filled00),
      filled00.filter((value, index) => value === tile0cells[index]).length, now, now]);
  db.run(`INSERT INTO coloring_tiled_progress_tiles
    (user_id,template_id,tile_x,tile_y,width,height,filled_json,completed_cells,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [USER, templateId, 5, 3, 32, 32, JSON.stringify(filled53),
      filled53.filter((value, index) => value === tile53cells[index]).length, now, now]);

  // Sanity: the pre-021 database must NOT have guidance rows.
  const staticRows = db.exec('SELECT COUNT(*) AS c FROM coloring_template_color_counts');
  assert.equal(staticRows[0].values[0][0], 0, 'pre-021 fixture must not contain static counts');
  const metaRows = db.exec('SELECT COUNT(*) AS c FROM coloring_template_guidance_index_meta');
  assert.equal(metaRows[0].values[0][0], 0, 'pre-021 fixture must not contain a marker');

  const dbPath = join(directory, 'pre021.db.bin');
  writeFileSync(dbPath, Buffer.from(db.export()));
  return { dbPath, templateId, completed, color1Total, color2Total, paintedColor1: painted, paintedColor2: painted2 };
}

async function request(path, { userId = USER, method = 'GET', body } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { 'X-User-Id': userId, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  try {
    json = await response.json();
  } catch {
    json = null;
  }
  return { response, json };
}

test('PRE-021 DATABASE → migration → real app flow: guidance returns a real target and the target tile is servable', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'splint-upgrade-'));
  const { dbPath, templateId, completed, color1Total, color2Total, paintedColor1, paintedColor2 } = await buildPre021DbFile(directory);

  const server = spawn('node', ['index.js'], {
    cwd: serverDir,
    env: {
      ...process.env,
      PORT: String(port),
      SQLITE_DB_PATH: dbPath,
      MEDIA_STORAGE_ROOT: join(directory, 'uploads'),
      ALLOW_DEV_AUTH: 'true',
      SEED_DEMO_DATA: 'false',
      RATE_LIMIT_MAX: '1000',
      RENDER_OUTBOX_ENABLED: 'false',
      // Keep the background job out of this test: the guidance endpoint must
      // serve the first request by itself (bounded one-template build).
      GUIDANCE_BACKFILL_AUTO: 'false',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  t.after(async () => {
    server.kill();
    await rm(directory, { recursive: true, force: true });
  });

  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('API did not start')), 15_000);
    server.stdout.on('data', (chunk) => {
      if (chunk.toString().includes('running on')) {
        clearTimeout(timer);
        resolve();
      }
    });
    server.once('error', reject);
  });

  // GET manifest — metadata only, no full grid.
  const manifest = await request(`/colorings/${templateId}/manifest`);
  assert.equal(manifest.response.status, 200);
  assert.equal('cells' in manifest.json, false);
  assert.equal('filled' in manifest.json, false);
  assert.equal(manifest.json.grid.width, WIDTH);

  // GET guidance — the first request after migration 021; must return a real
  // target (the bounded one-template index build happens inside this request).
  const guidance = await request(`/colorings/${templateId}/guidance`);
  assert.equal(guidance.response.status, 200, `guidance must succeed, got ${guidance.response.status}: ${JSON.stringify(guidance.json)}`);
  assert.ok(guidance.json.target, 'guidance must return a real target');
  assert.equal(guidance.json.artwork_complete, false);
  assert.equal(guidance.json.mode, 'auto');
  assert.equal('cells' in guidance.json, false);
  assert.equal('filled' in guidance.json, false);

  // GET the exact target tile — must be servable (HTTP 200) with the
  // user's progress revision.
  const tile = await request(`/colorings/${templateId}/tiles/${guidance.json.target.tile_x}/${guidance.json.target.tile_y}`);
  assert.equal(tile.response.status, 200, `target tile must be 200, got ${tile.response.status}`);
  assert.equal(tile.json.tile.cell_count, 1024);
  assert.equal(tile.json.progress.revision, 5, 'existing progress revision preserved');

  // GET guidance for the colors the user already painted — remaining counts
  // must reflect the existing progress, not the full static totals.
  const color1 = await request(`/colorings/${templateId}/guidance?selected_color=1`);
  assert.equal(color1.response.status, 200);
  const color2 = await request(`/colorings/${templateId}/guidance?selected_color=2`);
  assert.equal(color2.response.status, 200);
  // Remaining must equal the actual static total minus the painted cells.
  assert.ok(paintedColor1 > 0 && paintedColor2 > 0, 'fixture must actually paint cells');
  assert.equal(color1.json.global_remaining_for_color, color1Total - paintedColor1);
  assert.equal(color2.json.global_remaining_for_color, color2Total - paintedColor2);

  // The backfill marker must now exist for the template.
  const marker = await request(`/colorings/${templateId}/manifest`);
  assert.equal(marker.response.status, 200);
  assert.ok(completed > 0);
});
