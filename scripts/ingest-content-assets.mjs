import { deflateSync, inflateSync } from 'node:zlib';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const manifestPath = resolve(root, 'content/catalog-manifest.json');
const catalogPath = resolve(root, 'server/catalog-templates.json');
const reportPath = resolve(root, 'content/catalog-ingestion-report.json');
const onlyId = process.argv.find((argument) => argument.startsWith('--only-id='))?.slice('--only-id='.length);

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

function hexToRgb(hex) {
  const value = String(hex || '').replace('#', '');
  if (!/^[0-9a-f]{6}$/i.test(value)) throw new Error(`Invalid grid palette color: ${hex}`);
  return [
    Number.parseInt(value.slice(0, 2), 16),
    Number.parseInt(value.slice(2, 4), 16),
    Number.parseInt(value.slice(4, 6), 16),
  ];
}

/**
 * Render the exact logical cell map consumed by the Splint player. This is
 * deliberately separate from the full-color master: the player works on the
 * quantized grid, not on an arbitrary high-resolution downsample.
 */
function renderPixelizedGrid(grid) {
  const rgba = Buffer.alloc(grid.width * grid.height * 4);
  const colors = grid.palette.map(hexToRgb);
  for (let index = 0; index < grid.cells.length; index += 1) {
    const color = colors[grid.cells[index]];
    if (!color) throw new Error(`Invalid pixelized palette index: ${grid.cells[index]}`);
    const offset = index * 4;
    rgba[offset] = color[0];
    rgba[offset + 1] = color[1];
    rgba[offset + 2] = color[2];
    rgba[offset + 3] = 255;
  }
  return { width: grid.width, height: grid.height, rgba };
}

function fitImage(source, width, height) {
  const rgba = Buffer.alloc(width * height * 4, 255);
  // Fill the delivery canvas edge-to-edge. Subject breathing room is an
  // ImageGen composition requirement; it must not become an artificial
  // white frame around the finished artwork.
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

function cropImage(source, left, top, right, bottom) {
  const width = Math.max(1, source.width - left - right);
  const height = Math.max(1, source.height - top - bottom);
  const rgba = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const from = ((Math.min(source.height - 1, top + y) * source.width) + Math.min(source.width - 1, left + x)) * 4;
    const to = (y * width + x) * 4;
    source.rgba.copy(rgba, to, from, from + 4);
  }
  return { width, height, rgba };
}

function repairKnownInsetFrame(source, entryId) {
  // The first pre-direction batch was generated with an unintended white
  // inset. Preserve those originals in history and remove only that known
  // outer frame before the normal full-bleed fit.
  if (!/^coloring_autumn-cozy_coffee-rain_0[2-9]$/.test(entryId)) return source;
  const left = Math.max(1, Math.round(source.width * 0.0625));
  const top = Math.max(1, Math.round(source.height * 0.0625));
  return cropImage(source, left, top, left, top);
}

function rgbAt(rgba, width, x, y) {
  const index = (y * width + x) * 4;
  return [rgba[index], rgba[index + 1], rgba[index + 2]];
}

function averageCellColor(image, x0, y0, x1, y1) {
  let red = 0; let green = 0; let blue = 0; let count = 0;
  for (let y = y0; y < Math.min(image.height, y1); y += 1) for (let x = x0; x < Math.min(image.width, x1); x += 1) {
    const [r, g, b] = rgbAt(image.rgba, image.width, x, y);
    red += r; green += g; blue += b; count += 1;
  }
  return [red / Math.max(1, count), green / Math.max(1, count), blue / Math.max(1, count)];
}

function regionStats(cells, width, _height) {
  const regionIds = new Int32Array(cells.length); regionIds.fill(-1); const regions = [];
  const queue = new Int32Array(cells.length);
  for (let start = 0; start < cells.length; start += 1) {
    if (regionIds[start] !== -1) continue;
    const id = regions.length; const color = cells[start]; let head = 0; let tail = 0;
    const indices = []; queue[tail++] = start; regionIds[start] = id;
    while (head < tail) {
      const current = queue[head++]; indices.push(current);
      const x = current % width; const y = Math.floor(current / width);
      for (const next of [current - 1, current + 1, current - width, current + width]) {
        if (next < 0 || next >= cells.length || regionIds[next] !== -1) continue;
        const nx = next % width; const ny = Math.floor(next / width);
        if (Math.abs(nx - x) + Math.abs(ny - y) !== 1 || cells[next] !== color) continue;
        regionIds[next] = id; queue[tail++] = next;
      }
    }
    regions.push({ color, indices });
  }
  return regions;
}

