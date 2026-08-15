import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { getAdversarialFixtures } from '../scripts/pixelization-eval/fixtures.mjs';
import { evaluateRaster, flattenMetricRow } from '../scripts/pixelization-eval/metrics.mjs';

const fixtures = Object.fromEntries(getAdversarialFixtures().map(({ id, raster }) => [id, raster]));

test('metric contract exposes 4/8 connected regions and normalized distributions', () => {
  const metrics = evaluateRaster(fixtures.uniform);
  assert.equal(metrics.schemaVersion, 'pixelization-metrics.v1');
  assert.equal(metrics.regions4.count, 1);
  assert.equal(metrics.regions8.count, 1);
  assert.equal(metrics.regions4.densityPer10kCells, 10000 / 64);
  assert.equal(metrics.fragmentation.transitionCount, 0);
  assert.equal(metrics.predictedEffort.idealRegionTaps, 1);
  assert.equal(metrics.predictedEffort.classicLowerBound, 1);
  assert.equal(metrics.palette.usedCount, 1);
  assert.equal(metrics.sourceComparison.available, false);
});

test('checkerboard is visible as a fragmentation/effort adversarial case', () => {
  const metrics = evaluateRaster(fixtures.checkerboard);
  assert.equal(metrics.regions4.count, 64);
  assert.equal(metrics.regions8.count, 2, 'diagonal connectivity should expose a different structure');
  assert.equal(metrics.regions4.singletonCount, 64);
  assert.equal(metrics.regions4.singletonAreaRatio, 1);
  assert.equal(metrics.fragmentation.transitionRatio, 1);
  assert.equal(metrics.predictedEffort.idealRegionTaps, 64);
  assert.equal(metrics.predictedEffort.connectivity8RegionTaps, 2);
  assert.ok(metrics.numberReadability.labelsPotentiallyLegible === true || metrics.numberReadability.cellPixels < 7);
});

test('oversegmentation has materially higher region density than a coherent raster', () => {
  const coherent = evaluateRaster(fixtures.uniform);
  const metrics = evaluateRaster(fixtures.oversegmented);
  assert.ok(metrics.regions4.count > coherent.regions4.count);
  assert.ok(metrics.regions4.densityPer10kCells > coherent.regions4.densityPer10kCells);
  assert.ok(metrics.fragmentation.transitionRatio > coherent.fragmentation.transitionRatio);
  assert.ok(metrics.predictedEffort.classicLowerBound > coherent.predictedEffort.classicLowerBound);
  assert.equal(typeof metrics.fragmentation.compactness.mean, 'number');
  assert.equal(typeof metrics.palette.entropyBits, 'number');
});

test('intentional high-contrast accent is reported separately from low-contrast cleanup candidates', () => {
  const metrics = evaluateRaster(fixtures['intentional-accent']);
  assert.equal(metrics.regions4.singletonCount, 1);
  assert.equal(metrics.isolatedAndContrast.highContrastTinyCount, 1);
  assert.equal(metrics.isolatedAndContrast.lowContrastTinyCount, 0);
  assert.equal(metrics.isolatedAndContrast.highContrastAreaRatio, 1 / 49);
  assert.ok(metrics.fragmentation.boundaryContrast.meanDeltaE > 50);
});

test('blurred output fails source edge retention instead of winning on low fragmentation', () => {
  const metrics = evaluateRaster(fixtures.blurred);
  assert.equal(metrics.regions4.count, 1);
  assert.equal(metrics.fragmentation.transitionCount, 0);
  assert.equal(metrics.sourceComparison.available, true);
  assert.ok(metrics.sourceComparison.sourceEdgeCount > 0);
  assert.equal(metrics.sourceComparison.outputBoundaryCount, 0);
  assert.equal(metrics.sourceComparison.edgeRecall, 0);
  assert.ok(metrics.sourceComparison.meanDeltaE > 10);
});

test('same structure at multiple resolutions keeps area-normalized evidence stable', () => {
  const low = evaluateRaster(fixtures['same-structure-32']);
  const high = evaluateRaster(fixtures['same-structure-128']);
  assert.equal(low.regions4.count, high.regions4.count);
  assert.equal(low.regions8.count, high.regions8.count);
  assert.equal(low.regions4.tinyAreaRatio, 0);
  assert.equal(high.regions4.tinyAreaRatio, 0);
  assert.deepEqual(low.regions4.areaHistogram, high.regions4.areaHistogram);
  assert.ok(Math.abs(low.fragmentation.compactness.mean - high.fragmentation.compactness.mean) < 0.01);
  assert.ok(low.fragmentation.transitionRatio > high.fragmentation.transitionRatio, 'raw edge density is resolution-dependent and must not be confused with shape quality');
  assert.ok(low.regions4.densityPer10kCells > high.regions4.densityPer10kCells);
});

