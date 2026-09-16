import test from 'node:test';
import assert from 'node:assert/strict';
import manifest from '../content/catalog-manifest.json' with { type: 'json' };
import {
  CATALOG_COLLECTIONS,
  CATALOG_SHELF_DEFINITIONS,
  buildCatalogShelves,
  catalogRowMatchesSearch,
} from '../server/services/catalog-merchandising.js';

test('merchandising manifest exposes the exact 320-item catalog hierarchy', () => {
  assert.equal(manifest.entries.length, 320);
  assert.equal(CATALOG_COLLECTIONS.length, 16);
  assert.equal(CATALOG_COLLECTIONS.reduce((total, collection) => total + collection.albums.length, 0), 32);
  assert.equal(CATALOG_COLLECTIONS.reduce((total, collection) => total + collection.total_artworks, 0), 320);
  assert.equal(CATALOG_COLLECTIONS.reduce((total, collection) => total + collection.free_count, 0), 172);
  assert.equal(CATALOG_COLLECTIONS.reduce((total, collection) => total + collection.premium_count, 0), 148);
  assert.ok(CATALOG_COLLECTIONS.every((collection) => collection.image_url && collection.albums.length === 2));
  assert.ok(CATALOG_COLLECTIONS.every((collection) => collection.albums.every((album) => album.cover_url)));
});

test('shelf definitions are metadata-driven and search aliases work in both languages', () => {
  assert.ok(CATALOG_SHELF_DEFINITIONS.length >= 12);
  const items = manifest.entries.map((entry) => ({
    id: entry.id,
    title: entry.title,
    collection_id: entry.collection_id,
    album_id: entry.album_id,
    access: entry.access,
    tags: entry.tags,
    theme: entry.theme,
    mood: entry.mood,
    season: entry.season,
    featured_rank: entry.id.endsWith('_01') ? 0 : 1,
  }));
  const shelves = buildCatalogShelves(items);
  assert.ok(shelves.some((shelf) => shelf.id === 'new' && shelf.total_count > 0));
  assert.ok(shelves.some((shelf) => shelf.id === 'free' && shelf.total_count === 172));
  assert.ok(shelves.some((shelf) => shelf.id === 'premium' && shelf.total_count === 148));
  assert.ok(catalogRowMatchesSearch({ title: 'Neon monsoon', tags_json: '["cyber"]' }, 'кибер'));
  assert.ok(catalogRowMatchesSearch({ title: 'Blockbound', tags_json: '["voxel"]' }, 'блок'));
});
