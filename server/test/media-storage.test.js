import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';

const originalStorageRoot = process.env.MEDIA_STORAGE_ROOT;
const originalStorageDriver = process.env.STORAGE_DRIVER;

let mod;
let testDir;

before(async () => {
  testDir = await mkdtemp(join(tmpdir(), 'splint-media-test-'));
  process.env.MEDIA_STORAGE_ROOT = testDir;
  process.env.STORAGE_DRIVER = 'local';
  mod = await import('../services/media-storage.js');
});

after(async () => {
  process.env.MEDIA_STORAGE_ROOT = originalStorageRoot;
  process.env.STORAGE_DRIVER = originalStorageDriver;
  await rm(testDir, { recursive: true, force: true });
});

const validDataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

describe('media-storage local driver safety', () => {
  it('rejects path traversal via ../', async () => {
    await assert.rejects(
      mod.deletePrivateOriginal('local://originals/../outside.txt'),
      { message: 'Unsafe media path' },
    );
  });

  it('rejects path traversal via nested ../../', async () => {
    await assert.rejects(
      mod.deletePrivateOriginal('local://originals/a/../../outside.txt'),
      { message: 'Unsafe media path' },
    );
  });

  it('rejects path traversal via backslash', async () => {
    await assert.rejects(
      mod.deletePrivateOriginal('local://originals/..\\outside.txt'),
      { message: 'Unsafe media path' },
    );
  });

  it('rejects empty path', async () => {
    await assert.rejects(
      mod.deletePrivateOriginal('local://originals/'),
      { message: 'Unsafe media path' },
    );
  });

  it('stores and deletes a valid file', async () => {
    const mediaKey = await mod.storePrivateOriginal(validDataUrl, 'user_test');
    assert.ok(mediaKey.startsWith('local://'));
    await mod.deletePrivateOriginal(mediaKey);
  });

  it('deduplicates identical private originals for one owner', async () => {
    const first = await mod.storePrivateOriginal(validDataUrl, 'user_duplicate');
    const second = await mod.storePrivateOriginal(validDataUrl, 'user_duplicate');
    assert.equal(second, first, 'identical uploads must reuse the content-addressed key');
    const files = await readdir(join(testDir, 'originals', 'user_duplicate'));
    assert.equal(files.length, 1, 'duplicate uploads must leave one object');
    await mod.deletePrivateOriginal(first);
  });

  it('reads and deletes a canonical object through its database key', async () => {
    const key = 'artworks/user_test/canonical.png';
    const body = Buffer.from('canonical-object');
    const stored = await mod.storeMediaObject({ key, body, contentType: 'image/png' });
    assert.equal(stored, `local://${key}`);
    assert.deepEqual(await mod.readMediaObject(key), body);
    await mod.deleteMediaObject(key);
    await assert.rejects(mod.readMediaObject(key));
  });

  it('double delete does not throw', async () => {
    const mediaKey = await mod.storePrivateOriginal(validDataUrl, 'user_test2');
    await mod.deletePrivateOriginal(mediaKey);
    await mod.deletePrivateOriginal(mediaKey);
  });

  it('rejects oversized image', async () => {
    const large = 'data:image/png;base64,' + 'A'.repeat(14 * 1024 * 1024);
    await assert.rejects(
      mod.storePrivateOriginal(large, 'user_test'),
      { message: 'Unsupported or oversized source image' },
    );
  });

  it('rejects invalid data URL', async () => {
    await assert.rejects(
      mod.storePrivateOriginal('not-a-data-url', 'user_test'),
      { message: 'Unsupported or oversized source image' },
    );
  });

  it('rejects a malformed image with a valid data URL prefix', async () => {
    await assert.rejects(
      mod.storePrivateOriginal('data:image/png;base64,not-a-real-png', 'user_test'),
      { message: 'Unsupported or oversized source image' },
    );
  });

  it('returns null for null input', async () => {
    const result = await mod.storePrivateOriginal(null, 'user_test');
    assert.equal(result, null);
  });
});
