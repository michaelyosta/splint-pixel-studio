import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getAvailableCollectionTemplates,
  getOwnedUserTemplates,
  getPublicationBlocker,
} from '../src/features/creator/creatorCollectionsUtils.js';

const templates = [
  { id: 'own-private', title: 'Private', source_type: 'user', visibility: 'private', status: 'active' },
  { id: 'own-public', title: 'Public', source_type: 'user', visibility: 'public', status: 'active' },
  { id: 'catalog', title: 'Catalog', source_type: 'catalog', visibility: 'public', status: 'active' },
  { id: 'deleted', title: 'Deleted', source_type: 'user', visibility: 'public', status: 'deleted' },
];

test('creator collection manager exposes only active user templates', () => {
  assert.deepEqual(getOwnedUserTemplates(templates).map((template) => template.id), ['own-private', 'own-public']);
});

test('creator collection manager excludes templates already in the selected set', () => {
  const collection = { templates: [{ id: 'own-private' }] };
  assert.deepEqual(getAvailableCollectionTemplates(templates, collection).map((template) => template.id), ['own-public']);
});

test('publication guidance requires an item and public visibility', () => {
  assert.equal(getPublicationBlocker({ templates: [] }), 'Добавьте хотя бы одну свою раскраску.');
  assert.equal(getPublicationBlocker({ templates: [{ id: 'own-private', visibility: 'private' }] }), 'Перед публикацией сделайте все раскраски набора публичными.');
  assert.equal(getPublicationBlocker({ templates: [{ id: 'own-public', visibility: 'public' }] }), null);
});
