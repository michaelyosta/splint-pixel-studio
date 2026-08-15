import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PIXELIZATION_PIPELINES,
  PAINTABLE_LIMITS,
  buildColoringFromImage,
  buildPaintableCells,
  buildPalette,
  buildPreviewPixelBuffer,
  cleanUpSmallRegions,
  edgeAwareSmoothColors,
  findRewardingColor,
  fingerprintPixelizationResult,
  fingerprintPreviewPixels,
  getProgress,
  isProgressComplete,
  normalizeHex,
  sampleGridColors,
  sampleGridColorsRobust,
} from '../src/lib/pixelColoring.js';

test('getProgress counts only correctly filled cells', () => {
  const result = getProgress([0, 1, 2, 1], [0, -1, 0, 1]);
  assert.deepEqual(result, { completed: 2, total: 4, percent: 50 });
});

test('isProgressComplete does not treat a rounded display percentage as completion', () => {
  const progress = getProgress(Array(576).fill(0), [...Array(575).fill(0), -1]);
  assert.equal(progress.percent, 100);
  assert.equal(isProgressComplete(progress), false);
});

test('normalizeHex clamps and serializes RGB values', () => {
  assert.equal(normalizeHex(0, 181, 216), '#00b5d8');
  assert.equal(normalizeHex(-2, 260, 15), '#00ff0f');
});

test('findRewardingColor starts with the shortest unfinished color task', () => {
  const template = { palette: ['#000000', '#ffffff', '#ff0000'], cells: [0, 0, 0, 1, 1, 2] };
  assert.equal(findRewardingColor(template, Array(6).fill(-1)), 2);
});

test('buildPalette preserves a rare high-contrast accent', () => {
  const pixels = [...Array(90).fill([15, 20, 30]), ...Array(10).fill([250, 70, 40])];
  const palette = buildPalette(pixels, 2);
  assert.equal(palette.length, 2);
  assert.ok(palette.some((color) => color[0] > 200 && color[1] < 100));
});

test('cleanUpSmallRegions merges a tiny low-contrast noise region', () => {
  const cells = [0, 0, 0, 0, 1, 0, 0, 0, 0];
  const cleaned = cleanUpSmallRegions(cells, 3, 3, [[100, 110, 120], [104, 113, 121]]);
  assert.deepEqual(cleaned, Array(9).fill(0));
});

test('cleanUpSmallRegions keeps a tiny high-contrast accent', () => {
  const cells = [0, 0, 0, 0, 1, 0, 0, 0, 0];
  const cleaned = cleanUpSmallRegions(cells, 3, 3, [[230, 230, 230], [15, 20, 25]]);
  assert.equal(cleaned[4], 1);
});

test('sampleGridColors averages high-resolution source pixels into grid cells', () => {
  const pixels = new Uint8ClampedArray([
    10, 20, 30, 255, 30, 40, 50, 255,
    50, 60, 70, 255, 70, 80, 90, 255,
  ]);
  assert.deepEqual(sampleGridColors(pixels, 2, 2, 1, 1), [[40, 50, 60]]);
});

test('edgeAwareSmoothColors smooths texture but preserves a strong boundary', () => {
  const smoothed = edgeAwareSmoothColors([
    [100, 100, 100], [104, 101, 100], [225, 225, 225],
    [101, 99, 102], [103, 102, 101], [224, 226, 225],
  ], 3, 2);
  assert.ok(smoothed[0][0] < 110);
  assert.ok(smoothed[2][0] > 210);
});

function makeGrid(width, height, callback) {
  return Array.from({ length: width * height }, (_, index) => callback(index % width, Math.floor(index / width)));
}

function independentlyMeasureRegions(width, height, cells, microLimit) {
  const visited = new Uint8Array(cells.length);
  const sizes = [];
  for (let start = 0; start < cells.length; start += 1) {
    if (visited[start]) continue;
    const color = cells[start];
    const stack = [start];
    visited[start] = 1;
    let size = 0;
    while (stack.length) {
      const index = stack.pop();
      size += 1;
      const x = index % width;
      const y = Math.floor(index / width);
      const neighbours = [];
      if (x > 0) neighbours.push(index - 1);
      if (x < width - 1) neighbours.push(index + 1);
      if (y > 0) neighbours.push(index - width);
      if (y < height - 1) neighbours.push(index + width);
      for (const neighbour of neighbours) {
        if (!visited[neighbour] && cells[neighbour] === color) {
          visited[neighbour] = 1;
          stack.push(neighbour);
        }
      }
    }
    sizes.push(size);
  }
  return {
    regionCount: sizes.length,
    meanRegionSize: cells.length / sizes.length,
    tinyRegionRatio: sizes.filter((size) => size <= 2).reduce((sum, size) => sum + size, 0) / cells.length,
    microRegionRatio: sizes.filter((size) => size <= microLimit).reduce((sum, size) => sum + size, 0) / cells.length,
  };
}

