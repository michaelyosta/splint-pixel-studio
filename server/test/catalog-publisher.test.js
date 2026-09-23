import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import initSqlJs from 'sql.js';
import { runMigrations } from '../database/migrations.js';
import { isCatalogDeliveryKey } from '../routes/media.js';
import { publishCatalog, readCanonicalCatalog, sha256 } from '../services/catalog-publisher.js';
import { validateTiledGridDimensions } from '../services/tiled-coloring.js';

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

function catalogWithTiledTemplate(catalog, templateId, { phase = 0, width = 1200, height = 900, tileSize = 32 } = {}) {
  const runtimeById = new Map(catalog.runtimeById);
  const runtime = {
    ...runtimeById.get(templateId),
    width,
    height,
    palette: ['#000000', '#ffffff'],
    cells: [],
    storage_mode: 'tiled',
    tile_size: tileSize,
    cell_map_asset: 'content/generated/catalog-grids/test.u8.gz',
    cell_map_sha256: '0'.repeat(64),
  };
  runtimeById.set(templateId, runtime);
  const loadTiledTiles = (candidate) => {
    if (candidate.id !== templateId) return catalog.loadTiledTiles(candidate);
    const tiles = [];
    for (let tileY = 0; tileY < Math.ceil(height / tileSize); tileY += 1) {
      for (let tileX = 0; tileX < Math.ceil(width / tileSize); tileX += 1) {
        const tileWidth = Math.min(tileSize, width - tileX * tileSize);
        const tileHeight = Math.min(tileSize, height - tileY * tileSize);
        const cells = new Array(tileWidth * tileHeight);
        for (let y = 0; y < tileHeight; y += 1) {
          for (let x = 0; x < tileWidth; x += 1) {
            const globalX = tileX * tileSize + x;
            const globalY = tileY * tileSize + y;
            cells[y * tileWidth + x] = (globalX + globalY + phase) % 2;
          }
        }
        tiles.push({ tile_x: tileX, tile_y: tileY, width: tileWidth, height: tileHeight, cells });
      }
    }
    return tiles;
  };
  return { ...catalog, runtimeById, loadTiledTiles };
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

test('publisher stores 1200x900 catalog grids as tiles and reruns idempotently', async () => {
  const SQL = await initSqlJs();
  const sqlite = new SQL.Database();
  sqlite.run('PRAGMA foreign_keys = ON');
  await runMigrations({ mode: 'sqlite', pool: null, sqlite, persistFn: null, migrationsDir });

  try {
    const canonical = readCanonicalCatalog();
    const templateId = canonical.entries[0].id;
    const catalog = catalogWithTiledTemplate(canonical, templateId);
    const acceptedGrid = validateTiledGridDimensions(1200, 900, 32);
    assert.deepEqual([acceptedGrid.width, acceptedGrid.height, acceptedGrid.tiles_x, acceptedGrid.tiles_y], [1200, 900, 38, 29]);
    const first = await publishCatalog({ db: createAdapter(sqlite), catalog });
    assert.equal(first.tiled_templates_published, 1);
    assert.equal(first.tiled_template_tiles_published, 1102);
    const row = sqlite.exec('SELECT width,height,storage_mode,cells_json FROM coloring_templates WHERE id=?', [templateId])[0].values[0];
    assert.deepEqual(row.slice(0, 3), [1200, 900, 'tiled']);
    assert.equal(JSON.parse(row[3]).length, 0);
    assert.equal(sqlite.exec('SELECT COUNT(*) FROM coloring_template_tiles WHERE template_id=?', [templateId])[0].values[0][0], 1102);
    assert.equal(sqlite.exec('SELECT COUNT(*) FROM coloring_zones WHERE template_id=?', [templateId])[0].values[0][0], 0);

    const second = await publishCatalog({ db: createAdapter(sqlite), catalog, now: '2026-09-24T00:00:00.000Z' });
    assert.equal(second.tiled_templates_published, 0);
    assert.equal(second.tiled_template_tiles_published, 0);
    assert.equal(sqlite.exec('SELECT COUNT(*) FROM coloring_template_tiles WHERE template_id=?', [templateId])[0].values[0][0], 1102);
  } finally {
    sqlite.close();
  }
});

test('publisher preserves existing progress and fails closed if its tiled map changes', async () => {
  const SQL = await initSqlJs();
  const sqlite = new SQL.Database();
  sqlite.run('PRAGMA foreign_keys = ON');
  await runMigrations({ mode: 'sqlite', pool: null, sqlite, persistFn: null, migrationsDir });

  try {
    const canonical = readCanonicalCatalog();
    const templateId = canonical.entries[0].id;
    const stableCatalog = catalogWithTiledTemplate(canonical, templateId, { width: 40, height: 24 });
    await publishCatalog({ db: createAdapter(sqlite), catalog: stableCatalog });
    const now = '2026-09-24T00:00:00.000Z';
    sqlite.run('INSERT INTO users (id,nickname,created_at,updated_at) VALUES (?,?,?,?)', ['progress-owner', 'Owner', now, now]);
    sqlite.run(`INSERT INTO coloring_tiled_progress (user_id,template_id,revision,completed_cells,created_at,updated_at)
      VALUES (?,?,1,1,?,?)`, ['progress-owner', templateId, now, now]);

    await publishCatalog({ db: createAdapter(sqlite), catalog: stableCatalog, now });
    const changedCatalog = catalogWithTiledTemplate(canonical, templateId, { phase: 1, width: 40, height: 24 });
    await assert.rejects(
      publishCatalog({ db: createAdapter(sqlite), catalog: changedCatalog, now }),
      (error) => error.code === 'CATALOG_GRID_CHANGE_WITH_PROGRESS',
    );
    assert.equal(sqlite.exec('SELECT revision FROM coloring_tiled_progress WHERE user_id=? AND template_id=?', ['progress-owner', templateId])[0].values[0][0], 1);
    assert.equal(sqlite.exec('SELECT COUNT(*) FROM coloring_template_tiles WHERE template_id=?', [templateId])[0].values[0][0], 2);
  } finally {
    sqlite.close();
  }
});

test('canonical tiled input verifies compressed cell-map checksum and restores tile shape', async () => {
  const root = await mkdtemp(join(tmpdir(), 'splint-catalog-grid-'));
  try {
    const gridDir = join(root, 'content', 'generated', 'catalog-grids');
    const runtimePath = join(root, 'runtime.json');
    await mkdir(gridDir, { recursive: true });
    const canonical = readCanonicalCatalog();
    const runtime = canonical.runtimeTemplates.map((template, index) => index === 0 ? {
      ...template,
      width: 8,
      height: 8,
      palette: ['#000000', '#ffffff'],
      cells: [],
      storage_mode: 'tiled',
      tile_size: 8,
      cell_map_asset: 'content/generated/catalog-grids/test.u8.gz',
    } : template);
    const compressed = gzipSync(Buffer.from(Array.from({ length: 64 }, (_, index) => index % 2)));
    runtime[0].cell_map_sha256 = sha256(compressed);
    runtime[0].cell_map_raw_bytes = 64;
    const mapPath = join(gridDir, 'test.u8.gz');
    await writeFile(mapPath, compressed);
    await writeFile(runtimePath, JSON.stringify(runtime));

    const catalog = readCanonicalCatalog({ runtimePath, gridRoot: root });
    const tiles = catalog.loadTiledTiles(catalog.runtimeById.get(catalog.entries[0].id));
    assert.equal(tiles.length, 1);
    assert.equal(tiles[0].width, 8);
    assert.equal(tiles[0].height, 8);
    assert.deepEqual(tiles[0].cells.slice(0, 8), [0, 1, 0, 1, 0, 1, 0, 1]);

    await writeFile(mapPath, gzipSync(Buffer.from(Array(64).fill(1))));
    assert.throws(() => catalog.loadTiledTiles(catalog.runtimeById.get(catalog.entries[0].id)), /CATALOG_GRID_CHECKSUM_MISMATCH/);
  } finally {
    await rm(root, { recursive: true, force: true });
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
