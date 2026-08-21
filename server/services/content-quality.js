// Bounded, advisory content metadata for the Phase 4 collection journey.
//
// This module deliberately does not choose a creator conversion, mutate a
// template, or reject a catalog row. It turns already persisted/editorial
// signals into honest, coarse labels that the catalog and collection surfaces
// can show without exposing the full cell map. Pixelization recommendations
// remain opt-in and exact-resolution scoped: unknown artwork/resolution pairs
// stay on the safe classic fallback and are marked for review.

import {
  measureTemplateComplexity,
  PUBLIC_COMPLEXITY_BUDGET,
  validatePublicTemplateComplexity,
} from './template-complexity.js';

export const CONTENT_METADATA_SCHEMA_VERSION = 'content-metadata.v1';
export const PIXELIZATION_ROUTING_POLICY = 'pixelization-routing-v1';

const DURATION_BANDS = Object.freeze({
  short: { maxMinutes: 3, label: 'Короткая', sessionMode: 'quick' },
  medium: { maxMinutes: 8, label: 'Средняя', sessionMode: 'standard' },
  long: { maxMinutes: Infinity, label: 'Длинная', sessionMode: 'segmented' },
});

const COMPLEXITY_BANDS = Object.freeze({
  calm: { maxScore: 34, label: 'Спокойная' },
  focused: { maxScore: 64, label: 'Сосредоточенная' },
  intricate: { maxScore: Infinity, label: 'Детальная' },
});

