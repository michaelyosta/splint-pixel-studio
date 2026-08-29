import { createHash } from 'node:crypto';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { inflateSync } from 'node:zlib';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DeleteObjectCommand, GetObjectCommand, HeadBucketCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

const storageRoot = process.env.MEDIA_STORAGE_ROOT || join(dirname(fileURLToPath(import.meta.url)), '..', 'uploads');
const acceptedTypes = new Map([
  ['image/png', 'png'],
  ['image/jpeg', 'jpg'],
  ['image/webp', 'webp'],
]);

function validateImageBytes(type, bytes) {
  if (type === 'image/png') {
    const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    if (bytes.length < 33 || !bytes.subarray(0, 8).equals(signature)) return null;
    let offset = 8;
    let width;
    let height;
    let channels;
    const idat = [];
    let foundEnd = false;
    while (offset + 12 <= bytes.length) {
      const length = bytes.readUInt32BE(offset);
      const typeName = bytes.subarray(offset + 4, offset + 8).toString('ascii');
      const dataStart = offset + 8;
      const dataEnd = dataStart + length;
      if (dataEnd + 4 > bytes.length) return null;
      const data = bytes.subarray(dataStart, dataEnd);
      if (typeName === 'IHDR') {
        if (length !== 13 || width !== undefined) return null;
        width = data.readUInt32BE(0);
        height = data.readUInt32BE(4);
        const bitDepth = data[8];
        const colorType = data[9];
        channels = ({ 0: 1, 2: 3, 4: 2, 6: 4 })[colorType];
        if (bitDepth !== 8 || !channels || width < 1 || height < 1 || width > 4096 || height > 4096 || width * height > 16_777_216) return null;
      } else if (typeName === 'IDAT') {
        idat.push(data);
      } else if (typeName === 'IEND') {
        foundEnd = true;
        break;
      }
      offset = dataEnd + 4;
    }
    if (!foundEnd || width === undefined || !idat.length) return null;
    try {
      const decoded = inflateSync(Buffer.concat(idat));
      if (decoded.length !== (width * channels + 1) * height) return null;
    } catch {
      return null;
    }
    return { width, height };
  }
  if (type === 'image/jpeg') return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff ? {} : null;
  if (type === 'image/webp') return bytes.length >= 12 && bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP' ? {} : null;
  return null;
}

export function decodeImageDataUrl(dataUrl) {
  if (typeof dataUrl !== 'string') return null;
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([a-z0-9+/=\r\n]+)$/i.exec(dataUrl);
  if (!match) return null;
  const type = match[1].toLowerCase();
  const bytes = Buffer.from(match[2], 'base64');
  if (!acceptedTypes.has(type) || !bytes.length || bytes.length > 10 * 1024 * 1024) return null;
  const decoded = validateImageBytes(type, bytes);
  if (!decoded) return null;
  return { type, extension: acceptedTypes.get(type), bytes, ...decoded };
}

function isS3Configured() {
  if (process.env.STORAGE_DRIVER === 'local') return false;
  return !!(process.env.S3_ENDPOINT && process.env.S3_BUCKET && process.env.S3_ACCESS_KEY_ID && process.env.S3_SECRET_ACCESS_KEY);
}

function s3Client() {
  if (!isS3Configured()) return null;
  return new S3Client({
    endpoint: process.env.S3_ENDPOINT,
    region: process.env.S3_REGION || 'us-east-1',
    forcePathStyle: true,
    credentials: { accessKeyId: process.env.S3_ACCESS_KEY_ID, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY },
  });
}

function s3ObjectLocation(mediaKey) {
  if (typeof mediaKey !== 'string' || !mediaKey) return null;
  if (mediaKey.startsWith('s3://')) {
    const [bucket, ...parts] = mediaKey.slice(5).split('/');
    return { bucket, key: parts.join('/') };
  }
  if (isS3Configured() && !mediaKey.includes('://')) {
    return { bucket: process.env.S3_BUCKET, key: mediaKey.replace(/^\/+/, '') };
  }
  return null;
}

function safeLocalPath(relativeSegments) {
  if (!relativeSegments || /[\\/]$/.test(relativeSegments)) throw new Error('Unsafe media path');
  const relative = relativeSegments.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  if (!relative || relative.startsWith('..') || relative.includes('/../') || relative.includes('\\..\\')) {
    throw new Error('Unsafe media path');
  }
  const target = resolve(storageRoot, relative);
  const root = `${resolve(storageRoot)}${sep}`;
  if (!target.startsWith(root)) throw new Error('Unsafe media path');
  return target;
}

