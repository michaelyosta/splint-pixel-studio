import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildCatalogAssetInventory,
  buildCatalogGridAssetInventory,
  normalizeCatalogAssetInventory,
  normalizeCatalogGridAssetInventory,
  readCanonicalCatalog,
  sha256,
} from '../server/services/catalog-publisher.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const generatedRoot = resolve(root, 'content/generated/catalog-grids');
const verifiedMediaInventoryPath = resolve(root, 'docs/evidence/catalog-r2-inventory.json');
const candidateMediaInventoryPath = resolve(generatedRoot, 'catalog-r2-inventory.candidate.json');
const candidateGridInventoryPath = resolve(generatedRoot, 'catalog-grids-r2-inventory.candidate.json');

const verified = JSON.parse(await readFile(verifiedMediaInventoryPath, 'utf8'));
if (verified.bucket !== 'splint-originals' || !Array.isArray(verified.assets)) {
  throw new Error('The existing verified R2 media inventory is missing or names an unexpected bucket');
}
const previousByKey = new Map(verified.assets.map((asset) => [asset.key, asset]));
if (previousByKey.size !== verified.assets.length) throw new Error('Existing R2 media inventory contains duplicate keys');

const catalog = readCanonicalCatalog();
const assetRecords = buildCatalogAssetInventory(catalog);
const mediaAssets = [];
let reusedVerifiedObjects = 0;
let newPreviewBytes = 0;
for (const record of assetRecords) {
  if (record.kind === 'preview') {
    const bytes = await readFile(record.absolute_source);
    if (bytes.length > 16 * 1024) throw new Error(`Catalog preview budget exceeded: ${record.source_asset}`);
    mediaAssets.push({
      id: record.id,
      kind: record.kind,
      source_asset: record.source_asset,
      key: record.key,
      bytes: bytes.length,
      sha256: sha256(bytes),
    });
    newPreviewBytes += bytes.length;
    continue;
  }
  const prior = previousByKey.get(record.key);
  if (!prior || prior.id !== record.id || prior.kind !== record.kind || prior.source_asset !== record.source_asset
    || !Number.isSafeInteger(Number(prior.bytes)) || !/^[a-f0-9]{64}$/i.test(String(prior.sha256 || ''))) {
    throw new Error(`Missing previously verified R2 object evidence for ${record.key}`);
  }
  mediaAssets.push({ ...record, bytes: Number(prior.bytes), sha256: String(prior.sha256).toLowerCase() });
  reusedVerifiedObjects += 1;
}
const canonicalMedia = normalizeCatalogAssetInventory(assetRecords, mediaAssets);

const gridRecords = buildCatalogGridAssetInventory(catalog);
const gridAssets = [];
let gridBytes = 0;
for (const record of gridRecords) {
  const bytes = await readFile(record.absolute_source);
  if (bytes.length !== record.bytes || sha256(bytes) !== record.sha256) {
    throw new Error(`Candidate R2 grid checksum/size mismatch: ${record.id}`);
  }
  gridAssets.push({
    id: record.id,
    kind: 'grid',
    source_asset: record.source_asset,
    key: record.key,
    bytes: record.bytes,
    sha256: record.sha256,
    raw_bytes: record.raw_bytes,
  });
  gridBytes += record.bytes;
}
const canonicalGrids = normalizeCatalogGridAssetInventory(gridRecords, gridAssets);

await writeFile(candidateMediaInventoryPath, `${JSON.stringify({
  schema_version: 1,
  generated_at: new Date().toISOString(),
  bucket: verified.bucket,
  assets: canonicalMedia.map(({ id, kind, source_asset, key, bytes, sha256: checksum }) => ({
    id, kind, source_asset, key, bytes, sha256: checksum,
  })),
}, null, 2)}\n`);
await writeFile(candidateGridInventoryPath, `${JSON.stringify({
  schema_version: 1,
  generated_at: new Date().toISOString(),
  bucket: verified.bucket,
  assets: canonicalGrids.map(({ id, kind, source_asset, key, bytes, sha256: checksum, raw_bytes }) => ({
    id, kind, source_asset, key, bytes, sha256: checksum, raw_bytes,
  })),
}, null, 2)}\n`);

console.log(JSON.stringify({
  status: 'candidate-inventories-ready-no-upload-performed',
  bucket: verified.bucket,
  media_assets: canonicalMedia.length,
  reused_previously_verified_non_preview_assets: reusedVerifiedObjects,
  preview_assets: canonicalMedia.filter((asset) => asset.kind === 'preview').length,
  new_preview_bytes: newPreviewBytes,
  grid_assets: canonicalGrids.length,
  compressed_grid_bytes: gridBytes,
  media_inventory: 'content/generated/catalog-grids/catalog-r2-inventory.candidate.json',
  grid_inventory: 'content/generated/catalog-grids/catalog-grids-r2-inventory.candidate.json',
}, null, 2));
