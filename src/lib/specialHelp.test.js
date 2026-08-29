import test from 'node:test';
import assert from 'node:assert/strict';
import {
  defaultSpecialHelpState,
  hasSpecialsInProgress,
  markSpecialHelpRead,
  markSpecialIntroSeen,
  markSpecialKindSeen,
  normalizeSpecialKind,
  readSpecialHelpState,
  shouldShowSpecialIntro,
  shouldShowSpecialKindHint,
  SPECIAL_HELP_ITEMS,
  SPECIAL_HELP_KINDS,
  specialHelpItem,
  specialKindsInProgress,
  writeSpecialHelpState,
} from './specialHelp.js';

function memoryStorage() {
  const values = new Map();
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); },
    _values: values,
  };
}

test('special help covers exactly the six frozen kinds in a stable order', () => {
  assert.deepEqual(SPECIAL_HELP_KINDS, ['spark', 'bomb', 'fuse', 'choice', 'hazard', 'artifact']);
  assert.deepEqual(SPECIAL_HELP_ITEMS.map((item) => item.kind), SPECIAL_HELP_KINDS);
  for (const item of SPECIAL_HELP_ITEMS) {
    assert.ok(item.label.trim().length > 0, `${item.kind} needs a label`);
    assert.ok(item.short.trim().length > 0, `${item.kind} needs a short description`);
  }
  for (const kind of SPECIAL_HELP_KINDS) {
    assert.equal(specialHelpItem(kind).kind, kind);
  }
});

test('kind normalization accepts aliases and rejects unknown kinds', () => {
  assert.equal(normalizeSpecialKind('SPARK'), 'spark');
  assert.equal(normalizeSpecialKind(' Bomb '), 'bomb');
  assert.equal(normalizeSpecialKind(''), null);
  assert.equal(normalizeSpecialKind('jammer'), null);
  assert.equal(normalizeSpecialKind(null), null);
  assert.equal(specialHelpItem('unknown'), null);
});

test('read/write state is safe against missing or corrupt storage', () => {
  const storage = memoryStorage();
  const fallback = defaultSpecialHelpState();
  assert.deepEqual(readSpecialHelpState(null), fallback);
  assert.deepEqual(readSpecialHelpState(storage), fallback);

  storage.setItem('splint_special_help_v1', '{broken');
  assert.deepEqual(readSpecialHelpState(storage), fallback);

  const state = { version: 1, introSeen: true, kinds: ['SPARK', 'bomb', 'bomb'] };
  assert.equal(writeSpecialHelpState(storage, state), true);
  assert.deepEqual(readSpecialHelpState(storage), {
    version: 1,
    introSeen: true,
    kinds: ['spark', 'bomb'],
  });
  assert.equal(writeSpecialHelpState(storage, { ...state, kinds: ['unknown'] }), true);
  assert.deepEqual(readSpecialHelpState(storage).kinds, []);
});

test('kind and intro markers persist only the first time', () => {
  let state = defaultSpecialHelpState();
  state = markSpecialKindSeen(state, 'spark');
  assert.deepEqual(state.kinds, ['spark']);
  assert.equal(state, markSpecialKindSeen(state, 'spark'));
  state = markSpecialKindSeen(state, 'nope');
  assert.deepEqual(state.kinds, ['spark']);
  assert.equal(shouldShowSpecialKindHint(state, 'spark'), false);
  assert.equal(shouldShowSpecialKindHint(state, 'bomb'), true);

  state = markSpecialIntroSeen(state);
  assert.equal(state.introSeen, true);
  assert.equal(state, markSpecialIntroSeen(state));
});

test('reading the full legend marks only the intro and preserves kind hints', () => {
  const state = markSpecialHelpRead(defaultSpecialHelpState());
  assert.equal(state.introSeen, true);
  assert.deepEqual(state.kinds, []);
  assert.equal(shouldShowSpecialIntro(state, { hasSpecials: true, legacyOnboardingSeen: true }), false);
  for (const kind of SPECIAL_HELP_KINDS) {
    assert.equal(shouldShowSpecialKindHint(state, kind), true);
  }
});