function assertMetricsMatchCells(width, height, result) {
  const measured = independentlyMeasureRegions(width, height, result.cells, result.metrics.minRegionSize);
  assert.equal(result.metrics.regionCount, measured.regionCount);
  assert.equal(result.metrics.meanRegionSize, measured.meanRegionSize);
  assert.equal(result.metrics.tinyRegionRatio, measured.tinyRegionRatio);
  assert.equal(result.metrics.microRegionRatio, measured.microRegionRatio);
}

const CLASSIC_GOLDEN_5D21FD6 = Object.freeze({
  palette: ['#1e1e1e', '#e6e6e6'],
  cells: [
    0, 0, 1, 1,
    0, 0, 1, 1,
    0, 0, 1, 1,
    0, 0, 1, 1,
  ],
  resultFingerprint: 'px128-0bbe0cfeed445b16cfa14b860396e25a',
});

test('paintable sampling rejects a single source outlier inside a cell', () => {
  const pixels = new Uint8ClampedArray(4 * 4 * 4);
  for (let index = 0; index < 16; index += 1) {
    pixels[index * 4] = 100;
    pixels[(index * 4) + 1] = 100;
    pixels[(index * 4) + 2] = 100;
    pixels[(index * 4) + 3] = 255;
  }
  pixels[0] = 255;
  pixels[1] = 0;
  pixels[2] = 0;
  assert.deepEqual(sampleGridColorsRobust(pixels, 4, 4, 1, 1)[0], [100, 100, 100]);
});

test('paintable candidate keeps a strong silhouette boundary', () => {
  const source = makeGrid(8, 4, (x) => (x < 4 ? [20, 20, 20] : [240, 240, 240]));
  const result = buildPaintableCells(source, 8, 4, 2, { minRegionSize: 2 });
  for (let y = 0; y < 4; y += 1) assert.notEqual(result.cells[(y * 8) + 3], result.cells[(y * 8) + 4]);
  assert.equal(result.metrics.edgeRetention, 1);
});

test('paintable edge metrics cover vertical adjacency and do not invent a perfect no-edge score', () => {
  const horizontalBoundary = makeGrid(4, 8, (_x, y) => (y < 4 ? [20, 20, 20] : [240, 240, 240]));
  const edged = buildPaintableCells(horizontalBoundary, 4, 8, 2, { minRegionSize: 2 });
  assert.equal(edged.metrics.strongEdgeCount, 4);
  assert.equal(edged.metrics.retainedStrongEdgeCount, 4);
  assert.equal(edged.metrics.edgeRetention, 1);

  const flat = buildPaintableCells(makeGrid(4, 4, () => [100, 100, 100]), 4, 4, 2);
  assert.equal(flat.metrics.strongEdgeCount, 0);
  assert.equal(flat.metrics.edgeRetention, null);
  assert.equal(flat.metrics.effortLowerBound.minimumManualStrokes, flat.metrics.regionCount);
  assert.equal('predictedEffort' in flat.metrics, false);
});

test('paintable cleanup removes micro, snake, and checkerboard fragmentation', () => {
  const noisy = makeGrid(6, 6, (x, y) => ((x + y) % 2 ? [250, 250, 250] : [20, 20, 20]));
  const result = buildPaintableCells(noisy, 6, 6, 2, { minRegionSize: 2, regularizationIterations: 0 });
  assert.equal(result.metrics.regionCount, 1);

  const snake = makeGrid(7, 7, (x, y) => (x === 3 && y >= 2 && y <= 4 ? [120, 120, 120] : [100, 100, 100]));
  const snakeResult = buildPaintableCells(snake, 7, 7, 2, { minRegionSize: 2, regularizationIterations: 0 });
  assert.equal(snakeResult.metrics.regionCount, 1);
});

test('paintable metrics describe final cells after the last default merge pass', () => {
  let seed = 0x5d21fd6;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 0x100000000;
  };
  const source = makeGrid(31, 23, (x, y) => [
    30 + Math.floor(random() * 170),
    25 + ((x * 7 + y * 11) % 180),
    40 + Math.floor(random() * 150),
  ]);
  const result = buildPaintableCells(source, 31, 23, 8);
  assertMetricsMatchCells(31, 23, result);
});

test('paintable metrics are recomputed after maxMergePasses one', () => {
  const source = makeGrid(6, 6, (x, y) => ((x + y) % 2 ? [250, 250, 250] : [20, 20, 20]));
  const result = buildPaintableCells(source, 6, 6, 2, {
    minRegionSize: 2,
    regularizationIterations: 0,
    maxMergePasses: 1,
  });
  assert.equal(result.metrics.regionCount, 1);
  assertMetricsMatchCells(6, 6, result);
});

