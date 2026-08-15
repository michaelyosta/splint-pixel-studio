#!/usr/bin/env node

import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { getAdversarialFixtures } from './fixtures.mjs';
import { flattenMetricRow, evaluateRaster } from './metrics.mjs';
import { renderComparisonPanel, renderPanel } from './panel.mjs';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..', '..');
const DEFAULT_MANIFEST = path.join(SCRIPT_DIR, 'corpus.json');
const DEFAULT_OUTPUT = path.join(REPO_ROOT, 'docs', 'evidence', 'pixelization', 'current-baseline');

function parseArgs(argv) {
  const result = {
    manifest: DEFAULT_MANIFEST,
    sizes: null,
    colors: null,
    adapter: 'current',
    adapters: null,
    outputDir: DEFAULT_OUTPUT,
    skipPanels: false,
    port: Number(process.env.PIXEL_EVAL_WEB_PORT || 5198),
  };
  for (const argument of argv) {
    if (argument === '--skip-panels') result.skipPanels = true;
    else if (argument.startsWith('--manifest=')) result.manifest = path.resolve(argument.slice('--manifest='.length));
    else if (argument.startsWith('--sizes=')) result.sizes = argument.slice('--sizes='.length).split(',').map(Number).filter(Number.isInteger);
    else if (argument.startsWith('--colors=')) result.colors = Number(argument.slice('--colors='.length));
    else if (argument.startsWith('--adapter=')) result.adapter = argument.slice('--adapter='.length);
    else if (argument.startsWith('--adapters=')) result.adapters = argument.slice('--adapters='.length).split(',').map((value) => value.trim()).filter(Boolean);
    else if (argument.startsWith('--output-dir=')) result.outputDir = path.resolve(argument.slice('--output-dir='.length));
    else if (argument.startsWith('--port=')) result.port = Number(argument.slice('--port='.length));
    else if (argument === '--help' || argument === '-h') {
      console.log('Usage: node scripts/pixelization-eval/run.mjs [--sizes=32,160,512] [--colors=10] [--adapter=current | --adapters=classic,paintable] [--output-dir=...] [--skip-panels]');
      process.exit(0);
    }
  }
  if (!result.sizes?.length) result.sizes = null;
  return result;
}

async function loadJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

async function validateCorpusFiles(manifest) {
  const results = [];
  for (const image of manifest.images || []) {
    const absolutePath = path.resolve(REPO_ROOT, image.path);
    const relativePath = path.relative(REPO_ROOT, absolutePath);
    if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) throw new Error(`Corpus path escapes repository root: ${image.path}`);
    const bytes = await readFile(absolutePath);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const expected = image.source?.sha256?.toLowerCase() || null;
    if (expected && expected !== sha256) throw new Error(`Corpus hash mismatch for ${image.id}: expected ${expected}, received ${sha256}`);
    results.push({
      id: image.id,
      path: relativePath.replaceAll('\\', '/'),
      bytes: bytes.length,
      sha256,
      license: image.source?.license || null,
      sourcePage: image.source?.page || null,
      upstreamSha1: image.source?.upstreamSha1 || null,
    });
  }
  return results;
}

function stableOutputHash(output) {
  const content = JSON.stringify({ width: output.width, height: output.height, palette: output.palette, cells: Array.from(output.cells) });
  return createHash('sha256').update(content).digest('hex');
}

function normalizeOutput(output, options) {
  if (!output || !Number.isInteger(output.width) || !Number.isInteger(output.height)) throw new Error('Adapter returned no integer dimensions');
  const cells = Array.from(output.cells || []);
  if (output.width !== options.width || output.height !== options.height) throw new Error(`Adapter dimensions ${output.width}x${output.height} do not match requested ${options.width}x${options.height}`);
  if (cells.length !== output.width * output.height) throw new Error(`Adapter returned ${cells.length} cells for ${output.width}x${output.height}`);
  if (!Array.isArray(output.palette) || output.palette.length < 1) throw new Error('Adapter returned no palette');
  return { width: output.width, height: output.height, palette: output.palette, cells, outputMetadata: output.outputMetadata || null };
}