test('intro completion does not suppress the first hint for each later kind', () => {
  let state = markSpecialIntroSeen(defaultSpecialHelpState());
  for (const kind of ['bomb', 'fuse', 'choice', 'hazard', 'artifact']) {
    assert.equal(shouldShowSpecialKindHint(state, kind), true);
    state = markSpecialKindSeen(state, kind);
    assert.equal(shouldShowSpecialKindHint(state, kind), false);
  }
  assert.equal(shouldShowSpecialKindHint(state, 'spark'), true);
});

test('reload after a contextual hint does not repeat that kind', () => {
  const storage = memoryStorage();
  let state = markSpecialKindSeen(defaultSpecialHelpState(), 'bomb');
  assert.equal(writeSpecialHelpState(storage, state), true);
  const reloaded = readSpecialHelpState(storage);
  assert.equal(shouldShowSpecialKindHint(reloaded, 'bomb'), false);
  assert.equal(shouldShowSpecialKindHint(reloaded, 'fuse'), true);
});

test('artifact help describes local picture fragments without a collection', () => {
  const artifact = specialHelpItem('artifact');
  assert.match(artifact.short, /этой картине/);
  assert.match(artifact.short, /прогресс/);
  assert.doesNotMatch(artifact.short, /коллекци/i);
});

test('intro gating requires specials and a completed legacy onboarding', () => {
  let state = defaultSpecialHelpState();
  assert.equal(shouldShowSpecialIntro(state, { hasSpecials: true, legacyOnboardingSeen: false }), false);
  assert.equal(shouldShowSpecialIntro(state, { hasSpecials: false, legacyOnboardingSeen: true }), false);
  assert.equal(shouldShowSpecialIntro(state, { hasSpecials: true, legacyOnboardingSeen: true, treatment: false }), false);
  assert.equal(shouldShowSpecialIntro(state, { hasSpecials: true, legacyOnboardingSeen: true, treatment: true }), true);
  state = markSpecialIntroSeen(state);
  assert.equal(shouldShowSpecialIntro(state, { hasSpecials: true, legacyOnboardingSeen: true }), false);
});

test('control cohort never counts diagnostics or markers for automatic onboarding', () => {
  assert.equal(hasSpecialsInProgress({
    specials_experiment_group: 'control',
    special_diagnostics: { special_count: 2 },
  }), false);
  assert.equal(hasSpecialsInProgress({
    specials_experiment_group: 'control',
    specials: [{ kind: 'spark' }],
  }), false);
  assert.equal(shouldShowSpecialIntro(defaultSpecialHelpState(), {
    hasSpecials: true,
    legacyOnboardingSeen: true,
    treatment: false,
  }), false);
});

test('treatment progress specials are detected for legacy and tiled payloads', () => {
  assert.equal(hasSpecialsInProgress(null), false);
  assert.equal(hasSpecialsInProgress({ specials_experiment_group: 'control' }), false);
  assert.equal(hasSpecialsInProgress({ special_diagnostics: { special_count: 2 } }), false);
  assert.equal(hasSpecialsInProgress({ specials_experiment_group: 'treatment', specials: [] }), true);
  assert.equal(hasSpecialsInProgress({
    specials_experiment_group: 'treatment',
    specials: [{ kind: 'spark' }],
  }), true);
  assert.equal(hasSpecialsInProgress({
    specials_experiment_group: 'treatment',
    special_diagnostics: { special_count: 2 },
  }), true);
  assert.equal(hasSpecialsInProgress({ specials_experiment_group: 'treatment' }), true);
  assert.deepEqual(specialKindsInProgress({ specials: [
    { kind: 'spark' },
    { kind: 'artifact' },
    { kind: 'SPARK' },
    { kind: 'jammer' },
  ] }), ['spark', 'artifact']);
  assert.deepEqual(specialKindsInProgress({}), []);
});
