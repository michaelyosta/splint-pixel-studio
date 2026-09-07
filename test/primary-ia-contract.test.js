import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const primaryDestinations = [
  { id: 'catalog', label: 'Каталог' },
  { id: 'create', label: 'Создать' },
  { id: 'profile', label: 'Профиль' },
];

function source(relativePath) {
  return readFileSync(resolve(repoRoot, relativePath), 'utf8');
}

function staticRoutes(text, pattern = /(?:navigatePrimary|setView)\(\s*'([^']+)'\s*\)/g) {
  return [...text.matchAll(pattern)].map((match) => match[1]);
}

test('BottomNavigation declares exactly the three primary destinations', () => {
  const navigation = source('src/components/BottomNavigation.jsx');
  const itemsBody = navigation.match(/const ITEMS\s*=\s*\[([\s\S]*?)\];/)?.[1];

  assert.ok(itemsBody, 'BottomNavigation must keep a static ITEMS declaration');
  assert.deepEqual(
    [...itemsBody.matchAll(/\bid\s*:\s*['"]([^'"]+)['"]/g)].map((match) => match[1]),
    primaryDestinations.map(({ id }) => id),
  );
  assert.deepEqual(
    [...itemsBody.matchAll(/\blabel\s*:\s*['"]([^'"]+)['"]/g)].map((match) => match[1]),
    primaryDestinations.map(({ label }) => label),
  );
  assert.match(navigation, /<nav\b[\s\S]*aria-label="Основная навигация"/);
});

test('app header and default shell expose only primary navigation routes', () => {
  const app = source('src/App.jsx');
  const header = app.match(/<header\b[\s\S]*?<\/header>/)?.[0];

  assert.ok(header, 'App must keep a header navigation surface');
  assert.deepEqual(staticRoutes(header), ['catalog', 'profile']);
  assert.match(header, /className="brand-button"[\s\S]*navigatePrimary\('catalog'\)/);
  assert.match(header, /className="header-profile-button"[\s\S]*navigatePrimary\('profile'\)/);
  assert.match(app, /view !== 'play' && !coreFeelExperiment\.enabled && <BottomNavigation activeView=\{view\} onNavigate=\{navigatePrimary\}/);
  assert.match(
    app,
    /\['catalog',\s*'create',\s*'profile'\]\.includes\(initialResume\?\.route\)/,
    'resume fallback must preserve the three primary destinations',
  );
});

test('application shell restores the known-good flex and absolute navigation contract', () => {
  const app = source('src/App.jsx');
  const styles = source('src/App.css');
  const containerRule = styles.match(/\.app-container\s*\{([\s\S]*?)\}/)?.[1] || '';
  const contentRule = styles.match(/\.screen-content\s*\{([\s\S]*?)\}/)?.[1] || '';
  const navigationRule = styles.match(/(?:^|\n)\.app-tab-bar\s*\{([\s\S]*?)\}/)?.[1] || '';
  const redesignedButtonRule = styles.match(/\.app-tab-bar--redesigned > button\s*\{([\s\S]*?)\}/)?.[1] || '';

  assert.match(containerRule, /display:\s*flex/);
  assert.match(containerRule, /flex-direction:\s*column/);
  assert.match(containerRule, /position:\s*relative/);
  assert.doesNotMatch(containerRule, /display:\s*grid|grid-template-rows/);
  assert.match(contentRule, /flex:\s*1/);
  assert.match(contentRule, /min-height:\s*0/);
  assert.match(contentRule, /overflow-y:\s*auto/);
  assert.match(contentRule, /padding-bottom:\s*96px/);
  assert.match(navigationRule, /position:\s*absolute/);
  assert.match(navigationRule, /bottom:\s*calc\(10px \+ env\(safe-area-inset-bottom,\s*0px\)\)/);
  assert.match(navigationRule, /backdrop-filter:\s*blur\(14px\)/);
  assert.match(redesignedButtonRule, /width:\s*20%/);
  assert.doesNotMatch(app, /createPortal|shellGeneration|telegramStartupBlocked|app-container--play/);
});

test('navigation shell contains no post-regression iOS paint workarounds', () => {
  const app = source('src/App.jsx');
  const styles = source('src/App.css');
  const telegram = source('src/lib/telegram.js');
  const main = source('src/main.jsx');

  assert.doesNotMatch(app, /createPortal|isRealTelegramIosSession|iosNavigationHost|shellGeneration|telegramStartupBlocked/);
  assert.doesNotMatch(styles, /ios-primary|primary-navigation--portal|telegram-startup-surface|data-tg-ios|app-tab-bar--repaint|translateZ\(0\)|grid-template-rows/);
  assert.doesNotMatch(telegram, /isRealTelegramIosSession|shouldAutoExpandTelegramWebApp|syncTelegramViewportCssVars|bindTelegramViewportLifecycle|requestFullscreen|exitFullscreen/);
  assert.doesNotMatch(main, /ViewportSelfHeal|viewportDiagnostic|flushSync|shellGeneration/);
  assert.match(telegram, /webApp\.ready\(\)[\s\S]*webApp\.expand\?\.\(\)/);
});

test('profile CTAs stay within primary IA while secondary routes remain implementation details', () => {
  const profile = source('src/views/ProfileView.jsx');
  const routes = staticRoutes(profile, /onNavigate\(\s*'([^']+)'\s*\)/g);

  assert.ok(routes.length >= 2, 'profile must retain catalog and create CTAs');
  assert.deepEqual([...new Set(routes)].sort(), ['catalog', 'create']);
  assert.match(profile, /onNavigate\('create'\)[\s\S]*Создать/);
  assert.match(profile, /onNavigate\('catalog'\)[\s\S]*Открыть каталог/);
});

test('CreateHub keeps import as the single primary CTA and collection management secondary', () => {
  const createHub = source('src/components/CreateHub.jsx');

  assert.equal((createHub.match(/create-hub-card--active/g) || []).length, 1);
  assert.match(createHub, /onClick=\{onImport\}/);
  assert.match(createHub, /create-hub-secondary[\s\S]*onClick=\{onCreatePack\}/);
});
