/**
 * Build aspect-preserving, high-resolution catalog grid candidates with the
 * same classic-v1 browser pipeline used by the app. Grid binaries and review
 * renders stay in the ignored content/generated/catalog-grids directory.
 *
 * Usage (with Vite running):
 *   node scripts/build-catalog-grid-candidates.mjs --url http://127.0.0.1:5173 --ids coloring_example_01
 *   node scripts/build-catalog-grid-candidates.mjs --url http://127.0.0.1:5173
 *   node scripts/build-catalog-grid-candidates.mjs --url http://127.0.0.1:5173 --write-runtime
 */

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync, gzipSync } from 'node:zlib';
import { chromium } from '@playwright/test';
import { deriveCatalogGridDimensions, readCanonicalCatalog, sha256 } from '../server/services/catalog-publisher.js';
import { connectedRegionStats } from './catalog-grid-analysis.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const hasFlag = (name) => args.includes(name);
const readArg = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const requestedBaseUrl = readArg('--url', '');
const outputDir = resolve(root, 'content/generated/catalog-grids');
const previewDir = join(outputDir, 'previews');
const reportPath = join(outputDir, 'candidate-report.json');
const candidateRuntimePath = join(outputDir, 'catalog-templates-1200.candidate.json');
const maxSide = Number(readArg('--max-side', '1200'));
const sourceRef = readArg('--ref', 'HEAD');
const requestedIds = readArg('--ids', '').split(',').map((id) => id.trim()).filter(Boolean);
const limit = Number(readArg('--limit', '0'));
const tileSize = 32;

if (!Number.isInteger(maxSide) || maxSide < 8 || maxSide > 1200) {
  throw new RangeError('--max-side must be an integer between 8 and 1200');
}
if (args.includes('--help')) {
  console.log('Use --url <vite-url>, optional --ids id,id or --limit N, and --write-runtime only after the complete 320-item candidate set is approved.');
  process.exit(0);
}

const canonical = readCanonicalCatalog();
let entries = canonical.entries;
if (requestedIds.length) {
  const requested = new Set(requestedIds);
  entries = entries.filter((entry) => requested.has(entry.id));
  const missing = [...requested].filter((id) => !entries.some((entry) => entry.id === id));
  if (missing.length) throw new Error(`Unknown catalog ids: ${missing.join(', ')}`);
}
if (limit > 0) entries = entries.slice(0, limit);
if (!entries.length) throw new Error('No catalog entries selected');
if (hasFlag('--write-runtime') && entries.length !== canonical.entries.length) {
  throw new Error('--write-runtime requires the complete canonical 320-item catalog');
}

function safeAssetPath(value) {
  const normalized = String(value || '').replaceAll('\\', '/');
  if (!normalized.startsWith('content/generated/masters/') || normalized.split('/').includes('..')) {
    throw new Error(`Catalog master path is not allowed: ${value}`);
  }
  return normalized;
}

function readMaster(entry) {
  const asset = safeAssetPath(entry.source_asset);
  const localPath = resolve(root, asset);
  if (existsSync(localPath)) return readFile(localPath);
  return execFileSync('git', ['show', `${sourceRef}:${asset}`], {
    cwd: root,
    maxBuffer: 256 * 1024 * 1024,
  });
}

function pngDimensions(bytes, asset) {
  if (bytes.length < 24 || bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') {
    throw new Error(`Catalog master is not a valid PNG: ${asset}`);
  }
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  if (!width || !height) throw new Error(`Catalog master has invalid PNG dimensions: ${asset}`);
  return { width, height };
}

function safeName(value) {
  return String(value).replace(/[^a-z0-9_-]+/gi, '-').toLowerCase();
}

function dataUrlBuffer(dataUrl) {
  const match = String(dataUrl || '').match(/^data:image\/png;base64,(.+)$/);
  if (!match) throw new Error('Pixel candidate preview did not return a PNG data URL');
  return Buffer.from(match[1], 'base64');
}

