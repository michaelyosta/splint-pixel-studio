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
import {
  buildCatalogAssetInventory,
  buildCatalogGridAssetInventory,
  catalogConstants,
  deriveCatalogGridDimensions,
  normalizeCatalogAssetInventory,
  normalizeCatalogGridAssetInventory,
  publishCatalog,
  readCanonicalCatalog,
  sha256,
} from '../services/catalog-publisher.js';
import { validateTiledGridDimensions } from '../services/tiled-coloring.js';
import { connectedRegionStats } from '../../scripts/catalog-grid-analysis.mjs';
import { encodeCatalogGridPng } from '../../scripts/catalog-grid-png.mjs';

const serverDir = dirname(dirname(fileURLToPath(import.meta.url)));
const migrationsDir = join(serverDir, 'migrations', 'sqlite');

test('catalog grid dimensions preserve source proportions up to the 1200-cell max side', () => {
  assert.deepEqual(deriveCatalogGridDimensions(2000, 2500), { width: 960, height: 1200 });
  assert.deepEqual(deriveCatalogGridDimensions(2000, 2000), { width: 1200, height: 1200 });
  assert.deepEqual(deriveCatalogGridDimensions(3000, 2250), { width: 1200, height: 900 });
  assert.deepEqual(deriveCatalogGridDimensions(64, 80), { width: 64, height: 80 });
  assert.throws(() => deriveCatalogGridDimensions(0, 80), RangeError);
});

test('catalog candidate fragmentation metrics use four-connected equal-color components', () => {
  assert.deepEqual(connectedRegionStats(Uint8Array.from([0, 0, 1, 1, 0, 2]), 3, 2), {
    regions4: 4,
    regionDensityPer10k: 6666.67,
    singletonCount: 3,
    singletonAreaRatio: 0.5,
    tinyRegionCount: 4,
    smallRegionCellCount: 3,
    smallRegionCellRatio: 0.5,
    tinyRegionCellCount: 6,
    tinyRegionCellRatio: 1,
    medianRegionCells: 1,
    p90RegionCells: 1,
    maxRegionCells: 3,
  });
  assert.throws(() => connectedRegionStats(Uint8Array.from([0, 1]), 3, 1), TypeError);
});

test('catalog preview PNG stays palette-indexed, aspect-preserving, and decodes to the expected colors', async () => {
  const { deflateSync, inflateSync } = await import('node:zlib');
  const { bytes, width, height } = encodeCatalogGridPng({
    cells: Uint8Array.from([0, 1, 2, 3]),
    width: 2,
    height: 2,
    palette: ['#000000', '#ffffff', '#ff0000', '#00ff00'],
  });
  assert.deepEqual([width, height], [2, 2]);
  assert.deepEqual(bytes.subarray(12, 16).toString('ascii'), 'IHDR');
  assert.deepEqual([bytes[24], bytes[25]], [4, 3]);
  let offset = 8;
  const chunks = [];
  while (offset < bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.subarray(offset + 4, offset + 8).toString('ascii');
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    chunks.push({ type, data });
    offset += length + 12;
    if (type === 'IEND') break;
  }
  assert.deepEqual(chunks.find((chunk) => chunk.type === 'PLTE').data, Buffer.from([
    0, 0, 0, 255, 255, 255, 255, 0, 0, 0, 255, 0,
  ]));
  const scanlines = inflateSync(Buffer.concat(chunks.filter((chunk) => chunk.type === 'IDAT').map((chunk) => chunk.data)));
  assert.deepEqual(scanlines, Buffer.from([0, 0x01, 0, 0x23]));
  assert.equal(deflateSync(scanlines).length > 0, true);
});

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

function singleTemplateCatalog(catalog, templateId, runtime, loadTiledGrid = catalog.loadTiledGrid) {
  const entry = catalog.entries.find((candidate) => candidate.id === templateId);
  const sourceCollection = catalog.collectionById.get(entry.collection_id);
  const album = sourceCollection.albums.find((candidate) => candidate.id === entry.album_id);
  const collection = { ...sourceCollection, albums: [album] };
  const covers = catalog.covers.filter((cover) => cover.parent_id === collection.id || cover.parent_id === album.id);
  return {
    ...catalog,
    entries: [entry],
    collections: [collection],
    covers,
    runtimeTemplates: [runtime],
    runtimeById: new Map([[templateId, runtime]]),
    collectionById: new Map([[collection.id, collection]]),
    coverByParent: new Map(covers.map((cover) => [cover.parent_id, cover])),
    counts: {
      collections: 1,
      albums: 1,
      colorings: 1,
      free: entry.access === 'free' ? 1 : 0,
      premium: entry.access === 'premium' ? 1 : 0,
    },
    loadTiledGrid,
  };
}

