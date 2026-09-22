import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import initSqlJs from 'sql.js';
import { runMigrations } from '../database/migrations.js';
import { isCatalogDeliveryKey } from '../routes/media.js';
import { publishCatalog, readCanonicalCatalog } from '../services/catalog-publisher.js';

const serverDir = dirname(dirname(fileURLToPath(import.meta.url)));
const migrationsDir = join(serverDir, 'migrations', 'sqlite');

function createAdapter(sqlite) {
  const rows = (sql, params = []) => {
    const statement = sqlite.prepare(sql);
    try {
      statement.bind(params);
      const result = [];
      while (statement.step()) result.push(statement.getAsObject());
      return result;
    } finally {
      statement.free();
    }
  };
  return {
    all: async (sql, params = []) => rows(sql, params),
    get: async (sql, params = []) => rows(sql, params)[0] || undefined,
    run: async (sql, params = []) => {
      sqlite.run(sql, params);
      return { changes: sqlite.getRowsModified() };
    },
    withDbTransaction: async (callback) => {
      sqlite.run('BEGIN');
      try {
        const result = await callback(createAdapter(sqlite));
        sqlite.run('COMMIT');
        return result;
      } catch (error) {
        sqlite.run('ROLLBACK');
        throw error;
      }
    },
  };
}

test('publisher writes the canonical catalog without touching protected domains', async () => {
  const SQL = await initSqlJs();
  const sqlite = new SQL.Database();
  sqlite.run('PRAGMA foreign_keys = ON');
  await runMigrations({ mode: 'sqlite', pool: null, sqlite, persistFn: null, migrationsDir });

  try {
    const report = await publishCatalog({ db: createAdapter(sqlite), catalog: readCanonicalCatalog() });
    assert.equal(report.production_catalog_count, 320);
    assert.equal(report.production_collections, 16);
    assert.equal(report.production_albums, 32);
    assert.equal(report.production_free, 172);
    assert.equal(report.production_premium, 148);
    assert.equal(report.user_progress_touched, false);
    assert.equal(report.ownership_touched, false);
    assert.equal(report.stars_semantics_touched, false);

    const row = sqlite.exec("SELECT COUNT(*) AS c FROM coloring_templates WHERE source_type='catalog' AND status='active' AND visibility='public'")[0].values[0][0];
    assert.equal(row, 320);
  } finally {
    sqlite.close();
  }
});

test('publisher source does not route through demo seeding', async () => {
  const source = await readFile(join(serverDir, 'services', 'catalog-publisher.js'), 'utf8');
  assert.doesNotMatch(source, /seedDemoData|bootstrapSystemData/);
});

test('catalog media delivery allows previews and covers but never masters', () => {
  assert.equal(isCatalogDeliveryKey('catalog/previews/pixel.png'), true);
  assert.equal(isCatalogDeliveryKey('catalog/covers/collection.png'), true);
  assert.equal(isCatalogDeliveryKey('catalog/covers/source/collection.png'), false);
  assert.equal(isCatalogDeliveryKey('catalog/masters/secret.png'), false);
  assert.equal(isCatalogDeliveryKey('catalog/previews/../masters/secret.png'), false);
});
