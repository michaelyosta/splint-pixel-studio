import { deflateSync } from 'node:zlib';

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const crcTable = new Uint32Array(256);
for (let index = 0; index < crcTable.length; index += 1) {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  crcTable[index] = value >>> 0;
}

function crc32(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) value = crcTable[(value ^ byte) & 0xff] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const name = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, checksum]);
}

function parsePalette(palette) {
  if (!Array.isArray(palette) || palette.length < 2 || palette.length > 16
    || palette.some((color) => typeof color !== 'string' || !/^#[0-9a-f]{6}$/i.test(color))) {
    throw new RangeError('Indexed PNG previews support 2–16 valid hexadecimal palette colors');
  }
  return Buffer.from(palette.flatMap((color) => [
    Number.parseInt(color.slice(1, 3), 16),
    Number.parseInt(color.slice(3, 5), 16),
    Number.parseInt(color.slice(5, 7), 16),
  ]));
}

function greatestCommonDivisor(left, right) {
  let a = left;
  let b = right;
  while (b) [a, b] = [b, a % b];
  return a;
}

export function encodeCatalogGridPng({ cells, width, height, palette, maxSide = 256 }) {
  if (!(cells instanceof Uint8Array) || !Number.isInteger(width) || !Number.isInteger(height)
    || width < 1 || height < 1 || cells.length !== width * height
    || !Number.isInteger(maxSide) || maxSide < 1) {
    throw new TypeError('Indexed PNG preview requires a byte grid matching positive dimensions');
  }
  const paletteBytes = parsePalette(palette);
  for (const value of cells) if (value >= palette.length) throw new RangeError('Grid references a color outside its palette');

  const scale = Math.min(maxSide / Math.max(width, height), 1);
  const divisor = greatestCommonDivisor(width, height);
  const unitWidth = width / divisor;
  const unitHeight = height / divisor;
  const scaleUnits = Math.min(divisor, Math.floor(maxSide / Math.max(unitWidth, unitHeight)));
  const previewWidth = scaleUnits > 0
    ? unitWidth * scaleUnits
    : Math.max(1, Math.round(width * scale));
  const previewHeight = scaleUnits > 0
    ? unitHeight * scaleUnits
    : Math.max(1, Math.round(height * scale));
  const rowBytes = Math.ceil(previewWidth / 2);
  const scanlines = Buffer.alloc((rowBytes + 1) * previewHeight);
  for (let y = 0; y < previewHeight; y += 1) {
    const sourceY = Math.min(height - 1, Math.floor(((y + 0.5) * height) / previewHeight));
    const rowOffset = y * (rowBytes + 1);
    scanlines[rowOffset] = 0;
    for (let x = 0; x < previewWidth; x += 1) {
      const sourceX = Math.min(width - 1, Math.floor(((x + 0.5) * width) / previewWidth));
      const color = cells[sourceY * width + sourceX];
      const byteOffset = rowOffset + 1 + Math.floor(x / 2);
      if (x % 2 === 0) scanlines[byteOffset] = color << 4;
      else scanlines[byteOffset] |= color;
    }
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(previewWidth, 0);
  header.writeUInt32BE(previewHeight, 4);
  header[8] = 4;
  header[9] = 3;
  const imageData = deflateSync(scanlines, { level: 9 });
  return {
    width: previewWidth,
    height: previewHeight,
    bytes: Buffer.concat([
      PNG_SIGNATURE,
      pngChunk('IHDR', header),
      pngChunk('PLTE', paletteBytes),
      pngChunk('IDAT', imageData),
      pngChunk('IEND', Buffer.alloc(0)),
    ]),
  };
}
