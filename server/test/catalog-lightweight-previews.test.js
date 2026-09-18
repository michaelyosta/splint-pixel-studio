import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import initSqlJs from 'sql.js';
import { runMigrations } from '../database/migrations.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const serverDir = join(__dirname, '..');
const migrationsDir = join(serverDir, 'migrations', 'sqlite');
const NOW = '2026-09-17T00:00:00.000Z';

function migration034Sql() {
  return readFileSync(join(migrationsDir, '034_catalog_lightweight_previews.sql'), 'utf8');
}

async function bootMigratedDb() {
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  db.run('PRAGMA foreign_keys = ON;');
  await runMigrations({ mode: 'sqlite', pool: null, sqlite: db, persistFn: null, migrationsDir });
  return db;
}

function insertTemplate(db, { id, previewUrl }) {
  db.run(
    `INSERT INTO coloring_templates
      (id,owner_id,title,description,category,difficulty,width,height,palette_json,cells_json,
       preview_url,original_media_key,source_type,visibility,status,created_at,updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id, null, `Title ${id}`, '', 'featured', 'easy', 32, 32, '["#000000","#ffffff"]', '[0,1]',
      previewUrl, null, 'catalog', 'public', 'active', NOW, NOW],
  );
}

function previewUrlOf(db, id) {
  const stmt = db.prepare('SELECT preview_url FROM coloring_templates WHERE id=?');
  stmt.bind([id]);
  assert.ok(stmt.step(), `template ${id} must exist`);
  const row = stmt.getAsObject();
  stmt.free();
  return row.preview_url;
}

test('migration 034 serves the lightweight pixel preview instead of the full master', async () => {
  const db = await bootMigratedDb();
  insertTemplate(db, { id: 'tpl_plain', previewUrl: '/assets/catalog/generated/autumn-cozy_coffee-rain_01.png' });
  insertTemplate(db, { id: 'tpl_pixel', previewUrl: '/assets/catalog/generated/autumn-cozy_coffee-rain_01-pixel.png' });
  insertTemplate(db, { id: 'tpl_upload', previewUrl: 'data:image/png;base64,iVBOR' });
  insertTemplate(db, { id: 'tpl_cover', previewUrl: '/assets/catalog/generated/covers/reading-nooks.png' });

  db.exec(migration034Sql());

  assert.equal(
    previewUrlOf(db, 'tpl_plain'),
    '/assets/catalog/generated/autumn-cozy_coffee-rain_01-pixel.png',
    'generated full-size preview must map to its pixel variant',
  );
  assert.equal(
    previewUrlOf(db, 'tpl_pixel'),
    '/assets/catalog/generated/autumn-cozy_coffee-rain_01-pixel.png',
    'pixel preview must stay untouched (idempotent)',
  );
  assert.equal(previewUrlOf(db, 'tpl_upload'), 'data:image/png;base64,iVBOR', 'user uploads must stay untouched');
  assert.equal(
    previewUrlOf(db, 'tpl_cover'),
    '/assets/catalog/generated/covers/reading-nooks.png',
    'cover art must stay untouched',
  );

  // Re-running the migration must be a no-op.
  db.exec(migration034Sql());
  assert.equal(
    previewUrlOf(db, 'tpl_plain'),
    '/assets/catalog/generated/autumn-cozy_coffee-rain_01-pixel.png',
    'migration must be idempotent (no double -pixel infix)',
  );
  db.close();
});
