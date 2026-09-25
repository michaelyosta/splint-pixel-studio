import { existsSync } from 'node:fs';
import { readFile, rename, writeFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildCatalogAssetInventory,
  buildCatalogGridAssetInventory,
  catalogConstants,
  normalizeCatalogAssetInventory,
  normalizeCatalogGridAssetInventory,
  publishCatalog,
  readCanonicalCatalog,
  sha256,
} from '../services/catalog-publisher.js';
import { createS3Credentials, uploadImmutableCatalogAsset } from '../services/catalog-asset-storage.js';

const root = fileURLToPath(new URL('../..', import.meta.url));
const defaultInventoryPath = resolve(root, 'docs', 'evidence', 'catalog-r2-inventory.json');
const defaultGridInventoryPath = resolve(root, 'docs', 'evidence', 'catalog-grids-r2-inventory.json');

function hasFlag(args, name) {
  return args.includes(name);
}

function option(args, name, fallback) {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
}

function contentType(path) {
  const extension = extname(path).toLowerCase();
  return extension === '.jpg' || extension === '.jpeg' ? 'image/jpeg' : 'image/png';
}

async function storageConfig() {
  const required = ['S3_ENDPOINT', 'S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'];
  const missing = required.filter((name) => !process.env[name]);
  if (missing.length) throw new Error(`R2/S3 configuration is incomplete; missing ${missing.join(', ')}`);
  const {
    S3Client,
  } = await import('@aws-sdk/client-s3');
  return {
    endpoint: process.env.S3_ENDPOINT,
    bucket: process.env.S3_BUCKET,
    client: new S3Client({
      endpoint: process.env.S3_ENDPOINT,
      region: process.env.S3_REGION || 'auto',
      forcePathStyle: true,
      credentials: createS3Credentials({
        accessKeyId: process.env.S3_ACCESS_KEY_ID,
        secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
        sessionToken: process.env.S3_SESSION_TOKEN,
      }),
    }),
  };
}

function isNotFound(error) {
  return error?.name === 'NotFound'
    || error?.$metadata?.httpStatusCode === 404
    || error?.Code === 'NoSuchKey';
}

async function readExpectedInventory(records, inventoryPath) {
  try {
    const stored = JSON.parse(await readFile(inventoryPath, 'utf8'));
    if (!Array.isArray(stored.assets)) throw new Error('inventory.assets must be an array');
    if (typeof stored.bucket !== 'string' || !stored.bucket) {
      throw new Error('inventory.bucket must be set');
    }
    if (stored.bucket !== process.env.S3_BUCKET) {
      throw new Error(`inventory bucket ${stored.bucket} does not match configured bucket`);
    }
    return normalizeCatalogAssetInventory(records, stored.assets);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return normalizeCatalogAssetInventory(records, await collectLocalInventory(records));
    }
    throw new Error(`Cannot read inventory ${inventoryPath}: ${error.message}`);
  }
}

async function collectLocalInventory(records) {
  const assets = [];
  for (const record of records) {
    const body = await readFile(record.absolute_source);
    assets.push({
      id: record.id,
      kind: record.kind,
      source_asset: record.source_asset,
      key: record.key,
      bytes: body.length,
      sha256: sha256(body),
    });
  }
  return assets;
}

async function uploadAssets(records, storage, inventoryPath) {
  const expectedAssets = await readExpectedInventory(records, inventoryPath);
  const recordsByKey = new Map(records.map((record) => [record.key, record]));
  const uploaded = [];
  for (const expected of expectedAssets) {
    const record = recordsByKey.get(expected.key);
    if (!record) throw new Error(`Missing canonical catalog asset record for ${expected.key}`);
    const action = await uploadImmutableCatalogAsset({
      client: storage.client,
      bucket: storage.bucket,
      asset: expected,
      readBody: async () => {
        try {
          return await readFile(resolve(root, record.source_asset));
        } catch (error) {
          if (error.code === 'ENOENT') {
            throw new Error(`Missing local source for absent R2 object ${expected.key}; refusing upload`);
          }
          throw error;
        }
      },
      contentType: contentType(record.source_asset),
    });
    uploaded.push({ ...expected, action });
  }
  return uploaded;
}

