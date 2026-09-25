import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import {
  buildCatalogTileColorCountVector,
  createCatalogGridSource,
  validateCatalogGridSourceDescriptor,
} from '../services/catalog-grid-source.js';

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function fixture() {
  const template = {
    id: 'coloring_fixture_01',
    source_type: 'catalog',
    width: 9,
    height: 10,
    tile_size: 8,
    palette: ['#000000', '#ffffff', '#ff0000'],
  };
  const raw = Buffer.from(Array.from({ length: 90 }, (_, index) => index % 3));
  const compressed = gzipSync(raw, { mtime: 0 });
  const tileColorCounts = buildCatalogTileColorCountVector(template, raw);
  const descriptor = {
    object_key: `catalog/grids/${template.id}.${sha256(compressed)}.u8.gz`,
    sha256: sha256(compressed),
    compressed_bytes: compressed.length,
    raw_bytes: raw.length,
    tile_color_counts: tileColorCounts,
    tile_color_counts_sha256: sha256(tileColorCounts),
  };
  return { template, raw, compressed, descriptor };
}

test('catalog grid descriptor rejects any object outside the immutable catalog key pattern', () => {
  const { template, descriptor } = fixture();
  assert.equal(validateCatalogGridSourceDescriptor(descriptor, template).object_key, descriptor.object_key);
  assert.throws(() => validateCatalogGridSourceDescriptor({ ...descriptor, object_key: 'originals/user/map.u8.gz' }, template), {
    code: 'CATALOG_GRID_DESCRIPTOR_INVALID',
  });
  assert.throws(() => validateCatalogGridSourceDescriptor({ ...descriptor, sha256: '0'.repeat(64) }, template), {
    code: 'CATALOG_GRID_DESCRIPTOR_INVALID',
  });
});

test('R2-backed grid reads verify compressed checksum and extract exact partial-edge tiles', async () => {
  const { template, compressed, descriptor } = fixture();
  let reads = 0;
  const source = createCatalogGridSource({ readObject: async (key) => {
    reads += 1;
    assert.equal(key, descriptor.object_key);
    return compressed;
  } });
  const db = { get: async () => descriptor };
  const first = await source.readTile(db, template, 1, 1);
  const second = await source.readTile(db, template, 1, 1);
  assert.deepEqual({
    tile_x: first.bounds.tile_x,
    tile_y: first.bounds.tile_y,
    offset_x: first.bounds.offset_x,
    offset_y: first.bounds.offset_y,
    width: first.bounds.width,
    height: first.bounds.height,
    cell_count: first.bounds.cell_count,
    tile_size: first.bounds.tile_size,
  }, {
    tile_x: 1, tile_y: 1, offset_x: 8, offset_y: 8,
    width: 1, height: 2, cell_count: 2, tile_size: 8,
  });
  assert.deepEqual(first.cells, [2, 2]);
  assert.deepEqual(second.cells, first.cells);
  assert.equal(reads, 1);
});

test('compact Uint16LE tile/color index validates partial edges and returns exact color totals', async () => {
  const { template, compressed, descriptor } = fixture();
  const source = createCatalogGridSource({ readObject: async () => compressed });
  const db = { get: async () => descriptor };
  const edge = await source.readTileColorCounts(db, template, 1, 1);
  assert.equal([...edge.counts.values()].reduce((sum, count) => sum + count, 0), 2);
  assert.deepEqual([...edge.counts.entries()], [[2, 2]]);
  assert.equal(descriptor.tile_color_counts.length, 4 * 3 * 2);
});

test('R2-backed source fails closed on object checksum or count-vector corruption', async () => {
  const { template, compressed, descriptor } = fixture();
  const source = createCatalogGridSource({ readObject: async () => Buffer.from('not-the-canonical-object') });
  await assert.rejects(source.readTile({ get: async () => descriptor }, template, 0, 0), {
    code: 'CATALOG_GRID_OBJECT_CHECKSUM_MISMATCH',
  });
  const badCounts = { ...descriptor, tile_color_counts: Buffer.from(descriptor.tile_color_counts) };
  badCounts.tile_color_counts[0] = (badCounts.tile_color_counts[0] + 1) % 255;
  const countsSource = createCatalogGridSource({ readObject: async () => compressed });
  await assert.rejects(countsSource.readTileColorCounts({ get: async () => badCounts }, template, 0, 0), {
    code: 'CATALOG_GRID_INDEX_INVALID',
  });
});
