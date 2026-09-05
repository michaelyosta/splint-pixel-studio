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

test('PrimaryNavigation declares exactly the three primary destinations', () => {
  const navigation = source('src/components/PrimaryNavigation.jsx');
  const itemsBody = navigation.match(/const ITEMS\s*=\s*\[([\s\S]*?)\];/)?.[1];

  assert.ok(itemsBody, 'PrimaryNavigation must keep a static ITEMS declaration');
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
  assert.match(app, /<PrimaryNavigation placement="top"[^>]*\bonNavigate=\{navigatePrimary\}/);
  assert.match(app, /<PrimaryNavigation activeView=\{view\}\s+onNavigate=\{navigatePrimary\}/);
  assert.doesNotMatch(app, /<PrimaryNavigation\b[^>]*\bkey=/, 'primary navigation must remain mounted across route commits');
  assert.match(
    app,
    /\['catalog',\s*'create',\s*'profile'\]\.includes\(initialResume\?\.route\)/,
    'resume fallback must preserve the three primary destinations',
  );
});

test('application shell keeps long content in a bounded middle grid row', () => {
  const app = source('src/App.jsx');
  const styles = source('src/App.css');
  const containerRule = styles.match(/\.app-container\s*\{([\s\S]*?)\}/)?.[1] || '';
  const playerRule = styles.match(/\.app-container--play\s*\{([\s\S]*?)\}/)?.[1] || '';
  const headerRule = styles.match(/\.app-header\s*\{([\s\S]*?)\}/)?.[1] || '';
  const contentRule = styles.match(/\.screen-content\s*\{([\s\S]*?)\}/)?.[1] || '';
  const navigationRule = styles.match(/\.app-tab-bar\s*\{([\s\S]*?)\}/)?.[1] || '';

  assert.match(containerRule, /display:\s*grid/);
  assert.match(containerRule, /grid-template-rows:\s*auto\s+minmax\(0,\s*1fr\)\s+auto/);
  assert.match(containerRule, /min-height:\s*0/);
  assert.match(containerRule, /overflow:\s*hidden/);
  assert.match(headerRule, /grid-row:\s*1/);
  assert.match(contentRule, /grid-row:\s*2/);
  assert.match(contentRule, /min-height:\s*0/);
  assert.match(contentRule, /min-width:\s*0/);
  assert.match(contentRule, /overflow-y:\s*auto/);
  assert.match(navigationRule, /grid-row:\s*3/);
  assert.match(playerRule, /display:\s*flex/);
  assert.match(app, /view === 'play' \? ' app-container--play' : ''/);
});

test('real Telegram iOS uses a top navigation row without rendering the bottom bar', () => {
  const app = source('src/App.jsx');
  const styles = source('src/App.css');
  const telegram = source('src/lib/telegram.js');
  const topShellRule = styles.match(/\.app-container--ios-primary-top\s*\{([\s\S]*?)\}/)?.[1] || '';
  const topNavigationRule = styles.match(/\.primary-navigation--top\s*\{([\s\S]*?)\}/)?.[1] || '';
  const topButtonRule = styles.match(/\.primary-navigation--top > button\s*\{([\s\S]*?)\}/)?.[1] || '';

  assert.match(telegram, /isRealTelegramSession\(webApp\)\s*&&\s*webApp\.platform === 'ios'/);
  assert.match(app, /showPrimaryNavigation && useIosTopNavigation && <PrimaryNavigation placement="top"/);
  assert.match(app, /showPrimaryNavigation && !useIosTopNavigation && <PrimaryNavigation/);
  assert.match(topShellRule, /grid-template-rows:\s*auto\s+54px\s+minmax\(0,\s*1fr\)/);
  assert.match(topNavigationRule, /grid-row:\s*2/);
  assert.match(topNavigationRule, /height:\s*54px/);
  assert.match(topNavigationRule, /grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(topButtonRule, /min-height:\s*44px/);
  assert.doesNotMatch(topNavigationRule, /\b(?:position|transform|filter|backdrop-filter|isolation|mix-blend-mode)\s*:/);
  assert.doesNotMatch(styles, /data-tg-ios|app-tab-bar--repaint|translateZ\(0\)/);
  assert.doesNotMatch(app, /scheduleTelegramBottomNavigationRouteRepaint|useLayoutEffect/);
  assert.doesNotMatch(telegram, /invalidateTelegramBottomNavigation|scheduleTelegramBottomNavigationRouteRepaint/);
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
