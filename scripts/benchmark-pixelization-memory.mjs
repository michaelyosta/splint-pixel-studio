/**
 * Deterministic worker-contract memory benchmark for the paintable pipeline.
 * It exercises buildColoringFromImage -> tiled payload -> quality assessment.
 * Browser image decoding/PNG compression are mocked, so this is engineering
 * evidence for allocation bounds rather than a physical-iOS memory claim.
 *
 * Usage:
 *   npm run benchmark:pixelization-memory
 *   npm run benchmark:pixelization-memory -- --sizes 192,512,1200
 */

import { performance } from 'node:perf_hooks';
import { buildColoringFromImage, PAINTABLE_LIMITS } from '../src/lib/pixelColoring.js';
import { createTiledTemplate } from '../src/lib/tiledTemplate.js';
import { assessQuality } from '../src/lib/creatorQuality.js';

const args = process.argv.slice(2);
const readArg = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const sizes = readArg('--sizes', '192,512')
  .split(',')
  .map(Number)
  .filter((value) => Number.isInteger(value) && value > 0);

function memorySnapshot() {
  const usage = process.memoryUsage();
  const megabytes = (bytes) => Number((bytes / (1024 * 1024)).toFixed(1));
  return {
    rssMb: megabytes(usage.rss),
    heapUsedMb: megabytes(usage.heapUsed),
    externalMb: megabytes(usage.external),
    arrayBuffersMb: megabytes(usage.arrayBuffers),
  };
}

class BenchmarkCanvas {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.context = {
      imageSmoothingEnabled: false,
      imageSmoothingQuality: 'low',
      fillStyle: '#000000',
      fillRect() {},
      drawImage() {},
      putImageData() {},
      createImageData: (imageWidth, imageHeight) => ({
        data: new Uint8ClampedArray(imageWidth * imageHeight * 4),
      }),
      getImageData: (_x, _y, imageWidth, imageHeight) => {
        const data = new Uint8ClampedArray(imageWidth * imageHeight * 4);
        for (let y = 0; y < imageHeight; y += 1) {
          for (let x = 0; x < imageWidth; x += 1) {
            const offset = ((y * imageWidth) + x) * 4;
            const checker = ((x >> 4) + (y >> 4)) % 2;
            data[offset] = (x * 17 + y * 3 + checker * 61) % 256;
            data[offset + 1] = (x * 5 + y * 11 + checker * 37) % 256;
            data[offset + 2] = (x * 7 + y * 13 + checker * 83) % 256;
            data[offset + 3] = 255;
          }
        }
        return { data };
      },
    };
  }

  getContext() {
    return this.context;
  }

  toDataURL() {
    return 'data:image/png;base64,';
  }
}

globalThis.OffscreenCanvas = BenchmarkCanvas;
globalThis.createImageBitmap = async () => ({ width: 1600, height: 1200, close() {} });
globalThis.FileReader = class {
  readAsDataURL() {
    this.result = 'data:image/png;base64,';
    queueMicrotask(() => this.onload?.());
  }
};

const results = [];
for (const size of sizes) {
  global.gc?.();
  const before = memorySnapshot();
  const startedAt = performance.now();
  try {
    const buildStartedAt = performance.now();
    const coloring = await buildColoringFromImage(new Blob(['benchmark']), {
      width: size,
      height: size,
      colors: 12,
      stylePreset: 'paintable',
      yieldEvery: 64,
    });
    const afterBuild = memorySnapshot();
    const tilesStartedAt = performance.now();
    const tiled = createTiledTemplate(coloring);
    const afterTiles = memorySnapshot();
    const qualityStartedAt = performance.now();
    const quality = assessQuality(coloring.width, coloring.height, coloring.palette, coloring.cells);
    const afterQuality = memorySnapshot();
    results.push({
      size,
      status: 'measured',
      durationsMs: {
        build: Number((tilesStartedAt - buildStartedAt).toFixed(1)),
        tiles: Number((qualityStartedAt - tilesStartedAt).toFixed(1)),
        quality: Number((performance.now() - qualityStartedAt).toFixed(1)),
        total: Number((performance.now() - startedAt).toFixed(1)),
      },
      memory: { before, afterBuild, afterTiles, afterQuality },
      output: {
        cells: coloring.cells.length,
        paletteSize: coloring.palette.length,
        regionCount: coloring.metrics.regionCount,
        tileCount: Object.keys(tiled.tiles).length,
        quality: quality.level,
        resultFingerprint: coloring.resultFingerprint,
        previewPixelFingerprint: coloring.previewPixelFingerprint,
      },
    });
  } catch (error) {
    results.push({
      size,
      status: error?.code === 'PAINTABLE_RESOLUTION_LIMIT' ? 'explicitly-limited' : 'failed',
      durationMs: Number((performance.now() - startedAt).toFixed(1)),
      memory: { before, after: memorySnapshot() },
      error: { name: error?.name, code: error?.code, message: error?.message },
    });
  }
}

console.log(JSON.stringify({
  benchmark: 'worker-contract-build-to-tiles-to-quality',
  physicalIosClaim: false,
  paintableLimits: PAINTABLE_LIMITS,
  results,
}, null, 2));
