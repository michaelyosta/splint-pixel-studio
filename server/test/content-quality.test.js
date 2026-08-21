import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildContentMetadata,
  deriveComplexityMetadata,
  deriveDurationMetadata,
  deriveStyleQualityMetadata,
} from '../services/content-quality.js';

test('short measured artwork receives a bounded, honest session label', () => {
  const metadata = buildContentMetadata({
    width: 16,
    height: 16,
    palette: ['#000000', '#ffffff'],
    cells: Array(16 * 16).fill(0),
    difficulty: 'easy',
    est_minutes: 3,
  });
  assert.equal(metadata.schema_version, 'content-metadata.v1');
  assert.equal(metadata.duration.band, 'short');
  assert.equal(metadata.duration.session_mode, 'quick');
  assert.equal(metadata.duration.confidence, 'editorial');
  assert.equal(metadata.complexity.confidence, 'measured');
  assert.equal(metadata.complexity.gate, 'pass');
  assert.equal(metadata.style.status, 'unassessed');
  assert.equal(metadata.quality_gate.status, 'review');
  assert.equal(metadata.quality_gate.blocking, false);
});

test('large tiled artwork is explicitly segmented without loading a full grid', () => {
  const metadata = buildContentMetadata({
    width: 1_200,
    height: 1_200,
    palette: ['#000000', '#ffffff'],
    cells: [],
    storage_mode: 'tiled',
    difficulty: 'hard',
    est_minutes: 3,
  }, {
    metrics: {
      totalCells: 1_440_000,
      connectedComponents: 1_400,
      maxComponentsPerColor: 900,
      smallRegionCount: 300,
      checkerboardScore: 0.01,
      estimatedMergeCost: 20_000,
    },
  });
  assert.equal(metadata.duration.band, 'long');
  assert.equal(metadata.duration.session_mode, 'segmented');
  assert.match(metadata.duration.label, /по сегментам/);
  assert.equal(metadata.complexity.confidence, 'supplied-metrics');
  assert.equal(metadata.complexity.gate, 'review');
});

test('fragmented raster is held by the existing public complexity budget', () => {
  const width = 16;
  const height = 16;
  const cells = Array.from({ length: width * height }, (_, index) => (index + Math.floor(index / width)) % 2);
  const metadata = buildContentMetadata({
    width,
    height,
    palette: ['#000000', '#ffffff'],
    cells,
    difficulty: 'medium',
  });
  assert.equal(metadata.complexity.gate, 'hold');
  assert.ok(metadata.quality_gate.reasons.includes('complexity-budget'));
});

test('exact pixelization evidence can opt a row into a provisional route', () => {
  const style = deriveStyleQualityMetadata({
    pixelization_recommendation: {
      decision: 'paintable',
      status: 'provisional-positive',
      confidence: 'medium',
      reasons: ['effort-improvement-within-guardrails'],
    },
  });
  assert.equal(style.route, 'paintable');
  assert.equal(style.status, 'provisional-positive');
  assert.match(style.label, /предварительно подходит/);
});

test('metadata helpers remain deterministic for editorial-only rows', () => {
  const template = { width: 32, height: 32, palette: Array(10).fill('#000000'), difficulty: 'medium', est_minutes: 4 };
  assert.deepEqual(deriveDurationMetadata(template), deriveDurationMetadata(template));
  assert.deepEqual(deriveComplexityMetadata(template), deriveComplexityMetadata(template));
});
