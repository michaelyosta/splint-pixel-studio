import test from 'node:test';
import assert from 'node:assert/strict';
import { createPremiumPackPurchaseIntent } from './premiumPurchase.js';

test('premium purchase intent opens the controlled store for the selected pack', () => {
  let openedPackId = null;
  const intent = createPremiumPackPurchaseIntent('col_premium-gallery', (packId) => {
    openedPackId = packId;
  });

  assert.equal(typeof intent, 'function');
  intent();
  assert.equal(openedPackId, 'col_premium-gallery');
});

test('premium purchase intent stays inert when the store route is unavailable', () => {
  assert.equal(createPremiumPackPurchaseIntent('col_premium-gallery'), null);
});
