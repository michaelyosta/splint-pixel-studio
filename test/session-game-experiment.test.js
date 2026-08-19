import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getSessionGameDevSubject,
  isSessionGameSpecialAllowed,
  resolveSessionGameExperiment,
} from '../src/features/sessionGame/sessionGameExperiment.js';

test('session-game experiment stays disabled without an explicit session mode', () => {
  const experiment = resolveSessionGameExperiment('', { DEV: true });
  assert.equal(experiment.enabled, false);
  assert.equal(experiment.variantId, null);
});

test('treatment exposes only Spark and Artifact, while control exposes no specials', () => {
  const treatment = resolveSessionGameExperiment(
    '?phase2=session&phase2Variant=treatment&phase2Subject=phase2_test_01',
    { DEV: true },
  );
  const control = resolveSessionGameExperiment(
    '?phase2=session&phase2Variant=control&phase2Subject=phase2_test_02',
    { DEV: true },
  );
  assert.equal(treatment.enabled, true);
  assert.equal(treatment.mode, 'session-game');
  assert.deepEqual(treatment.variant.allowedSpecialKinds, ['spark', 'artifact']);
  assert.equal(treatment.subjectId, 'phase2_test_01');
  assert.equal(isSessionGameSpecialAllowed(treatment, 'spark'), true);
  assert.equal(isSessionGameSpecialAllowed(treatment, 'artifact'), true);
  assert.equal(isSessionGameSpecialAllowed(treatment, 'bomb'), false);
  assert.equal(isSessionGameSpecialAllowed(control, 'spark'), false);
  assert.equal(isSessionGameSpecialAllowed(control, 'artifact'), false);
});

test('subject IDs are opt-in dev auth only and are bounded', () => {
  const valid = getSessionGameDevSubject(
    '?phase2=session&phase2Subject=phase2_human_7',
    { DEV: true, VITE_ALLOW_DEV_AUTH: 'true' },
  );
  const invalid = getSessionGameDevSubject(
    '?phase2=session&phase2Subject=not-safe',
    { DEV: true, VITE_ALLOW_DEV_AUTH: 'true' },
  );
  const production = getSessionGameDevSubject(
    '?phase2=session&phase2Subject=phase2_human_7',
    { DEV: false, VITE_ALLOW_DEV_AUTH: 'true' },
  );
  assert.equal(valid, 'phase2_human_7');
  assert.equal(invalid, null);
  assert.equal(production, null);
});
