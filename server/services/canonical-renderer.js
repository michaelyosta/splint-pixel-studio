import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type, 'ascii');
  const body = Buffer.concat([typeBuffer, data]);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(body), 0);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  return Buffer.concat([length, body, checksum]);
}

function hexRgb(value) {
  if (!/^#[0-9a-f]{6}$/i.test(value)) throw new Error(`Invalid palette color: ${value}`);
  return [
    Number.parseInt(value.slice(1, 3), 16),
    Number.parseInt(value.slice(3, 5), 16),
    Number.parseInt(value.slice(5, 7), 16),
  ];
}

export function renderCanonicalPng({ width, height, palette, cells, filled }) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 160 || height > 160) {
    throw new Error('Canonical renderer only supports dimensions from 1×1 to 160×160');
  }
  if (!Array.isArray(palette) || !Array.isArray(cells) || !Array.isArray(filled) || cells.length !== width * height || filled.length !== cells.length) {
    throw new Error('Canonical renderer input shape is invalid');
  }
  const colors = palette.map(hexRgb);
  const pixels = Buffer.alloc(width * height * 4);
  for (let index = 0; index < cells.length; index += 1) {
    const colorIndex = filled[index] === cells[index] ? cells[index] : -1;
    const [red, green, blue] = colorIndex >= 0 && colorIndex < colors.length ? colors[colorIndex] : [0, 0, 0];
    const offset = index * 4;
    pixels[offset] = red;
    pixels[offset + 1] = green;
    pixels[offset + 2] = blue;
    pixels[offset + 3] = colorIndex >= 0 ? 255 : 0;
  }

  const scanlines = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const rowOffset = y * (width * 4 + 1);
    scanlines[rowOffset] = 0;
    pixels.copy(scanlines, rowOffset + 1, y * width * 4, (y + 1) * width * 4);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const png = Buffer.concat([
    PNG_SIGNATURE,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(scanlines, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);

  return {
    buffer: png,
    mimeType: 'image/png',
    width,
    height,
    byteSize: png.length,
    contentHash: createHash('sha256').update(png).digest('hex'),
  };
}

export function renderCanonicalThumbnail({ width, height, palette, cells, filled, maxDimension = 48 }) {
  const thumbnailWidth = Math.max(1, Math.min(width, maxDimension));
  const thumbnailHeight = Math.max(1, Math.min(height, maxDimension));
  const thumbnailCells = [];
  const thumbnailFilled = [];
  for (let y = 0; y < thumbnailHeight; y += 1) {
    const sourceY = Math.min(height - 1, Math.floor((y * height) / thumbnailHeight));
    for (let x = 0; x < thumbnailWidth; x += 1) {
      const sourceX = Math.min(width - 1, Math.floor((x * width) / thumbnailWidth));
      const sourceIndex = sourceY * width + sourceX;
      thumbnailCells.push(cells[sourceIndex]);
      thumbnailFilled.push(filled[sourceIndex]);
    }
  }
  return renderCanonicalPng({
    width: thumbnailWidth,
    height: thumbnailHeight,
    palette,
    cells: thumbnailCells,
    filled: thumbnailFilled,
  });
}