function paletteUsage(cells, paletteLength) {
  const counts = new Array(paletteLength).fill(0);
  for (const cell of cells) counts[cell] += 1;
  return counts;
}

function runtimeWithCandidate(runtime, candidate) {
  return {
    ...runtime,
    width: candidate.width,
    height: candidate.height,
    palette: candidate.palette,
    cells: [],
    storage_mode: 'tiled',
    tile_size: tileSize,
    cell_map_asset: candidate.cell_map_asset,
    cell_map_r2_key: candidate.cell_map_r2_key,
    cell_map_raw_bytes: candidate.cell_map_raw_bytes,
    cell_map_bytes: candidate.cell_map_bytes,
    cell_map_sha256: candidate.cell_map_sha256,
    pixelization_pipeline_version: candidate.pixelization_pipeline_version,
    pixelization_fingerprint: candidate.pixelization_fingerprint,
  };
}

async function writeAtomic(path, bytes) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, bytes);
  await rename(temporary, path);
}

async function startPixelizationModuleServer() {
  const moduleSource = await readFile(join(root, 'src', 'lib', 'pixelColoring.js'));
  const server = createServer((request, response) => {
    if (request.url === '/') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end('<!doctype html><html><head><meta charset="utf-8"></head><body>Splint pixelization candidate runner</body></html>');
      return;
    }
    if (request.url === '/src/lib/pixelColoring.js') {
      response.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store' });
      response.end(moduleSource);
      return;
    }
    response.writeHead(404);
    response.end('not found');
  });
  await new Promise((resolvePromise, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolvePromise);
  });
  const address = server.address();
  return { server, url: `http://127.0.0.1:${address.port}` };
}

await mkdir(previewDir, { recursive: true });
const algorithmSha256 = sha256(await readFile(join(root, 'src', 'lib', 'pixelColoring.js')));
const report = {
  schema_version: 1,
  status: 'building',
  source_ref: sourceRef,
  source_manifest_sha256: sha256(await readFile(join(root, 'content', 'catalog-manifest.json'))),
  algorithm_sha256: algorithmSha256,
  builder_sha256: sha256(await readFile(fileURLToPath(import.meta.url))),
  pipeline_version: 'classic-v1',
  max_side: maxSide,
  tile_size: tileSize,
  requested_count: entries.length,
  results: [],
};
if (!hasFlag('--no-resume') && existsSync(reportPath)) {
  try {
    const previous = JSON.parse(await readFile(reportPath, 'utf8'));
    if (previous.source_manifest_sha256 === report.source_manifest_sha256
      && previous.algorithm_sha256 === algorithmSha256
      && previous.builder_sha256 === report.builder_sha256
      && previous.pipeline_version === report.pipeline_version
      && previous.max_side === maxSide) {
      report.results = previous.results || [];
    }
  } catch {
    // A corrupt/interrupted report is rebuilt from complete, checksum-verified files.
  }
}
const previousResults = new Map(report.results.map((item) => [item.id, item]));
const runtimeOutput = new Map(canonical.runtimeTemplates.map((template) => [template.id, { ...template }]));
const completed = new Map();