async function loadAdapter(specifier) {
  const builtIn = new Map([
    ['current', 'current.mjs'],
    ['classic', 'classic.mjs'],
    ['paintable', 'paintable.mjs'],
  ]);
  const modulePath = builtIn.has(specifier)
    ? path.join(SCRIPT_DIR, 'adapters', builtIn.get(specifier))
    : path.isAbsolute(specifier) ? specifier : path.resolve(REPO_ROOT, specifier);
  const module = await import(pathToFileURL(modulePath).href);
  const adapter = module.default || module;
  if (typeof adapter.run !== 'function') throw new Error(`Adapter ${modulePath} must export run({ page, sourceUrl, options })`);
  return { id: adapter.id || path.basename(modulePath), run: adapter.run, modulePath };
}

async function waitForServer(url, child) {
  const deadline = Date.now() + 30000;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch (error) {
      lastError = error;
    }
    if (child.exitCode !== null) throw new Error(`Vite exited with code ${child.exitCode}`);
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`Timed out waiting for Vite at ${url}: ${lastError?.message || 'no response'}`);
}

async function startVite(port) {
  const viteBin = path.join(REPO_ROOT, 'node_modules', 'vite', 'bin', 'vite.js');
  const child = spawn(process.execPath, [viteBin, '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
    cwd: REPO_ROOT,
    env: { ...process.env, BROWSER: 'none' },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  const logs = [];
  child.stdout.on('data', (chunk) => logs.push(String(chunk).slice(-2000)));
  child.stderr.on('data', (chunk) => logs.push(String(chunk).slice(-2000)));
  const url = `http://127.0.0.1:${port}/`;
  try {
    await waitForServer(url, child);
  } catch (error) {
    child.kill();
    throw new Error(`${error.message}\n${logs.join('')}`);
  }
  return { child, url };
}

async function stopVite(child) {
  if (!child || child.killed) return;
  child.kill();
  await new Promise((resolve) => {
    const timeout = setTimeout(resolve, 1500);
    child.once('exit', () => { clearTimeout(timeout); resolve(); });
  });
}

async function sampleSourceMeans(page, sourceUrl, options) {
  return page.evaluate(async ({ url, options: buildOptions }) => {
    const image = new Image();
    image.src = url;
    await image.decode();
    const analysisScale = Math.max(1, Math.min(6, Math.floor(384 / Math.max(buildOptions.width, buildOptions.height))));
    const analysisWidth = buildOptions.width * analysisScale;
    const analysisHeight = buildOptions.height * analysisScale;
    const canvas = document.createElement('canvas');
    canvas.width = analysisWidth;
    canvas.height = analysisHeight;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.fillStyle = '#101820';
    context.fillRect(0, 0, analysisWidth, analysisHeight);
    const crop = buildOptions.crop;
    if (crop) {
      const cropSize = Math.min(image.naturalWidth, image.naturalHeight) / crop.scale;
      const cx = image.naturalWidth / 2 + crop.offsetX;
      const cy = image.naturalHeight / 2 + crop.offsetY;
      const sx = Math.max(0, Math.min(image.naturalWidth - cropSize, cx - cropSize / 2));
      const sy = Math.max(0, Math.min(image.naturalHeight - cropSize, cy - cropSize / 2));
      context.drawImage(image, sx, sy, cropSize, cropSize, 0, 0, analysisWidth, analysisHeight);
    } else {
      const sourceRatio = image.naturalWidth / image.naturalHeight;
      const targetRatio = analysisWidth / analysisHeight;
      const drawWidth = sourceRatio > targetRatio ? analysisWidth : analysisHeight * sourceRatio;
      const drawHeight = sourceRatio > targetRatio ? analysisWidth / sourceRatio : analysisHeight;
      context.drawImage(image, (analysisWidth - drawWidth) / 2, (analysisHeight - drawHeight) / 2, drawWidth, drawHeight);
    }
    const pixels = context.getImageData(0, 0, analysisWidth, analysisHeight).data;
    const means = [];
    for (let gridY = 0; gridY < buildOptions.height; gridY += 1) {
      const top = Math.floor((gridY * analysisHeight) / buildOptions.height);
      const bottom = Math.max(top + 1, Math.floor(((gridY + 1) * analysisHeight) / buildOptions.height));
      for (let gridX = 0; gridX < buildOptions.width; gridX += 1) {
        const left = Math.floor((gridX * analysisWidth) / buildOptions.width);
        const right = Math.max(left + 1, Math.floor(((gridX + 1) * analysisWidth) / buildOptions.width));
        const sum = [0, 0, 0];
        let count = 0;
        for (let y = top; y < bottom; y += 1) {
          for (let x = left; x < right; x += 1) {
            const offset = ((y * analysisWidth) + x) * 4;
            sum[0] += pixels[offset]; sum[1] += pixels[offset + 1]; sum[2] += pixels[offset + 2]; count += 1;
          }
        }
        const red = Math.round(sum[0] / count);
        const green = Math.round(sum[1] / count);
        const blue = Math.round(sum[2] / count);
        means.push((red << 16) | (green << 8) | blue);
      }
    }
    return means;
  }, { url: sourceUrl, options });
}

function sourcePathToUrl(relativePath) {
  const normalized = relativePath.replaceAll('\\', '/').replace(/^public\//, '');
  return `/${normalized}`;
}

function csvEscape(value) {
  const normalized = value === null || value === undefined ? '' : String(value);
  return /[",\n]/.test(normalized) ? `"${normalized.replaceAll('"', '""')}"` : normalized;
}

function buildCsv(rows) {
  const columns = [
    'adapter', 'stylePreset', 'pipelineVersion', 'resultFingerprint', 'image', 'category', 'license', 'sourcePage', 'sourceSha256', 'width', 'height', 'colors', 'runtimeMs', 'evaluationRuntimeMs', 'sourceSamplingMs', 'outputHash',
    'regions4', 'regions8', 'regionDensity4Per10k', 'regionDensity8Per10k', 'singletonCount', 'singletonAreaRatio',
    'tinyAreaRatio', 'highContrastTinyCount', 'lowContrastTinyCount', 'transitionRatio', 'compactnessMean', 'compactnessP90',
    'paletteUsed', 'paletteEntropyBits', 'meanDeltaE', 'edgePrecision', 'edgeRecall', 'idealRegionTaps', 'classicLowerBound',
    'conservativeManualTapLowerBound', 'previewCellPixels', 'readableCellRatio', 'labelsPotentiallyLegible', 'panel',
  ];
  const lines = [columns.join(',')];
  for (const row of rows) lines.push(columns.map((column) => csvEscape(row[column])).join(','));
  return `${lines.join('\n')}\n`;
}

function relativeDelta(candidate, baseline) {
  if (!Number.isFinite(candidate) || !Number.isFinite(baseline)) return null;
  if (baseline === 0) return candidate === 0 ? 0 : null;
  return (candidate - baseline) / baseline;
}

function buildComparison(baseline, candidate) {
  const deltas = {
    regions4: candidate.regions4 - baseline.regions4,
    regions4Relative: relativeDelta(candidate.regions4, baseline.regions4),
    tinyAreaRatio: candidate.tinyAreaRatio - baseline.tinyAreaRatio,
    transitionRatio: candidate.transitionRatio - baseline.transitionRatio,
    compactnessMean: candidate.compactnessMean - baseline.compactnessMean,
    idealRegionTaps: candidate.idealRegionTaps - baseline.idealRegionTaps,
    classicLowerBound: candidate.classicLowerBound - baseline.classicLowerBound,
    classicLowerBoundRelative: relativeDelta(candidate.classicLowerBound, baseline.classicLowerBound),
    meanDeltaE: Number.isFinite(candidate.meanDeltaE) && Number.isFinite(baseline.meanDeltaE) ? candidate.meanDeltaE - baseline.meanDeltaE : null,
    edgePrecision: Number.isFinite(candidate.edgePrecision) && Number.isFinite(baseline.edgePrecision) ? candidate.edgePrecision - baseline.edgePrecision : null,
    edgeRecall: Number.isFinite(candidate.edgeRecall) && Number.isFinite(baseline.edgeRecall) ? candidate.edgeRecall - baseline.edgeRecall : null,
    runtimeMs: candidate.runtimeMs - baseline.runtimeMs,
    runtimeRelative: relativeDelta(candidate.runtimeMs, baseline.runtimeMs),
    previewCellPixels: candidate.previewCellPixels - baseline.previewCellPixels,
  };
  const regressions = [];
  const improvements = [];
  const unavailableMetrics = [];
  if (deltas.classicLowerBoundRelative !== null && deltas.classicLowerBoundRelative > 0.05 && deltas.classicLowerBound > 5) regressions.push('effort_lower_bound_gt_5pct');
  if (deltas.transitionRatio > 0.01) regressions.push('transition_ratio_gt_1pp');
  if (deltas.tinyAreaRatio > 0.005) regressions.push('tiny_area_ratio_gt_0_5pp');
  if (deltas.edgeRecall !== null && deltas.edgeRecall < -0.03) regressions.push('edge_recall_down_gt_3pp');
  if (deltas.edgePrecision !== null && deltas.edgePrecision < -0.03) regressions.push('edge_precision_down_gt_3pp');
  if (deltas.meanDeltaE !== null && deltas.meanDeltaE > 0.75) regressions.push('mean_delta_e_up_gt_0_75');
  if (deltas.runtimeRelative !== null && deltas.runtimeRelative > 2 && deltas.runtimeMs > 500) regressions.push('runtime_gt_3x_and_500ms');
  if (deltas.classicLowerBoundRelative !== null && deltas.classicLowerBoundRelative < -0.1) improvements.push('effort_lower_bound_down_gt_10pct');
  if (deltas.transitionRatio < -0.01) improvements.push('transition_ratio_down_gt_1pp');
  if (deltas.tinyAreaRatio < -0.005) improvements.push('tiny_area_ratio_down_gt_0_5pp');
  if (deltas.edgeRecall !== null && deltas.edgeRecall > 0.03) improvements.push('edge_recall_up_gt_3pp');
  if (deltas.edgePrecision !== null && deltas.edgePrecision > 0.03) improvements.push('edge_precision_up_gt_3pp');
  if (deltas.meanDeltaE !== null && deltas.meanDeltaE < -0.75) improvements.push('mean_delta_e_down_gt_0_75');
  for (const metric of ['meanDeltaE', 'edgePrecision', 'edgeRecall']) if (deltas[metric] === null) unavailableMetrics.push(metric);
  return {
    image: baseline.image,
    category: baseline.category,
    width: baseline.width,
    height: baseline.height,
    colors: baseline.colors,
    baselineAdapter: baseline.adapter,
    candidateAdapter: candidate.adapter,
    baselineHash: baseline.outputHash,
    candidateHash: candidate.outputHash,
    baselineRuntimeMs: baseline.runtimeMs,
    candidateRuntimeMs: candidate.runtimeMs,
    baselineRegions4: baseline.regions4,
    candidateRegions4: candidate.regions4,
    baselineClassicLowerBound: baseline.classicLowerBound,
    candidateClassicLowerBound: candidate.classicLowerBound,
    baselineTransitionRatio: baseline.transitionRatio,
    candidateTransitionRatio: candidate.transitionRatio,
    baselineTinyAreaRatio: baseline.tinyAreaRatio,
    candidateTinyAreaRatio: candidate.tinyAreaRatio,
    baselineMeanDeltaE: baseline.meanDeltaE,
    candidateMeanDeltaE: candidate.meanDeltaE,
    baselineEdgePrecision: baseline.edgePrecision,
    candidateEdgePrecision: candidate.edgePrecision,
    baselineEdgeRecall: baseline.edgeRecall,
    candidateEdgeRecall: candidate.edgeRecall,
    baselineLabelsPotentiallyLegible: baseline.labelsPotentiallyLegible,
    candidateLabelsPotentiallyLegible: candidate.labelsPotentiallyLegible,
    deltas,
    regressions,
    improvements,
    unavailableMetrics,
    panel: '',
  };
}

function buildComparisonCsv(comparisons) {
  const columns = [
    'image', 'category', 'width', 'height', 'colors', 'baselineAdapter', 'candidateAdapter',
    'baselineRegions4', 'candidateRegions4', 'baselineClassicLowerBound', 'candidateClassicLowerBound',
    'baselineTransitionRatio', 'candidateTransitionRatio', 'baselineTinyAreaRatio', 'candidateTinyAreaRatio',
    'baselineMeanDeltaE', 'candidateMeanDeltaE', 'baselineEdgePrecision', 'candidateEdgePrecision',
    'baselineEdgeRecall', 'candidateEdgeRecall', 'baselineRuntimeMs', 'candidateRuntimeMs',
    'baselineLabelsPotentiallyLegible', 'candidateLabelsPotentiallyLegible', 'regions4Delta',
    'classicLowerBoundRelativeDelta', 'transitionRatioDelta', 'tinyAreaRatioDelta', 'meanDeltaEDelta',
    'edgePrecisionDelta', 'edgeRecallDelta', 'runtimeRelativeDelta', 'regressions', 'improvements',
    'unavailableMetrics', 'baselineHash', 'candidateHash', 'panel',
  ];
  const rows = comparisons.map((comparison) => ({
    ...comparison,
    regions4Delta: comparison.deltas.regions4,
    classicLowerBoundRelativeDelta: comparison.deltas.classicLowerBoundRelative,
    transitionRatioDelta: comparison.deltas.transitionRatio,
    tinyAreaRatioDelta: comparison.deltas.tinyAreaRatio,
    meanDeltaEDelta: comparison.deltas.meanDeltaE,
    edgePrecisionDelta: comparison.deltas.edgePrecision,
    edgeRecallDelta: comparison.deltas.edgeRecall,
    runtimeRelativeDelta: comparison.deltas.runtimeRelative,
    regressions: comparison.regressions.join('|'),
    improvements: comparison.improvements.join('|'),
    unavailableMetrics: comparison.unavailableMetrics.join('|'),
  }));
  return `${[columns.join(','), ...rows.map((row) => columns.map((column) => csvEscape(row[column])).join(','))].join('\n')}\n`;
}

function getGitCommit() {
  try { return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: REPO_ROOT, encoding: 'utf8' }).trim(); } catch { return null; }
}

function generatedReadme({ manifest, adapters, options, outputDir, gitCommit, rows, comparisons, warnings }) {
  const adapterText = adapters.map((adapter) => `${adapter.id} (${adapter.modulePath})`).join(', ');
  return `# Pixelization evaluation evidence\n\n`
    + `Generated by scripts/pixelization-eval/run.mjs on ${new Date().toISOString()}.\n\n`
    + `- Adapters: ${adapterText}\n`
    + `- Git commit: ${gitCommit || 'unknown'}\n`
    + `- Manifest: ${path.relative(REPO_ROOT, manifest).replaceAll('\\', '/')}\n`
    + `- Options: ${JSON.stringify(options)}\n`
    + `- Output directory: ${path.relative(REPO_ROOT, outputDir).replaceAll('\\', '/')}\n`
    + `- Metric rows: ${rows.length}; paired comparisons: ${comparisons.length}; warnings: ${warnings.length}\n\n`
    + `This is a reproducible measurement and visual-comparison snapshot. It deliberately does not declare a winner. Human review is required for artistic quality, number readability, and paint feel.\n\n`
    + `Each row records a stable output hash, conversion runtime, 4/8-connected region statistics, normalized densities, tiny/high-contrast region signals, fragmentation, palette coherence, source comparison (when available), effort lower bounds, and number-readability proxies.\n\n`
    + `Comparison flags use explicit guardrails, not a composite score: effort >5% and >5 taps, transitions >1 percentage point, tiny area >0.5 percentage points, edge precision/recall down >3 points, mean DeltaE up >0.75, or runtime >3x and >500ms. Improvements use symmetric structural thresholds where applicable. Flags identify review cases; they are not a beauty ranking.\n`;
}

async function main() {
  const cli = parseArgs(process.argv.slice(2));
  const manifest = await loadJson(cli.manifest);
  const corpusValidation = await validateCorpusFiles(manifest);
  const defaults = manifest.defaults || {};
  const sizes = cli.sizes || defaults.sizes || [32, 160, 512];
  const colors = cli.colors || defaults.colors || 10;
  const adapterSpecs = cli.adapters?.length ? cli.adapters : [cli.adapter];
  if (adapterSpecs.length > 2) throw new Error('Comparison panels currently support one baseline and one candidate adapter');
  const adapters = await Promise.all(adapterSpecs.map(loadAdapter));
  await mkdir(cli.outputDir, { recursive: true });
  const panelDir = path.join(cli.outputDir, 'panels');
  await mkdir(panelDir, { recursive: true });

  let browser;
  let vite;
  const rows = [];
  const comparisons = [];
  const warnings = [];
  const startedAt = new Date().toISOString();
  const gitCommit = getGitCommit();
  const runOptions = { colors, sizes, crop: defaults.crop ?? null, yieldEvery: defaults.yieldEvery ?? 96, previewWidth: defaults.previewWidth ?? 320, previewHeight: defaults.previewHeight ?? 320 };
  try {
    const playwright = await import('@playwright/test');
    vite = await startVite(cli.port);
    browser = await playwright.chromium.launch({ headless: true });
    const page = await browser.newPage({ deviceScaleFactor: 1 });
    await page.goto(vite.url, { waitUntil: 'domcontentloaded' });
    for (const image of manifest.images || []) {
      const sourceUrl = sourcePathToUrl(image.path);
      const imageSizes = cli.sizes || image.sizes || sizes;
      for (const size of imageSizes) {
        const options = { width: size, height: size, colors, crop: runOptions.crop, yieldEvery: runOptions.yieldEvery };
        const sampleStarted = performance.now();
        let sourceMeans;
        try {
          sourceMeans = await sampleSourceMeans(page, sourceUrl, options);
        } catch (error) {
          warnings.push(`${image.id}@${size}: source means unavailable: ${error.message}`);
          sourceMeans = null;
        }
        const sourceSamplingMs = performance.now() - sampleStarted;
        const evaluated = [];
        for (const adapter of adapters) {
          let output;
          const conversionStarted = performance.now();
          try {
            output = normalizeOutput(await adapter.run({ page, sourceUrl, options }), options);
          } catch (error) {
            warnings.push(`${image.id}@${size}:${adapter.id}: adapter failed: ${error.message}`);
            console.error(`FAILED ${image.id}@${size}:${adapter.id}: ${error.message}`);
            continue;
          }
          const runtimeMs = performance.now() - conversionStarted;
          const evaluationStarted = performance.now();
          const raster = { ...output, sourceMeans };
          const metrics = evaluateRaster(raster, { numberReadability: { previewWidth: runOptions.previewWidth, previewHeight: runOptions.previewHeight } });
          const evaluationRuntimeMs = performance.now() - evaluationStarted;
          const outputHash = stableOutputHash(output);
          const flat = flattenMetricRow(metrics);
          const metadata = output.outputMetadata || {};
          const row = {
            adapter: adapter.id,
            stylePreset: metadata.stylePreset || adapter.id,
            pipelineVersion: metadata.pipelineVersion || null,
            resultFingerprint: metadata.resultFingerprint || null,
            producerMetrics: metadata.producerMetrics || null,
            image: image.id,
            category: image.category,
            tags: image.tags || [],
            license: image.source?.license || null,
            sourcePage: image.source?.page || null,
            sourceSha256: corpusValidation.find((entry) => entry.id === image.id)?.sha256 || null,
            width: size,
            height: size,
            colors,
            runtimeMs: Math.round(runtimeMs * 1000) / 1000,
            evaluationRuntimeMs: Math.round(evaluationRuntimeMs * 1000) / 1000,
            sourceSamplingMs: Math.round(sourceSamplingMs * 1000) / 1000,
            outputHash,
            panel: '',
            metricVector: metrics,
            ...flat,
          };
          if (adapters.length === 1 && !cli.skipPanels) {
            const panelName = `${image.id}-${size}x${size}.png`;
            const panelDataUrl = await renderPanel({ page, sourceUrl, output, metrics, title: `${image.id} · ${size}×${size} · ${adapter.id}` });
            const panelBytes = Buffer.from(panelDataUrl.split(',')[1], 'base64');
            await writeFile(path.join(panelDir, panelName), panelBytes);
            row.panel = path.posix.join('panels', panelName);
          }
          rows.push(row);
          evaluated.push({ adapter, output, metrics, row });
          console.log(`${image.id}@${size}:${adapter.id}: ${runtimeMs.toFixed(0)}ms, regions=${flat.regions4}, hash=${outputHash.slice(0, 12)}`);
        }
        if (adapters.length === 2 && evaluated.length === 2) {
          const comparison = buildComparison(evaluated[0].row, evaluated[1].row);
          if (!cli.skipPanels) {
            const panelName = `${image.id}-${size}x${size}-${adapters[0].id}-vs-${adapters[1].id}.png`;
            const panelDataUrl = await renderComparisonPanel({
              page,
              sourceUrl,
              baseline: { output: evaluated[0].output, metrics: evaluated[0].metrics, label: adapters[0].id },
              candidate: { output: evaluated[1].output, metrics: evaluated[1].metrics, label: adapters[1].id },
              comparison,
              title: `${image.id} · ${size}×${size} · ${adapters[0].id} vs ${adapters[1].id}`,
            });
            await writeFile(path.join(panelDir, panelName), Buffer.from(panelDataUrl.split(',')[1], 'base64'));
            comparison.panel = path.posix.join('panels', panelName);
            evaluated[0].row.panel = comparison.panel;
            evaluated[1].row.panel = comparison.panel;
          }
          comparisons.push(comparison);
        } else if (adapters.length === 2) {
          warnings.push(`${image.id}@${size}: paired comparison unavailable because ${evaluated.length}/2 adapters completed`);
        }
      }
    }
  } finally {
    await browser?.close();
    await stopVite(vite?.child);
  }

  const adversarial = Object.fromEntries(getAdversarialFixtures().map(({ id, raster }) => {
    const metrics = evaluateRaster(raster, { numberReadability: { previewWidth: 320, previewHeight: 320 } });
    return [id, { raster: { width: raster.width, height: raster.height }, metrics, flattened: flattenMetricRow(metrics) }];
  }));
  const summary = {
    schemaVersion: 'pixelization-evaluation-run.v2',
    generatedAt: new Date().toISOString(),
    startedAt,
    gitCommit,
    adapters: adapters.map(({ id, modulePath }) => ({ id, modulePath })),
    manifest: path.relative(REPO_ROOT, cli.manifest).replaceAll('\\', '/'),
    corpusValidation,
    options: runOptions,
    rows,
    comparisons,
    adversarial,
    warnings,
    noWinnerDeclared: true,
  };
  await writeFile(path.join(cli.outputDir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
  await writeFile(path.join(cli.outputDir, 'summary.csv'), buildCsv(rows));
  if (comparisons.length) await writeFile(path.join(cli.outputDir, 'comparisons.csv'), buildComparisonCsv(comparisons));
  await writeFile(path.join(cli.outputDir, 'README.md'), generatedReadme({
    manifest: cli.manifest,
    adapters,
    options: runOptions,
    outputDir: cli.outputDir,
    gitCommit,
    rows,
    comparisons,
    warnings,
  }));
  console.log(`Wrote ${rows.length} metric rows, ${comparisons.length} comparisons, and ${Object.keys(adversarial).length} adversarial fixtures to ${cli.outputDir}`);
  if (warnings.length) console.warn(`Warnings: ${warnings.length}`);
}

main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
});