async function verifyObjects(expectedAssets, storage, { restoreCheck = false } = {}) {
  const { GetObjectCommand, HeadObjectCommand } = await import('@aws-sdk/client-s3');
  const result = { checked: 0, missing: [], mismatched: [], restored_samples: [] };
  for (const expected of expectedAssets) {
    let head;
    try {
      head = await storage.client.send(new HeadObjectCommand({ Bucket: storage.bucket, Key: expected.key }));
    } catch (error) {
      if (isNotFound(error)) {
        result.missing.push(expected.key);
        continue;
      }
      throw error;
    }
    result.checked += 1;
    const remoteSha = head.Metadata?.sha256 || head.Metadata?.['x-amz-meta-sha256'];
    if (Number(head.ContentLength) !== Number(expected.bytes) || remoteSha !== expected.sha256) {
      result.mismatched.push({ key: expected.key, expected_bytes: expected.bytes, remote_bytes: head.ContentLength, expected_sha256: expected.sha256, remote_sha256: remoteSha || null });
    }
  }
  if (restoreCheck) {
    const samples = ['master', 'full', 'preview'].map((kind) => expectedAssets.find((asset) => asset.kind === kind)).filter(Boolean);
    for (const expected of samples) {
      const response = await storage.client.send(new GetObjectCommand({ Bucket: storage.bucket, Key: expected.key }));
      const body = Buffer.from(await response.Body.transformToByteArray());
      result.restored_samples.push({ key: expected.key, bytes: body.length, sha256: sha256(body), matches: body.length === Number(expected.bytes) && sha256(body) === expected.sha256 });
    }
  }
  if (result.missing.length || result.mismatched.length || result.restored_samples.some((sample) => !sample.matches)) {
    const error = new Error(`Catalog object verification failed: missing=${result.missing.length}, mismatched=${result.mismatched.length}`);
    error.report = result;
    throw error;
  }
  return result;
}

async function writeInventoryFile(inventoryPath, value) {
  const temporary = `${inventoryPath}.${process.pid}.tmp`;
  await writeFile(temporary, JSON.stringify(value, null, 2) + '\n', 'utf8');
  await rename(temporary, inventoryPath);
}

async function readExpectedGridInventory(records, inventoryPath) {
  try {
    const stored = JSON.parse(await readFile(inventoryPath, 'utf8'));
    if (stored.bucket !== process.env.S3_BUCKET) throw new Error('grid inventory bucket does not match configured bucket');
    return normalizeCatalogGridAssetInventory(records, stored.assets);
  } catch (error) {
    if (error.code !== 'ENOENT') throw new Error(`Cannot read grid inventory ${inventoryPath}: ${error.message}`);
    const assets = [];
    for (const record of records) {
      const body = await readFile(resolve(root, record.source_asset));
      assets.push({
        id: record.id,
        kind: 'grid',
        source_asset: record.source_asset,
        key: record.key,
        bytes: body.length,
        sha256: sha256(body),
        raw_bytes: record.raw_bytes,
      });
    }
    return normalizeCatalogGridAssetInventory(records, assets);
  }
}

async function uploadGridAssets(records, storage, inventoryPath, writeInventory) {
  const expectedAssets = await readExpectedGridInventory(records, inventoryPath);
  const uploaded = [];
  for (const asset of expectedAssets) {
    const action = await uploadImmutableCatalogAsset({
      client: storage.client,
      bucket: storage.bucket,
      asset,
      readBody: async () => readFile(resolve(root, asset.source_asset)),
      contentType: 'application/gzip',
    });
    uploaded.push({ ...asset, action });
  }
  if (writeInventory) {
    const inventoryAssets = uploaded.map((asset) => Object.fromEntries(Object.entries(asset).filter(([key]) => key !== 'action' && key !== 'absolute_source')));
    await writeInventoryFile(inventoryPath, { schema_version: 1, generated_at: new Date().toISOString(), bucket: storage.bucket, assets: inventoryAssets });
  }
  return uploaded;
}

