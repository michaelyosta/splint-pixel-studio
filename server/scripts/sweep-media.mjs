import { readdir, stat, unlink } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DeleteObjectsCommand, ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3';
import { all, closeDb, initDb } from '../db.js';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const defaultRoot = join(scriptDir, '..', 'uploads');
const args = new Set(process.argv.slice(2));

if (args.has('--help')) {
  console.log('Usage: npm --prefix server run media:sweep -- [--dry-run|--apply]');
  console.log('Default is --dry-run. --apply additionally requires CONFIRM_MEDIA_SWEEP=YES.');
  process.exit(0);
}

const apply = args.has('--apply');
if (apply && process.env.CONFIRM_MEDIA_SWEEP !== 'YES') {
  throw new Error('Refusing media deletion: set CONFIRM_MEDIA_SWEEP=YES together with --apply');
}

const minAgeMs = Number(process.env.MEDIA_SWEEP_MIN_AGE_MS || 60 * 60 * 1000);
if (!Number.isFinite(minAgeMs) || minAgeMs < 0) throw new Error('MEDIA_SWEEP_MIN_AGE_MS must be a non-negative number');
const cutoff = Date.now() - minAgeMs;

function isS3() {
  return process.env.STORAGE_DRIVER === 's3';
}

async function referencedKeys() {
  const refs = new Set();
  const artworks = await all('SELECT storage_key,thumbnail_key FROM artworks');
  const templates = await all('SELECT original_media_key FROM coloring_templates WHERE original_media_key IS NOT NULL');
  for (const row of [...artworks, ...templates]) {
    for (const value of Object.values(row)) {
      if (typeof value !== 'string') continue;
      const marker = value.match(/^(?:local|s3):\/\/[^/]+\/(.+)$/);
      if (marker) refs.add(marker[1]);
      else if (!value.includes('://') && value) refs.add(value.replace(/^\/+/, ''));
    }
  }
  return refs;
}

async function walk(root, directory = root, files = []) {
  for (const entry of await readdir(directory, { withFileTypes: true }).catch(() => [])) {
    const full = join(directory, entry.name);
    if (entry.isDirectory()) await walk(root, full, files);
    else {
      const metadata = await stat(full);
      files.push({ key: relative(root, full).replaceAll('\\', '/'), path: full, modifiedAt: metadata.mtimeMs, bytes: metadata.size });
    }
  }
  return files;
}

async function sweepLocal(refs) {
  const root = process.env.MEDIA_STORAGE_ROOT || defaultRoot;
  const candidates = (await walk(root)).filter((file) => file.modifiedAt <= cutoff && !refs.has(file.key));
  if (apply) for (const file of candidates) await unlink(file.path);
  return { driver: 'local', root, dry_run: !apply, candidates };
}

async function sweepS3(refs) {
  const required = ['S3_ENDPOINT', 'S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'];
  const missing = required.filter((name) => !process.env[name]);
  if (missing.length) throw new Error(`S3 sweep requires: ${missing.join(', ')}`);
  const client = new S3Client({
    endpoint: process.env.S3_ENDPOINT,
    region: process.env.S3_REGION || 'us-east-1',
    forcePathStyle: true,
    credentials: { accessKeyId: process.env.S3_ACCESS_KEY_ID, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY },
  });
  const objects = [];
  let continuationToken;
  do {
    const page = await client.send(new ListObjectsV2Command({ Bucket: process.env.S3_BUCKET, ContinuationToken: continuationToken }));
    objects.push(...(page.Contents || []));
    continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (continuationToken);
  const candidates = objects
    .filter((object) => object.Key && object.LastModified?.getTime() <= cutoff && !refs.has(object.Key))
    .map((object) => ({ key: object.Key, modifiedAt: object.LastModified.getTime(), bytes: object.Size || 0 }));
  if (apply && candidates.length) {
    await client.send(new DeleteObjectsCommand({
      Bucket: process.env.S3_BUCKET,
      Delete: { Objects: candidates.map(({ key }) => ({ Key: key })), Quiet: true },
    }));
  }
  return { driver: 's3', bucket: process.env.S3_BUCKET, dry_run: !apply, candidates };
}

try {
  await initDb();
  const refs = await referencedKeys();
  const report = isS3() ? await sweepS3(refs) : await sweepLocal(refs);
  console.log(JSON.stringify({ ...report, referenced_objects: refs.size }, null, 2));
} finally {
  await closeDb();
}
