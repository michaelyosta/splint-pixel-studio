/**
 * Reproducible browser-side comparison harness for the image -> pixelization
 * pipelines. It deliberately uses the same buildColoringFromImage function
 * as creation preview/final generation; it is not a beauty score.
 *
 * Usage (with Vite already running):
 *   node scripts/pixelization-corpus-benchmark.mjs --url http://127.0.0.1:5173
 *   node scripts/pixelization-corpus-benchmark.mjs --url ... --resolutions 192,384,512 --colors 8,12
 *   node scripts/pixelization-corpus-benchmark.mjs --url ... --full-cells
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';

const args = process.argv.slice(2);
const readArg = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const hasArg = (name) => args.includes(name);
const baseUrl = readArg('--url', 'http://127.0.0.1:5173');
const outputDir = resolve(readArg('--output', 'docs/evidence/pixelization-corpus'));
const resolutions = readArg('--resolutions', '192,384,512').split(',').map(Number).filter((value) => Number.isInteger(value) && value > 0);
const colorCounts = readArg('--colors', '8,12').split(',').map(Number).filter((value) => Number.isInteger(value) && value >= 2);
const styles = readArg('--styles', 'classic,paintable').split(',').filter((value) => ['classic', 'paintable', 'paintable-dither'].includes(value));
const includeCells = hasArg('--full-cells');

const corpus = [
  { id: 'portrait-lena', asset: '/assets/lena_art_avatar.jpg', type: 'portrait' },
  { id: 'animal-rare-beasts', asset: '/assets/rare_beasts_art.jpg', type: 'animal-high-detail' },
  { id: 'animal-neon-cat', asset: '/assets/catalog/neon-cat.png', type: 'animal-illustration' },
  { id: 'landscape-city', asset: '/assets/city_streets_art.jpg', type: 'landscape-gradient' },
  { id: 'landscape-fantasy', asset: '/assets/fantasy_worlds_art.jpg', type: 'landscape-silhouette' },
  { id: 'object-retro-arcade', asset: '/assets/retro_arcade_art.jpg', type: 'object-high-detail' },
  { id: 'illustration-astro-whale', asset: '/assets/catalog/astro-whale.png', type: 'simple-silhouette' },
  { id: 'illustration-alpine-train', asset: '/assets/catalog/alpine-train.png', type: 'gradient-illustration' },
];

function safeName(value) {
  return value.replace(/[^a-z0-9_-]+/gi, '-').toLowerCase();
}

async function writeDataUrl(filePath, dataUrl) {
  const match = String(dataUrl || '').match(/^data:[^;]+;base64,(.+)$/);
  if (!match) return false;
  await writeFile(filePath, Buffer.from(match[1], 'base64'));
  return true;
}

await mkdir(outputDir, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });

const manifest = {
  baseUrl,
  resolutions,
  colorCounts,
  styles,
  corpus,
  humanReviewRequired: true,
  note: 'Metrics and fingerprints are comparison evidence, not a subjective beauty verdict.',
  results: [],
};

for (const item of corpus) {
  for (const width of resolutions) {
    for (const colors of colorCounts) {
      for (const stylePreset of styles) {
        const result = await page.evaluate(async ({ asset, width: targetWidth, colors: requestedColors, style }) => {
          const module = await import('/src/lib/pixelColoring.js');
          try {
            const response = await fetch(asset);
            const blob = await response.blob();
            const file = new File([blob], asset.split('/').pop() || 'corpus-image', { type: blob.type });
            const data = await module.buildColoringFromImage(file, {
              width: targetWidth,
              height: targetWidth,
              colors: requestedColors,
              stylePreset: style,
              yieldEvery: 16,
            });
            return {
              width: data.width,
              height: data.height,
              palette: data.palette,
              cells: data.cells,
              previewDataUrl: data.previewDataUrl,
              originalDataUrl: data.originalDataUrl,
              pipelineVersion: data.pipelineVersion,
              stylePreset: data.stylePreset,
              resultFingerprint: data.resultFingerprint,
              previewPixelFingerprint: data.previewPixelFingerprint,
              metrics: data.metrics || null,
            };
          } catch (error) {
            return {
              error: {
                name: error?.name || 'Error',
                code: error?.code || null,
                message: error?.message || String(error),
              },
            };
          }
        }, { asset: item.asset, width, colors, style: stylePreset });

        const prefix = safeName(`${item.id}-${width}-${colors}-${stylePreset}`);
        if (result.error) {
          const summary = {
            corpusId: item.id,
            type: item.type,
            asset: item.asset,
            requestedWidth: width,
            requestedHeight: width,
            requestedColors: colors,
            requestedStylePreset: stylePreset,
            status: result.error.code === 'PAINTABLE_RESOLUTION_LIMIT' ? 'explicitly-limited' : 'failed',
            error: result.error,
          };
          await writeFile(resolve(outputDir, `${prefix}.json`), `${JSON.stringify(summary, null, 2)}\n`);
          manifest.results.push(summary);
          console.log(`${prefix}: ${summary.status} (${result.error.code || result.error.name})`);
          continue;
        }
        await writeDataUrl(resolve(outputDir, `${prefix}-original.png`), result.originalDataUrl);
        await writeDataUrl(resolve(outputDir, `${prefix}-preview.png`), result.previewDataUrl);
        const summary = {
          corpusId: item.id,
          type: item.type,
          asset: item.asset,
          width: result.width,
          height: result.height,
          palette: result.palette,
          pipelineVersion: result.pipelineVersion,
          stylePreset: result.stylePreset,
          resultFingerprint: result.resultFingerprint,
          previewPixelFingerprint: result.previewPixelFingerprint,
          metrics: result.metrics,
        };
        if (includeCells) summary.cells = result.cells;
        await writeFile(resolve(outputDir, `${prefix}.json`), `${JSON.stringify(summary, null, 2)}\n`);
        manifest.results.push(summary);
        console.log(`${prefix}: ${result.resultFingerprint}`);
      }
    }
  }
}

await writeFile(resolve(outputDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
await browser.close();
console.log(`Wrote ${manifest.results.length} comparisons to ${outputDir}`);
