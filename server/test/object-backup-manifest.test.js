import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import {
  archivePathForKey,
  assertObjectRecoveryTarget,
  archiveFilePath,
  describeObject,
  readManifest,
  objectStoreFingerprint,
  verifyArchive,
  writeManifest,
} from '../scripts/object-backup-common.mjs';

test('object recovery rejects the original bucket and permits a separate endpoint/bucket', () => {
  const endpoint = 'https://fixture.r2.cloudflarestorage.com';
  const bucket = 'fixture-originals';
  const manifest = { source: { bucket, fingerprint: objectStoreFingerprint(endpoint, bucket) } };
  assert.throws(() => assertObjectRecoveryTarget(manifest, `${endpoint}/`, bucket, {}), /source bucket/);
  assert.doesNotThrow(() => assertObjectRecoveryTarget(manifest, 'http://127.0.0.1:9000', bucket, {}));
  assert.doesNotThrow(() => assertObjectRecoveryTarget(manifest, endpoint, 'fixture-recovery', {}));
  assert.throws(() => assertObjectRecoveryTarget(manifest, endpoint, 'active-source', { S3_ENDPOINT: endpoint, S3_BUCKET: 'active-source' }), /configured source bucket/);
});

test('legacy object recovery requires the source endpoint and never guesses isolation', () => {
  const manifest = { source: { bucket: 'fixture' } };
  assert.throws(() => assertObjectRecoveryTarget(manifest, 'http://localhost:9000', 'fixture', {}), /requires S3_ENDPOINT/);
  assert.throws(() => assertObjectRecoveryTarget(manifest, 'http://localhost:9000', 'fixture', { S3_ENDPOINT: 'http://localhost:9000' }), /source bucket/);
});

test('object backup archive paths are deterministic and metadata is bounded', () => {
  const first = archivePathForKey('artworks/example/art.png');
  assert.equal(first, archivePathForKey('artworks/example/art.png'));
  assert.match(first, /^objects\/[a-f0-9]{64}\.bin$/);
  const metadata = describeObject('thumbnails/artwork-1/thumb.png', { ContentLength: 12, ContentType: 'image/png', ETag: 'etag' });
  assert.deepEqual(metadata, {
    key: 'thumbnails/artwork-1/thumb.png',
    archive_path: archivePathForKey('thumbnails/artwork-1/thumb.png'),
    bytes: 12,
    etag: 'etag',
    content_type: 'image/png',
    logical_type: 'thumbnail',
    artwork_id: 'artwork-1',
    owner_or_template_id: null,
    last_modified: null,
  });
});

test('object backup manifest checksum and archive content are verified', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'splint-object-backup-'));
  try {
    const body = Buffer.from('disposable object');
    const key = 'artworks/art-1/art.png';
    const object = {
      key,
      archive_path: archivePathForKey(key),
      bytes: body.length,
      content_sha256: createHash('sha256').update(body).digest('hex'),
      content_type: 'image/png',
    };
    await mkdir(join(directory, 'objects'), { recursive: true });
    await writeFile(join(directory, object.archive_path), body);
    await writeManifest(directory, { format: 'splint-s3-object-backup', version: 1, objects: [object] });
    const manifest = await readManifest(directory);
    assert.equal((await verifyArchive(directory, manifest)).ok, true);
    await writeFile(join(directory, object.archive_path), Buffer.from('tampered'));
    const failed = await verifyArchive(directory, manifest);
    assert.equal(failed.ok, false);
    assert.equal(failed.failures[0].reason, 'content_mismatch');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('object archive paths cannot escape the backup directory', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'splint-object-backup-path-'));
  try {
    assert.throws(() => archiveFilePath(directory, '../outside.bin'), /Invalid object archive path/);
    const manifest = { objects: [{ key: 'artworks/art-1/art.png', archive_path: '../outside.bin', bytes: 0, content_sha256: '' }] };
    const result = await verifyArchive(directory, manifest);
    assert.equal(result.ok, false);
    assert.equal(result.failures[0].reason, 'invalid_archive_path');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('verification CLI reports corruption without exposing private object keys', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'splint-object-backup-log-'));
  try {
    const key = 'originals/private-fixture-owner/private-fixture-image.png';
    await writeManifest(directory, { format: 'splint-s3-object-backup', version: 1, objects: [{ key, archive_path: archivePathForKey(key), bytes: 3, content_sha256: createHash('sha256').update('abc').digest('hex') }] });
    const script = fileURLToPath(new URL('../scripts/verify-object-backup.mjs', import.meta.url));
    const output = spawnSync(process.execPath, [script], { env: { ...process.env, OBJECT_BACKUP_DIR: directory }, encoding: 'utf8', windowsHide: true });
    assert.equal(output.status, 1);
    const summary = JSON.parse(output.stdout);
    assert.equal(summary.failure_count, 1);
    assert.equal(summary.failure_reasons.missing_archive_file, 1);
    assert.equal(output.stdout.includes(key), false);
    assert.equal(output.stdout.includes('private-fixture-owner'), false);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
