import test from 'node:test';
import assert from 'node:assert/strict';
import { catalogAssetUrl } from '../services/catalog-merchandising.js';

test('private catalog delivery maps only runtime previews and covers to public media keys', () => {
  assert.equal(
    catalogAssetUrl('public/assets/catalog/generated/autumn-cozy_01-pixel.png', '/media/catalog/'),
    '/media/catalog/previews/autumn-cozy_01-pixel.png',
  );
  assert.equal(
    catalogAssetUrl('public/assets/catalog/generated/covers/autumn-cozy.png', '/media/catalog/'),
    '/media/catalog/covers/autumn-cozy.png',
  );
  assert.equal(
    catalogAssetUrl('public/assets/catalog/generated/autumn-cozy_01.png', 'https://cdn.example/catalog'),
    'https://cdn.example/catalog/full/autumn-cozy_01.png',
  );
});

test('catalog asset URLs stay local static paths when no R2 delivery base is configured', () => {
  assert.equal(
    catalogAssetUrl('public/assets/catalog/generated/autumn-cozy_01-pixel.png', ''),
    '/assets/catalog/generated/autumn-cozy_01-pixel.png',
  );
  assert.equal(
    catalogAssetUrl('/assets/catalog/astro-whale-pixel.png', '/media/catalog'),
    '/assets/catalog/astro-whale-pixel.png',
  );
});