test('paintable cleanup never teleports a global colour across a region boundary', () => {
  const source = makeGrid(5, 5, (x, y) => {
    if (x === 2 && y === 2) return [220, 220, 220];
    if ((x === 2 && Math.abs(y - 2) === 1) || (y === 2 && Math.abs(x - 2) === 1)) return [120, 120, 120];
    return [10, 10, 10];
  });
  const result = buildPaintableCells(source, 5, 5, 3, {
    minRegionSize: 2,
    regularizationIterations: 0,
    maxMergePasses: 1,
  });
  assert.equal(result.palette[result.cells[12]], '#787878', 'centre may merge only into its mid-grey boundary colour');
});

test('paintable candidate preserves a coherent high-contrast accent', () => {
  const source = makeGrid(5, 5, (x, y) => (x === 2 && y === 2 ? [250, 40, 40] : [220, 220, 220]));
  const result = buildPaintableCells(source, 5, 5, 2, { minRegionSize: 2, regularizationIterations: 0 });
  assert.notEqual(result.cells[12], result.cells[0]);
  assert.equal(result.metrics.regionCount, 2);
});

test('paintable candidate is deterministic and exposes its pipeline identity', () => {
  const source = makeGrid(12, 9, (x, y) => [20 + (x * 11), 30 + (y * 9), 80 + ((x + y) * 3)]);
  const first = buildPaintableCells(source, 12, 9, 5, { minRegionSize: 3 });
  const second = buildPaintableCells(source, 12, 9, 5, { minRegionSize: 3 });
  assert.deepEqual(first.palette, second.palette);
  assert.deepEqual(first.cells, second.cells);
  assert.equal(PIXELIZATION_PIPELINES.paintable, 'paintable-v1');
});

test('optional ordered dither remains bounded by the paintable cleanup budget', () => {
  const source = makeGrid(24, 24, (x, y) => [80 + ((x + y) * 2), 100 + ((x + y) * 2), 120 + ((x + y) * 2)]);
  const result = buildPaintableCells(source, 24, 24, 4, {
    ditherMode: 'ordered',
    minRegionSize: 3,
    regularizationIterations: 0,
  });
  assert.ok(result.metrics.tinyRegionRatio < 0.1);
  assert.ok(result.metrics.regionCount < 100);
});

test('paintable candidate checks cooperative cancellation', () => {
  let checks = 0;
  assert.throws(
    () => buildPaintableCells(Array.from({ length: 64 * 64 }, () => [100, 100, 100]), 64, 64, 4, {
      checkCancelled: () => {
        checks += 1;
        if (checks >= 1) throw Object.assign(new Error('cancelled'), { name: 'AbortError' });
      },
    }),
    { name: 'AbortError' },
  );
});

test('paintable candidate stays bounded on a representative small benchmark', () => {
  const source = makeGrid(64, 64, (x, y) => [x * 3, y * 3, (x + y) * 2]);
  const started = performance.now();
  const result = buildPaintableCells(source, 64, 64, 8, { minRegionSize: 8 });
  const duration = performance.now() - started;
  assert.equal(result.cells.length, 64 * 64);
  assert.ok(duration < 1500, `candidate took ${duration.toFixed(1)}ms`);
});

test('pixelization fingerprints are wide, typed, delimited, and preview-specific', () => {
  const base = {
    width: 2,
    height: 2,
    palette: ['#000000', '#ffffff'],
    cells: [0, 1, 1, 0],
    stylePreset: 'paintable',
    pipelineVersion: PIXELIZATION_PIPELINES.paintable,
  };
  const fingerprint = fingerprintPixelizationResult(base);
  assert.match(fingerprint, /^px128-[0-9a-f]{32}$/);
  assert.equal(fingerprint, fingerprintPixelizationResult({ ...base }));
  assert.notEqual(fingerprint, fingerprintPixelizationResult({ ...base, width: 1, height: 4 }));
  assert.notEqual(fingerprint, fingerprintPixelizationResult({ ...base, cells: [0, 1, 0, 1] }));
  assert.notEqual(fingerprint, fingerprintPixelizationResult({ ...base, palette: ['#000001', '#ffffff'] }));
  assert.notEqual(fingerprint, fingerprintPixelizationResult({ ...base, stylePreset: 'classic' }));

  const previewPixels = buildPreviewPixelBuffer(base.width, base.height, base.palette, base.cells);
  const previewFingerprint = fingerprintPreviewPixels(base.width, base.height, previewPixels);
  assert.match(previewFingerprint, /^rgba128-[0-9a-f]{32}$/);
  assert.notEqual(previewFingerprint, fingerprint);
});