function catalogWithTiledTemplate(catalog, templateId, { phase = 0, width = 1200, height = 900, tileSize = 32 } = {}) {
  const rawGrid = Buffer.alloc(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) rawGrid[y * width + x] = (x + y + phase) % 2;
  }
  const compressedGrid = gzipSync(rawGrid, { mtime: 0 });
  const cellMapSha = sha256(compressedGrid);
  const runtime = {
    ...catalog.runtimeById.get(templateId),
    width,
    height,
    palette: ['#000000', '#ffffff'],
    cells: [],
    storage_mode: 'tiled',
    tile_size: tileSize,
    cell_map_asset: 'content/generated/catalog-grids/test.u8.gz',
    cell_map_r2_key: `catalog/grids/${templateId}.${cellMapSha}.u8.gz`,
    cell_map_sha256: cellMapSha,
    cell_map_bytes: compressedGrid.length,
    cell_map_raw_bytes: rawGrid.length,
  };
  const loadTiledGrid = (candidate) => {
    if (candidate.id !== templateId) return catalog.loadTiledGrid(candidate);
    return rawGrid;
  };
  return singleTemplateCatalog(catalog, templateId, runtime, loadTiledGrid);
}

function canonicalCatalogWithLegacyDemoGrids(catalog) {
  const runtimeTemplates = catalog.runtimeTemplates.map((template) => ({
    ...template,
    width: 32,
    height: 32,
    cells: Array(32 * 32).fill(0),
    storage_mode: 'legacy',
    tile_size: 32,
    cell_map_asset: null,
    cell_map_r2_key: null,
    cell_map_sha256: null,
    cell_map_bytes: null,
    cell_map_raw_bytes: null,
  }));
  return {
    ...catalog,
    runtimeTemplates,
    runtimeById: new Map(runtimeTemplates.map((template) => [template.id, template])),
    loadTiledGrid: undefined,
    loadTiledTiles: undefined,
  };
}

