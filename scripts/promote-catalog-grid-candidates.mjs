import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const generatedRoot = resolve(root, 'content/generated/catalog-grids');
const apply = process.argv.includes('--apply');
const approvalPath = resolve(root, 'docs/evidence/CATALOG_PIXEL_GRID_APPROVAL_2026-09-25.md');
const inputPaths = {
  sourceManifest: resolve(root, 'content/catalog-manifest.json'),
  sourceRuntime: resolve(root, 'server/catalog-templates.json'),
  manifest: resolve(generatedRoot, 'catalog-manifest-1200.candidate.json'),
  runtime: resolve(generatedRoot, 'catalog-templates-1200.candidate.json'),
  report: resolve(generatedRoot, 'candidate-report.json'),
  previews: resolve(generatedRoot, 'delivery-preview-inventory.json'),
};

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
function resolveGeneratedAsset(assetPath, expectedPrefix) {
  const normalized = String(assetPath || '').replaceAll('\\', '/');
  if (!normalized.startsWith(expectedPrefix) || normalized.split('/').includes('..')) {
    throw new Error(`Candidate asset path is outside ${expectedPrefix}: ${assetPath}`);
  }
  return resolve(root, normalized);
}
async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

const approval = await readFile(approvalPath, 'utf8');
if (!approval.includes('Status: OWNER-APPROVED FOR CATALOG')) {
  throw new Error('Catalog promotion requires the checked-in owner visual-approval record');
}
const [sourceManifest, sourceRuntime, manifest, runtime, report, previewInventory] = await Promise.all([
  readJson(inputPaths.sourceManifest),
  readJson(inputPaths.sourceRuntime),
  readJson(inputPaths.manifest),
  readJson(inputPaths.runtime),
  readJson(inputPaths.report),
  readJson(inputPaths.previews),
]);
if (sourceManifest.entries?.length !== 320 || sourceRuntime.length !== 320
  || manifest.entries?.length !== 320 || runtime.length !== 320
  || report.status !== 'candidate-ready-human-review-required'
  || report.selected_count !== 320 || report.results?.length !== 320
  || previewInventory.assets?.length !== 320) {
  throw new Error('Promotion requires complete 320-item source, candidate, runtime, report and preview inventories');
}
const originalIds = new Set(sourceManifest.entries.map((entry) => entry.id));
if (new Set(manifest.entries.map((entry) => entry.id)).size !== 320
  || manifest.entries.some((entry) => !originalIds.has(entry.id))) {
  throw new Error('Candidate manifest IDs must match the canonical 320-item set exactly');
}
const runtimeById = new Map(runtime.map((item) => [item.id, item]));
const resultById = new Map(report.results.map((item) => [item.id, item]));
const previewById = new Map(previewInventory.assets.map((item) => [item.id, item]));
if (runtimeById.size !== 320 || resultById.size !== 320 || previewById.size !== 320) {
  throw new Error('Candidate inventories contain duplicate IDs');
}

for (const entry of manifest.entries) {
  const candidate = runtimeById.get(entry.id);
  const result = resultById.get(entry.id);
  const preview = previewById.get(entry.id);
  if (!candidate || !result || !preview || candidate.storage_mode !== 'tiled'
    || candidate.width !== result.width || candidate.height !== result.height
    || candidate.width < 8 || candidate.height < 8 || candidate.width > 1200 || candidate.height > 1200
    || candidate.cell_map_sha256 !== result.cell_map_sha256
    || candidate.cell_map_r2_key !== `catalog/grids/${entry.id}.${result.cell_map_sha256}.u8.gz`
    || entry.preview_asset !== preview.asset || preview.bytes > 16 * 1024) {
    throw new Error(`Candidate manifest/runtime/report/preview mismatch: ${entry.id}`);
  }
  const gridPath = resolveGeneratedAsset(candidate.cell_map_asset, 'content/generated/catalog-grids/');
  if (!existsSync(gridPath)) throw new Error(`Missing generated grid: ${candidate.cell_map_asset}`);
  const compressed = await readFile(gridPath);
  if (compressed.length !== candidate.cell_map_bytes || hash(compressed) !== candidate.cell_map_sha256) {
    throw new Error(`Generated grid checksum/size mismatch: ${entry.id}`);
  }
  const raw = gunzipSync(compressed, { maxOutputLength: candidate.width * candidate.height });
  if (raw.length !== candidate.width * candidate.height || raw.some((cell) => cell >= candidate.palette.length)) {
    throw new Error(`Generated grid dimensions/palette mismatch: ${entry.id}`);
  }
  const previewPath = resolveGeneratedAsset(preview.asset, 'public/assets/catalog/generated/');
  if (!existsSync(previewPath)) throw new Error(`Missing delivery preview: ${preview.asset}`);
  const previewBytes = await readFile(previewPath);
  if (previewBytes.length !== preview.bytes || hash(previewBytes) !== preview.sha256
    || previewBytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') {
    throw new Error(`Delivery preview checksum/format mismatch: ${entry.id}`);
  }
}

const candidateRuntimeById = new Map(runtime.map((item) => [item.id, item]));
const nextRuntime = sourceRuntime.map((item) => candidateRuntimeById.get(item.id));
if (nextRuntime.some((item) => !item)) throw new Error('Candidate runtime is missing a canonical template');

if (apply) {
  const outputs = [
    [inputPaths.sourceManifest, `${JSON.stringify(manifest, null, 2)}\n`],
    [inputPaths.sourceRuntime, `${JSON.stringify(nextRuntime, null, 2)}\n`],
  ];
  const staged = [];
  try {
    for (const [path, content] of outputs) {
      const temporary = `${path}.${process.pid}.tmp`;
      await mkdir(dirname(path), { recursive: true });
      await writeFile(temporary, content, { flag: 'wx' });
      staged.push([temporary, path]);
    }
    for (const [temporary, path] of staged) await rename(temporary, path);
  } catch (error) {
    await Promise.all(staged.map(([temporary]) => rm(temporary, { force: true })));
    throw error;
  }
}

console.log(JSON.stringify({
  status: apply ? 'promoted' : 'validated',
  count: manifest.entries.length,
  collections: manifest.collections?.length || 0,
  albums: (manifest.collections || []).reduce((sum, collection) => sum + (collection.albums?.length || 0), 0),
  free: manifest.entries.filter((entry) => entry.access === 'free').length,
  premium: manifest.entries.filter((entry) => entry.access === 'premium').length,
  grids: runtime.length,
  delivery_previews: previewInventory.assets.length,
  output_paths: apply ? ['content/catalog-manifest.json', 'server/catalog-templates.json'] : [],
}, null, 2));