test('flattened rows retain source/edge/readability/effort fields without inventing null evidence', () => {
  const row = flattenMetricRow(evaluateRaster(fixtures.blurred));
  assert.equal(row.meanDeltaE > 0, true);
  assert.equal(row.edgeRecall, 0);
  assert.equal(row.idealRegionTaps, 1);
  assert.equal(row.previewCellPixels, 40);
  assert.equal(row.readableCellRatio, 1);
});

test('invalid adapter output is rejected before metrics can be gamed', () => {
  assert.throws(
    () => evaluateRaster({ width: 2, height: 2, palette: ['#000000'], cells: [0, 0, 0] }),
    /exactly 4 entries/,
  );
  assert.throws(
    () => evaluateRaster({ width: 2, height: 2, palette: ['#000000'], cells: [0, 0, 0, 1] }),
    /references palette index 1/,
  );
});

test('metric vector invariants reconcile across adversarial fixtures', () => {
  for (const [id, raster] of Object.entries(fixtures)) {
    const metrics = evaluateRaster(raster);
    const regionHistogramTotal = Object.values(metrics.regions4.sizeHistogram).reduce((sum, value) => sum + value, 0);
    const areaHistogramTotal = Object.values(metrics.regions4.areaHistogram).reduce((sum, value) => sum + value, 0);
    const paletteArea = metrics.palette.usageShares.reduce((sum, value) => sum + value, 0);
    assert.equal(regionHistogramTotal, metrics.regions4.count, `${id}: size histogram must reconcile to 4-connected regions`);
    assert.equal(areaHistogramTotal, metrics.regions4.count, `${id}: area histogram must reconcile to 4-connected regions`);
    assert.ok(metrics.regions4.count >= metrics.regions8.count, `${id}: 8-connectivity cannot create more components`);
    assert.ok(Math.abs(paletteArea - 1) < 1e-12, `${id}: palette area shares must sum to one`);
    assert.equal(
      metrics.predictedEffort.classicLowerBound,
      metrics.predictedEffort.idealRegionTaps + metrics.predictedEffort.colorSwitchLowerBound,
      `${id}: classic effort lower bound must retain its declared components`,
    );
  }
});

test('representative corpus is local, explicitly licensed, and hash pinned', async () => {
  const repoRoot = path.resolve(import.meta.dirname, '..');
  const manifest = JSON.parse(await readFile(path.join(repoRoot, 'scripts/pixelization-eval/corpus/representative-corpus.json'), 'utf8'));
  assert.equal(manifest.images.length, 7);
  const categories = new Set(manifest.images.map((image) => image.category));
  for (const required of ['portrait', 'animal', 'landscape', 'object', 'gradient', 'simple-illustration', 'strong-silhouette']) {
    assert.ok(categories.has(required), `missing representative stratum: ${required}`);
  }
  for (const image of manifest.images) {
    const absolutePath = path.resolve(repoRoot, image.path);
    assert.ok(absolutePath.startsWith(`${repoRoot}${path.sep}`), `${image.id}: source path must stay inside repository`);
    assert.match(image.source.license, /^(CC0 1\.0|Public domain)$/);
    assert.match(image.source.page, /^https:\/\/commons\.wikimedia\.org\/wiki\/File:/);
    assert.match(image.source.upstreamSha1, /^[a-f0-9]{40}$/);
    assert.match(image.source.sha256, /^[a-f0-9]{64}$/);
    const actualHash = createHash('sha256').update(await readFile(absolutePath)).digest('hex');
    assert.equal(actualHash, image.source.sha256, `${image.id}: local derivative changed without a manifest update`);
  }
});

test('candidate comparison reuses the exact representative sources and bounds high-resolution probes', async () => {
  const repoRoot = path.resolve(import.meta.dirname, '..');
  const baseline = JSON.parse(await readFile(path.join(repoRoot, 'scripts/pixelization-eval/corpus/representative-corpus.json'), 'utf8'));
  const comparison = JSON.parse(await readFile(path.join(repoRoot, 'scripts/pixelization-eval/corpus/representative-candidate-corpus.json'), 'utf8'));
  const expectedHashes = new Map(baseline.images.map((image) => [image.id, image.source.sha256]));
  assert.equal(comparison.images.length, baseline.images.length);
  for (const image of comparison.images) assert.equal(image.source.sha256, expectedHashes.get(image.id), `${image.id}: comparison source differs from baseline`);
  const highResolution = comparison.images.filter((image) => image.sizes?.includes(1200));
  assert.deepEqual(highResolution.map((image) => image.id), [
    'portrait-jessica-meir',
    'landscape-utah-dunes',
    'illustration-paint-brush',
  ]);
  assert.ok(comparison.images.every((image) => (image.sizes || comparison.defaults.sizes).includes(192)));
  assert.ok(comparison.images.every((image) => (image.sizes || comparison.defaults.sizes).includes(512)));
});
