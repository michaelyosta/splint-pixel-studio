import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCollectionProgress,
  buildGallerySummary,
  formatArtworkComplexity,
  formatArtworkDuration,
  formatArtworkMeta,
  formatResumeBeat,
  isCompletedArtwork,
  isInProgressArtwork,
  sortCollectionsForShelf,
  sortGalleryItems,
} from '../src/lib/galleryProgression.js';

function artwork(id, percent, extra = {}) {
  return {
    id,
    title: id,
    est_minutes: 5,
    difficulty: 'medium',
    width: 160,
    height: 160,
    progress: {
      percent,
      completed_cells: percent,
      total_cells: 100,
      updated_at: extra.updated_at || null,
      completed_at: percent >= 100 ? '2026-08-21T10:00:00.000Z' : null,
    },
    ...extra,
  };
}

test('gallery summary separates completed results from active and unopened work', () => {
  assert.deepEqual(buildGallerySummary([
    artwork('done', 100),
    artwork('active', 32),
    artwork('new', 0),
  ]), { completed: 1, inProgress: 1, unopened: 1 });
  assert.equal(isCompletedArtwork(artwork('done', 100)), true);
});

test('new user-created artwork is actionable before its first paint', () => {
  assert.equal(isInProgressArtwork(artwork('created', 0, { source_type: 'user' })), true);
  assert.deepEqual(buildGallerySummary([
    artwork('created', 0, { source_type: 'user' }),
    artwork('catalog-unopened', 0),
  ]), { completed: 0, inProgress: 1, unopened: 1 });
});

test('gallery ordering puts active return target before completed results', () => {
  const items = sortGalleryItems([
    artwork('done', 100),
    artwork('older-active', 20, { updated_at: '2026-08-20T09:00:00.000Z' }),
    artwork('latest-active', 30, { updated_at: '2026-08-21T09:00:00.000Z' }),
  ]);
  assert.deepEqual(items.map((item) => item.id), ['latest-active', 'older-active', 'done']);
});

test('duration and complexity labels stay honest and bucketed', () => {
  assert.equal(formatArtworkDuration({ est_minutes: 3 }), 'до 3 мин');
  assert.equal(formatArtworkDuration({ est_minutes: 7 }), '5–10 мин');
  assert.equal(formatArtworkComplexity({ difficulty: 'hard' }), 'сложная');
  assert.equal(formatArtworkComplexity({ width: 1200, height: 1200 }), 'много деталей');
});

test('gallery renders server content metadata and marks legacy payloads as unassessed', () => {
  const metadata = {
    schema_version: 'content-metadata.v1',
    duration: { label: 'Средняя · около 6 мин' },
    complexity: { label: 'Сосредоточенная' },
  };
  assert.equal(formatArtworkMeta(artwork('authoritative', 20, { content_metadata: metadata })), 'Средняя · около 6 мин · Сосредоточенная');
  assert.match(formatArtworkMeta(artwork('legacy', 20)), /Метаданные не проверены/);
});

test('resume promise names the next reveal beat without fabricating a target', () => {
  assert.equal(formatResumeBeat(artwork('new', 0)), 'Первый reveal-фрагмент');
  assert.equal(formatResumeBeat(artwork('active', 42)), 'Следующий reveal-фрагмент · раскрыто 42%');
  assert.equal(formatResumeBeat(artwork('done', 100)), 'Готовый результат');
});

test('collection shelf merges server progress with loaded mine data', () => {
  const collection = buildCollectionProgress({ id: 'night', title: 'Night', completed_count: 0, total_count: 3 }, [
    { ...artwork('one', 100), collection_id: 'night' },
    { ...artwork('two', 22), collection_id: 'night' },
  ]);
  assert.equal(collection.completed_count, 1);
  assert.equal(collection.total_count, 3);
  assert.equal(collection.progress_percent, 33);
  assert.equal(collection.state, 'in_progress');
});

test('collection shelf prioritizes a collection with a live unfinished thread', () => {
  const shelf = sortCollectionsForShelf([
    { id: 'complete', title: 'Complete', completed_count: 2, total_count: 2 },
    { id: 'new', title: 'New', completed_count: 0, total_count: 2 },
    { id: 'active', title: 'Active', completed_count: 1, total_count: 2 },
  ]);
  assert.deepEqual(shelf.map((item) => item.id), ['active', 'new', 'complete']);
});
