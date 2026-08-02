import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { createHash as createHashStream } from 'node:crypto';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { join, resolve, sep } from 'node:path';
import {
  CreateBucketCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';

export const MANIFEST_NAME = 'object-backup.manifest.json';
export const MANIFEST_SHA_NAME = `${MANIFEST_NAME}.sha256`;

export function requireEnv(names, label = 'Object backup') {
  const missing = names.filter((name) => !process.env[name]);
  if (missing.length) throw new Error(`${label} requires: ${missing.join(', ')}`);
}

export function clientFromEnv(env = process.env) {
  return new S3Client({
    endpoint: env.S3_ENDPOINT,
    region: env.S3_REGION || 'us-east-1',
    forcePathStyle: true,
    credentials: { accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY },
  });
}

export function archivePathForKey(key) {
  return `objects/${createHash('sha256').update(key).digest('hex')}.bin`;
}

export function archiveFilePath(backupDir, archivePath) {
  if (typeof archivePath !== 'string' || !/^objects\/[a-f0-9]{64}\.bin$/.test(archivePath)) {
    const error = new Error('Invalid object archive path');
    error.code = 'INVALID_ARCHIVE_PATH';
    throw error;
  }
  const root = `${resolve(backupDir)}${sep}`;
  const target = resolve(backupDir, archivePath);
  if (!target.startsWith(root)) {
    const error = new Error('Object archive path escapes backup directory');
    error.code = 'INVALID_ARCHIVE_PATH';
    throw error;
  }
  return target;
}

export function describeObject(key, head, listed = {}) {
  const [root, entityId] = key.split('/');
  const logicalType = root === 'artworks'
    ? 'canonical'
    : root === 'thumbnails'
      ? 'thumbnail'
      : root === 'originals'
        ? 'original'
        : 'unknown';
  return {
    key,
    archive_path: archivePathForKey(key),
    bytes: Number(head.ContentLength ?? listed.Size ?? 0),
    etag: head.ETag || listed.ETag || null,
    content_type: head.ContentType || 'application/octet-stream',
    logical_type: logicalType,
    artwork_id: logicalType === 'canonical' || logicalType === 'thumbnail' ? entityId || null : null,
    owner_or_template_id: logicalType === 'original' ? entityId || null : null,
    last_modified: (head.LastModified || listed.LastModified || null)?.toISOString?.() || null,
  };
}

export async function listObjects(client, bucket) {
  const records = [];
  let continuationToken;
  do {
    const page = await client.send(new ListObjectsV2Command({ Bucket: bucket, ContinuationToken: continuationToken }));
    for (const listed of page.Contents || []) {
      if (!listed.Key) continue;
      const head = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: listed.Key }));
      records.push(describeObject(listed.Key, head, listed));
    }
    continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (continuationToken);
  return records;
}

export async function writeObjectToFile(body, filePath) {
  const hash = createHashStream('sha256');
  let bytes = 0;
  const digest = new Transform({
    transform(chunk, _encoding, callback) {
      bytes += chunk.length;
      hash.update(chunk);
      callback(null, chunk);
    },
  });
  await pipeline(Readable.from(body), digest, createWriteStream(filePath, { flags: 'w' }));
  return { bytes, content_sha256: hash.digest('hex') };
}

export async function hashFile(filePath) {
  const hash = createHash('sha256');
  let bytes = 0;
  for await (const chunk of createReadStream(filePath)) {
    bytes += chunk.length;
    hash.update(chunk);
  }
  return { bytes, content_sha256: hash.digest('hex') };
}

export async function hashObject(client, bucket, key) {
  const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  if (!response.Body) throw new Error(`Object has no body: ${key}`);
  const hash = createHash('sha256');
  let bytes = 0;
  for await (const chunk of response.Body) {
    bytes += chunk.length;
    hash.update(chunk);
  }
  return { bytes, content_sha256: hash.digest('hex') };
}

export async function readManifest(backupDir) {
  const content = await readFile(join(backupDir, MANIFEST_NAME), 'utf8');
  const sidecar = (await readFile(join(backupDir, MANIFEST_SHA_NAME), 'utf8')).trim().split(/\s+/)[0];
  const actual = createHash('sha256').update(content).digest('hex');
  if (!sidecar || sidecar !== actual) throw new Error('Object backup manifest checksum mismatch');
  return JSON.parse(content);
}

export async function writeManifest(backupDir, manifest) {
  await mkdir(join(backupDir, 'objects'), { recursive: true });
  const content = `${JSON.stringify(manifest, null, 2)}\n`;
  const manifestPath = join(backupDir, MANIFEST_NAME);
  const temporaryPath = `${manifestPath}.tmp`;
  await writeFile(temporaryPath, content, 'utf8');
  await rename(temporaryPath, manifestPath);
  const digest = createHash('sha256').update(content).digest('hex');
  await writeFile(join(backupDir, MANIFEST_SHA_NAME), `${digest}  ${MANIFEST_NAME}\n`, 'utf8');
  return { manifestPath, digest };
}

export async function verifyArchive(backupDir, manifest) {
  const failures = [];
  let totalBytes = 0;
  for (const object of manifest.objects || []) {
    try {
      const filePath = archiveFilePath(backupDir, object.archive_path);
      const actual = await hashFile(filePath);
      totalBytes += actual.bytes;
      if (actual.bytes !== object.bytes || actual.content_sha256 !== object.content_sha256) {
        failures.push({ key: object.key, reason: 'content_mismatch', expected: { bytes: object.bytes, content_sha256: object.content_sha256 }, actual });
      }
    } catch (error) {
      failures.push({ key: object.key, reason: error.code === 'ENOENT' ? 'missing_archive_file' : error.code === 'INVALID_ARCHIVE_PATH' ? 'invalid_archive_path' : 'read_error' });
    }
  }
  return { ok: failures.length === 0, object_count: (manifest.objects || []).length, total_bytes: totalBytes, failures };
}

export async function ensureBucket(client, bucket) {
  try {
    await client.send(new HeadBucketCommand({ Bucket: bucket }));
  } catch (error) {
    if (!['NotFound', 'NoSuchBucket', 'NotFoundException'].includes(error.name)) throw error;
    await client.send(new CreateBucketCommand({ Bucket: bucket }));
  }
}

export async function putArchiveObject(client, bucket, backupDir, object) {
  await client.send(new PutObjectCommand({
    Bucket: bucket,
    Key: object.key,
    Body: createReadStream(archiveFilePath(backupDir, object.archive_path)),
    ContentLength: object.bytes,
    ContentType: object.content_type || 'application/octet-stream',
  }));
  return hashObject(client, bucket, object.key);
}
