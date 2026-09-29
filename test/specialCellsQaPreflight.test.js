import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateSpecialQaProgress, parseArgs } from '../scripts/check-special-cells-qa.mjs';

test('Special QA preflight accepts an explicit treatment override with candidates', () => {
  const result = evaluateSpecialQaProgress({
    template_id: 'tpl-1200',
    specials_experiment_group: 'treatment',
    special_diagnostics: {
      cohort_override: true,
      template_width: 1200,
      template_height: 1200,
      storage_mode: 'tiled',
      generation_version: 4,
      special_count: 7727,
      counts_by_kind: { spark: 1287, bomb: 3348 },
      counts_by_status: { unseen: 7727, offered: 0, consumed: 0, skipped: 0 },
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.cohort, 'treatment');
  assert.equal(result.override, true);
  assert.equal(result.template.width, 1200);
  assert.equal(result.candidates, 7727);
});

test('Special QA preflight rejects silent control and missing diagnostics', () => {
  const result = evaluateSpecialQaProgress({ specials_experiment_group: 'control' });
  assert.equal(result.ok, false);
  assert.ok(result.failures.some((failure) => failure.includes('expected treatment')));
  assert.ok(result.failures.some((failure) => failure.includes('diagnostics')));
  assert.ok(result.failures.some((failure) => failure.includes('override')));
});

test('Special QA preflight resolves a persisted Bomb offer at its server center', () => {
  const result = evaluateSpecialQaProgress({
    specials_experiment_group: 'treatment',
    special_offer: {
      kind: 'bomb',
      special_id: 'sc-bomb',
      offer_token: 'private-offer-token',
      center_x: 11,
      center_y: 23,
    },
    special_diagnostics: {
      cohort_override: true,
      special_count: 1,
    },
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.one_tap_resolution, {
    status: 'ready',
    action_type: 'use_bomb',
    option_selected: false,
    bomb_center_selected: { x: 11, y: 23 },
  });
  assert.doesNotMatch(JSON.stringify(result), /private-offer-token|sc-bomb/);
});

test('Special QA preflight blocks an active offer without a deterministic resolution', () => {
  const result = evaluateSpecialQaProgress({
    specials_experiment_group: 'treatment',
    special_offer: { kind: 'bomb', special_id: 'sc-bomb', offer_token: 'private-token' },
    special_diagnostics: { cohort_override: true, special_count: 1 },
  });
  assert.equal(result.ok, false);
  assert.equal(result.one_tap_resolution.status, 'blocked');
  assert.ok(result.failures.some((failure) => failure.includes('deterministic one-tap')));
});

test('Special QA preflight parses the explicit live-template contract', () => {
  assert.deepEqual(parseArgs([
    '--template', 'tpl-real', '--expect', 'control', '--user', 'qa-user', '--api', 'http://localhost:3999/',
  ]), {
    api: 'http://localhost:3999/',
    template: 'tpl-real',
    expectedCohort: 'control',
    user: 'qa-user',
  });
});