const moduleServer = requestedBaseUrl ? null : await startPixelizationModuleServer();
const baseUrl = requestedBaseUrl || moduleServer.url;
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  for (const [index, entry] of entries.entries()) {
    if (completed.has(entry.id)) {
      console.log(`${index + 1}/${entries.length} ${entry.id}: checksum-verified resume`);
      continue;
    }
    const source = await readMaster(entry);
    const sourceSha = sha256(source);
    const sourceDimensions = pngDimensions(source, entry.source_asset);
    const target = deriveCatalogGridDimensions(sourceDimensions.width, sourceDimensions.height, maxSide);
    const current = canonical.runtimeById.get(entry.id);
    const old = previousResults.get(entry.id);
    if (old && old.source_sha256 === sourceSha && old.width === target.width && old.height === target.height
      && old.cell_map_asset?.startsWith('content/generated/catalog-grids/')) {
      const mapPath = resolve(root, old.cell_map_asset);
      const previewPath = resolve(root, old.preview_asset || '');
      if (existsSync(mapPath) && existsSync(previewPath)) {
        const compressed = await readFile(mapPath);
        if (sha256(compressed) === old.cell_map_sha256) {
          const raw = gunzipSync(compressed, { maxOutputLength: target.width * target.height });
          if (raw.length === target.width * target.height && raw.every((cell) => cell < old.palette.length)) {
            completed.set(entry.id, old);
            runtimeOutput.set(entry.id, runtimeWithCandidate(current, old));
            console.log(`${index + 1}/${entries.length} ${entry.id}: source/map checksum-verified resume`);
            continue;
          }
        }
      }
    }
    const colorCount = current.palette.length;
    const result = await page.evaluate(async ({ sourceBase64, width, height, colors }) => {
      const bytes = Uint8Array.from(atob(sourceBase64), (character) => character.charCodeAt(0));
      const file = new File([bytes], 'catalog-master.png', { type: 'image/png' });
      const { buildColoringFromImage } = await import('/src/lib/pixelColoring.js');
      const data = await buildColoringFromImage(file, {
        width,
        height,
        colors,
        stylePreset: 'classic',
        includeOriginalDataUrl: false,
        yieldEvery: 24,
      });
      const cells = Uint8Array.from(data.cells);
      const palette = data.palette.map((hex) => [
        parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16),
      ]);
      const full = document.createElement('canvas');
      full.width = data.width;
      full.height = data.height;
      const context = full.getContext('2d');
      const image = context.createImageData(data.width, data.height);
      for (let index = 0; index < cells.length; index += 1) {
        const color = palette[cells[index]];
        const offset = index * 4;
        image.data[offset] = color[0];
        image.data[offset + 1] = color[1];
        image.data[offset + 2] = color[2];
        image.data[offset + 3] = 255;
      }
      context.putImageData(image, 0, 0);
      const scale = Math.min(512 / data.width, 512 / data.height);
      const preview = document.createElement('canvas');
      preview.width = Math.max(1, Math.round(data.width * scale));
      preview.height = Math.max(1, Math.round(data.height * scale));
      const previewContext = preview.getContext('2d');
      previewContext.imageSmoothingEnabled = false;
      previewContext.drawImage(full, 0, 0, preview.width, preview.height);
      let binary = '';
      const chunkSize = 0x8000;
      for (let offset = 0; offset < cells.length; offset += chunkSize) {
        binary += String.fromCharCode(...cells.subarray(offset, Math.min(cells.length, offset + chunkSize)));
      }
      return {
        width: data.width,
        height: data.height,
        palette: data.palette,
        pipelineVersion: data.pipelineVersion,
        stylePreset: data.stylePreset,
        resultFingerprint: data.resultFingerprint,
        cellsBase64: btoa(binary),
        previewDataUrl: preview.toDataURL('image/png'),
      };
    }, {
      sourceBase64: source.toString('base64'),
      width: target.width,
      height: target.height,
      colors: colorCount,
    });
    if (result.width !== target.width || result.height !== target.height
      || result.pipelineVersion !== 'classic-v1' || result.stylePreset !== 'classic') {
      throw new Error(`Unexpected pixelization result for ${entry.id}`);
    }
    const raw = Buffer.from(result.cellsBase64, 'base64');
    if (raw.length !== target.width * target.height || raw.some((cell) => cell >= result.palette.length)) {
      throw new Error(`Invalid palette-index map for ${entry.id}`);
    }
    const compressed = gzipSync(raw, { level: 9, mtime: 0 });
    const safeId = safeName(entry.id);
    const cellAsset = `content/generated/catalog-grids/${safeId}.u8.gz`;
    const previewAsset = `content/generated/catalog-grids/previews/${safeId}-pixel.png`;
    const cellPath = resolve(root, cellAsset);
    const previewPath = resolve(root, previewAsset);
    const cellMapSha256 = sha256(compressed);
    const regionStats = connectedRegionStats(raw, target.width, target.height);
    const previousCells = Uint8Array.from(current.cells);
    const previousGridStats = {
      width: current.width,
      height: current.height,
      cell_count: previousCells.length,
      ...connectedRegionStats(previousCells, current.width, current.height),
    };
    const candidate = {
      id: entry.id,
      source_asset: safeAssetPath(entry.source_asset),
      source_sha256: sourceSha,
      source_width: sourceDimensions.width,
      source_height: sourceDimensions.height,
      width: target.width,
      height: target.height,
      cell_count: raw.length,
      palette: result.palette,
      palette_cell_counts: paletteUsage(raw, result.palette.length),
      pixelization_pipeline_version: result.pipelineVersion,
      pixelization_fingerprint: result.resultFingerprint,
      storage_mode: 'tiled',
      tile_size: tileSize,
      cell_map_asset: cellAsset,
      cell_map_r2_key: `catalog/grids/${safeId}.${cellMapSha256}.u8.gz`,
      cell_map_raw_bytes: raw.length,
      cell_map_bytes: compressed.length,
      cell_map_sha256: cellMapSha256,
      preview_asset: previewAsset,
      preview_sha256: sha256(dataUrlBuffer(result.previewDataUrl)),
      previous_grid: previousGridStats,
      ...regionStats,
    };
    await writeAtomic(cellPath, compressed);
    await writeAtomic(previewPath, dataUrlBuffer(result.previewDataUrl));
    runtimeOutput.set(entry.id, runtimeWithCandidate(runtimeOutput.get(entry.id), candidate));
    completed.set(entry.id, candidate);
    report.results = [...completed.values()];
    await writeAtomic(reportPath, `${JSON.stringify({ ...report, status: 'building' }, null, 2)}\n`);
    console.log(`${index + 1}/${entries.length} ${entry.id}: ${target.width}x${target.height}, ${regionStats.regions4} regions4, ${compressed.length} gzip bytes`);
  }

  const results = entries.map((entry) => completed.get(entry.id)).filter(Boolean);
  const complete = results.length === canonical.entries.length;
  const nextRuntime = canonical.runtimeTemplates.map((template) => runtimeOutput.get(template.id));
  const runtimeJson = `${JSON.stringify(nextRuntime, null, 2)}\n`;
  await writeAtomic(candidateRuntimePath, runtimeJson);
  if (hasFlag('--write-runtime')) {
    await writeAtomic(join(root, 'server', 'catalog-templates.json'), runtimeJson);
  }
  const reportFinal = {
    ...report,
    status: complete ? 'candidate-ready-human-review-required' : 'partial-candidate-human-review-required',
    complete,
    selected_count: results.length,
    proposed_raw_cell_bytes: results.reduce((sum, item) => sum + item.cell_count, 0),
    proposed_compressed_cell_bytes: results.reduce((sum, item) => sum + item.cell_map_bytes, 0),
    median_previous_regions4: median(results.map((item) => item.previous_grid?.regions4 || 0)),
    median_regions4: median(results.map((item) => item.regions4)),
    p90_regions4: percentile(results.map((item) => item.regions4), 0.9),
    results,
    runtime_output: hasFlag('--write-runtime') ? 'server/catalog-templates.json' : 'content/generated/catalog-grids/catalog-templates-1200.candidate.json',
    visual_approval: 'REQUIRED',
  };
  await writeAtomic(reportPath, `${JSON.stringify(reportFinal, null, 2)}\n`);
  console.log(JSON.stringify({ status: reportFinal.status, count: results.length, raw_cell_bytes: reportFinal.proposed_raw_cell_bytes, compressed_cell_bytes: reportFinal.proposed_compressed_cell_bytes, median_regions4: reportFinal.median_regions4, p90_regions4: reportFinal.p90_regions4, runtime_output: reportFinal.runtime_output }, null, 2));
} finally {
  await browser.close();
  if (moduleServer) await new Promise((resolvePromise) => moduleServer.server.close(resolvePromise));
}

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
}

function percentile(values, p) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))];
}
