import { createHash } from 'node:crypto';
import { HeadObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';

function isNotFound(error) {
  return error?.name === 'NotFound'
    || error?.$metadata?.httpStatusCode === 404
    || error?.Code === 'NoSuchKey';
}

function isConditionalConflict(error) {
  return [409, 412].includes(error?.$metadata?.httpStatusCode)
    || ['ConditionalRequestConflict', 'PreconditionFailed'].includes(error?.name)
    || ['ConditionalRequestConflict', 'PreconditionFailed'].includes(error?.Code);
}

function assertImmutableMatch(asset, head) {
  const remoteSha = head.Metadata?.sha256 || head.Metadata?.['x-amz-meta-sha256'];
  if (Number(head.ContentLength) !== Number(asset.bytes) || remoteSha !== asset.sha256) {
    throw new Error(`Immutable catalog object mismatch at ${asset.key}; refusing overwrite`);
  }
}

async function headObject(client, bucket, asset) {
  try {
    return await client.send(new HeadObjectCommand({ Bucket: bucket, Key: asset.key }));
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
}

export async function uploadImmutableCatalogAsset({ client, bucket, asset, readBody, contentType }) {
  const existing = await headObject(client, bucket, asset);
  if (existing) {
    assertImmutableMatch(asset, existing);
    return 'verified-existing';
  }

  const body = await readBody();
  const actualSha = createHash('sha256').update(body).digest('hex');
  if (body.length !== Number(asset.bytes) || actualSha !== asset.sha256) {
    throw new Error(`Local catalog asset changed after inventory: ${asset.source_asset}`);
  }

  try {
    await client.send(new PutObjectCommand({
      Bucket: bucket,
      Key: asset.key,
      Body: body,
      ContentLength: body.length,
      ContentType: contentType,
      CacheControl: 'public, max-age=31536000, immutable',
      Metadata: { sha256: actualSha, source_asset: asset.source_asset },
      IfNoneMatch: '*',
    }));
    return 'uploaded';
  } catch (error) {
    if (!isConditionalConflict(error)) throw error;
    const raced = await headObject(client, bucket, asset);
    if (!raced) throw error;
    assertImmutableMatch(asset, raced);
    return 'verified-existing';
  }
}
