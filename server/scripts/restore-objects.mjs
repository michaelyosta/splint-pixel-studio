import { resolve } from 'node:path';
import {
  clientFromEnv,
  ensureBucket,
  putArchiveObject,
  readManifest,
  requireEnv,
  verifyArchive,
} from './object-backup-common.mjs';

requireEnv(['OBJECT_BACKUP_DIR'], 'Object restore');
requireEnv(['RESTORE_S3_ENDPOINT', 'RESTORE_S3_BUCKET', 'RESTORE_S3_ACCESS_KEY_ID', 'RESTORE_S3_SECRET_ACCESS_KEY'], 'Object restore destination');

const apply = process.argv.includes('--apply');
if (apply && process.env.CONFIRM_OBJECT_RESTORE !== 'YES') throw new Error('Refusing object restore: set CONFIRM_OBJECT_RESTORE=YES with --apply');

const backupDir = resolve(process.env.OBJECT_BACKUP_DIR);
const manifest = await readManifest(backupDir);
const archive = await verifyArchive(backupDir, manifest);
if (!archive.ok) throw new Error(`Object archive verification failed for ${archive.failures.length} object(s)`);

const client = clientFromEnv({
  S3_ENDPOINT: process.env.RESTORE_S3_ENDPOINT,
  S3_REGION: process.env.RESTORE_S3_REGION || 'us-east-1',
  S3_ACCESS_KEY_ID: process.env.RESTORE_S3_ACCESS_KEY_ID,
  S3_SECRET_ACCESS_KEY: process.env.RESTORE_S3_SECRET_ACCESS_KEY,
});
const bucket = process.env.RESTORE_S3_BUCKET;

if (!apply) {
  console.log(JSON.stringify({ dry_run: true, backup_dir: backupDir, destination_bucket: bucket, object_count: manifest.objects.length, total_bytes: archive.total_bytes }, null, 2));
  process.exit(0);
}

await ensureBucket(client, bucket);
for (const object of manifest.objects) {
  const restored = await putArchiveObject(client, bucket, backupDir, object);
  if (restored.bytes !== object.bytes || restored.content_sha256 !== object.content_sha256) {
    throw new Error(`Restored object verification failed: ${object.key}`);
  }
}
console.log(JSON.stringify({ dry_run: false, destination_bucket: bucket, object_count: manifest.objects.length, total_bytes: archive.total_bytes, verified: true, idempotent: true }, null, 2));
