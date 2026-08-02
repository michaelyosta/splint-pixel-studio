import test from 'node:test';
import assert from 'node:assert/strict';
import { HeadObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { deleteMediaObject, deletePrivateOriginal, readMediaObject, storeMediaObject, storePrivateOriginal } from '../services/media-storage.js';

const requiredS3Env = ['S3_ENDPOINT', 'S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'];
const hasS3IntegrationConfig = process.env.STORAGE_DRIVER === 's3'
  && requiredS3Env.every((key) => Boolean(process.env[key]));

const validPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

test('S3: private original is uploaded and deleted', { skip: !hasS3IntegrationConfig }, async () => {
  const mediaKey = await storePrivateOriginal(validPng, 's3_integration_test');
  assert.match(mediaKey, new RegExp(`^s3://${process.env.S3_BUCKET}/originals/s3_integration_test/`));

  const [, bucket, ...keyParts] = mediaKey.match(/^s3:\/\/([^/]+)\/(.+)$/) || [];
  const key = keyParts.join('/');
  const client = new S3Client({
    endpoint: process.env.S3_ENDPOINT,
    region: process.env.S3_REGION || 'us-east-1',
    forcePathStyle: true,
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY_ID,
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
    },
  });

  try {
    const head = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    assert.equal(head.ContentType, 'image/png');
  } finally {
    await deletePrivateOriginal(mediaKey);
  }

  await assert.rejects(
    client.send(new HeadObjectCommand({ Bucket: bucket, Key: key })),
    (error) => error?.$metadata?.httpStatusCode === 404 || error?.name === 'NotFound',
  );
});

test('S3: canonical media write/read/delete is idempotent by key', { skip: !hasS3IntegrationConfig }, async () => {
  const key = 'artworks/s3_integration_test/canonical.png';
  const body = Buffer.from('canonical-test-object');
  const first = await storeMediaObject({ key, body, contentType: 'image/png' });
  const second = await storeMediaObject({ key, body, contentType: 'image/png' });
  assert.equal(first, second);
  assert.deepEqual(await readMediaObject(first), body);
  await deleteMediaObject(first);
  assert.equal(await readMediaObject(first).catch(() => null), null);
});
