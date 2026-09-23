import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { HeadObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { createS3Credentials, uploadImmutableCatalogAsset } from '../services/catalog-asset-storage.js';

const body = Buffer.from('immutable catalog fixture');
const asset = {
  source_asset: 'content/generated/masters/fixture.png',
  key: 'catalog/masters/fixture.png',
  bytes: body.length,
  sha256: createHash('sha256').update(body).digest('hex'),
};

function notFound() {
  return Object.assign(new Error('not found'), { name: 'NotFound', $metadata: { httpStatusCode: 404 } });
}

function preconditionFailed() {
  return Object.assign(new Error('precondition failed'), { name: 'PreconditionFailed', $metadata: { httpStatusCode: 412 } });
}

function matchingHead() {
  return { ContentLength: body.length, Metadata: { sha256: asset.sha256 } };
}

test('temporary S3 credentials preserve the session token', () => {
  assert.deepEqual(createS3Credentials({
    accessKeyId: 'temporary-access-key',
    secretAccessKey: 'temporary-secret-key',
    sessionToken: 'temporary-session-token',
  }), {
    accessKeyId: 'temporary-access-key',
    secretAccessKey: 'temporary-secret-key',
    sessionToken: 'temporary-session-token',
  });
});

test('long-lived S3 credentials omit an absent session token', () => {
  assert.deepEqual(createS3Credentials({
    accessKeyId: 'access-key',
    secretAccessKey: 'secret-key',
  }), {
    accessKeyId: 'access-key',
    secretAccessKey: 'secret-key',
  });
});

test('catalog asset upload is conditional and verifies the local bytes before writing', async () => {
  const sent = [];
  const client = {
    async send(command) {
      sent.push(command);
      if (command instanceof HeadObjectCommand) throw notFound();
      assert.ok(command instanceof PutObjectCommand);
      return {};
    },
  };
  let bodyReads = 0;

  const action = await uploadImmutableCatalogAsset({
    client,
    bucket: 'splint-originals',
    asset,
    readBody: async () => { bodyReads += 1; return body; },
    contentType: 'image/png',
  });

  assert.equal(action, 'uploaded');
  assert.equal(bodyReads, 1);
  const put = sent.find((command) => command instanceof PutObjectCommand);
  assert.equal(put.input.IfNoneMatch, '*');
  assert.equal(put.input.Bucket, 'splint-originals');
  assert.equal(put.input.Key, asset.key);
  assert.equal(put.input.Metadata.sha256, asset.sha256);
});

test('a matching object created concurrently is verified rather than overwritten', async () => {
  let heads = 0;
  let puts = 0;
  const client = {
    async send(command) {
      if (command instanceof HeadObjectCommand) {
        heads += 1;
        if (heads === 1) throw notFound();
        return matchingHead();
      }
      assert.ok(command instanceof PutObjectCommand);
      puts += 1;
      throw preconditionFailed();
    },
  };

  const action = await uploadImmutableCatalogAsset({
    client,
    bucket: 'splint-originals',
    asset,
    readBody: async () => body,
    contentType: 'image/png',
  });

  assert.equal(action, 'verified-existing');
  assert.equal(heads, 2);
  assert.equal(puts, 1);
});

test('an existing mismatched object is never overwritten', async () => {
  const client = {
    async send(command) {
      if (command instanceof HeadObjectCommand) return { ContentLength: body.length + 1, Metadata: { sha256: 'different' } };
      assert.fail('mismatched object must not be overwritten');
    },
  };
  let bodyReads = 0;

  await assert.rejects(uploadImmutableCatalogAsset({
    client,
    bucket: 'splint-originals',
    asset,
    readBody: async () => { bodyReads += 1; return body; },
    contentType: 'image/png',
  }), /Immutable catalog object mismatch/);
  assert.equal(bodyReads, 0);
});

test('a mismatched object created during upload is rejected after the conditional write fails', async () => {
  let heads = 0;
  let puts = 0;
  const client = {
    async send(command) {
      if (command instanceof HeadObjectCommand) {
        heads += 1;
        if (heads === 1) throw notFound();
        return { ContentLength: body.length + 1, Metadata: { sha256: 'different' } };
      }
      assert.ok(command instanceof PutObjectCommand);
      puts += 1;
      throw preconditionFailed();
    },
  };

  await assert.rejects(uploadImmutableCatalogAsset({
    client,
    bucket: 'splint-originals',
    asset,
    readBody: async () => body,
    contentType: 'image/png',
  }), /Immutable catalog object mismatch/);
  assert.equal(heads, 2);
  assert.equal(puts, 1);
});
