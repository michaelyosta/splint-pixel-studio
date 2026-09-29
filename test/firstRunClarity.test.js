import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

async function load(path) {
  return readFile(new URL(path, import.meta.url), 'utf8');
}

test('hero exposes one dominant open-and-paint CTA that prefers free artwork', async () => {
  const source = await load('../src/views/CatalogView.jsx');
  assert.match(source, /data-catalog-hero-cta="true"/);
  assert.match(source, /Начать раскрашивать/);
  assert.match(source, /const firstPaintable = popularTemplates\.find\(\(item\) => item\.access !== 'premium'\)/);
  assert.match(source, /onTrack\('hero_cta_open', \{ coloring_id: firstPaintable\.id, source: 'hero' \}\)/);
  const ctaCount = (source.match(/data-catalog-hero-cta="true"/g) || []).length;
  assert.equal(ctaCount, 1, 'exactly one dominant hero CTA');
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
  const heroAt = source.indexOf('<section className="catalog-hero"');
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
  assert.match(source, /const isLockedPremium = item\.access === 'premium' && !\(progressPercent > 0\)/);
});