function ensureLocalDir(targetPath) {
  return mkdir(dirname(targetPath), { recursive: true });
}

// Original files are intentionally never returned by the coloring API.
export async function storePrivateOriginal(dataUrl, ownerId, decodedImage = null) {
  if (dataUrl == null) return null;
  const image = decodedImage || decodeImageDataUrl(dataUrl);
  if (!image) throw new Error('Unsupported or oversized source image');
  // Content-address originals per owner. Repeated uploads of the same source
  // image now reuse one immutable object instead of multiplying storage. The
  // owner segment keeps private originals isolated even when two users upload
  // identical bytes.
  const contentHash = createHash('sha256').update(image.bytes).digest('hex');
  const key = `originals/${ownerId}/${contentHash}.${image.extension}`;
  if (isS3Configured()) {
    const client = s3Client();
    await client.send(new PutObjectCommand({ Bucket: process.env.S3_BUCKET, Key: key, Body: image.bytes, ContentType: image.type }));
    return `s3://${process.env.S3_BUCKET}/${key}`;
  }
  const localPath = safeLocalPath(key);
  await ensureLocalDir(localPath);
  try {
    await writeFile(localPath, image.bytes, { flag: 'wx' });
  } catch (error) {
    // The content-addressed key makes duplicate uploads safe to race. A
    // winner may have created the object between our existence check and the
    // write; both callers can return the same durable key.
    if (error.code !== 'EEXIST') throw error;
  }
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
  if (!mediaKey.startsWith('local://')) return;
  const relative = mediaKey.slice('local://'.length);
  const target = safeLocalPath(relative);
  await unlink(target).catch((error) => { if (error.code !== 'ENOENT') throw error; });
}

export function publicMediaUrl(storageKey) {
  const normalized = String(storageKey || '')
    .replace(/^s3:\/\/[^/]+\//, '')
    .replace(/^local:\/\//, '')
    .replace(/^\/+/, '');
  return `/media/${normalized.split('/').map(encodeURIComponent).join('/')}`;
}

export async function storeMediaObject({ key, body, contentType = 'application/octet-stream' }) {
  if (!key || key.includes('..') || key.startsWith('/')) throw new Error('Unsafe media key');
  if (isS3Configured()) {
    await s3Client().send(new PutObjectCommand({ Bucket: process.env.S3_BUCKET, Key: key, Body: body, ContentType: contentType }));
    return `s3://${process.env.S3_BUCKET}/${key}`;
  }
  const target = safeLocalPath(key);
  await ensureLocalDir(target);
  try {
    await writeFile(target, body, { flag: 'wx' });
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
  }
  return `local://${key}`;
}

export async function readMediaObject(mediaKey) {
  const s3Location = s3ObjectLocation(mediaKey);
  if (s3Location) {
    const response = await s3Client().send(new GetObjectCommand({ Bucket: s3Location.bucket, Key: s3Location.key }));
    return Buffer.from(await response.Body.transformToByteArray());
  }
  const localKey = mediaKey?.startsWith('local://')
    ? mediaKey.slice('local://'.length)
    : typeof mediaKey === 'string' && !mediaKey.includes('://')
      ? mediaKey
      : null;
  if (!localKey) return null;
  return readFile(safeLocalPath(localKey));
}

export async function deleteMediaObject(mediaKey) {
  if (!mediaKey) return;
  const s3Location = s3ObjectLocation(mediaKey);
  if (s3Location) {
    const client = s3Client();
    if (!client) return;
    await client.send(new DeleteObjectCommand({ Bucket: s3Location.bucket, Key: s3Location.key }));
    return;
  }
  if (mediaKey.startsWith('local://') || !mediaKey.includes('://')) {
    const localKey = mediaKey.startsWith('local://') ? mediaKey.slice('local://'.length) : mediaKey;
    await unlink(safeLocalPath(localKey)).catch((error) => {
      if (error.code !== 'ENOENT') throw error;
    });
  }
}

export async function checkMediaStorage() {
  if (isS3Configured()) {
    await s3Client().send(new HeadBucketCommand({ Bucket: process.env.S3_BUCKET }));
    return { ok: true, driver: 's3' };
  }
  await mkdir(storageRoot, { recursive: true });
  return { ok: true, driver: 'local' };
}
