import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CORE_FEEL_REFERENCE_TEMPLATE_ID,
  getCoreFeelDevSubject,
  getCoreFeelFragmentForColor,
  getNextCoreFeelFragment,
  resolveCoreFeelExperiment,
} from '../src/features/coreFeel/coreFeelExperiment.js';

const template = {
  id: CORE_FEEL_REFERENCE_TEMPLATE_ID,
  width: 28,
  height: 28,
  cells: Array(28 * 28).fill(0),
};
template.cells[148] = 2;
template.cells[149] = 2;
template.cells[233] = 3;

test('core feel experiment is opt-in and resolves a shared variant profile', () => {
  assert.equal(resolveCoreFeelExperiment('').enabled, false);
  const experiment = resolveCoreFeelExperiment(
    '?coreFeel=b&coreSound=on&coreHaptics=off',
    { DEV: true },
  );
  assert.equal(experiment.enabled, true);
  assert.equal(experiment.variantId, 'b');
  assert.equal(experiment.variant.enhanced, true);
  assert.equal(experiment.soundEnabled, true);
  assert.equal(experiment.hapticsEnabled, false);
  assert.equal(resolveCoreFeelExperiment('?coreFeel=b', { PROD: true }).enabled, false);
  assert.equal(resolveCoreFeelExperiment('?coreFeel=b', {
    PROD: true,
    VITE_CORE_FEEL_EXPERIMENT_ENABLED: 'true',
  }).enabled, true);
});

test('dev subject override is narrow, validated and unavailable outside dev auth', () => {
  const search = '?coreFeel=a&coreSubject=corefeel_p01';
  assert.equal(getCoreFeelDevSubject(search, { DEV: true, VITE_ALLOW_DEV_AUTH: 'true' }), 'corefeel_p01');
  assert.equal(getCoreFeelDevSubject(search, { DEV: false, VITE_ALLOW_DEV_AUTH: 'true' }), null);
  assert.equal(getCoreFeelDevSubject('?coreFeel=a&coreSubject=../admin', { DEV: true, VITE_ALLOW_DEV_AUTH: 'true' }), null);
});

test('reference fragments preserve authored order and skip completed cells', () => {
  const filled = Array(28 * 28).fill(-1);
  const first = getNextCoreFeelFragment(template, filled);
  assert.equal(first.id, 'whale-head-contour');
  assert.deepEqual(first.cells, [148, 149]);
  filled[148] = 2;
  filled[149] = 2;
  const next = getNextCoreFeelFragment(template, filled);
  assert.equal(next.id, 'whale-face');
  assert.deepEqual(next.cells, [233]);
  assert.equal(getCoreFeelFragmentForColor(template, filled, 3).id, 'whale-face');
});
