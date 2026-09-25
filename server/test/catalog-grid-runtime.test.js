import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

const storageRoot = await mkdtemp(join(tmpdir(), 'splint-catalog-grid-runtime-'));
process.env.MEDIA_STORAGE_ROOT = storageRoot;

const { readTiledTemplateTiles, readTiledTemplateTilesForSpecials, readTiledTile, applyTiledChanges } = await import('../services/tiled-coloring.js');
const { buildCatalogTileColorCountVector } = await import('../services/catalog-grid-source.js');

test('R2-backed catalog maps serve exact edge tiles to rendering and keep cell validation server-authoritative', async (t) => {
  t.after(async () => rm(storageRoot, { recursive: true, force: true }));

  const template = {
    id: 'catalog_grid_runtime_test',
    source_type: 'catalog',
    storage_mode: 'tiled',
    width: 40,
    height: 20,
    tile_size: 8,
    palette: ['#101010', '#eeeeee'],
  };
  const raw = Buffer.alloc(template.width * template.height);
  for (let y = 0; y < template.height; y += 1) {
    for (let x = 0; x < template.width; x += 1) raw[y * template.width + x] = x < 8 ? 0 : 1;
  }
  const compressed = gzipSync(raw, { mtime: 0 });
  const sha256 = createHash('sha256').update(compressed).digest('hex');
  const objectKey = `catalog/grids/${template.id}.${sha256}.u8.gz`;
  const objectPath = join(storageRoot, ...objectKey.split('/'));
  await mkdir(join(storageRoot, 'catalog', 'grids'), { recursive: true });
  await writeFile(objectPath, compressed, { flag: 'wx' });
  const vector = buildCatalogTileColorCountVector(template, raw);
  const vectorSha = createHash('sha256').update(vector).digest('hex');
  const descriptor = {
    object_key: objectKey,
    sha256,
    compressed_bytes: compressed.length,
    raw_bytes: raw.length,
    tile_color_counts: vector,
    tile_color_counts_sha256: vectorSha,
  };
  const db = {
    async get(sql) {
      if (sql.includes('FROM coloring_catalog_grid_sources')) return descriptor;
      return null;
    },
    async all() { return []; },
  };

  const edgeTile = await readTiledTile(db, { template, userId: 'runtime-test', tileX: 4, tileY: 2 });
  assert.deepEqual([edgeTile.bounds.width, edgeTile.bounds.height], [8, 4]);
  assert.deepEqual(edgeTile.cells, Array(32).fill(1));

  const renderTiles = await readTiledTemplateTiles(db, { template });
  const specialTiles = await readTiledTemplateTilesForSpecials(db, { template });
  assert.equal(renderTiles.length, 15);
  assert.deepEqual(renderTiles.map(({ tile_x, tile_y, width, height, cells }) => ({ tile_x, tile_y, width, height, cells })), specialTiles);
  assert.deepEqual([renderTiles.at(-1).width, renderTiles.at(-1).height], [8, 4]);

  await assert.rejects(
    applyTiledChanges(db, {
      userId: 'runtime-test',
      template,
      existingProgress: null,
      changes: [{ index: template.width * (template.height - 1) + template.width - 1, color: 0 }],
    }),
    (error) => error?.code === 'INVALID_COLOR_FOR_CELL',
  );
  const valid = await applyTiledChanges(db, {
    userId: 'runtime-test',
    template,
    existingProgress: null,
    changes: [{ index: template.width * (template.height - 1) + template.width - 1, color: 1 }],
  });
  assert.equal(valid.completedCells, 1);
  assert.deepEqual(valid.states.get('4:2').bounds, edgeTile.bounds);
});
