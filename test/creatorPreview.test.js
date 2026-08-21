import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CREATOR_PREVIEW_RESOLUTIONS,
  buildCreatorPreviewError,
  buildCreatorPreviewCacheKey,
  deriveCreatorPreviewInsights,
  isCreatorPreviewCurrent,
  renderCreatorNumberGridPreview,
} from '../src/lib/imageCrop.js';

test('creator exposes only the supported recovery preview resolutions', () => {
  assert.deepEqual(CREATOR_PREVIEW_RESOLUTIONS, [192, 512, 1024, 1200]);
});

test('preview cache identity includes file, resolution, crop, colors, and style', () => {
  const base = {
    fileToken: 'portrait.png:123:456',
    width: 192,
    colors: 10,
    cropMode: 'fit',
    stylePreset: 'paintable',
  };
  const key = buildCreatorPreviewCacheKey(base);
  assert.notEqual(key, buildCreatorPreviewCacheKey({ ...base, width: 512 }));
  assert.notEqual(key, buildCreatorPreviewCacheKey({ ...base, colors: 12 }));
  assert.notEqual(key, buildCreatorPreviewCacheKey({ ...base, fileToken: 'animal.png:123:456' }));
  assert.notEqual(key, buildCreatorPreviewCacheKey({
    ...base,
    cropMode: 'crop',
    crop: { scale: 1.2, offsetX: 3, offsetY: -2 },
  }));
  assert.equal(isCreatorPreviewCurrent(7, 7), true);
  assert.equal(isCreatorPreviewCurrent(7, 8), false);
});

test('failed preview clears stale evidence and exposes the bounded error', () => {
  const result = buildCreatorPreviewError({
    resolution: 1200,
    status: 'computing',
    pixel: 'data:image/png;base64,stale',
    numbered: 'data:image/png;base64,stale-numbered',
    palette: ['#ffffff'],
    resultFingerprint: 'stale-result',
  }, {
    code: 'PAINTABLE_RESOLUTION_LIMIT',
    message: 'paintable-v1 supports at most 512x512 logical cells',
  });
  assert.equal(result.resolution, 1200);
  assert.equal(result.status, 'error');
  assert.equal(result.progress, 0);
  assert.equal(result.pixel, null);
  assert.equal(result.numbered, null);
  assert.deepEqual(result.palette, []);
  assert.equal(result.resultFingerprint, null);
  assert.deepEqual(result.error, {
    code: 'PAINTABLE_RESOLUTION_LIMIT',
    message: 'paintable-v1 supports at most 512x512 logical cells',
  });
});

test('paintability insight penalizes fragmentation and tiny regions', () => {
  const coherent = deriveCreatorPreviewInsights({
    width: 192,
    height: 192,
    palette: ['#111111', '#eeeeee'],
    cells: Array(192 * 192).fill(0),
    metrics: {
      regionCount: 12,
      meanRegionSize: 3072,
      tinyRegionRatio: 0,
      microRegionRatio: 0,
      edgeRetention: 0.95,
      predictedEffort: 12,
    },
  });
  const fragmented = deriveCreatorPreviewInsights({
    width: 192,
    height: 192,
    palette: ['#111111', '#eeeeee'],
    cells: Array.from({ length: 192 * 192 }, (_, index) => index % 2),
    metrics: {
      regionCount: 9000,
      meanRegionSize: 4,
      tinyRegionRatio: 0.09,
      microRegionRatio: 0.35,
      edgeRetention: 0.6,
      predictedEffort: 9000,
    },
  });
  assert.ok(coherent.paintabilityScore > fragmented.paintabilityScore);
  assert.equal(coherent.numberReadability, 'Высокая');
  assert.equal(fragmented.numberReadability, 'Только при увеличении');
});

test('1200 number preview stays on a bounded 12 by 12 crop', { concurrency: false }, () => {
  const previousDocument = globalThis.document;
  const calls = { fillText: 0, fillRect: 0 };
  const context = {
    fillRect() { calls.fillRect += 1; },
    strokeRect() {},
    fillText() { calls.fillText += 1; },
  };
  const canvas = {
    width: 0,
    height: 0,
    getContext() { return context; },
    toDataURL() { return 'data:image/png;base64,bounded'; },
  };
  globalThis.document = { createElement: () => canvas };
  try {
    const cells = Array(1200 * 1200).fill(0);
    const result = renderCreatorNumberGridPreview(1200, 1200, ['#abcdef'], cells);
    assert.equal(result, 'data:image/png;base64,bounded');
    assert.equal(canvas.width, 480);
    assert.equal(canvas.height, 480);
    assert.equal(calls.fillText, 12 * 12);
    assert.equal(calls.fillRect, 1 + (12 * 12 * 2));
  } finally {
    globalThis.document = previousDocument;
  }
});
