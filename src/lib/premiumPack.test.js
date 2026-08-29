import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PREMIUM_PACK_STATES,
  SHOWCASE_PREMIUM_PACK,
  evaluatePremiumItemQuality,
  evaluatePremiumPackQuality,
  findPremiumEntitlement,
  isCuratedPremiumPack,
  mergeShowcasePackServerProjection,
  packTotalMinutes,
  resolvePremiumPackState,
} from './premiumPack.js';
import { formatPackContentMetadata } from './contentMetadata.js';

test('showcase pack meets the bounded curated-content quality bar', () => {
  const result = evaluatePremiumPackQuality(SHOWCASE_PREMIUM_PACK);
  assert.equal(result.pass, true);
  assert.equal(result.items.length, 2);
  assert.equal(isCuratedPremiumPack(SHOWCASE_PREMIUM_PACK), true);
  assert.equal(packTotalMinutes(SHOWCASE_PREMIUM_PACK), 12);
  assert.ok(SHOWCASE_PREMIUM_PACK.items.every((item) => item.content_metadata?.schema_version === 'content-metadata.v1'));
  assert.equal(formatPackContentMetadata(SHOWCASE_PREMIUM_PACK), 'Средняя · около 6 мин · Сосредоточенная');
});

test('quality gate rejects noisy or incomplete pack items', () => {
  const result = evaluatePremiumItemQuality({
    preview_url: '/preview.png',
    est_minutes: 4,
    first_segment: '',
    visual_beats: 2,
    micro_region_ratio: 0.2,
    final_reveal: false,
    identity: true,
    editorial_quality: 'noisy',
  });
  assert.equal(result.pass, false);
  assert.equal(result.checks.raster_quality, false);
  assert.equal(result.checks.visual_beats, false);
});

test('state resolver shows preview while entitlement is loading', () => {
  assert.equal(resolvePremiumPackState({ snapshotStatus: 'loading' }), PREMIUM_PACK_STATES.PREVIEW);
});

test('state resolver never turns a payment intent into ownership', () => {
  assert.equal(resolvePremiumPackState({ paymentsMode: 'telegram_stars' }), PREMIUM_PACK_STATES.PAID);
  assert.equal(resolvePremiumPackState({ paymentsMode: 'disabled' }), PREMIUM_PACK_STATES.UNAVAILABLE);
  assert.equal(resolvePremiumPackState({ paymentsMode: 'telegram_stars', entitlement: { state: 'owned' } }), PREMIUM_PACK_STATES.OWNED);
  assert.equal(resolvePremiumPackState({ paymentsMode: 'telegram_stars', entitlement: { owned: false } }), PREMIUM_PACK_STATES.PAID);
});

test('free and locked states remain available to the same view-model', () => {
  const freePack = { ...SHOWCASE_PREMIUM_PACK, id: 'free-pack', pack_type: 'free' };
  assert.equal(resolvePremiumPackState({ pack: freePack }), PREMIUM_PACK_STATES.FREE);
  const lockedPack = { ...freePack, pack_type: 'premium', requires_free_completion: true };
  assert.equal(resolvePremiumPackState({ pack: lockedPack, prerequisitesMet: false, paymentsMode: 'telegram_stars' }), PREMIUM_PACK_STATES.LOCKED);
});

test('entitlement lookup is bounded to collection and template subjects', () => {
  const snapshot = {
    collections: [{ subject_id: 'other', owned: true }],
    templates: [{ subject_id: SHOWCASE_PREMIUM_PACK.id, state: 'owned', owned: true }],
  };
  assert.equal(findPremiumEntitlement(snapshot)?.subject_id, SHOWCASE_PREMIUM_PACK.id);
  assert.equal(findPremiumEntitlement({ collections: [] }), null);
});

test('showcase preview merges server metadata and keeps the explicit image fallback', () => {
  const serverProjection = {
    id: SHOWCASE_PREMIUM_PACK.id,
    title: 'Премиум-галерея',
    pack_type: 'premium',
    price_in_stars: 120,
    image_url: null,
    total_count: 2,
    content_metadata: {
      schema_version: 'content-metadata.v1',
      duration: { band: 'medium', label: 'Средняя · около 6 мин · подборка' },
      complexity: { band: 'focused', label: 'Сосредоточенная · подборка' },
      quality_gate: { status: 'review' },
    },
  };
  const merged = mergeShowcasePackServerProjection(SHOWCASE_PREMIUM_PACK, serverProjection);
  assert.equal(merged.id, SHOWCASE_PREMIUM_PACK.id);
  assert.equal(merged.price_in_stars, 120);
  assert.equal(merged.content_metadata.duration.label, 'Средняя · около 6 мин · подборка');
  assert.equal(merged.image_url, SHOWCASE_PREMIUM_PACK.image_url);
  assert.deepEqual(merged.items.map((item) => item.id), ['color_premium_whale', 'color_premium_dragon']);

  const unrelated = mergeShowcasePackServerProjection(SHOWCASE_PREMIUM_PACK, { ...serverProjection, id: 'other-pack', price_in_stars: 1 });
  assert.equal(unrelated, SHOWCASE_PREMIUM_PACK);
});

