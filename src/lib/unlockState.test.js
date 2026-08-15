import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildJourneyView,
  formatRequirement,
  isKnownReasonCode,
  isUnlockLockedPayload,
  nextActionForRequirement,
  normalizeSnapshot,
  prepareRecommendations,
  REASON_CODES,
  reasonText,
  reasonTitle,
  RECOMMENDATION_REASONS,
  recommendationReasonText,
  UNLOCK_STATES,
} from './unlockState.js';

test('every stable reason code maps to concise Russian title and text', () => {
  for (const code of Object.values(REASON_CODES)) {
    assert.ok(reasonTitle(code).trim().length > 0, `${code} needs a title`);
    assert.ok(reasonText(code).trim().length > 0, `${code} needs text`);
    assert.equal(isKnownReasonCode(code), true);
  }
  assert.equal(isKnownReasonCode('NOT_A_CODE'), false);
});

test('premium reason stays neutral and never advertises a payment path', () => {
  const text = reasonText(REASON_CODES.PREMIUM_REQUIRED);
  assert.match(text, /Контент сейчас недоступен/);
  assert.doesNotMatch(text, /Premium|Stars|купить|покупк|прогресс откроет/i);
  const action = nextActionForRequirement({
    rule_type: 'premium',
    target_value: 'col_premium',
    target: 120,
    current: 0,
    satisfied: false,
    progress: 0,
  });
  assert.equal(action, 'Контент сейчас недоступен.');
  assert.doesNotMatch(action, /Premium|Stars|купить|покупк/i);

  const formatted = formatRequirement({
    rule_type: 'premium',
    target_value: 'col_premium',
    target: 120,
    current: 0,
    satisfied: false,
    progress: 0,
  });
  assert.equal(formatted.progressText, 'Недоступно');
  assert.equal(formatted.label, 'Контент сейчас недоступен');
  assert.doesNotMatch(formatted.label, /Premium|Премиум|Stars/i);
});

test('recommendation reasons map to stable player-facing labels', () => {
  const expected = {
    [RECOMMENDATION_REASONS.CONTINUE_PROGRESS]: 'Продолжите начатую раскраску',
    [RECOMMENDATION_REASONS.THEME_AFFINITY]: 'Похоже на ваши любимые темы',
    [RECOMMENDATION_REASONS.COLLECTION_AFFINITY]: 'Из коллекции, которую вы раскрашиваете',
    [RECOMMENDATION_REASONS.DIFFICULTY_MATCH]: 'Подходит по сложности',
    [RECOMMENDATION_REASONS.DAILY_FEATURED]: 'Выбор дня',
    [RECOMMENDATION_REASONS.COLD_START]: 'Новое для вас',
  };
  for (const [code, label] of Object.entries(expected)) {
    assert.equal(recommendationReasonText(code), label);
  }
  assert.equal(recommendationReasonText('UNKNOWN'), 'Рекомендация');
});

test('formatRequirement builds bounded progress and exact next actions', () => {
  const level = formatRequirement({
    rule_type: 'level',
    target_value: '2',
    target: 2,
    current: 1,
    satisfied: false,
    progress: 0.5,
  });
  assert.equal(level.label, 'Уровень');
  assert.equal(level.percent, 50);
  assert.equal(level.progressText, '1 / 2');
  assert.match(level.nextAction, /Достигните уровня 2/);

  const streak = formatRequirement({
    rule_type: 'streak',
    target_value: '3',
    target: 3,
    current: 1,
    satisfied: false,
    progress: 1 / 3,
  });
  assert.match(streak.nextAction, /Раскрашивайте 3 дней подряд/);

  const collection = formatRequirement({
    rule_type: 'collection_completion',
    target_value: 'col_starter-path',
    label: 'Завершённая коллекция',
    target: 'col_starter-path',
    total: 2,
    current: 1,
    satisfied: false,
    progress: 0.5,
  });
  assert.equal(collection.progressText, '1 / 2');
  assert.match(collection.nextAction, /Завершите коллекцию целиком/);

  const achievement = formatRequirement({
    rule_type: 'achievement',
    target_value: 'ach_first_zone',
    label: 'Достижение',
    current: 0,
    satisfied: false,
    progress: 0,
  });
  assert.equal(achievement.progressText, 'Не открыто');
  assert.match(achievement.nextAction, /Откройте достижение/);
});

test('normalizeSnapshot caps lists and requirements defensively', () => {
  const raw = {
    progression_facts: { level: 1, xp_total: 10, completed_artworks: 0 },
    summary: { available: 2, owned: 1, progression_locked: 1, premium_locked: 1 },
    collections: Array.from({ length: 120 }, (_, index) => ({
      subject_type: 'collection',
      subject_id: `col_${index}`,
      title: `Коллекция ${index}`,
      state: UNLOCK_STATES.PROGRESSION_LOCKED,
      reason_code: REASON_CODES.LEVEL_REQUIRED,
      requirements: Array.from({ length: 12 }, (_, requirementIndex) => ({
        rule_type: 'level',
        target: 2,
        current: 1,
        satisfied: false,
        progress: 0.5,
        label: `req-${requirementIndex}`,
      })),
    })),
    templates: [],
    next_actionable: [],
  };
  const normalized = normalizeSnapshot(raw);
  assert.equal(normalized.collections.length, 100);
  assert.equal(normalized.collections[0].requirements.length, 6);
  assert.equal(normalized.summary.available, 2);
});

