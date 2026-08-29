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

test('positive-event candidates keep one event family plus passive Artifact', () => {
  const automaticSpark = resolveSessionGameExperiment(
    '?phase2=session&phase2Variant=treatment&phase2Event=spark_auto&phase2Subject=phase2_spark_auto',
    { DEV: true },
  );
  const bomb = resolveSessionGameExperiment(
    '?phase2=session&phase2Variant=treatment&phase2Event=bomb&phase2Subject=phase2_bomb',
    { DEV: true },
  );
  assert.equal(automaticSpark.positiveEventId, 'spark_auto');
  assert.equal(automaticSpark.positiveEvent.mode, 'automatic');
  assert.deepEqual(automaticSpark.variant.allowedSpecialKinds, ['spark', 'artifact']);
  assert.equal(isSessionGameSpecialAllowed(automaticSpark, 'spark'), true);
  assert.equal(isSessionGameSpecialAllowed(automaticSpark, 'bomb'), false);
  assert.equal(isSessionGameSpecialAllowed(automaticSpark, 'artifact'), true);
  assert.equal(bomb.positiveEventId, 'bomb');
  assert.equal(bomb.positiveEvent.mode, 'spatial');
  assert.deepEqual(bomb.variant.allowedSpecialKinds, ['bomb', 'artifact']);
  assert.equal(isSessionGameSpecialAllowed(bomb, 'bomb'), true);
  assert.equal(isSessionGameSpecialAllowed(bomb, 'spark'), false);
  assert.equal(isSessionGameSpecialAllowed(bomb, 'artifact'), true);
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
