import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  archivePathForKey,
  archiveFilePath,
  describeObject,
  readManifest,
  verifyArchive,
  writeManifest,
} from '../scripts/object-backup-common.mjs';

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