function collapseRegions(cells, width, height, palette, maxRegions) {
  let regions = regionStats(cells, width, height);
  let guard = 0;
  while (regions.length > maxRegions && guard < cells.length) {
    guard += 1;
    const region = [...regions].sort((a, b) => a.indices.length - b.indices.length)[0];
    const neighbourCounts = new Map();
    for (const current of region.indices) {
      const x = current % width; const y = Math.floor(current / width);
      for (const next of [current - 1, current + 1, current - width, current + width]) {
        if (next < 0 || next >= cells.length || cells[next] === region.color) continue;
        const nx = next % width; const ny = Math.floor(next / width);
        if (Math.abs(nx - x) + Math.abs(ny - y) !== 1) continue;
        neighbourCounts.set(cells[next], (neighbourCounts.get(cells[next]) || 0) + 1);
      }
    }
    if (!neighbourCounts.size) break;
    const [red, green, blue] = palette[region.color];
    const replacement = [...neighbourCounts.entries()].sort((a, b) => {
      const colorDistance = (label) => {
        const [r, g, bl] = palette[label];
        return (r - red) ** 2 + (g - green) ** 2 + (bl - blue) ** 2;
      };
      const scoreA = colorDistance(a[0]) - a[1] * 180;
      const scoreB = colorDistance(b[0]) - b[1] * 180;
      return scoreA - scoreB;
    })[0][0];
    region.indices.forEach((index) => { cells[index] = replacement; });
    regions = regionStats(cells, width, height);
  }
  return { cells, regions };
}