test('browser pipeline fingerprints the same cells used by preview and supports cancellation', async () => {
  const previous = {
    OffscreenCanvas: globalThis.OffscreenCanvas,
    createImageBitmap: globalThis.createImageBitmap,
    FileReader: globalThis.FileReader,
  };
  const putBuffers = [];
  let bitmapCalls = 0;
  class MockContext {
    constructor(width, height) {
      this.width = width;
      this.height = height;
      this.imageSmoothingEnabled = false;
      this.imageSmoothingQuality = 'low';
    }

    fillRect() {}

    drawImage() {}

    getImageData() {
      const data = new Uint8ClampedArray(this.width * this.height * 4);
      for (let index = 0; index < this.width * this.height; index += 1) {
        const x = index % this.width;
        const value = x < this.width / 2 ? 30 : 230;
        data[index * 4] = value;
        data[(index * 4) + 1] = value;
        data[(index * 4) + 2] = value;
        data[(index * 4) + 3] = 255;
      }
      return { data };
    }

    createImageData(width, height) {
      return { data: new Uint8ClampedArray(width * height * 4) };
    }

    putImageData(imageData) {
      putBuffers.push({ width: this.width, height: this.height, data: Uint8ClampedArray.from(imageData.data) });
    }
  }
  globalThis.OffscreenCanvas = class MockCanvas {
    constructor(width, height) {
      this.width = width;
      this.height = height;
      this.context = new MockContext(width, height);
    }

    getContext() { return this.context; }

    toDataURL() { return 'data:image/png;base64,AA=='; }
  };
  globalThis.createImageBitmap = async () => {
    bitmapCalls += 1;
    return { width: 4, height: 4, close() {} };
  };
  let originalReads = 0;
  globalThis.FileReader = class MockFileReader {
    readAsDataURL() {
      originalReads += 1;
      this.result = 'data:image/png;base64,AA==';
      this.onload?.();
    }
  };
  try {
    const progress = [];
    const result = await buildColoringFromImage(new Blob(['source']), {
      width: 4,
      height: 4,
      colors: 2,
      stylePreset: 'paintable',
      yieldEvery: 1,
      onProgress: (event) => progress.push(event.stage),
    });
    assert.equal(result.pipelineVersion, PIXELIZATION_PIPELINES.paintable);
    assert.equal(typeof result.resultFingerprint, 'string');
    const expectedPixels = buildPreviewPixelBuffer(result.width, result.height, result.palette, result.cells);
    const renderedPixels = putBuffers.find((entry) => entry.width === result.width && entry.height === result.height);
    assert.deepEqual(renderedPixels?.data, expectedPixels);
    assert.equal(result.previewPixelFingerprint, fingerprintPreviewPixels(result.width, result.height, expectedPixels));
    assert.notEqual(result.previewPixelFingerprint, result.resultFingerprint);
    assert.ok(progress.includes('complete'));
    assert.equal(originalReads, 1);

    const previewOnly = await buildColoringFromImage(new Blob(['source']), {
      width: 4,
      height: 4,
      colors: 2,
      stylePreset: 'paintable',
      includeOriginalDataUrl: false,
    });
    assert.equal(previewOnly.originalDataUrl, null);
    assert.equal(previewOnly.resultFingerprint, result.resultFingerprint);
    assert.equal(originalReads, 1, 'preview mode does not encode a second copy of the source image');

    const classic = await buildColoringFromImage(new Blob(['source']), {
      width: 4,
      height: 4,
      colors: 2,
      stylePreset: 'classic',
      yieldEvery: 1,
    });
    assert.deepEqual(classic.palette, CLASSIC_GOLDEN_5D21FD6.palette);
    assert.deepEqual(classic.cells, CLASSIC_GOLDEN_5D21FD6.cells);
    assert.equal(classic.resultFingerprint, CLASSIC_GOLDEN_5D21FD6.resultFingerprint);

    const callsBeforeLimit = bitmapCalls;
    await assert.rejects(
      buildColoringFromImage(new Blob(['source']), {
        width: 1200,
        height: 1200,
        colors: 12,
        stylePreset: 'paintable',
      }),
      (error) => error?.code === 'PAINTABLE_RESOLUTION_LIMIT'
        && error.limit.maxCells === PAINTABLE_LIMITS.maxCells,
    );
    assert.equal(bitmapCalls, callsBeforeLimit, 'oversized paintable requests fail before image allocation');

    let checks = 0;
    await assert.rejects(
      buildColoringFromImage(new Blob(['source']), {
        width: 16,
        height: 16,
        colors: 4,
        stylePreset: 'paintable',
        yieldEvery: 1,
        shouldCancel: () => {
          checks += 1;
          return checks > 2;
        },
      }),
      { name: 'AbortError' },
    );
  } finally {
    globalThis.OffscreenCanvas = previous.OffscreenCanvas;
    globalThis.createImageBitmap = previous.createImageBitmap;
    globalThis.FileReader = previous.FileReader;
  }
});
