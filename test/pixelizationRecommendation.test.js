import test from 'node:test';
import assert from 'node:assert/strict';

import { buildRecommendation, DEFAULT_POLICY } from '../scripts/pixelization-eval/recommend.mjs';

function comparison(overrides = {}) {
  return {
    image: 'fixture',
    category: 'test',
    width: 512,
    height: 512,
    baselineAdapter: 'classic',
    candidateAdapter: 'paintable',
    baselineClassicLowerBound: 1000,
    candidateClassicLowerBound: 800,
    deltas: {
      classicLowerBoundRelative: -0.2,
      edgeRecall: 0,
      edgePrecision: 0,
      meanDeltaE: 0,
      tinyAreaRatio: 0,
      transitionRatio: 0,
      ...overrides,
    },
  };
}

test('recommendation accepts a paintable candidate only when effort improves and guardrails hold', () => {
  const report = buildRecommendation({ schemaVersion: 'test', comparisons: [comparison()] });
  assert.equal(report.entries[0].recommendation.decision, 'paintable');
  assert.equal(report.entries[0].recommendation.status, 'provisional-positive');
});

test('recommendation falls back to classic and marks review on edge recall regression', () => {
  const report = buildRecommendation({ comparisons: [comparison({ edgeRecall: -DEFAULT_POLICY.maxEdgeRecallDrop - 0.001 })] });
  assert.equal(report.entries[0].recommendation.decision, 'classic');
  assert.equal(report.entries[0].recommendation.status, 'human-review');
  assert.ok(report.entries[0].recommendation.reasons.includes('edge-recall-drop'));
});

test('recommendation does not treat preview scale as logical resolution', () => {
  const report = buildRecommendation({
    comparisons: [comparison()],
    options: { previewWidth: 320, previewHeight: 320 },
  });
  assert.equal(report.entries[0].width, 512);
  assert.match(report.logicalResolution.note, /render\/preview scale/);
});

test('resolution-limit warnings produce explicit classic fallback entries', () => {
  const report = buildRecommendation({
    comparisons: [],
    warnings: [
      'portrait@1200:paintable: adapter failed: PAINTABLE_RESOLUTION_LIMIT',
      'portrait@1200: paired comparison unavailable because 1/2 adapters completed',
    ],
  });
  assert.equal(report.entries.length, 1);
  assert.equal(report.entries[0].width, 1200);
  assert.equal(report.entries[0].recommendation.decision, 'classic');
  assert.equal(report.entries[0].recommendation.status, 'unavailable');
});

test('recommendation rejects malformed summaries instead of guessing', () => {
  assert.throws(() => buildRecommendation({}), /comparisons/);
});

