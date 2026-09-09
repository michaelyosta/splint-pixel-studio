import assert from 'node:assert/strict';
import test from 'node:test';
import { shouldResolveRequestedPackRoute } from './navigation.js';

test('requested pack deep links resolve only while catalog is active', () => {
  assert.equal(shouldResolveRequestedPackRoute({
    view: 'catalog',
    requestedPackId: 'col_premium-gallery',
    collections: [{ id: 'col_premium-gallery' }],
  }), true);

  assert.equal(shouldResolveRequestedPackRoute({
    view: 'store',
    requestedPackId: 'col_premium-gallery',
    collections: [{ id: 'col_premium-gallery' }],
  }), false);
});

test('requested pack deep links wait for a real id and loaded collections', () => {
  assert.equal(shouldResolveRequestedPackRoute({
    view: 'catalog',
    requestedPackId: null,
    collections: [{ id: 'col_premium-gallery' }],
  }), false);

  assert.equal(shouldResolveRequestedPackRoute({
    view: 'catalog',
    requestedPackId: 'col_premium-gallery',
    collections: [],
  }), false);
});
