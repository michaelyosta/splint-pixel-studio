import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import manifest from '../content/catalog-manifest.json' with { type: 'json' };
import {
  CATALOG_ALBUM_BY_ID,
  CATALOG_COLLECTION_BY_ID,
} from '../server/services/catalog-merchandising.js';

const root = resolve(import.meta.dirname, '..');
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function localAssetPath(assetPath) {
  const normalized = String(assetPath || '').replaceAll('\\', '/');
  return resolve(root, normalized.startsWith('/') ? normalized.slice(1) : normalized);
}

async function assertPngAsset(assetPath, expectedWidth, expectedHeight) {
  assert.ok(assetPath, 'asset path is required');
  const filePath = localAssetPath(assetPath);
  await access(filePath);
  const bytes = await readFile(filePath);
  assert.ok(bytes.length >= 24, `PNG is too small: ${assetPath}`);
  assert.deepEqual(bytes.subarray(0, 8), PNG_SIGNATURE, `invalid PNG signature: ${assetPath}`);
  assert.equal(bytes.toString('ascii', 12, 16), 'IHDR', `PNG has no IHDR: ${assetPath}`);
  if (expectedWidth !== undefined && expectedHeight !== undefined) {
    assert.equal(bytes.readUInt32BE(16), Number(expectedWidth), `unexpected width: ${assetPath}`);
    assert.equal(bytes.readUInt32BE(20), Number(expectedHeight), `unexpected height: ${assetPath}`);
  }
  return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
}

test('catalog manifest has a complete normalized hierarchy and valid local assets', async () => {
  assert.equal(manifest.entries.length, 320);
  assert.equal(manifest.covers.length, 48);
  assert.equal(CATALOG_COLLECTION_BY_ID.size, 16);
  assert.equal(CATALOG_ALBUM_BY_ID.size, 32);

  const unique = (items, label) => assert.equal(new Set(items).size, items.length, `duplicate ${label}`);
  unique(manifest.entries.map((entry) => entry.id), 'entry id');
  unique(manifest.entries.map((entry) => entry.slug), 'entry slug');
  unique(manifest.covers.map((cover) => cover.id), 'cover id');
  unique(manifest.entries.map((entry) => entry.optimized_asset), 'optimized asset path');
  unique(manifest.entries.map((entry) => entry.preview_asset), 'preview asset path');

  const accessCounts = manifest.entries.reduce((counts, entry) => {
    counts[entry.access] = (counts[entry.access] || 0) + 1;
    return counts;
  }, {});
  assert.deepEqual(accessCounts, { free: 172, premium: 148 });
  assert.ok(manifest.entries.every((entry) => (
    CATALOG_COLLECTION_BY_ID.has(entry.collection_id)
    && CATALOG_ALBUM_BY_ID.has(entry.album_id)
    && entry.source_asset
    && entry.optimized_asset
    && entry.preview_asset
  )));

  const coverByParent = new Map(manifest.covers.map((cover) => [cover.parent_id, cover]));
  assert.equal(coverByParent.size, 48);
  assert.ok([...CATALOG_COLLECTION_BY_ID.keys()].every((id) => coverByParent.has(id)));
  assert.ok([...CATALOG_ALBUM_BY_ID.keys()].every((id) => coverByParent.has(id)));
  assert.ok([...coverByParent.keys()].every((id) => CATALOG_COLLECTION_BY_ID.has(id) || CATALOG_ALBUM_BY_ID.has(id)));

  await Promise.all(manifest.entries.flatMap((entry) => [
    assertPngAsset(entry.source_asset, entry.width, entry.height),
    assertPngAsset(entry.optimized_asset),
    assertPngAsset(entry.preview_asset).then(([width, height]) => {
      assert.ok(width > 0 && height > 0, `preview has invalid dimensions: ${entry.preview_asset}`);
      assert.equal(width * Number(entry.grid_height), height * Number(entry.grid_width), `preview ratio mismatch: ${entry.preview_asset}`);
    }),
  ]));
  await Promise.all(manifest.covers.flatMap((cover) => [
    assertPngAsset(cover.source_asset, cover.width, cover.height),
    assertPngAsset(cover.optimized_asset),
  ]));

  // Delivery budgets: card and player surfaces serve the lightweight pixel
  // preview, never the full-resolution master. A regression here directly
  // inflates every catalog page view on mobile WebViews.
  const MAX_PREVIEW_BYTES = 16 * 1024;
  const MAX_COVER_BYTES = 1024 * 1024;
  await Promise.all(manifest.entries.map(async (entry) => {
    const bytes = await readFile(localAssetPath(entry.preview_asset));
    assert.ok(
      bytes.length <= MAX_PREVIEW_BYTES,
      `preview exceeds delivery budget (${bytes.length} > ${MAX_PREVIEW_BYTES}): ${entry.preview_asset}`,
    );
  }));
  await Promise.all(manifest.covers.map(async (cover) => {
    const bytes = await readFile(localAssetPath(cover.optimized_asset));
    assert.ok(
      bytes.length <= MAX_COVER_BYTES,
      `cover exceeds delivery budget (${bytes.length} > ${MAX_COVER_BYTES}): ${cover.optimized_asset}`,
    );
  }));
});
