import { readFile, writeFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildCatalogAssetInventory,
  catalogConstants,
  normalizeCatalogAssetInventory,
  publishCatalog,
  readCanonicalCatalog,
  sha256,
} from '../services/catalog-publisher.js';

const root = fileURLToPath(new URL('../..', import.meta.url));
const defaultInventoryPath = resolve(root, 'content', 'catalog-r2-inventory.json');

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
      credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY_ID,
        secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
        ...(process.env.S3_SESSION_TOKEN ? { sessionToken: process.env.S3_SESSION_TOKEN } : {}),
      },
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
    if (error.code === 'ENOENT') return collectLocalInventory(records);
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
  const { HeadObjectCommand, PutObjectCommand } = await import('@aws-sdk/client-s3');
  const expectedAssets = await readExpectedInventory(records, inventoryPath);
  const recordsByKey = new Map(records.map((record) => [record.key, record]));
  const uploaded = [];
  for (const expected of expectedAssets) {
    let head = null;
    try {
      head = await storage.client.send(new HeadObjectCommand({ Bucket: storage.bucket, Key: expected.key }));
    } catch (error) {
      if (!isNotFound(error)) throw error;
    }
    if (head) {
      const remoteSha = head.Metadata?.sha256 || head.Metadata?.['x-amz-meta-sha256'];
      if (Number(head.ContentLength) !== expected.bytes || remoteSha !== expected.sha256) {
        throw new Error(`Immutable catalog object mismatch at ${expected.key}; refusing overwrite`);
      }
      uploaded.push({ ...expected, action: 'verified-existing' });
      continue;
    }
    const record = recordsByKey.get(expected.key);
    let body;
    try {
      body = await readFile(resolve(root, record.source_asset));
    } catch (error) {
      if (error.code === 'ENOENT') {
        throw new Error(`Missing local source for absent R2 object ${expected.key}; refusing upload`);
      }
      throw error;
    }
    if (body.length !== expected.bytes || sha256(body) !== expected.sha256) {
      throw new Error(`Local catalog source mismatch at ${expected.key}; refusing upload`);
    }
    await storage.client.send(new PutObjectCommand({
      Bucket: storage.bucket,
      Key: expected.key,
      Body: body,
      ContentType: contentType(record.source_asset),
      CacheControl: 'public, max-age=31536000, immutable',
      Metadata: { sha256: expected.sha256, source_asset: record.source_asset },
    }));
    uploaded.push({ ...expected, action: 'uploaded' });
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

async function main() {
  const args = process.argv.slice(2);
  const checkOnly = hasFlag(args, '--check');
  const upload = hasFlag(args, '--upload-assets');
  const verify = hasFlag(args, '--verify-assets');
  const restoreCheck = hasFlag(args, '--restore-check');
  const writeInventory = hasFlag(args, '--write-inventory');
  const inventoryPath = resolve(option(args, '--inventory', defaultInventoryPath));
  const catalog = readCanonicalCatalog({
    manifestPath: option(args, '--manifest', undefined),
    runtimePath: option(args, '--runtime', undefined),
  });
  const report = {
    status: 'validated',
    manifest_count: catalog.counts.colorings,
    collections: catalog.counts.collections,
    albums: catalog.counts.albums,
    free: catalog.counts.free,
    premium: catalog.counts.premium,
    assets: catalog.assetRecords.length,
    expected_catalog_count: catalogConstants.EXPECTED_CATALOG_COUNT,
  };

  if (upload || verify || restoreCheck) {
    const storage = await storageConfig();
    const records = buildCatalogAssetInventory(catalog);
    if (upload) {
      const uploaded = await uploadAssets(records, storage, inventoryPath);
      report.asset_upload = { total: uploaded.length, uploaded: uploaded.filter((item) => item.action === 'uploaded').length, verified_existing: uploaded.filter((item) => item.action === 'verified-existing').length };
      if (writeInventory) {
        const inventoryAssets = uploaded.map((asset) => Object.fromEntries(Object.entries(asset).filter(([key]) => key !== 'action')));
        await writeFile(inventoryPath, JSON.stringify({ schema_version: 1, generated_at: new Date().toISOString(), bucket: storage.bucket, assets: inventoryAssets }, null, 2) + '\n', 'utf8');
      }
    }
    if (verify || restoreCheck) {
      const expected = await readExpectedInventory(records, inventoryPath);
      report.asset_verification = await verifyObjects(expected, storage, { restoreCheck });
    }
  }

  if (!checkOnly && !upload && !verify && !restoreCheck) {
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