function finite(value, fallback = null) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function positiveInteger(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function normalizeBand(minutes) {
  if (minutes <= DURATION_BANDS.short.maxMinutes) return 'short';
  if (minutes <= DURATION_BANDS.medium.maxMinutes) return 'medium';
  return 'long';
}

function formatMinutes(minutes) {
  const rounded = Math.max(1, Math.round(minutes));
  return `около ${rounded} мин`;
}

/**
 * Build an honest session-length label. `est_minutes` is treated as an
 * editorial estimate, not a promise of exact completion time. Very large
 * grids are explicitly segmented even when an old row still says `3` minutes
 * so the catalog cannot imply a short one-sitting artwork.
 */
export function deriveDurationMetadata(template = {}) {
  const width = positiveInteger(template.width);
  const height = positiveInteger(template.height);
  const totalCells = width * height;
  const declaredMinutes = finite(template.est_minutes, null);
  const hasDeclaredEstimate = declaredMinutes !== null && declaredMinutes > 0;
  const safeDeclaredMinutes = hasDeclaredEstimate ? clamp(declaredMinutes, 1, 1_440) : null;

  // A long-form pilot needs a truthful stop/resume promise, not an inflated
  // precision estimate. 25,600 cells is the existing public complexity
  // budget; anything larger is a segmented artwork by definition.
  const segmented = template.storage_mode === 'tiled' && totalCells > 25_600;
  const minimumForGrid = totalCells > 25_600 ? 15 : totalCells > 4_096 ? 5 : 1;
  const minutes = Math.max(safeDeclaredMinutes || 0, minimumForGrid || 1);
  const band = segmented ? 'long' : normalizeBand(minutes);
  const bandMeta = DURATION_BANDS[band];
  const label = segmented
    ? `${bandMeta.label} · по сегментам`
    : `${bandMeta.label} · ${formatMinutes(minutes)}`;

  return {
    band,
    label,
    minutes,
    total_cells: totalCells || null,
    session_mode: segmented ? 'segmented' : bandMeta.sessionMode,
    confidence: hasDeclaredEstimate ? 'editorial' : 'structural',
    source: segmented
      ? 'grid-size-segmented-contract'
      : hasDeclaredEstimate ? 'est_minutes' : 'grid-size-fallback',
  };
}

function difficultyBase(value) {
  switch (String(value || '').toLowerCase()) {
    case 'easy': return 18;
    case 'medium': return 42;
    case 'hard': return 68;
    case 'custom': return 46;
    default: return 38;
  }
}

function measuredMetrics(template) {
  const width = positiveInteger(template.width);
  const height = positiveInteger(template.height);
  const cells = Array.isArray(template.cells) ? template.cells : null;
  if (!width || !height || !cells || cells.length !== width * height || cells.length > 25_600) return null;
  const palette = Array.isArray(template.palette) && template.palette.length ? template.palette : ['#000000'];
  return measureTemplateComplexity({ width, height, palette, cells });
}

function suppliedMetrics(template, metrics) {
  const candidate = metrics || template.complexity_metrics || template.content_metrics;
  if (!candidate || typeof candidate !== 'object') return null;
  const connectedComponents = positiveInteger(candidate.connectedComponents ?? candidate.regionCount, 0);
  const smallRegionCount = positiveInteger(candidate.smallRegionCount, 0);
  const totalCells = positiveInteger(candidate.totalCells, positiveInteger(template.width) * positiveInteger(template.height));
  return {
    totalCells,
    connectedComponents,
    maxComponentsPerColor: positiveInteger(candidate.maxComponentsPerColor, 0),
    smallRegionCount,
    checkerboardScore: clamp(finite(candidate.checkerboardScore, 0), 0, 1),
    estimatedMergeCost: Math.max(0, finite(candidate.estimatedMergeCost, 0)),
  };
}

function suppliedComplexityGate(template, metrics) {
  const width = positiveInteger(template.width);
  const height = positiveInteger(template.height);
  const totalCells = metrics.totalCells || width * height;
  // The legacy public budget is intentionally not a rejection rule for
  // tiled/long-form maps. Those maps require a separate segmented pilot and
  // should be surfaced as review, not mislabeled as a failed upload.
  if (totalCells > PUBLIC_COMPLEXITY_BUDGET.totalCells) return null;
  const paletteSize = Array.isArray(template.palette)
    ? template.palette.length
    : positiveInteger(template.palette_size, 0);
  const values = {
    totalCells,
    paletteSize,
    connectedComponents: metrics.connectedComponents,
    maxComponentsPerColor: metrics.maxComponentsPerColor,
    smallRegionCount: metrics.smallRegionCount,
    checkerboardScore: metrics.checkerboardScore,
    workingWindows: Math.ceil(metrics.connectedComponents / 4) + Math.ceil(totalCells / 4_096),
    estimatedMergeCost: metrics.estimatedMergeCost,
  };
  return Object.entries(values).every(([key, value]) => (
    value <= PUBLIC_COMPLEXITY_BUDGET[key]
  ));
}

function complexityScore(template, metrics) {
  const width = positiveInteger(template.width);
  const height = positiveInteger(template.height);
  const totalCells = metrics?.totalCells || width * height || 1;
  const paletteSize = Array.isArray(template.palette)
    ? template.palette.length
    : positiveInteger(template.palette_size, 0);
  const base = difficultyBase(template.difficulty);
  const sizePressure = totalCells > 25_600 ? 28 : totalCells > 4_096 ? 18 : totalCells > 1_600 ? 10 : 0;
  const palettePressure = clamp(Math.max(0, paletteSize - 8) * 2, 0, 12);
  if (!metrics) return Math.round(clamp(base + sizePressure + palettePressure, 0, 100));

  const fragmentation = totalCells ? metrics.connectedComponents / totalCells : 0;
  const smallRegionRatio = totalCells ? metrics.smallRegionCount / totalCells : 0;
  const fragmentationPressure = clamp(fragmentation * 1_000 * 0.55, 0, 25);
  const tinyRegionPressure = clamp(smallRegionRatio * 100, 0, 20);
  const checkerboardPressure = clamp(metrics.checkerboardScore * 20, 0, 20);
  return Math.round(clamp(
    base + sizePressure + palettePressure + fragmentationPressure + tinyRegionPressure + checkerboardPressure,
    0,
    100,
  ));
}

/**
 * Derive a coarse complexity label while preserving the evidence source.
 * `measured` means the bounded stored raster was inspected; `editorial`
 * means only dimensions/palette/difficulty were available (normal for tiled
 * maps, where loading the full grid would violate the bounded contract).
 */
export function deriveComplexityMetadata(template = {}, metrics = null) {
  const measured = measuredMetrics(template);
  const supplied = suppliedMetrics(template, metrics);
  const evidence = measured || supplied;
  const score = complexityScore(template, evidence);
  const band = score <= COMPLEXITY_BANDS.calm.maxScore
    ? 'calm'
    : score <= COMPLEXITY_BANDS.focused.maxScore ? 'focused' : 'intricate';
  const complexity = COMPLEXITY_BANDS[band];
  const complexityGate = measured
    ? validatePublicTemplateComplexity({
      width: positiveInteger(template.width),
      height: positiveInteger(template.height),
      palette: Array.isArray(template.palette) ? template.palette : Array(positiveInteger(template.palette_size, 1)).fill('#000000'),
      cells: template.cells,
    }).allowed
    : supplied ? suppliedComplexityGate(template, supplied) : null;

  return {
    band,
    label: complexity.label,
    score,
    confidence: measured ? 'measured' : supplied ? 'supplied-metrics' : 'editorial',
    source: measured ? 'bounded-raster-metrics' : supplied ? 'supplied-metrics' : 'dimensions-and-editorial-difficulty',
    gate: complexityGate === false ? 'hold' : complexityGate === true ? 'pass' : 'review',
  };
}

function readPixelizationSignal(template = {}, pixelization = null) {
  const candidate = pixelization
    || template.pixelization_recommendation
    || template.pixelization
    || template.content_quality?.pixelization
    || null;
  if (!candidate || typeof candidate !== 'object') return null;
  return {
    decision: ['classic', 'paintable'].includes(candidate.decision) ? candidate.decision : null,
    status: typeof candidate.status === 'string' ? candidate.status : null,
    confidence: typeof candidate.confidence === 'string' ? candidate.confidence : null,
    reasons: Array.isArray(candidate.reasons) ? candidate.reasons.slice(0, 4).map(String) : [],
    policy: candidate.policy || PIXELIZATION_ROUTING_POLICY,
    source: candidate.source || 'exact-resolution-pixelization-evidence',
  };
}

export function deriveStyleQualityMetadata(template = {}, pixelization = null) {
  const signal = readPixelizationSignal(template, pixelization);
  if (!signal) {
    return {
      route: 'classic',
      status: 'unassessed',
      confidence: 'none',
      label: 'Стиль не проверен',
      reasons: ['exact-pixelization-evidence-missing'],
      policy: PIXELIZATION_ROUTING_POLICY,
      source: 'safe-classic-default',
    };
  }
  const status = signal.status || (signal.decision === 'paintable' ? 'provisional-positive' : 'safe-fallback');
  const route = signal.decision || 'classic';
  const label = route === 'paintable'
    ? status === 'provisional-positive' ? 'Paintable · предварительно подходит' : 'Paintable · на проверке'
    : status === 'human-review' ? 'Classic · нужна проверка' : 'Classic · безопасный fallback';
  return {
    route,
    status,
    confidence: signal.confidence || 'none',
    label,
    reasons: signal.reasons,
    policy: signal.policy,
    source: signal.source,
  };
}

export function buildContentMetadata(template = {}, { metrics = null, pixelization = null } = {}) {
  const duration = deriveDurationMetadata(template);
  const complexity = deriveComplexityMetadata(template, metrics);
  const style = deriveStyleQualityMetadata(template, pixelization);
  const reasons = [];
  if (complexity.gate === 'hold') reasons.push('complexity-budget');
  if (complexity.gate === 'review') {
    reasons.push(duration.session_mode === 'segmented' && complexity.confidence === 'supplied-metrics'
      ? 'segmented-long-form-review'
      : 'complexity-evidence-missing');
  }
  if (style.status === 'unassessed' || style.status === 'human-review') reasons.push('pixelization-review');
  return {
    schema_version: CONTENT_METADATA_SCHEMA_VERSION,
    duration,
    complexity,
    style,
    quality_gate: {
      status: reasons.length ? 'review' : 'pass',
      reasons,
      blocking: false,
    },
  };
}

/**
 * Build one bounded, collection-level metadata object from already selected
 * template summaries. Collection cards do not need (and must not receive)
 * cell maps; every item is therefore evaluated from the same safe editorial
 * signals used for tiled catalog rows.
 */
export function buildCollectionContentMetadata(templates = []) {
  const rows = Array.isArray(templates) ? templates.slice(0, 48) : [];
  if (!rows.length) {
    return {
      schema_version: CONTENT_METADATA_SCHEMA_VERSION,
      duration: { band: 'unknown', label: 'Длительность не проверена', session_mode: 'unknown', confidence: 'none', source: 'collection-items-missing' },
      complexity: { band: 'unknown', label: 'Сложность не проверена', confidence: 'none', source: 'collection-items-missing', gate: 'review' },
      style: { route: 'classic', status: 'unassessed', confidence: 'none', label: 'Стиль не проверен', reasons: ['collection-items-missing'], policy: PIXELIZATION_ROUTING_POLICY, source: 'safe-classic-default' },
      quality_gate: { status: 'review', reasons: ['collection-items-missing'], blocking: false },
    };
  }

  const metadata = rows.map((template) => buildContentMetadata(template));
  const durationRank = { short: 0, medium: 1, long: 2 };
  const complexityRank = { calm: 0, focused: 1, intricate: 2 };
  const durationBands = [...new Set(metadata.map((item) => item.duration.band))];
  const complexityBands = [...new Set(metadata.map((item) => item.complexity.band))];
  const longestDuration = metadata.reduce((best, item) => (
    (durationRank[item.duration.band] ?? -1) > (durationRank[best.duration.band] ?? -1) ? item : best
  ), metadata[0]).duration;
  const highestComplexity = metadata.reduce((best, item) => (
    (complexityRank[item.complexity.band] ?? -1) > (complexityRank[best.complexity.band] ?? -1) ? item : best
  ), metadata[0]).complexity;
  const duration = durationBands.length === 1
    ? { ...longestDuration, label: `${longestDuration.label} · подборка` }
    : { band: 'mixed', label: 'Смешанная · разные сессии', session_mode: 'mixed', confidence: 'aggregate', source: 'collection-items', item_count: rows.length };
  const complexity = complexityBands.length === 1
    ? { ...highestComplexity, label: `${highestComplexity.label} · подборка` }
    : { band: 'mixed', label: 'Смешанная сложность', score: highestComplexity.score, confidence: 'aggregate', source: 'collection-items', gate: 'review', item_count: rows.length };
  const styleRoutes = [...new Set(metadata.map((item) => `${item.style.route}:${item.style.status}`))];
  const style = styleRoutes.length === 1
    ? { ...metadata[0].style, source: 'collection-items', item_count: rows.length }
    : { route: 'classic', status: 'unassessed', confidence: 'aggregate', label: 'Стиль не проверен для всей подборки', reasons: ['mixed-item-style-evidence'], policy: PIXELIZATION_ROUTING_POLICY, source: 'collection-items', item_count: rows.length };
  const reasons = [...new Set(metadata.flatMap((item) => item.quality_gate.reasons))];
  if (duration.band === 'mixed') reasons.push('mixed-session-lengths');
  if (complexity.band === 'mixed') reasons.push('mixed-complexity');
  return {
    schema_version: CONTENT_METADATA_SCHEMA_VERSION,
    duration,
    complexity,
    style,
    quality_gate: { status: reasons.length ? 'review' : 'pass', reasons: [...new Set(reasons)], blocking: false, item_count: rows.length },
  };
}
