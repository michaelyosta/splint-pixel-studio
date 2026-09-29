import test from 'node:test';
import assert from 'node:assert/strict';
import {
  autoSpecialActionForOffer,
  autoSparkActionKey,
  autoSparkActionForOffer,
  specialOfferDecisionCount,
  submitAutoSparkAction,
} from './specialCellsGameplay.js';

test('new one-target Spark offer auto-applies with zero player decisions', () => {
  const offer = {
    kind: 'spark',
    special_id: 'sc_auto',
    offer_token: 'abcdef1234567890',
    default_option_id: 'default',
    target_options: [{ option_id: 'default', estimated_cells: 50 }],
  };
  assert.deepEqual(autoSparkActionForOffer(offer), {
    type: 'use_spark',
    special_id: 'sc_auto',
    offer_token: 'abcdef1234567890',
    option_id: 'default',
    experiment_group: 'treatment',
  });
  assert.equal(specialOfferDecisionCount(offer), 0);
});

test('recovered legacy A/B Spark offer auto-selects the persisted first option', () => {
  const offer = {
    special_id: 'sc_legacy',
    offer_token: 'abcdef1234567890',
    target_options: [
      { option_id: 'a', estimated_cells: 12 },
      { option_id: 'b', estimated_cells: 9 },
    ],
  };
  assert.equal(autoSparkActionForOffer(offer).option_id, 'a');
  assert.equal(specialOfferDecisionCount(offer), 0);
});

test('each current offer kind resolves its deterministic server option without a player decision', () => {
  const common = { special_id: 'sc_auto', offer_token: 'abcdef1234567890' };
  assert.deepEqual(autoSpecialActionForOffer({ ...common, kind: 'bomb', center_x: 12, center_y: 18 }), {
    type: 'use_bomb', ...common, center_x: 12, center_y: 18, experiment_group: 'treatment',
  });
  assert.equal(autoSpecialActionForOffer({ ...common, kind: 'fuse', steps: [{}] }).type, 'disarm_fuse');
  assert.equal(autoSpecialActionForOffer({ ...common, kind: 'hazard' }).type, 'disarm_hazard');
  assert.deepEqual(autoSpecialActionForOffer({
    ...common,
    kind: 'choice',
    choice_options: [{ option_id: 'smart_target' }, { option_id: 'local_burst' }],
  }), {
    type: 'use_choice', ...common, option_id: 'smart_target', experiment_group: 'treatment',
  });
  assert.equal(specialOfferDecisionCount({ ...common, kind: 'choice', choice_options: [{ option_id: 'smart_target' }] }), 0);
  assert.equal(specialOfferDecisionCount({ ...common, kind: 'bomb', center_x: 1, center_y: 1 }), 0);
});

test('transient auto-Spark failure is retryable without changing the server action', async () => {
  const action = autoSparkActionForOffer({
    kind: 'spark',
    special_id: 'sc_retry',
    offer_token: 'abcdef1234567890',
    default_option_id: 'default',
    target_options: [{ option_id: 'default', estimated_cells: 12 }],
  });
  let attempts = 0;
  const submit = async (received) => {
    assert.deepEqual(received, action);
    attempts += 1;
    return attempts > 1;
  };
  assert.equal(await submitAutoSparkAction(submit, action), false);
  assert.equal(await submitAutoSparkAction(submit, action), true);
  assert.equal(attempts, 2);
});

test('Fuse link steps receive distinct attempt keys without changing the server envelope', () => {
  const offer = {
    kind: 'fuse',
    special_id: 'sc_fuse',
    offer_token: 'abcdef1234567890',
    progress_revision: 8,
    steps: [{ distance: 1 }],
  };
  const action = autoSpecialActionForOffer(offer);
  const nextStepOffer = { ...offer, progress_revision: 9, steps: [{ distance: 2 }] };
  assert.notEqual(autoSparkActionKey(action, offer), autoSparkActionKey(action, nextStepOffer));
  assert.deepEqual(action, {
    type: 'disarm_fuse',
    special_id: 'sc_fuse',
    offer_token: 'abcdef1234567890',
    experiment_group: 'treatment',
  });
});
