import test from 'node:test';
import assert from 'node:assert/strict';
import { buildReport } from '../scripts/content-quality-audit.mjs';

test('content audit attaches only exact pixelization evidence and keeps unknown rows classic', () => {
  const report = buildReport([
    {
      id: 'fixture-paintable',
      title: 'Paintable fixture',
      collection_id: 'pack-a',
      theme: 'cozy',
      mood: 'calm',
      width: 192,
      height: 192,
      difficulty: 'easy',
      est_minutes: 3,
      palette: ['#000000', '#ffffff'],
      cells: Array(192 * 192).fill(0),
      pixelization_source_id: 'fixture',
    },
    {
      id: 'fixture-unknown',
      title: 'Unknown fixture',
      collection_id: 'pack-a',
      width: 512,
      height: 512,
      difficulty: 'medium',
      est_minutes: 5,
      palette: ['#000000', '#ffffff'],
      cells: Array(512 * 512).fill(0),
    },
  ], {
    policyVersion: 'pixelization-routing-v1',
    source: { gitCommit: 'fixture' },
    entries: [{
      image: 'fixture',
      width: 192,
      height: 192,
      recommendation: {
        decision: 'paintable',
        status: 'provisional-positive',
        confidence: 'medium',
        reasons: ['effort-improvement-within-guardrails'],
      },
    }],
  });
  const positive = report.entries.find((entry) => entry.id === 'fixture-paintable');
  const unknown = report.entries.find((entry) => entry.id === 'fixture-unknown');
  assert.equal(positive.pixelization_evidence.status, 'provisional-positive');
  assert.equal(positive.content_metadata.style.route, 'paintable');
  assert.equal(unknown.pixelization_evidence, null);
  assert.equal(unknown.content_metadata.style.route, 'classic');
  assert.equal(unknown.content_metadata.style.status, 'unassessed');
  assert.equal(report.summary.attached_pixelization_rows, 1);
});

test('audit does not treat preview dimensions as logical paintable evidence', () => {
  const report = buildReport([{
    id: 'preview-only',
    title: 'Preview only',
    width: 512,
    height: 512,
    difficulty: 'medium',
    est_minutes: 6,
    palette: ['#000000', '#ffffff'],
    cells: Array(512 * 512).fill(0),
    pixelization_source_id: 'fixture',
  }], {
    entries: [{
      image: 'fixture',
      width: 320,
      height: 320,
      recommendation: { decision: 'paintable', status: 'provisional-positive' },
    }],
  });
  assert.equal(report.entries[0].pixelization_evidence, null);
  assert.equal(report.entries[0].content_metadata.style.route, 'classic');
});

