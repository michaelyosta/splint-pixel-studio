/**
 * Presentation contract for the server-owned content metadata.
 *
 * The server is the source of truth.  The client may render a deliberately
 * explicit "not assessed" state when an older or synthetic payload has no
 * metadata; it must not silently rebuild an authoritative label from
 * est_minutes or difficulty.
 */

export const CONTENT_METADATA_SCHEMA_VERSION = 'content-metadata.v1';

const UNKNOWN = 'Метаданные не проверены';

function text(value, fallback = '') {
  const valueText = String(value ?? '').trim();
  return valueText || fallback;
}

function readMetadata(itemOrMetadata) {
  const metadata = itemOrMetadata?.content_metadata || itemOrMetadata;
  if (!metadata || typeof metadata !== 'object') return null;
  if (metadata.schema_version !== CONTENT_METADATA_SCHEMA_VERSION) return null;
  if (!metadata.duration || !metadata.complexity) return null;
  return metadata;
}

export function hasContentMetadata(itemOrMetadata) {
  return Boolean(readMetadata(itemOrMetadata));
}

export function contentMetadataLabels(itemOrMetadata) {
  const metadata = readMetadata(itemOrMetadata);
  if (!metadata) {
    return {
      metadata: null,
      duration: UNKNOWN,
      complexity: UNKNOWN,
      style: UNKNOWN,
      quality: UNKNOWN,
      assessed: false,
    };
  }
  const qualityStatus = metadata.quality_gate?.status;
  return {
    metadata,
    duration: text(metadata.duration.label, UNKNOWN),
    complexity: text(metadata.complexity.label, UNKNOWN),
    style: text(metadata.style?.label, UNKNOWN),
    quality: qualityStatus === 'pass' ? 'Контент проверен' : 'Нужна редакторская проверка',
    assessed: true,
  };
}

export function formatContentMetadataLine(itemOrMetadata, { includeStyle = false } = {}) {
  const labels = contentMetadataLabels(itemOrMetadata);
  const values = [labels.duration, labels.complexity];
  if (includeStyle) values.push(labels.style);
  return values.join(' · ');
}

export function formatContentMetadataDetail(itemOrMetadata) {
  const labels = contentMetadataLabels(itemOrMetadata);
  return {
    ...labels,
    line: formatContentMetadataLine(itemOrMetadata),
    styleLine: formatContentMetadataLine(itemOrMetadata, { includeStyle: true }),
  };
}

/** Aggregate already-authoritative item metadata for a pack card. */
export function formatPackContentMetadata(pack) {
  const items = Array.isArray(pack?.items) ? pack.items : [];
  const labels = items.map(contentMetadataLabels).filter((entry) => entry.assessed);
  if (!labels.length) return UNKNOWN;
  const durations = [...new Set(labels.map((entry) => entry.duration))];
  const complexities = [...new Set(labels.map((entry) => entry.complexity))];
  const duration = durations.length === 1 ? durations[0] : 'Разная длительность';
  const complexity = complexities.length === 1 ? complexities[0] : 'Разная сложность';
  return `${duration} · ${complexity}`;
}
