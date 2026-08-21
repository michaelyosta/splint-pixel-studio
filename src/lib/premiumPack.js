import { assessQuality } from './creatorQuality.js';

/**
 * Product-facing states for the bounded showcase pack. `paid` describes a
 * pack that could be offered by an enabled payment mode; it is not a payment
 * result. Only a server-owned entitlement may produce `owned`.
 */
export const PREMIUM_PACK_STATES = Object.freeze({
  PREVIEW: 'preview',
  FREE: 'free',
  OWNED: 'owned',
  PAID: 'paid',
  LOCKED: 'locked',
  UNAVAILABLE: 'unavailable',
});

export const PREMIUM_PACK_STATE_LABELS = Object.freeze({
  [PREMIUM_PACK_STATES.PREVIEW]: 'Предпросмотр',
  [PREMIUM_PACK_STATES.FREE]: 'Бесплатно',
  [PREMIUM_PACK_STATES.OWNED]: 'Открыто',
  [PREMIUM_PACK_STATES.PAID]: 'Платный доступ',
  [PREMIUM_PACK_STATES.LOCKED]: 'Закрыто',
  [PREMIUM_PACK_STATES.UNAVAILABLE]: 'Пока недоступно',
});

export const SHOWCASE_PREMIUM_PACK = Object.freeze({
  id: 'col_premium-gallery',
  title: 'Ночная орбита',
  eyebrow: 'ВИТРИНА · CURATED PACK',
  description: 'Две спокойные космические сцены о свете, который находится в темноте.',
  creator: 'Splint Studio',
  pack_type: 'premium',
  price_in_stars: 120,
  image_url: '/assets/catalog/astro-whale-pixel.png',
  requires_free_completion: false,
  items: Object.freeze([
    {
      id: 'color_premium_whale',
      title: 'Звёздный кит',
      description: 'Мягкий космический силуэт среди созвездий.',
      preview_url: '/assets/catalog/astro-whale-pixel.png',
      est_minutes: 6,
      dimensions: '24×24',
      first_segment: 'Контур кита и первое созвездие',
      visual_beats: 4,
      micro_region_ratio: 0.04,
      final_reveal: true,
      identity: true,
      // The seeded premium template is intentionally simple; this records
      // the same creatorQuality acceptance bar without shipping cell maps in
      // the preview bundle.
      editorial_quality: 'fair',
    },
    {
      id: 'color_premium_dragon',
      title: 'Чайный дракон',
      description: 'Тёплая чашка и маленький хранитель ночного окна.',
      preview_url: '/assets/catalog/tea-dragon-pixel.png',
      est_minutes: 6,
      dimensions: '24×24',
      first_segment: 'Пар, чашка и первое свечение',
      visual_beats: 4,
      micro_region_ratio: 0.04,
      final_reveal: true,
      identity: true,
      editorial_quality: 'fair',
    },
  ]),
  quality_gate_version: 'curated-v1',
});

const KNOWN_STATES = new Set(Object.values(PREMIUM_PACK_STATES));
const KNOWN_PAYMENT_MODES = new Set(['disabled', 'internal_credits', 'telegram_stars']);

function safeText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function safePositiveNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function hasRasterQualityData(item) {
  return Number.isInteger(Number(item?.width))
    && Number.isInteger(Number(item?.height))
    && Number(item.width) > 0
    && Number(item.height) > 0
    && Array.isArray(item?.palette)
    && item.palette.length > 0
    && Array.isArray(item?.cells)
    && item.cells.length === Number(item.width) * Number(item.height);
}

/**
 * Apply the existing raster-quality gate when a full template is available.
 * Editorial previews intentionally omit cells, so their persisted QA result
 * is used as a bounded fallback rather than making preview payloads large.
 */
