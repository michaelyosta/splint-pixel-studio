import { randomUUID } from 'node:crypto';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DeleteObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

const storageRoot = process.env.MEDIA_STORAGE_ROOT || join(dirname(fileURLToPath(import.meta.url)), '..', 'uploads', 'originals');
const acceptedTypes = new Map([
  ['image/png', 'png'],
  ['image/jpeg', 'jpg'],
  ['image/webp', 'webp'],
]);

function decodeImageDataUrl(dataUrl) {
  if (typeof dataUrl !== 'string') return null;
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([a-z0-9+/=\r\n]+)$/i.exec(dataUrl);
  if (!match) return null;
  const type = match[1].toLowerCase();
  const bytes = Buffer.from(match[2], 'base64');
  if (!acceptedTypes.has(type) || !bytes.length || bytes.length > 10 * 1024 * 1024) return null;
  return { type, extension: acceptedTypes.get(type), bytes };
}

function s3Client() {
  if (!process.env.S3_ENDPOINT || !process.env.S3_BUCKET || !process.env.S3_ACCESS_KEY_ID || !process.env.S3_SECRET_ACCESS_KEY) return null;
  return new S3Client({
    endpoint: process.env.S3_ENDPOINT,
    region: process.env.S3_REGION || 'us-east-1',
    forcePathStyle: true,
    credentials: { accessKeyId: process.env.S3_ACCESS_KEY_ID, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY },
  });
}

// Original files are intentionally never returned by the coloring API.
export async function storePrivateOriginal(dataUrl, ownerId) {
  if (dataUrl == null) return null;
  const image = decodeImageDataUrl(dataUrl);
  if (!image) throw new Error('Unsupported or oversized source image');
  const key = `originals/${ownerId}/${randomUUID()}.${image.extension}`;
  const client = s3Client();
  if (client) {
    await client.send(new PutObjectCommand({ Bucket: process.env.S3_BUCKET, Key: key, Body: image.bytes, ContentType: image.type }));
    return `s3://${process.env.S3_BUCKET}/${key}`;
  }
  const localPath = join(storageRoot, ownerId, key.split('/').at(-1));
  await mkdir(dirname(localPath), { recursive: true });
  await writeFile(localPath, image.bytes, { flag: 'wx' });
  return `local://${key}`;
}

export async function deletePrivateOriginal(mediaKey) {
  if (!mediaKey) return;
  if (mediaKey.startsWith('s3://')) {
    const client = s3Client();
    if (!client) return;
    const [bucket, ...keyParts] = mediaKey.slice(5).split('/');
    await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: keyParts.join('/') }));
    return;
  }
  if (!mediaKey.startsWith('local://originals/')) return;
  const relative = mediaKey.slice('local://originals/'.length);
  const target = resolve(storageRoot, relative);
  const root = `${resolve(storageRoot)}${sep}`;
  if (!target.startsWith(root)) throw new Error('Unsafe media path');
  await unlink(target).catch((error) => { if (error.code !== 'ENOENT') throw error; });
}
