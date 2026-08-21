import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CHECKOUT_STATES,
  PACK_STATES,
  canCheckout,
  getPackState,
  normalizeStorePacks,
  reduceCheckoutState,
} from './packStore.js';

function collection(overrides = {}) {
  return {
    id: 'pack-one',
    title: 'Ночной город',
    pack_type: 'free',
    status: 'published',
    visibility: 'public',
    total_artworks: 4,
    ...overrides,
  };
}

test('pack state is server-metadata driven and distinguishes free, owned, paid and unavailable', () => {
  assert.equal(getPackState(collection()), PACK_STATES.FREE);
  assert.equal(getPackState(collection(), { state: 'owned' }), PACK_STATES.OWNED);
  assert.equal(getPackState(collection({ pack_type: 'premium', price_in_stars: 120 })), PACK_STATES.PAID);
  assert.equal(getPackState(collection({ pack_type: 'premium', price_in_stars: 0 })), PACK_STATES.UNAVAILABLE);
  assert.equal(getPackState(collection({ status: 'draft', owner_id: 'creator-1' })), PACK_STATES.UNAVAILABLE);
});

test('store keeps one paid showcase and caps malformed/duplicate metadata', () => {
  const packs = normalizeStorePacks([
    collection({ id: 'paid-a', title: 'Paid A', pack_type: 'premium', price_in_stars: 120 }),
    collection({ id: 'paid-b', title: 'Paid B', pack_type: 'premium', price_in_stars: 180 }),
    collection({ id: 'free-a', title: 'Free A' }),
    collection({ id: 'free-a', title: 'Duplicate' }),
    collection({ id: 'private', owner_id: 'creator-1', status: 'draft', visibility: 'private' }),
  ], null, { limit: 3 });

  assert.deepEqual(packs.map((pack) => pack.id), ['paid-a', 'free-a']);
  assert.equal(packs[0].pack_state, PACK_STATES.PAID);
  assert.equal(packs[0].checkout_enabled, false);
});

test('paid checkout is disabled unless the explicit Telegram Stars mode is enabled', () => {
  const disabled = normalizeStorePacks([collection({ pack_type: 'premium', price_in_stars: 120 })])[0];
  const enabled = normalizeStorePacks([collection({ pack_type: 'premium', price_in_stars: 120 })], null, { paymentsMode: 'telegram_stars' })[0];
  assert.equal(canCheckout(disabled), false);
  assert.equal(canCheckout(enabled), true);
});

test('checkout reducer covers pending, success, cancel, retry and restore without inferring success', () => {
  let state = reduceCheckoutState(undefined, { type: 'BEGIN', requestId: 'req-1' });
  assert.equal(state.status, CHECKOUT_STATES.PENDING);
  state = reduceCheckoutState(state, { type: 'CANCEL', reason: 'user' });
  assert.equal(state.status, CHECKOUT_STATES.CANCELLED);
  state = reduceCheckoutState(state, { type: 'RETRY', requestId: 'req-2' });
  assert.equal(state.status, CHECKOUT_STATES.PENDING);
  state = reduceCheckoutState(state, { type: 'FAIL', error: 'timeout' });
  assert.equal(state.status, CHECKOUT_STATES.ERROR);
  state = reduceCheckoutState(state, { type: 'RESTORE' });
  assert.equal(state.status, CHECKOUT_STATES.RESTORING);
  state = reduceCheckoutState(state, { type: 'RESTORE_EMPTY' });
  assert.equal(state.status, CHECKOUT_STATES.CANCELLED);
  state = reduceCheckoutState(state, { type: 'RESTORE' });
  state = reduceCheckoutState(state, { type: 'RESTORE_SUCCESS', operationId: 'op-1' });
  assert.equal(state.status, CHECKOUT_STATES.SUCCESS);
  assert.equal(state.restored, true);
});