test('buildJourneyView ranks server next_actionable first with current/next', () => {
  const snapshot = {
    progression_facts: { level: 1, xp_total: 0, completed_artworks: 0 },
    summary: { available: 0, owned: 0, progression_locked: 2, premium_locked: 1 },
    collections: [
      {
        subject_type: 'collection',
        subject_id: 'col_starter-path',
        title: 'Путь новичка',
        state: UNLOCK_STATES.PROGRESSION_LOCKED,
        reason_code: REASON_CODES.PROGRESSION_REQUIRED,
        requirements: [],
      },
      {
        subject_type: 'collection',
        subject_id: 'col_premium-gallery',
        title: 'Premium-галерея',
        state: UNLOCK_STATES.PREMIUM_LOCKED,
        reason_code: REASON_CODES.PREMIUM_REQUIRED,
        requirements: [],
      },
    ],
    templates: [],
    next_actionable: [
      {
        subject_type: 'collection',
        subject_id: 'col_starter-path',
        title: 'Путь новичка',
        state: UNLOCK_STATES.PROGRESSION_LOCKED,
        reason_code: REASON_CODES.PROGRESSION_REQUIRED,
        requirements: [{ rule_type: 'level', target: 2, current: 1, satisfied: false, progress: 0.5 }],
        progress_ratio: 0.5,
        unlockable_now: false,
      },
      {
        subject_type: 'template',
        subject_id: 'color_streak_badge',
        title: 'Знак серии',
        state: UNLOCK_STATES.PROGRESSION_LOCKED,
        reason_code: REASON_CODES.STREAK_REQUIRED,
        requirements: [],
        progress_ratio: 0.2,
        unlockable_now: false,
      },
    ],
  };
  const journey = buildJourneyView(snapshot);
  assert.equal(journey.current.subject_id, 'col_starter-path');
  assert.equal(journey.next.subject_id, 'color_streak_badge');
  assert.equal(journey.current.requirements.length, 1);
  assert.equal(journey.counts.premium_locked, 1);
});

test('buildJourneyView falls back to available then progression-locked subjects', () => {
  const available = buildJourneyView({
    progression_facts: { level: 2 },
    summary: {},
    collections: [],
    templates: [{
      subject_type: 'template',
      subject_id: 'tpl_free',
      title: 'Свободная',
      state: UNLOCK_STATES.AVAILABLE,
      reason_code: REASON_CODES.AVAILABLE,
      requirements: [],
    }],
    next_actionable: [],
  });
  assert.equal(available.current.subject_id, 'tpl_free');

  const locked = buildJourneyView({
    progression_facts: { level: 1 },
    summary: {},
    collections: [],
    templates: [{
      subject_type: 'template',
      subject_id: 'tpl_locked',
      title: 'Закрытая',
      state: UNLOCK_STATES.PROGRESSION_LOCKED,
      reason_code: REASON_CODES.LEVEL_REQUIRED,
      requirements: [],
    }],
    next_actionable: [],
  });
  assert.equal(locked.current.subject_id, 'tpl_locked');
});

test('prepareRecommendations dedupes, excludes locked, and caps the list', () => {
  const items = [
    { id: 'a', title: 'A', reason_code: RECOMMENDATION_REASONS.COLD_START },
    { id: 'a', title: 'A duplicate', reason_code: RECOMMENDATION_REASONS.COLD_START },
    { id: 'b', title: 'B', unlock_state: UNLOCK_STATES.PREMIUM_LOCKED },
    { id: 'c', title: 'C', unlock_state: UNLOCK_STATES.PROGRESSION_LOCKED },
    { id: 'd', title: 'D', reason_code: RECOMMENDATION_REASONS.CONTINUE_PROGRESS },
    { id: 'e', title: 'E', reason_code: 'UNKNOWN' },
  ];
  const prepared = prepareRecommendations(items, { limit: 3 });
  assert.deepEqual(prepared.map((item) => item.id), ['a', 'd', 'e']);
  assert.equal(prepared[1].reason_code, RECOMMENDATION_REASONS.CONTINUE_PROGRESS);
  assert.equal(prepared[2].reason_code, RECOMMENDATION_REASONS.COLD_START);

  const capped = prepareRecommendations(Array.from({ length: 50 }, (_, index) => ({ id: `x${index}`, title: `X ${index}` })));
  assert.equal(capped.length, 8);
  assert.equal(prepareRecommendations(null).length, 0);
});

test('locked payload detection covers direct-ID 403 shapes', () => {
  assert.equal(isUnlockLockedPayload({ state: UNLOCK_STATES.PREMIUM_LOCKED }), true);
  assert.equal(isUnlockLockedPayload({ state: 'unknown' }), false);
  assert.equal(isUnlockLockedPayload(null), false);
});
