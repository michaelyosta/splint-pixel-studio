import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import {
  MANIFEST_NAME,
  clientFromEnv,
  listObjects,
  requireEnv,
  writeManifest,
  writeObjectToFile,
} from './object-backup-common.mjs';

requireEnv(['S3_ENDPOINT', 'S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY']);
requireEnv(['OBJECT_BACKUP_DIR'], 'Object backup destination');

const apply = process.argv.includes('--apply');
const backupDir = resolve(process.env.OBJECT_BACKUP_DIR);
const bucket = process.env.S3_BUCKET;
const client = clientFromEnv();
const objects = await listObjects(client, bucket);
const manifest = {
  format: 'splint-s3-object-backup',
  version: 1,
  created_at: new Date().toISOString(),
  source: { bucket },
  objects,
};

if (!apply) {
  console.log(JSON.stringify({ dry_run: true, backup_dir: backupDir, manifest: MANIFEST_NAME, object_count: objects.length, total_bytes: objects.reduce((sum, object) => sum + object.bytes, 0) }, null, 2));
  process.exit(0);
}

await mkdir(join(backupDir, 'objects'), { recursive: true });
for (const object of objects) {
  const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: object.key }));
  if (!response.Body) throw new Error(`Object has no body: ${object.key}`);
  const archived = await writeObjectToFile(response.Body, join(backupDir, object.archive_path));
  object.content_sha256 = archived.content_sha256;
  if (archived.bytes !== object.bytes) throw new Error(`Object size changed during backup: ${object.key}`);
}
const written = await writeManifest(backupDir, manifest);
console.log(JSON.stringify({ dry_run: false, backup_dir: backupDir, manifest: written.manifestPath, manifest_sha256: written.digest, object_count: objects.length, total_bytes: objects.reduce((sum, object) => sum + object.bytes, 0) }, null, 2));