async function verifyGridObjects(expectedAssets, storage, { restoreCheck = false } = {}) {
  const { GetObjectCommand, HeadObjectCommand } = await import('@aws-sdk/client-s3');
  const result = { checked: 0, missing: [], mismatched: [], restored_samples: [] };
  for (const expected of expectedAssets) {
    let head;
    try {
      head = await storage.client.send(new HeadObjectCommand({ Bucket: storage.bucket, Key: expected.key }));
    } catch (error) {
      if (isNotFound(error)) {
        result.missing.push(expected.key);
        continue;
      }
      throw error;
    }
    result.checked += 1;
    const remoteSha = head.Metadata?.sha256 || head.Metadata?.['x-amz-meta-sha256'];
    if (Number(head.ContentLength) !== expected.bytes || remoteSha !== expected.sha256) {
      result.mismatched.push({ key: expected.key, expected_bytes: expected.bytes, remote_bytes: head.ContentLength, expected_sha256: expected.sha256, remote_sha256: remoteSha || null });
    }
  }
  if (restoreCheck) {
    const samples = [expectedAssets[0], expectedAssets[Math.floor(expectedAssets.length / 2)], expectedAssets.at(-1)].filter(Boolean);
    for (const expected of samples) {
      const response = await storage.client.send(new GetObjectCommand({ Bucket: storage.bucket, Key: expected.key }));
      const body = Buffer.from(await response.Body.transformToByteArray());
      result.restored_samples.push({ key: expected.key, bytes: body.length, sha256: sha256(body), matches: body.length === expected.bytes && sha256(body) === expected.sha256 });
    }
  }
  if (result.missing.length || result.mismatched.length || result.restored_samples.some((sample) => !sample.matches)) {
    const error = new Error(`Catalog grid object verification failed: missing=${result.missing.length}, mismatched=${result.mismatched.length}`);
    error.report = result;
    throw error;
  }
  return result;
}

