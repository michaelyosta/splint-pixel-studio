import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { getCatalogHeroState, selectHeroPaintable } from '../src/lib/catalogHero.js';

async function load(path) {
  return readFile(new URL(path, import.meta.url), 'utf8');
}

test('hero CTA selection never recommends completed or self-created work and prefers unstarted free work', async () => {
  const source = await load('../src/views/CatalogView.jsx');
  assert.match(source, /data-catalog-hero-cta="true"/);
  assert.match(source, /selectHeroPaintable\(templates, mine, currentUser\?\.id\)/);
  assert.match(source, /onTrack\('hero_cta_open', \{ coloring_id: heroAction\.item\.id, source: 'hero' \}\)/);
  const ctaCount = (source.match(/data-catalog-hero-cta="true"/g) || []).length;
  assert.equal(ctaCount, 1, 'exactly one dominant hero CTA');

  const items = [
    { id: 'finished', access: 'free' },
    { id: 'finished-flag', access: 'free', is_completed: true },
    { id: 'created', access: 'free', owner_id: 'viewer' },
    { id: 'started', access: 'free' },
    { id: 'unstarted', access: 'free' },
    { id: 'premium', access: 'premium' },
  ];
  const mine = [
    { id: 'finished', progress: { percent: 100 } },
    { id: 'started', progress: { percent: 42 } },
  ];
  assert.equal(selectHeroPaintable(items, mine, 'viewer').id, 'unstarted');
  assert.equal(selectHeroPaintable(items.filter((item) => item.id !== 'unstarted'), mine, 'viewer').id, 'started');
  assert.equal(selectHeroPaintable(items.slice(0, 2), mine, 'viewer'), null);
  assert.equal(selectHeroPaintable([items[1]], [], 'viewer'), null);
});

test('hero state is full only for a fresh user and offers the right returning action', () => {
  assert.equal(getCatalogHeroState([]).kind, 'fresh');
  const unfinished = { id: 'continue', title: 'В лесу', progress: { percent: 35 } };
  assert.deepEqual(getCatalogHeroState([unfinished]), {
    kind: 'continue', unfinished, finishedCount: 0, createdCount: 0,
  });
  assert.equal(getCatalogHeroState([{ id: 'finished', progress: { percent: 100 } }]).kind, 'returning');
  assert.equal(getCatalogHeroState([{ id: 'created', owner_id: 'viewer' }], 'viewer').createdCount, 1);
});

test('first-run guide is static guidance: 3 steps, dismissible, persisted, no progression', async () => {
  const component = await load('../src/components/FirstRunGuide.jsx');
  const hook = await load('../src/hooks/useFirstRunGuide.js');
  const stepCount = (component.match(/\{ title: '/g) || []).length;
  assert.equal(stepCount, 3, 'max 3 static coach steps');
  assert.match(component, /data-first-run-guide="true"/);
  assert.match(component, /Понятно, начать/);
  assert.match(hook, /splint:first-run-guide:v1/);
  assert.match(hook, /setItem\(FIRST_RUN_GUIDE_STORAGE_KEY, DISMISSED_VALUE\)/);
  assert.match(hook, /getItem\(FIRST_RUN_GUIDE_STORAGE_KEY\) === DISMISSED_VALUE/);
  for (const source of [component, hook]) {
    assert.doesNotMatch(source, /\bXP\b|уровень|достижени|наград|streak|серия|session-goal/i);
  }
  assert.doesNotMatch(component, /animation|transition|framer|motion/i);
});

test('guide renders inline at the top of the default catalog showcase only', async () => {
  const source = await load('../src/views/CatalogView.jsx');
  assert.match(source, /import FirstRunGuide from '\.\.\/components\/FirstRunGuide\.jsx'/);
  assert.match(source, /const \{ guideVisible, dismissGuide \} = useFirstRunGuide\(\)/);
  assert.match(source, /\{guideVisible && <FirstRunGuide onDismiss=\{dismissGuide\} \/>\}/);
  const heroAt = source.indexOf('data-catalog-hero data-hero-state=');
  const guideAt = source.indexOf('{guideVisible && <FirstRunGuide');
  assert.ok(guideAt > -1 && guideAt < heroAt, 'guide sits above the hero');
});

test('loading and empty states tell the user what happens next', async () => {
  const source = await load('../src/views/CatalogView.jsx');
  assert.match(source, /data-catalog-loading-hint="true"/);
  assert.match(source, /Подбираем картины… Дальше выбери любую и нажми «Начать раскрашивать»/);
  assert.match(source, /нажми «Обновить», затем выбери картину и нажми «Начать раскрашивать»/);
});

test('clarity additions keep catalog contracts: hero copy, teaser, chips, fail-closed premium', async () => {
  const source = await load('../src/views/CatalogView.jsx');
  assert.match(source, /\{templates\.length\} сцен/);
  assert.match(source, /<PremiumPackTeaser pack=\{premiumPack\} state=\{premiumState\} onOpen=\{\(\) => onChangeChip\('premium'\)\} \/>/);
  assert.match(source, /data-premium-gallery-block/);
  assert.match(source, /const isLockedPremium = isPremiumArtworkLocked\(item, \{ entitlement: premiumEntitlement, userId: currentUser\?\.id \}\)/);
});
