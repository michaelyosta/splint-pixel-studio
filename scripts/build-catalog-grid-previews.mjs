import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { buildBudgetedCatalogGridPreview } from './catalog-grid-preview.mjs';
import { CATALOG_GRID_PREVIEW_BUDGET_BYTES } from './catalog-grid-preview.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const generatedRoot = join(root, 'content', 'generated', 'catalog-grids');
const reportPath = join(generatedRoot, 'candidate-report.json');
const runtimePath = join(generatedRoot, 'catalog-templates-1200.candidate.json');
const outputDir = join(root, 'public', 'assets', 'catalog', 'generated');
const outputManifestPath = join(generatedRoot, 'catalog-manifest-1200.candidate.json');

const report = JSON.parse(await readFile(reportPath, 'utf8'));
const sourceManifest = JSON.parse(await readFile(join(root, 'content', 'catalog-manifest.json'), 'utf8'));
const candidateRuntime = JSON.parse(await readFile(runtimePath, 'utf8'));
if (report.status !== 'candidate-ready-human-review-required' || report.selected_count !== 320 || !report.complete) {
  throw new Error('Delivery previews require the complete 320-map candidate report');
}
if (sourceManifest.entries.length !== 320 || candidateRuntime.length !== 320) {
  throw new Error('Delivery previews require the canonical 320-entry manifest and runtime');
}

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const runtimeById = new Map(candidateRuntime.map((template) => [template.id, template]));
const newEntries = new Map();
const inventory = [];
await mkdir(outputDir, { recursive: true });

for (const item of report.results) {
  const runtime = runtimeById.get(item.id);
  const entry = sourceManifest.entries.find((candidate) => candidate.id === item.id);
  if (!runtime || !entry || runtime.width !== item.width || runtime.height !== item.height) {
    throw new Error(`Candidate manifest/runtime mismatch for ${item.id}`);
  }
  const mapPath = resolve(root, item.cell_map_asset);
  if (!existsSync(mapPath)) throw new Error(`Candidate cell map is missing: ${item.cell_map_asset}`);
  const compressed = await readFile(mapPath);
  if (hash(compressed) !== item.cell_map_sha256) throw new Error(`Candidate cell-map checksum mismatch: ${item.id}`);
  const cells = gunzipSync(compressed, { maxOutputLength: item.width * item.height });
  if (cells.length !== item.width * item.height) throw new Error(`Candidate cell-map size mismatch: ${item.id}`);

  const preview = buildBudgetedCatalogGridPreview({
    cells,
    width: item.width,
    height: item.height,
    palette: item.palette,
  });
  const filename = `${entry.slug}-1200px-pixel.png`;
  const path = join(outputDir, filename);
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, preview.bytes);
  await rename(temporary, path);
  const assetPath = `public/assets/catalog/generated/${filename}`;
  newEntries.set(entry.id, {
    ...entry,
    grid_width: item.width,
    grid_height: item.height,
    preview_asset: assetPath,
  });
  inventory.push({
    id: item.id,
    asset: assetPath,
    candidate_file: assetPath,
    bytes: preview.byteLength,
    sha256: hash(preview.bytes),
    width: preview.width,
    height: preview.height,
    max_side: preview.maxSide,
    grid_width: item.width,
    grid_height: item.height,
    budget_bytes: CATALOG_GRID_PREVIEW_BUDGET_BYTES,
  });
}

if (inventory.length !== 320 || new Set(inventory.map((item) => item.asset)).size !== 320
  || inventory.some((item) => item.bytes > CATALOG_GRID_PREVIEW_BUDGET_BYTES)) {
  throw new Error('Candidate pixel-preview inventory is incomplete, duplicated, or over budget');
}
const candidateManifest = {
  ...sourceManifest,
  entries: sourceManifest.entries.map((entry) => newEntries.get(entry.id)),
};
const manifestTemporary = `${outputManifestPath}.${process.pid}.tmp`;
await writeFile(manifestTemporary, `${JSON.stringify(candidateManifest, null, 2)}\n`);
await rename(manifestTemporary, outputManifestPath);
const inventoryPath = join(generatedRoot, 'delivery-preview-inventory.json');
const inventoryTemporary = `${inventoryPath}.${process.pid}.tmp`;
await writeFile(inventoryTemporary, `${JSON.stringify({ schema_version: 1, visual_approval: 'REQUIRED', assets: inventory }, null, 2)}\n`);
await rename(inventoryTemporary, inventoryPath);

console.log(JSON.stringify({
  status: 'candidate-previews-ready-human-review-required',
  count: inventory.length,
  total_bytes: inventory.reduce((sum, item) => sum + item.bytes, 0),
  max_bytes: Math.max(...inventory.map((item) => item.bytes)),
  median_preview_long_side: median(inventory.map((item) => Math.max(item.width, item.height))),
  median_preview_bytes: median(inventory.map((item) => item.bytes)),
  runtime: 'content/generated/catalog-grids/catalog-templates-1200.candidate.json',
  manifest: 'content/generated/catalog-grids/catalog-manifest-1200.candidate.json',
  inventory: 'content/generated/catalog-grids/delivery-preview-inventory.json',
}, null, 2));

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
}
