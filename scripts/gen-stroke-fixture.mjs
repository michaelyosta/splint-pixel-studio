import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Generates e2e/fixtures/stroke-bars.png — a 1200x1200 image with 10 flat
 * vertical color bands (120 cells each). Flat bands survive the creator's
 * quantization as long single-color horizontal runs, which the stroke-engine
 * E2E uses to drag a finger across 30+ valid cells (including across tile
 * boundaries at x=320/640/960).
 */
const __dirname = dirname(fileURLToPath(import.meta.url));
const SIZE = 1200;
const BANDS = 10;
const BAND_WIDTH = SIZE / BANDS; // 120 cells
const COLORS = [
  [230, 57, 70],   // red
  [46, 125, 50],   // green
  [25, 118, 210],  // blue
  [251, 192, 45],  // yellow
  [142, 68, 173],  // purple
  [0, 188, 212],   // cyan
  [255, 112, 67],  // orange
  [121, 85, 72],   // brown
  [96, 125, 139],  // blue-grey
  [255, 213, 79],  // amber
];

function crc32(buf) {
  let c = 0xffffffff;
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let v = n;
    for (let k = 0; k < 8; k += 1) v = v & 1 ? 0xedb88320 ^ (v >>> 1) : v >>> 1;
    table[n] = v;
  }
  for (let i = 0; i < buf.length; i += 1) c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeB = Buffer.from(type, 'ascii');
  const crcData = Buffer.concat([typeB, data]);
  const crcV = Buffer.alloc(4);
  crcV.writeUInt32BE(crc32(crcData));
  return Buffer.concat([len, typeB, data, crcV]);
}

const raw = Buffer.alloc(SIZE * (1 + SIZE * 3));
for (let y = 0; y < SIZE; y += 1) {
  const rowOff = y * (1 + SIZE * 3);
  raw[rowOff] = 0; // filter: none
  for (let x = 0; x < SIZE; x += 1) {
    const band = Math.min(BANDS - 1, Math.floor(x / BAND_WIDTH));
    const [r, g, b] = COLORS[band];
    const off = rowOff + 1 + x * 3;
    raw[off] = r;
    raw[off + 1] = g;
    raw[off + 2] = b;
  }
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 2; // color type RGB
ihdr[10] = 0;
ihdr[11] = 0;
ihdr[12] = 0;

const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);

const out = resolve(__dirname, '..', 'e2e', 'fixtures', 'stroke-bars.png');
writeFileSync(out, png);
console.log(`wrote ${out} (${png.length} bytes)`);
