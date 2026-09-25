import { createHash } from 'node:crypto';
import { readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { readCanonicalCatalog, sha256 } from '../server/services/catalog-publisher.js';
import { connectedRegionStats } from './catalog-grid-analysis.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const reportPath = join(root, 'content', 'generated', 'catalog-grids', 'candidate-report.json');
const report = JSON.parse(await readFile(reportPath, 'utf8'));
if (report.status !== 'candidate-ready-human-review-required' || report.selected_count !== 320) {
  throw new Error('Quality analysis requires the completed 320-map candidate set');
}
const current = readCanonicalCatalog();
const results = [];

for (const item of report.results) {
  const compressed = await readFile(resolve(root, item.cell_map_asset));
  if (sha256(compressed) !== item.cell_map_sha256) throw new Error(`Cell-map checksum mismatch: ${item.id}`);
  const cells = gunzipSync(compressed, { maxOutputLength: item.width * item.height });
  const candidateStats = connectedRegionStats(cells, item.width, item.height);
  const old = current.runtimeById.get(item.id);
  const oldCells = Uint8Array.from(old.cells);
  const previousStats = connectedRegionStats(oldCells, old.width, old.height);
  const candidateQuality = qualityLevel(candidateStats.smallRegionCellCount, cells.length, item.palette_cell_counts);
  const previousPaletteCounts = new Array(old.palette.length).fill(0);
  for (const color of oldCells) previousPaletteCounts[color] += 1;
  const previousQuality = qualityLevel(previousStats.smallRegionCellCount, oldCells.length, previousPaletteCounts);
  results.push({
    ...item,
    ...candidateStats,
    previous_grid: { ...item.previous_grid, ...previousStats, quality_level: previousQuality },
    quality_level: candidateQuality,
  });
}

const levels = (key) => Object.fromEntries(['good', 'fair', 'noisy'].map((level) => [
  level,
  results.filter((item) => (key === 'candidate' ? item.quality_level : item.previous_grid.quality_level) === level).length,
]));
report.results = results;
report.quality_analysis = {
  quality_contract: 'src/lib/creatorQuality.js: small-region ratio counts cells in four-connected components of size <= 2',
  candidate_levels: levels('candidate'),
  previous_levels: levels('previous'),
  median_small_region_cell_ratio: median(results.map((item) => item.smallRegionCellRatio)),
  median_singleton_area_ratio: median(results.map((item) => item.singletonAreaRatio)),
  median_tiny_region_cell_ratio: median(results.map((item) => item.tinyRegionCellRatio)),
  max_small_region_cell_ratio: Math.max(...results.map((item) => item.smallRegionCellRatio)),
  source_manifest_sha256: createHash('sha256').update(await readFile(join(root, 'content', 'catalog-manifest.json'))).digest('hex'),
  algorithm_sha256: createHash('sha256').update(await readFile(join(root, 'src', 'lib', 'pixelColoring.js'))).digest('hex'),
};
const temporary = `${reportPath}.${process.pid}.tmp`;
await writeFile(temporary, `${JSON.stringify(report, null, 2)}\n`);
await rename(temporary, reportPath);
console.log(JSON.stringify({
  count: results.length,
  ...report.quality_analysis,
}, null, 2));

function qualityLevel(smallRegionCellCount, totalCellCount, paletteCellCounts) {
  const smallRegionCellRatio = smallRegionCellCount / totalCellCount;
  const colorEfficiency = paletteCellCounts.filter((count) => count > 0).length / paletteCellCounts.length;
  if (smallRegionCellRatio < 0.02 && colorEfficiency > 0.5) return 'good';
  if (smallRegionCellRatio < 0.08) return 'fair';
  return 'noisy';
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : Number(((sorted[middle - 1] + sorted[middle]) / 2).toFixed(5));
}
