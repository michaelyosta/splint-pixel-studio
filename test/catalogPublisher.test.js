import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCatalogAssetInventory,
  catalogConstants,
  readCanonicalCatalog,
} from '../server/services/catalog-publisher.js';

test('catalog publisher validates the canonical 320-item delivery set', () => {
  const catalog = readCanonicalCatalog();

  assert.equal(catalogConstants.EXPECTED_CATALOG_COUNT, 320);
  assert.equal(catalogConstants.EXPECTED_COVER_COUNT, 48);
  assert.deepEqual(catalog.counts, {
    collections: 16,
    albums: 32,
    colorings: 320,
    free: 172,
    premium: 148,
  });
  assert.equal(catalog.assetRecords.length, 1056);
  assert.equal(new Set(catalog.assetRecords.map((asset) => asset.key)).size, 1056);
  assert.ok(catalog.assetRecords.every((asset) => !asset.key.includes('..')));
  assert.ok(catalog.entries.every((entry) => entry.preview_asset.endsWith('-pixel.png')));
  assert.ok(catalog.assetRecords.filter((asset) => asset.kind === 'preview').every((asset) => asset.key.startsWith('catalog/previews/')));
  assert.ok(catalog.assetRecords.filter((asset) => asset.kind === 'master').every((asset) => asset.key.startsWith('catalog/masters/')));
  assert.ok(catalog.assetRecords.filter((asset) => asset.kind === 'full').every((asset) => asset.key.startsWith('catalog/full/')));
  assert.ok(catalog.assetRecords.filter((asset) => asset.kind === 'cover-source').every((asset) => asset.key.startsWith('catalog/covers/source/')));
  assert.ok(catalog.assetRecords.filter((asset) => asset.kind === 'cover').every((asset) => asset.key.startsWith('catalog/covers/')));
});

test('catalog publisher keeps runtime payload ids aligned with canonical metadata', () => {
  const catalog = readCanonicalCatalog();
  assert.equal(catalog.runtimeById.size, catalog.entries.length);
  for (const entry of catalog.entries) {
    const runtime = catalog.runtimeById.get(entry.id);
    assert.ok(runtime, entry.id);
    assert.ok(Array.isArray(runtime.palette), entry.id);
    assert.ok(Array.isArray(runtime.cells), entry.id);
    assert.equal(runtime.cells.length, runtime.width * runtime.height, entry.id);
  }
});

test('catalog asset inventory does not require generated binaries to validate identity', () => {
  const catalog = readCanonicalCatalog();
  const inventory = buildCatalogAssetInventory(catalog);
  assert.equal(inventory.length, 1056);
  const normalizePath = (value) => String(value).replaceAll('\\', '/');
  assert.ok(inventory.every((asset) => normalizePath(asset.absolute_source).endsWith(asset.source_asset)));
});