export function evaluatePremiumItemQuality(item) {
  const raster = hasRasterQualityData(item)
    ? assessQuality(Number(item.width), Number(item.height), item.palette, item.cells)
    : { level: safeText(item?.editorial_quality) || 'noisy' };
  const checks = {
    thumbnail: Boolean(safeText(item?.preview_url)),
    honest_duration: safePositiveNumber(item?.est_minutes) >= 1 && safePositiveNumber(item?.est_minutes) <= 20,
    first_segment: Boolean(safeText(item?.first_segment)),
    visual_beats: Number(item?.visual_beats) >= 3,
    low_micro_regions: Number.isFinite(Number(item?.micro_region_ratio)) && Number(item.micro_region_ratio) < 0.08,
    final_reveal: Boolean(item?.final_reveal),
    identity: Boolean(item?.identity),
    raster_quality: raster.level === 'good' || raster.level === 'fair',
  };
  return {
    pass: Object.values(checks).every(Boolean),
    checks,
    raster_quality: raster.level,
  };
}

export function evaluatePremiumPackQuality(pack = SHOWCASE_PREMIUM_PACK) {
  const items = Array.isArray(pack?.items) ? pack.items : [];
  const itemResults = items.map((item) => ({ id: item.id, ...evaluatePremiumItemQuality(item) }));
  const packChecks = {
    identity: Boolean(safeText(pack?.title) && safeText(pack?.description) && safeText(pack?.creator)),
    thumbnail: Boolean(safeText(pack?.image_url)),
    honest_count: items.length >= 2 && items.length <= 8,
    item_quality: itemResults.length > 0 && itemResults.every((item) => item.pass),
  };
  return {
    pass: Object.values(packChecks).every(Boolean),
    checks: packChecks,
    items: itemResults,
  };
}

export function isCuratedPremiumPack(pack = SHOWCASE_PREMIUM_PACK) {
  return evaluatePremiumPackQuality(pack).pass;
}

export function findPremiumEntitlement(snapshot, packId = SHOWCASE_PREMIUM_PACK.id) {
  const subjects = [
    ...(Array.isArray(snapshot?.collections) ? snapshot.collections : []),
    ...(Array.isArray(snapshot?.templates) ? snapshot.templates : []),
  ];
  return subjects.find((subject) => String(subject?.subject_id || '') === String(packId)) || null;
}

function normalizePaymentMode(mode) {
  const normalized = safeText(mode).toLowerCase();
  return KNOWN_PAYMENT_MODES.has(normalized) ? normalized : 'disabled';
}

/**
 * Resolve the visible state without ever inferring ownership from a local
 * click. A server entitlement (`owned` or `owned: true`) is the only source
 * of the owned state. `preview` is used while the entitlement snapshot is
 * still loading.
 */
export function resolvePremiumPackState({
  pack = SHOWCASE_PREMIUM_PACK,
  entitlement = null,
  snapshotStatus = 'ready',
  prerequisitesMet = true,
  paymentsMode = 'disabled',
} = {}) {
  if (snapshotStatus === 'loading' && !entitlement) return PREMIUM_PACK_STATES.PREVIEW;
  if (!isCuratedPremiumPack(pack)) return PREMIUM_PACK_STATES.UNAVAILABLE;
  if (entitlement?.owned === true || entitlement?.state === 'owned') return PREMIUM_PACK_STATES.OWNED;
  if (pack.pack_type !== 'premium') return PREMIUM_PACK_STATES.FREE;
  if (pack.requires_free_completion && prerequisitesMet !== true) return PREMIUM_PACK_STATES.LOCKED;
  return normalizePaymentMode(paymentsMode) === 'disabled'
    ? PREMIUM_PACK_STATES.UNAVAILABLE
    : PREMIUM_PACK_STATES.PAID;
}

export function isPremiumPackState(state) {
  return KNOWN_STATES.has(state);
}

export function packTotalMinutes(pack = SHOWCASE_PREMIUM_PACK) {
  return (Array.isArray(pack.items) ? pack.items : [])
    .reduce((total, item) => total + safePositiveNumber(item.est_minutes), 0);
}

export function packStateLabel(state) {
  return PREMIUM_PACK_STATE_LABELS[state] || PREMIUM_PACK_STATE_LABELS[PREMIUM_PACK_STATES.UNAVAILABLE];
}