function colorGridFromImage(image, width, height, maxRegions = Number.POSITIVE_INFINITY) {
  const samples = [];
  for (let gy = 0; gy < height; gy += 1) for (let gx = 0; gx < width; gx += 1) {
    samples.push(averageCellColor(image, Math.floor(gx * image.width / width), Math.floor(gy * image.height / height), Math.max(1, Math.floor((gx + 1) * image.width / width)), Math.max(1, Math.floor((gy + 1) * image.height / height))));
  }
  const centerCount = Math.min(10, Math.max(4, Math.round(Math.sqrt(samples.length) / 2)));
  const centers = Array.from({ length: centerCount }, (_, index) => [...samples[Math.floor(index * samples.length / centerCount)]]);
  let labels = new Array(samples.length).fill(0);
  for (let iteration = 0; iteration < 7; iteration += 1) {
    const sums = centers.map(() => [0, 0, 0, 0]);
    labels = samples.map((sample) => {
      let nearest = 0; let distance = Number.POSITIVE_INFINITY;
      centers.forEach((center, index) => {
        const delta = sample.map((value, component) => value - center[component]);
        const candidate = delta[0] ** 2 + delta[1] ** 2 + delta[2] ** 2;
        if (candidate < distance) { distance = candidate; nearest = index; }
      });
      sums[nearest][0] += sample[0]; sums[nearest][1] += sample[1]; sums[nearest][2] += sample[2]; sums[nearest][3] += 1;
      return nearest;
    });
    centers.forEach((center, index) => {
      if (sums[index][3]) {
        center[0] = sums[index][0] / sums[index][3]; center[1] = sums[index][1] / sums[index][3]; center[2] = sums[index][2] / sums[index][3];
      }
    });
  }
  const used = [...new Set(labels)];
  used.sort((a, b) => (centers[a][0] + centers[a][1] + centers[a][2]) - (centers[b][0] + centers[b][1] + centers[b][2]));
  const remap = new Map(used.map((old, index) => [old, index]));
  const palette = used.map((index) => centers[index].map((value) => Math.max(0, Math.min(255, Math.round(value)))));
  let cells = labels.map((label) => remap.get(label));
  for (let pass = 0; pass < 3; pass += 1) {
    const regionIds = new Int32Array(cells.length); regionIds.fill(-1); const sizes = [];
    const queue = new Int32Array(cells.length);
    for (let start = 0; start < cells.length; start += 1) {
      if (regionIds[start] !== -1) continue;
      const id = sizes.length; const color = cells[start]; let head = 0; let tail = 0;
      queue[tail++] = start; regionIds[start] = id; sizes.push({ color, indices: [] });
      while (head < tail) {
        const current = queue[head++]; sizes[id].indices.push(current);
        const x = current % width; const y = Math.floor(current / width);
        for (const next of [current - 1, current + 1, current - width, current + width]) {
          if (next < 0 || next >= cells.length || regionIds[next] !== -1) continue;
          const nx = next % width; const ny = Math.floor(next / width);
          if (Math.abs(nx - x) + Math.abs(ny - y) !== 1 || cells[next] !== color) continue;
          regionIds[next] = id; queue[tail++] = next;
        }
      }
    }
    let changed = false;
    for (const region of sizes) {
      if (region.indices.length >= 4) continue;
      const neighbourCounts = new Map();
      for (const current of region.indices) {
        const x = current % width; const y = Math.floor(current / width);
        for (const next of [current - 1, current + 1, current - width, current + width]) {
          if (next < 0 || next >= cells.length) continue;
          const nx = next % width; const ny = Math.floor(next / width);
          if (Math.abs(nx - x) + Math.abs(ny - y) !== 1 || regionIds[next] === regionIds[current]) continue;
          const neighbour = cells[next]; neighbourCounts.set(neighbour, (neighbourCounts.get(neighbour) || 0) + 1);
        }
      }
      const replacement = [...neighbourCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
      if (replacement === undefined) continue;
      region.indices.forEach((index) => { cells[index] = replacement; });
      changed = true;
    }
    if (!changed) break;
  }
  const regionIds = new Int32Array(cells.length); regionIds.fill(-1); let regionSizes = [];
  const queue = new Int32Array(cells.length);
  for (let start = 0; start < cells.length; start += 1) {
    if (regionIds[start] !== -1) continue;
    const id = regionSizes.length; const color = cells[start]; let head = 0; let tail = 0; let size = 0;
    queue[tail++] = start; regionIds[start] = id;
    while (head < tail) {
      const current = queue[head++]; size += 1; const x = current % width; const y = Math.floor(current / width);
      for (const next of [current - 1, current + 1, current - width, current + width]) {
        if (next < 0 || next >= cells.length || regionIds[next] !== -1) continue;
        const nx = next % width; const ny = Math.floor(next / width);
        if (Math.abs(nx - x) + Math.abs(ny - y) !== 1 || cells[next] !== color) continue;
        regionIds[next] = id; queue[tail++] = next;
      }
    }
    regionSizes.push(size);
  }
  if (regionSizes.length > maxRegions) {
    const collapsed = collapseRegions(cells, width, height, palette, maxRegions);
    cells = collapsed.cells;
    regionSizes = collapsed.regions.map((region) => region.indices.length);
  }
  const hex = palette.map(([red, green, blue]) => `#${red.toString(16).padStart(2, '0')}${green.toString(16).padStart(2, '0')}${blue.toString(16).padStart(2, '0')}`);
  return { cells, width, height, palette: hex, regionCount: regionSizes.length, regionSizes };
}

function gridFromImage(image, width, height, maxRegions = Number.POSITIVE_INFINITY) {
  const grid = colorGridFromImage(image, width, height, maxRegions);
  const histogram = grid.palette.map((_, index) => grid.cells.reduce((count, cell) => count + (cell === index ? 1 : 0), 0));
  return { ...grid, histogram };
}

function technicalQa(image, entry) {
  const expected = entry.orientation === 'cover' ? { width: 1200, height: 1200 } : { width: entry.width, height: entry.height };
  if (image.width !== expected.width || image.height !== expected.height) return { status: 'REGENERATE', reason: 'normalized_dimensions_mismatch' };
  let contentPixels = 0;
  let colorPixels = 0;
  const colorBins = new Set();
  for (let index = 0; index < image.rgba.length; index += 4) {
    const r = image.rgba[index]; const g = image.rgba[index + 1]; const b = image.rgba[index + 2];
    if ((r + g + b) / 3 < 245) contentPixels += 1;
    if (Math.max(r, g, b) - Math.min(r, g, b) > 24) colorPixels += 1;
    colorBins.add(`${Math.round(r / 32)},${Math.round(g / 32)},${Math.round(b / 32)}`);
  }
  const pixels = image.width * image.height;
  // A finished full-color scene is intentionally full-bleed; its background
  // may occupy nearly every pixel. Only reject an effectively empty asset.
  if (contentPixels < pixels * 0.03) return { status: 'REGENERATE', reason: 'artwork_density_out_of_bounds' };
  if (colorPixels < pixels * 0.02 || colorBins.size < 4) return { status: 'REGENERATE', reason: 'finished_full_color_requirement_failed' };
  if (entry.orientation === 'cover') return { status: 'PASS', reason: 'normalized_full_color_cover_full_bleed_heuristics_passed', regions: null };
  const maxRegions = entry.difficulty === 'simple' ? 35 : entry.difficulty === 'medium' ? 60 : 80;
  const grid = gridFromImage(image, entry.grid_width, entry.grid_height, maxRegions);
  return { status: 'PASS', reason: 'normalized_full_color_full_bleed_and_runtime_grid_built', regions: grid.regionCount, grid };
}

async function ensureParent(filePath) { await mkdir(dirname(filePath), { recursive: true }); }

async function sourceExists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

async function summarizeCurrentManifest(manifest) {
  const summary = { processed: 0, pass: 0, regenerate: 0, missing: 0, covers: 0, colorings: 0, failures: [] };
  for (const entry of [...manifest.entries, ...manifest.covers]) {
    if (!(await sourceExists(resolve(root, entry.source_asset)))) {
      summary.missing += 1;
      summary.failures.push({ id: entry.id, error: 'asset_missing' });
      continue;
    }
    summary.processed += 1;
    if (entry.qa_status === 'PASS') summary.pass += 1;
    if (entry.qa_status === 'REGENERATE') summary.regenerate += 1;
    if (entry.orientation === 'cover') summary.covers += 1;
    else summary.colorings += 1;
  }
  return summary;
}

const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const allEntries = [...manifest.entries, ...manifest.covers];
if (onlyId && !allEntries.some((entry) => entry.id === onlyId)) throw new Error(`Asset ID not found in catalog manifest: ${onlyId}`);
const entries = onlyId ? allEntries.filter((entry) => entry.id === onlyId) : allEntries;
const existingRuntimeTemplates = onlyId ? JSON.parse(await readFile(catalogPath, 'utf8')) : [];
const runtimeTemplates = onlyId ? existingRuntimeTemplates.filter((template) => template.id !== onlyId) : [];
const report = { processed: 0, pass: 0, regenerate: 0, missing: 0, covers: 0, colorings: 0, failures: [] };

for (const entry of entries) {
  const sourcePath = resolve(root, entry.source_asset);
  try {
    const source = decodePng(await readFile(sourcePath));
    const preparedSource = repairKnownInsetFrame(source, entry.id);
    const target = entry.orientation === 'cover'
      ? { width: 1200, height: 1200 }
      : { width: entry.width, height: entry.height };
    const master = fitImage(preparedSource, target.width, target.height);
    await ensureParent(sourcePath);
    await writeFile(sourcePath, encodePng(master));
    const qa = technicalQa(master, entry);
    const grid = qa.grid || null;
    entry.generation_status = 'generated';
    entry.qa_status = qa.status;
    entry.qa_notes = repairKnownInsetFrame(source, entry.id) === source ? qa.reason : `${qa.reason};known_inset_frame_removed`;
    entry.qa_region_count = qa.regions || null;
    report.processed += 1;
    if (qa.status === 'PASS') report.pass += 1; else report.regenerate += 1;
    if (entry.orientation === 'cover') {
      report.covers += 1;
      const coverPath = resolve(root, entry.optimized_asset);
      await ensureParent(coverPath);
      await writeFile(coverPath, encodePng(fitImage(master, 1200, 1200)));
      continue;
    }
    report.colorings += 1;
    const optimizedPath = resolve(root, entry.optimized_asset);
    const previewPath = resolve(root, entry.preview_asset);
    await ensureParent(optimizedPath); await ensureParent(previewPath);
    const optimized = fitImage(master, Math.round(target.width / 2), Math.round(target.height / 2));
    await writeFile(optimizedPath, encodePng(optimized));
    const maxRegions = entry.difficulty === 'simple' ? 35 : entry.difficulty === 'medium' ? 60 : 80;
    const runtimeGrid = grid || gridFromImage(master, entry.grid_width, entry.grid_height, maxRegions);
    const pixelized = renderPixelizedGrid(runtimeGrid);
    const preview = fitImage(pixelized, 512, Math.round(512 * target.height / target.width));
    await writeFile(previewPath, encodePng(preview));
    if (qa.status === 'PASS') runtimeTemplates.push({
      id: entry.id,
      title: entry.title,
      description: entry.description,
      category: entry.tags[0] || 'featured',
      difficulty: entry.difficulty,
      width: entry.grid_width,
      height: entry.grid_height,
      palette: runtimeGrid.palette,
      cells: runtimeGrid.cells,
      preview: `/${entry.optimized_asset.replace(/^public\//, '')}`,
      preview_asset: `/${entry.preview_asset.replace(/^public\//, '')}`,
      collection_id: entry.collection_id,
      collection_title: entry.collection_title,
      album_id: entry.album_id,
      album_title: entry.album_title,
      access: entry.access,
      theme: entry.tags[entry.tags.length - 2] || 'featured',
      mood: entry.mood,
      est_minutes: entry.difficulty === 'simple' ? 4 : entry.difficulty === 'medium' ? 7 : 11,
      daily_featured: 0,
      added_at: '2026-09-15T00:00:00.000Z',
      histogram: runtimeGrid.histogram,
    });
  } catch (error) {
    report.missing += 1;
    report.failures.push({ id: entry.id, error: error.message });
  }
}

const currentReport = onlyId ? await summarizeCurrentManifest(manifest) : report;
manifest.ingestion = {
  processed_at: '2026-09-15T00:00:00.000Z',
  report: currentReport,
  runtime_catalog_count: runtimeTemplates.length,
};
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
await writeFile(catalogPath, `${JSON.stringify(runtimeTemplates, null, 2)}\n`, 'utf8');
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ ...report, runtime_catalog_count: runtimeTemplates.length }, null, 2));
