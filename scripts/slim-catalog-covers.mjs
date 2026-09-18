// One-shot delivery slimming for catalog cover art.
//
// Collection/album covers are rendered as ~100-200px thumbnails, but the
// optimized delivery copies were stored at 1200x1200 (~3.7MB each). This
// script re-encodes them in place at 512px using the same cover-fit
// semantics as the generation pipeline, keeping every public path stable
// (no metadata, manifest, or validation churn).
//
// The PNG codec below mirrors scripts/ingest-content-assets.mjs on purpose:
// that pipeline script has no main guard (it rewrites manifests on import),
// so sharing code by import would risk the content pipeline. The functions
// are small, pure, and stable; duplication is the safer coupling here.
import { deflateSync, inflateSync } from 'node:zlib';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const coversDir = join(root, 'public', 'assets', 'catalog', 'generated', 'covers');
const TARGET = 512;

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const crcTable = Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit += 1) crc = (crc & 1) ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  return crc >>> 0;
});

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const name = Buffer.from(type, 'ascii');
  const body = Buffer.concat([name, data]);
  const result = Buffer.alloc(12 + data.length);
  result.writeUInt32BE(data.length, 0);
  body.copy(result, 4);
  result.writeUInt32BE(crc32(body), 8 + data.length);
  return result;
}

function decodePng(buffer) {
  if (!buffer.subarray(0, 8).equals(PNG_SIGNATURE)) throw new Error('PNG signature missing');
  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  const idat = [];
  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const start = offset + 8;
    const end = start + length;
    if (end + 4 > buffer.length) throw new Error('Truncated PNG chunk');
    const data = buffer.subarray(start, end);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    offset = end + 4;
  }
  const channels = ({ 0: 1, 2: 3, 4: 2, 6: 4 })[colorType];
  if (!width || !height || bitDepth !== 8 || !channels || interlace !== 0) throw new Error('Unsupported PNG format');
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const expected = height * (stride + 1);
  if (raw.length !== expected) throw new Error('PNG scanline length mismatch');
  const rgba = Buffer.alloc(width * height * 4);
  let rawOffset = 0;
  let previous = Buffer.alloc(stride);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[rawOffset++];
    const row = Buffer.alloc(stride);
    for (let x = 0; x < stride; x += 1) {
      const value = raw[rawOffset++];
      const left = x >= channels ? row[x - channels] : 0;
      const up = previous[x] || 0;
      const upLeft = x >= channels ? previous[x - channels] || 0 : 0;
      let reconstructed = value;
      if (filter === 1) reconstructed = (value + left) & 0xff;
      else if (filter === 2) reconstructed = (value + up) & 0xff;
      else if (filter === 3) reconstructed = (value + Math.floor((left + up) / 2)) & 0xff;
      else if (filter === 4) {
        const p = left + up - upLeft;
        const pa = Math.abs(p - left);
        const pb = Math.abs(p - up);
        const pc = Math.abs(p - upLeft);
        const predictor = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
        reconstructed = (value + predictor) & 0xff;
      } else if (filter !== 0) throw new Error(`Unsupported PNG filter ${filter}`);
      row[x] = reconstructed;
    }
    for (let x = 0; x < width; x += 1) {
      const source = x * channels;
      const target = (y * width + x) * 4;
      if (colorType === 6) row.copy(rgba, target, source, source + 4);
      else if (colorType === 2) {
        rgba[target] = row[source]; rgba[target + 1] = row[source + 1]; rgba[target + 2] = row[source + 2]; rgba[target + 3] = 255;
      } else if (colorType === 0) {
        rgba[target] = row[source]; rgba[target + 1] = row[source]; rgba[target + 2] = row[source]; rgba[target + 3] = 255;
      } else {
        const gray = row[source]; const alpha = row[source + 1];
        rgba[target] = gray; rgba[target + 1] = gray; rgba[target + 2] = gray; rgba[target + 3] = alpha;
      }
    }
    previous = row;
  }
  return { width, height, rgba };
}

function encodePng({ width, height, rgba }) {
  const rows = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y += 1) {
    const rowOffset = y * (width * 4 + 1);
    rows[rowOffset] = 0;
    rgba.copy(rows, rowOffset + 1, y * width * 4, (y + 1) * width * 4);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4);
  header[8] = 8; header[9] = 6; header[10] = 0; header[11] = 0; header[12] = 0;
  return Buffer.concat([PNG_SIGNATURE, pngChunk('IHDR', header), pngChunk('IDAT', deflateSync(rows, { level: 9 })), pngChunk('IEND', Buffer.alloc(0))]);
}

function fitImage(source, width, height) {
  const rgba = Buffer.alloc(width * height * 4, 255);
  const scale = Math.max(width / source.width, height / source.height);
  const drawWidth = Math.max(1, Math.round(source.width * scale));
  const drawHeight = Math.max(1, Math.round(source.height * scale));
  const left = Math.floor((width - drawWidth) / 2);
  const top = Math.floor((height - drawHeight) / 2);
  for (let y = 0; y < drawHeight; y += 1) {
    const sy = Math.min(source.height - 1, Math.floor(y * source.height / drawHeight));
    for (let x = 0; x < drawWidth; x += 1) {
      const sx = Math.min(source.width - 1, Math.floor(x * source.width / drawWidth));
      const from = (sy * source.width + sx) * 4;
      const to = ((top + y) * width + left + x) * 4;
      const alpha = source.rgba[from + 3] / 255;
      rgba[to] = Math.round(source.rgba[from] * alpha + 255 * (1 - alpha));
      rgba[to + 1] = Math.round(source.rgba[from + 1] * alpha + 255 * (1 - alpha));
      rgba[to + 2] = Math.round(source.rgba[from + 2] * alpha + 255 * (1 - alpha));
      rgba[to + 3] = 255;
    }
  }
  return { width, height, rgba };
}

const files = (await readdir(coversDir)).filter((name) => name.toLowerCase().endsWith('.png')).sort();
if (!files.length) throw new Error(`no covers found in ${coversDir}`);
let before = 0;
let after = 0;
for (const name of files) {
  const filePath = join(coversDir, name);
  const input = await readFile(filePath);
  before += input.length;
  const source = decodePng(input);
  const slim = source.width <= TARGET && source.height <= TARGET
    ? source
    : fitImage(source, TARGET, Math.max(1, Math.round((source.height * TARGET) / source.width)));
  const output = encodePng(slim.width === source.width && slim.height === source.height ? source : slim);
  await writeFile(filePath, output);
  after += output.length;
  console.log(`${name}: ${(input.length / 1048576).toFixed(2)}MB ${source.width}x${source.height} -> ${(output.length / 1024).toFixed(0)}KB ${slim.width}x${slim.height}`);
}
console.log(`covers total: ${(before / 1048576).toFixed(1)}MB -> ${(after / 1048576).toFixed(1)}MB`);