test('publisher writes canonical catalog metadata without production grids or protected-domain changes', async () => {
  const SQL = await initSqlJs();
  const sqlite = new SQL.Database();
  sqlite.run('PRAGMA foreign_keys = ON');
  await runMigrations({ mode: 'sqlite', pool: null, sqlite, persistFn: null, migrationsDir });

  try {
    // Production grid maps live in R2. Keep this metadata/protected-domain
    // contract test independent of generated catalog binaries in Git; the
    // adjacent tiled tests exercise grid validation and persistence directly.
    const catalog = canonicalCatalogWithLegacyDemoGrids(readCanonicalCatalog());
    const report = await publishCatalog({ db: createAdapter(sqlite), catalog });
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
    const previewUrl = sqlite.exec("SELECT preview_url FROM coloring_templates WHERE source_type='catalog' ORDER BY id LIMIT 1")[0].values[0][0];
    assert.match(previewUrl, /-pixel\.png$/);
    assert.doesNotMatch(previewUrl, /(?:masters|\/full)\//);
  } finally {
    sqlite.close();
  }
});

test('publisher syncs manifest-owned albums but preserves editor-managed overrides', async () => {
  const SQL = await initSqlJs();
  const sqlite = new SQL.Database();
  sqlite.run('PRAGMA foreign_keys = ON');
  await runMigrations({ mode: 'sqlite', pool: null, sqlite, persistFn: null, migrationsDir });

  try {
    const canonical = readCanonicalCatalog();
    const album = canonical.collections[0].albums[0];
    const templateId = canonical.entries.find((entry) => entry.album_id === album.id).id;
    const sourceRuntime = canonical.runtimeById.get(templateId);
    const runtime = {
      ...sourceRuntime,
      width: 8,
      height: 8,
      cells: Array(64).fill(0),
      storage_mode: 'legacy',
      tile_size: 32,
    };
    const scopedCatalog = singleTemplateCatalog(canonical, templateId, runtime);
    const withAlbumTitle = (catalog, title) => ({
      ...catalog,
      collections: catalog.collections.map((collection) => ({
        ...collection,
        albums: collection.albums.map((candidate) => candidate.id === album.id ? { ...candidate, title } : candidate),
      })),
    });

    await publishCatalog({ db: createAdapter(sqlite), catalog: scopedCatalog });
    let row = sqlite.exec('SELECT title,editor_managed FROM catalog_albums WHERE id=?', [album.id])[0].values[0];
    assert.equal(row[0], album.title);
    assert.equal(Number(row[1]), 0);

    await publishCatalog({ db: createAdapter(sqlite), catalog: withAlbumTitle(scopedCatalog, 'Manifest refresh') });
    row = sqlite.exec('SELECT title,editor_managed FROM catalog_albums WHERE id=?', [album.id])[0].values[0];
    assert.deepEqual(row, ['Manifest refresh', 0]);

    sqlite.run('UPDATE catalog_albums SET title=?,editor_managed=1 WHERE id=?', ['Editorial override', album.id]);
    await publishCatalog({ db: createAdapter(sqlite), catalog: withAlbumTitle(scopedCatalog, 'Later manifest refresh') });
    row = sqlite.exec('SELECT title,editor_managed FROM catalog_albums WHERE id=?', [album.id])[0].values[0];
    assert.deepEqual(row, ['Editorial override', 1]);
  } finally {
    sqlite.close();
  }
});

test('publisher stores catalog grids in R2 with a compact count vector and reruns idempotently', async () => {
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
    assert.equal(first.tiled_map_tiles_indexed, 1102);
    assert.equal(first.tiled_grid_source_bytes, catalog.runtimeById.get(templateId).cell_map_bytes);
    assert.equal(first.database_template_tile_rows_written, 0);
    const row = sqlite.exec('SELECT width,height,storage_mode,cells_json FROM coloring_templates WHERE id=?', [templateId])[0].values[0];
    assert.deepEqual(row.slice(0, 3), [1200, 900, 'tiled']);
    assert.equal(JSON.parse(row[3]).length, 0);
    assert.equal(sqlite.exec('SELECT COUNT(*) FROM coloring_template_tiles WHERE template_id=?', [templateId])[0].values[0][0], 0);
    assert.equal(sqlite.exec('SELECT COUNT(*) FROM coloring_catalog_grid_sources WHERE template_id=?', [templateId])[0].values[0][0], 1);
    assert.equal(sqlite.exec('SELECT COUNT(*) FROM coloring_template_color_counts WHERE template_id=?', [templateId])[0].values[0][0], 2);
    assert.equal(sqlite.exec('SELECT COUNT(*) FROM coloring_template_tile_color_counts WHERE template_id=?', [templateId])[0].values[0][0], 0);
    assert.equal(sqlite.exec('SELECT COUNT(*) FROM coloring_zones WHERE template_id=?', [templateId])[0].values[0][0], 0);

    const second = await publishCatalog({ db: createAdapter(sqlite), catalog, now: '2026-09-24T00:00:00.000Z' });
    assert.equal(second.tiled_templates_published, 0);
    assert.equal(second.tiled_map_tiles_indexed, 0);
    assert.equal(sqlite.exec('SELECT COUNT(*) FROM coloring_template_tiles WHERE template_id=?', [templateId])[0].values[0][0], 0);
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
    assert.equal(sqlite.exec('SELECT COUNT(*) FROM coloring_template_tiles WHERE template_id=?', [templateId])[0].values[0][0], 0);
    assert.equal(sqlite.exec('SELECT COUNT(*) FROM coloring_catalog_grid_sources WHERE template_id=?', [templateId])[0].values[0][0], 1);
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
    const templateId = canonical.entries[0].id;
    const runtime = canonical.runtimeTemplates.map((template) => template.id === templateId ? {
      ...template,
      width: 8,
      height: 8,
      palette: ['#000000', '#ffffff'],
      cells: [],
      storage_mode: 'tiled',
      tile_size: 8,
      cell_map_asset: 'content/generated/catalog-grids/test.u8.gz',
      cell_map_r2_key: `catalog/grids/${templateId}.${'0'.repeat(64)}.u8.gz`,
      cell_map_bytes: 1,
      cell_map_sha256: '0'.repeat(64),
      cell_map_raw_bytes: 64,
    } : template);
    const compressed = gzipSync(Buffer.from(Array.from({ length: 64 }, (_, index) => index % 2)));
    const targetIndex = runtime.findIndex((template) => template.id === templateId);
    runtime[targetIndex].cell_map_sha256 = sha256(compressed);
    runtime[targetIndex].cell_map_r2_key = `catalog/grids/${templateId}.${runtime[targetIndex].cell_map_sha256}.u8.gz`;
    runtime[targetIndex].cell_map_bytes = compressed.length;
    runtime[targetIndex].cell_map_raw_bytes = 64;
    const mapPath = join(gridDir, 'test.u8.gz');
    await writeFile(mapPath, compressed);
    await writeFile(runtimePath, JSON.stringify(runtime));

    const catalog = readCanonicalCatalog({ runtimePath, gridRoot: root });
    const tiles = catalog.loadTiledTiles(catalog.runtimeById.get(catalog.entries[0].id));
    assert.equal(tiles.length, 1);
    assert.equal(tiles[0].width, 8);
    assert.equal(tiles[0].height, 8);
    assert.deepEqual(tiles[0].cells.slice(0, 8), [0, 1, 0, 1, 0, 1, 0, 1]);

    const changedCompressed = gzipSync(Buffer.from(Array(64).fill(1)));
    await writeFile(mapPath, changedCompressed);
    catalog.runtimeById.get(templateId).cell_map_bytes = changedCompressed.length;
    assert.throws(() => catalog.loadTiledTiles(catalog.runtimeById.get(catalog.entries[0].id)), /CATALOG_GRID_CHECKSUM_MISMATCH/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('canonical tiled input may load an integrity-checked grid from R2 when local assets are absent', async () => {
  const root = await mkdtemp(join(tmpdir(), 'catalog-grid-r2-'));
  const runtimePath = join(root, 'runtime.json');
  const canonical = readCanonicalCatalog();
  const templateId = canonical.entries[0].id;
  const raw = Buffer.from(Array.from({ length: 64 }, (_, index) => index % 2));
  const compressed = gzipSync(raw);
  const gridSha = sha256(compressed);
  const runtime = canonical.runtimeTemplates.map((template) => template.id === templateId ? {
    ...template,
    width: 8,
    height: 8,
    palette: ['#000000', '#ffffff'],
    cells: [],
    storage_mode: 'tiled',
    tile_size: 8,
    cell_map_asset: `content/generated/catalog-grids/${templateId}.u8.gz`,
    cell_map_r2_key: `catalog/grids/${templateId}.${gridSha}.u8.gz`,
    cell_map_bytes: compressed.length,
    cell_map_raw_bytes: raw.length,
    cell_map_sha256: gridSha,
  } : template);
  await writeFile(runtimePath, JSON.stringify(runtime));

  try {
    const catalog = readCanonicalCatalog({
      runtimePath,
      gridRoot: root,
      gridReader: async (template) => {
        assert.equal(template.cell_map_r2_key, `catalog/grids/${templateId}.${gridSha}.u8.gz`);
        return compressed;
      },
    });
    const gridRecords = buildCatalogGridAssetInventory({
      ...catalog,
      runtimeTemplates: [catalog.runtimeById.get(templateId)],
    });
    assert.equal(gridRecords.length, 1);
    assert.equal(gridRecords[0].key, `catalog/grids/${templateId}.${gridSha}.u8.gz`);
    assert.deepEqual(normalizeCatalogGridAssetInventory(gridRecords, [{
      id: templateId,
      kind: 'grid',
      source_asset: gridRecords[0].source_asset,
      key: gridRecords[0].key,
      bytes: compressed.length,
      sha256: sha256(compressed),
      raw_bytes: raw.length,
    }]), gridRecords);
    const tiles = await catalog.loadTiledTiles(catalog.runtimeById.get(templateId));
    assert.equal(tiles.length, 1);
    assert.deepEqual(tiles[0].cells.slice(0, 8), [0, 1, 0, 1, 0, 1, 0, 1]);

    const targetIndex = runtime.findIndex((template) => template.id === templateId);
    runtime[targetIndex].cell_map_sha256 = '0'.repeat(64);
    runtime[targetIndex].cell_map_r2_key = `catalog/grids/${templateId}.${runtime[targetIndex].cell_map_sha256}.u8.gz`;
    await writeFile(runtimePath, JSON.stringify(runtime));
    const corruptCatalog = readCanonicalCatalog({
      runtimePath,
      gridRoot: root,
      gridReader: async () => compressed,
    });
    await assert.rejects(
      corruptCatalog.loadTiledTiles(corruptCatalog.runtimeById.get(templateId)),
      /CATALOG_GRID_CHECKSUM_MISMATCH/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('publisher retires stale catalog rows without hiding them or mutating saved progress, and restores reintroduced IDs', async () => {
  const SQL = await initSqlJs();
  const sqlite = new SQL.Database();
  sqlite.run('PRAGMA foreign_keys = ON');
  await runMigrations({ mode: 'sqlite', pool: null, sqlite, persistFn: null, migrationsDir });

  try {
    const canonical = canonicalCatalogWithLegacyDemoGrids(readCanonicalCatalog());
    const retiredId = canonical.entries[0].id;
    const currentId = canonical.entries[1].id;
    const retiredCatalog = singleTemplateCatalog(canonical, retiredId, canonical.runtimeById.get(retiredId));
    const currentCatalog = singleTemplateCatalog(canonical, currentId, canonical.runtimeById.get(currentId));
    const db = createAdapter(sqlite);
    const firstPublishedAt = '2026-09-25T10:00:00.000Z';
    const retiredAt = '2026-09-25T11:00:00.000Z';

    await publishCatalog({ db, catalog: retiredCatalog, now: firstPublishedAt });
    // The previous publisher retired rows by setting status='hidden'. Exercise
    // this upgrade path as well as rows that are still active.
    await db.run("UPDATE coloring_templates SET status='hidden' WHERE id=?", [retiredId]);
    await db.run('INSERT INTO users (id,nickname,created_at,updated_at) VALUES (?,?,?,?)',
      ['retirement_owner', 'Retirement Owner', firstPublishedAt, firstPublishedAt]);
    const originalFilled = Array(32 * 32).fill(-1);
    originalFilled[7] = 0;
    await db.run(`INSERT INTO coloring_progress
      (user_id,template_id,filled_json,revision,completed_at,created_at,updated_at)
      VALUES (?,?,?,?,NULL,?,?)`,
    ['retirement_owner', retiredId, JSON.stringify(originalFilled), 4, firstPublishedAt, firstPublishedAt]);

    const report = await publishCatalog({ db, catalog: currentCatalog, now: retiredAt });
    assert.equal(report.production_catalog_count, 1);
    assert.equal(report.retired_stale_catalog_rows, 1);
    const retired = await db.get('SELECT status,visibility,catalog_retired_at FROM coloring_templates WHERE id=?', [retiredId]);
    assert.deepEqual(retired, { status: 'active', visibility: 'public', catalog_retired_at: retiredAt });
    let progress = await db.get('SELECT filled_json,revision,completed_at FROM coloring_progress WHERE user_id=? AND template_id=?',
      ['retirement_owner', retiredId]);
    assert.deepEqual(progress, { filled_json: JSON.stringify(originalFilled), revision: 4, completed_at: null });

    const rerun = await publishCatalog({ db, catalog: currentCatalog, now: '2026-09-25T12:00:00.000Z' });
    assert.equal(rerun.retired_stale_catalog_rows, 0);
    assert.equal((await db.get('SELECT catalog_retired_at FROM coloring_templates WHERE id=?', [retiredId])).catalog_retired_at, retiredAt);

    const restored = await publishCatalog({ db, catalog: retiredCatalog, now: '2026-09-25T13:00:00.000Z' });
    assert.equal(restored.production_catalog_count, 1);
    assert.equal((await db.get('SELECT status,visibility,catalog_retired_at FROM coloring_templates WHERE id=?', [retiredId])).catalog_retired_at, null);
    progress = await db.get('SELECT filled_json,revision,completed_at FROM coloring_progress WHERE user_id=? AND template_id=?',
      ['retirement_owner', retiredId]);
    assert.deepEqual(progress, { filled_json: JSON.stringify(originalFilled), revision: 4, completed_at: null });
  } finally {
    sqlite.close();
  }
});

test('publisher source does not route through demo seeding', async () => {
  const source = await readFile(join(serverDir, 'services', 'catalog-publisher.js'), 'utf8');
  assert.doesNotMatch(source, /seedDemoData|bootstrapSystemData/);
});

test('catalog build entrypoint uses the tiled candidate pipeline and legacy demo builder refuses catalog replacement', async () => {
  const packageJson = JSON.parse(await readFile(join(serverDir, '..', 'package.json'), 'utf8'));
  const legacyBuilder = await readFile(join(serverDir, 'scripts', 'build-catalog-assets.py'), 'utf8');
  assert.equal(packageJson.scripts['catalog:build'], 'node scripts/build-catalog-grid-candidates.mjs');
  assert.match(packageJson.scripts['catalog:build:legacy-demo'], /build-catalog-assets\.py/);
  assert.match(legacyBuilder, /Refusing to replace a different canonical catalog/);
});

test('catalog asset upload accepts short-lived scoped S3 session credentials', async () => {
  const source = await readFile(join(serverDir, 'scripts', 'publish-catalog.mjs'), 'utf8');
  assert.match(source, /sessionToken:\s*process\.env\.S3_SESSION_TOKEN/);
  assert.match(source, /const storage = needsStorage \? await storageConfig\(\) : null/);
  assert.match(source, /typeof stored\.bucket !== 'string'/);
});

test('catalog media delivery allows previews and covers but never masters', () => {
  assert.equal(isCatalogDeliveryKey('catalog/previews/pixel.png'), true);
  assert.equal(isCatalogDeliveryKey('catalog/covers/collection.png'), true);
  assert.equal(isCatalogDeliveryKey('catalog/covers/source/collection.png'), false);
  assert.equal(isCatalogDeliveryKey('catalog/masters/secret.png'), false);
  assert.equal(isCatalogDeliveryKey('catalog/previews/../masters/secret.png'), false);
});

test('catalog R2 inventory is bound to the exact canonical asset set', () => {
  const records = [{ id: 'coloring_one', kind: 'preview', source_asset: 'public/assets/catalog/generated/one-pixel.png', key: 'catalog/previews/one-pixel.png' }];
  const assets = [{ ...records[0], bytes: '123', sha256: 'A'.repeat(64) }];
  assert.deepEqual(normalizeCatalogAssetInventory(records, assets), [{ ...records[0], bytes: 123, sha256: 'a'.repeat(64) }]);
  assert.throws(() => normalizeCatalogAssetInventory(records, []), /asset count/);
  assert.throws(() => normalizeCatalogAssetInventory(records, [{ ...assets[0], source_asset: 'public/other.png' }]), /does not match/);
  assert.throws(() => normalizeCatalogAssetInventory(records, [{ ...assets[0], sha256: 'nope' }]), /does not match/);
  assert.throws(() => normalizeCatalogAssetInventory(records, [assets[0], assets[0]]), /duplicate/);
});

test('catalog preview inventory is complete, unique, and within the 16 KiB delivery budget', async () => {
  const catalog = readCanonicalCatalog();
  const records = buildCatalogAssetInventory(catalog);
  const inventoryPath = join(serverDir, '..', 'docs', 'evidence', 'catalog-r2-inventory.json');
  const inventory = JSON.parse(await readFile(inventoryPath, 'utf8'));
  // The checked-in inventory is the last verified R2 inventory and therefore
  // still names the previous delivery previews. Reuse only its unchanged
  // masters/full/covers until the candidate previews are uploaded and verified.
  const reusableRecords = records.filter((record) => record.kind !== 'preview');
  const reusableAssets = inventory.assets.filter((asset) => asset.kind !== 'preview');
  const verifiedReusableAssets = normalizeCatalogAssetInventory(reusableRecords, reusableAssets);
  const previews = records.filter((asset) => asset.kind === 'preview');

  assert.equal(previews.length, 320);
  assert.equal(new Set(previews.map((asset) => asset.key)).size, previews.length);
  assert.ok(previews.every((asset) => /-1200px-pixel\.png$/.test(asset.source_asset)));
  assert.equal(verifiedReusableAssets.length, 736);
  assert.throws(() => normalizeCatalogAssetInventory(reusableRecords, reusableAssets.slice(1)), /asset count/);
  assert.throws(
    () => normalizeCatalogAssetInventory([previews[0]], [{
      ...previews[0],
      bytes: catalogConstants.MAX_CATALOG_PREVIEW_BYTES + 1,
      sha256: 'a'.repeat(64),
    }]),
    /CATALOG_PREVIEW_SIZE_BUDGET_EXCEEDED/,
  );
});
