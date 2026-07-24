import { writeFileSync } from 'node:fs';

// Minimal 4x4 PNG with distinct color regions.
// Created manually as raw PNG bytes.
// PNG spec: 8-byte signature, IHDR, IDAT, IEND
const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function crc32(buf) {
  let c = 0xffffffff;
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let v = n;
    for (let k = 0; k < 8; k++) v = v & 1 ? 0xedb88320 ^ (v >>> 1) : v >>> 1;
    table[n] = v;
  }
  for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
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

const w = 4, h = 4;
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(w, 0);
ihdr.writeUInt32BE(h, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 2; // color type RGB
ihdr[10] = 0; // compression
ihdr[11] = 0; // filter
ihdr[12] = 0; // interlace

// Raw image data: 4 rows, each: filter byte (0) + RGB pixels
const raw = Buffer.alloc(h * (1 + w * 3));
const colors = [
  [255, 0, 0], [0, 255, 0], [0, 0, 255], [255, 255, 0],
  [255, 0, 255], [0, 255, 255], [128, 128, 128], [255, 128, 0],
  [128, 0, 128], [0, 128, 128], [64, 64, 64], [192, 192, 192],
  [255, 64, 64], [64, 255, 64], [64, 64, 255], [255, 255, 255],
];
for (let y = 0; y < h; y++) {
  const rowOff = y * (1 + w * 3);
  raw[rowOff] = 0; // no filter
  for (let x = 0; x < w; x++) {
    const c = colors[y * w + x];
    const off = rowOff + 1 + x * 3;
    raw[off] = c[0];
    raw[off + 1] = c[1];
    raw[off + 2] = c[2];
  }
}

// Compress with zlib (node built-in)
import { deflateSync } from 'node:zlib';
const compressed = deflateSync(raw);
const idat = chunk('IDAT', compressed);
const iend = chunk('IEND', Buffer.alloc(0));

const png = Buffer.concat([sig, chunk('IHDR', ihdr), idat, iend]);
writeFileSync('e2e/fixtures/test-image.png', png);
console.log('Created test image:', png.length, 'bytes');