async function main() {
  const args = process.argv.slice(2);
  const checkOnly = hasFlag(args, '--check');
  const upload = hasFlag(args, '--upload-assets');
  const verify = hasFlag(args, '--verify-assets');
  const restoreCheck = hasFlag(args, '--restore-check');
  const writeInventory = hasFlag(args, '--write-inventory');
  const uploadGrids = hasFlag(args, '--upload-grid-assets');
  const verifyGrids = hasFlag(args, '--verify-grid-assets');
  const restoreGridCheck = hasFlag(args, '--restore-check-grid-assets');
  const writeGridInventory = hasFlag(args, '--write-grid-inventory');
  const inventoryPath = resolve(option(args, '--inventory', defaultInventoryPath));
  const gridInventoryPath = resolve(option(args, '--grid-inventory', defaultGridInventoryPath));
  const manifestPath = resolve(option(args, '--manifest', resolve(root, 'content', 'catalog-manifest.json')));
  const runtimePath = resolve(option(args, '--runtime', resolve(root, 'server', 'catalog-templates.json')));
  const publishToDatabase = !checkOnly && !upload && !verify && !restoreCheck
    && !uploadGrids && !verifyGrids && !restoreGridCheck;
  const runtimeForSourceCheck = JSON.parse(await readFile(runtimePath, 'utf8'));
  const hasMissingLocalGrid = runtimeForSourceCheck.some((template) => template.storage_mode === 'tiled'
    && !existsSync(resolve(root, String(template.cell_map_asset || ''))));
  const needsStorage = publishToDatabase || upload || verify || restoreCheck || uploadGrids || verifyGrids || restoreGridCheck;
  const storage = needsStorage ? await storageConfig() : null;
  let gridReader = null;
  if (publishToDatabase && hasMissingLocalGrid) {
    const { GetObjectCommand } = await import('@aws-sdk/client-s3');
    gridReader = async (template) => {
      if (!template.cell_map_r2_key) throw new Error(`Missing R2 source key for catalog grid ${template.id}`);
      const response = await storage.client.send(new GetObjectCommand({
        Bucket: storage.bucket,
        Key: template.cell_map_r2_key,
      }));
      if (!response.Body) throw new Error(`R2 catalog grid has no object body: ${template.cell_map_r2_key}`);
      return Buffer.from(await response.Body.transformToByteArray());
    };
  }
  const catalog = readCanonicalCatalog({
    manifestPath,
    runtimePath,
    gridReader,
  });
  const report = {
    status: 'validated',
    manifest_count: catalog.counts.colorings,
    collections: catalog.counts.collections,
    albums: catalog.counts.albums,
    free: catalog.counts.free,
    premium: catalog.counts.premium,
    assets: catalog.assetRecords.length,
    grid_assets: catalog.runtimeTemplates.filter((template) => template.storage_mode === 'tiled').length,
    expected_catalog_count: catalogConstants.EXPECTED_CATALOG_COUNT,
  };

  if (upload || verify || restoreCheck) {
    const records = buildCatalogAssetInventory(catalog);
    if (upload) {
      const uploaded = await uploadAssets(records, storage, inventoryPath);
      report.asset_upload = { total: uploaded.length, uploaded: uploaded.filter((item) => item.action === 'uploaded').length, verified_existing: uploaded.filter((item) => item.action === 'verified-existing').length };
      if (writeInventory) {
        const inventoryAssets = uploaded.map((asset) => Object.fromEntries(Object.entries(asset).filter(([key]) => key !== 'action')));
    await writeInventoryFile(inventoryPath, { schema_version: 1, generated_at: new Date().toISOString(), bucket: storage.bucket, assets: inventoryAssets });
      }
    }
    if (verify || restoreCheck) {
      const expected = await readExpectedInventory(records, inventoryPath);
      report.asset_verification = await verifyObjects(expected, storage, { restoreCheck });
    }
  }

  if (uploadGrids || verifyGrids || restoreGridCheck) {
    const records = buildCatalogGridAssetInventory(catalog);
    if (uploadGrids) {
      const uploaded = await uploadGridAssets(records, storage, gridInventoryPath, writeGridInventory);
      report.grid_asset_upload = {
        total: uploaded.length,
        uploaded: uploaded.filter((item) => item.action === 'uploaded').length,
        verified_existing: uploaded.filter((item) => item.action === 'verified-existing').length,
      };
    }
    if (verifyGrids || restoreGridCheck) {
      const expected = await readExpectedGridInventory(records, gridInventoryPath);
      report.grid_asset_verification = await verifyGridObjects(expected, storage, { restoreCheck: restoreGridCheck });
    }
  }

  if (publishToDatabase) {
    const gridRecords = buildCatalogGridAssetInventory(catalog);
    const expectedGridAssets = await readExpectedGridInventory(gridRecords, gridInventoryPath);
    report.grid_asset_verification = await verifyGridObjects(expectedGridAssets, storage);
    const assetRecords = buildCatalogAssetInventory(catalog);
    const expectedAssets = await readExpectedInventory(assetRecords, inventoryPath);
    report.asset_verification = await verifyObjects(expectedAssets, storage);
    const { all, closeDb, get, initDb, run, withDbTransaction } = await import('../db.js');
    await initDb();
    try {
      const published = await publishCatalog({ db: { all, get, run, withDbTransaction }, catalog });
      Object.assign(report, published, { status: published.production_catalog_count === catalog.counts.colorings ? 'published' : 'published_with_mismatch' });
    } finally {
      await closeDb();
    }
  }
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({ status: 'failed', code: error.code || 'CATALOG_PUBLISH_FAILED', message: error.message, report: error.report || undefined }, null, 2));
  process.exitCode = 1;
});
