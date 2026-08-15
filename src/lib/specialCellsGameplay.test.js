import test from 'node:test';
import assert from 'node:assert/strict';
import { autoSparkActionForOffer, specialOfferDecisionCount } from './specialCellsGameplay.js';

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

test('non-Spark offers retain their compatibility decision path', () => {
  assert.equal(autoSparkActionForOffer({ kind: 'choice', choice_options: [{}, {}] }), null);
  assert.equal(specialOfferDecisionCount({ kind: 'choice', choice_options: [{}, {}] }), 1);
  assert.equal(specialOfferDecisionCount({ kind: 'bomb' }), 1);
});
