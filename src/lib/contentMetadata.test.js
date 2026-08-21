import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CONTENT_METADATA_SCHEMA_VERSION,
  contentMetadataLabels,
  formatContentMetadataDetail,
  formatContentMetadataLine,
  formatPackContentMetadata,
  hasContentMetadata,
} from './contentMetadata.js';

function metadata(overrides = {}) {
  return {
    schema_version: CONTENT_METADATA_SCHEMA_VERSION,
    duration: { label: 'Средняя · около 6 мин' },
    complexity: { label: 'Сосредоточенная' },
    style: { label: 'Classic · безопасный fallback' },
    quality_gate: { status: 'review' },
    ...overrides,
  };
}

test('content metadata presentation keeps the server labels intact', () => {
  const item = { content_metadata: metadata() };
  assert.equal(hasContentMetadata(item), true);
  assert.equal(formatContentMetadataLine(item), 'Средняя · около 6 мин · Сосредоточенная');
  assert.equal(formatContentMetadataDetail(item).styleLine, 'Средняя · около 6 мин · Сосредоточенная · Classic · безопасный fallback');
  assert.equal(contentMetadataLabels(item).quality, 'Нужна редакторская проверка');
});

test('missing or wrong-schema metadata is explicit rather than silently guessed', () => {
  assert.equal(hasContentMetadata({ est_minutes: 3, difficulty: 'easy' }), false);
  assert.match(formatContentMetadataLine({ est_minutes: 3, difficulty: 'easy' }), /Метаданные не проверены/);
});

test('pack metadata uses authoritative item metadata and exposes mixed content honestly', () => {
  const pack = { items: [
    { content_metadata: metadata() },
    { content_metadata: metadata({ duration: { label: 'Длинная · по сегментам' } }) },
  ] };
  assert.equal(formatPackContentMetadata(pack), 'Разная длительность · Сосредоточенная');
  assert.equal(formatPackContentMetadata({ items: [{ est_minutes: 3 }] }), 'Метаданные не проверены');
});
