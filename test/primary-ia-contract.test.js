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
  assert.deepEqual(staticRoutes(header).filter((route) => route !== 'admin'), ['catalog', 'profile']);
  assert.match(header, /adminAccess\s*&&[\s\S]*navigatePrimary\('admin'\)/, 'admin route must remain conditional on server ACL');
  assert.match(header, /className="brand-button"[\s\S]*navigatePrimary\('catalog'\)/);
  assert.match(header, /className="header-profile-button"[\s\S]*navigatePrimary\('profile'\)/);
  assert.match(app, /view !== 'play' && !coreFeelExperiment\.enabled && <BottomNavigation activeView=\{view\} onNavigate=\{navigatePrimary\}/);
  assert.match(
    app,
    /\['catalog',\s*'create',\s*'profile'\]\.includes\(initialResume\?\.route\)/,
    'resume fallback must preserve the three primary destinations',
  );
});

test('application shell keeps navigation in normal flow outside the resizing content frame', () => {
  const app = source('src/App.jsx');
  const styles = source('src/App.css');
  const containerRule = styles.match(/(?:^|\n)\.app-container\s*\{([\s\S]*?)\}/)?.[1] || '';
  const frameRule = styles.match(/(?:^|\n)\.telegram-frame\s*\{([\s\S]*?)\}/)?.[1] || '';
  const contentRule = styles.match(/\.screen-content\s*\{([\s\S]*?)\}/)?.[1] || '';
  const navigationRule = styles.match(/(?:^|\n)\.app-tab-bar\s*\{([\s\S]*?)\}/)?.[1] || '';
  const redesignedButtonRule = styles.match(/\.app-tab-bar--redesigned > button\s*\{([\s\S]*?)\}/)?.[1] || '';
  const redesignedNavigationRule = styles.match(/(?:^|\n)\.app-tab-bar--redesigned\s*\{([\s\S]*?)\}/)?.[1] || '';

  assert.match(containerRule, /display:\s*flex/);
  assert.match(containerRule, /flex-direction:\s*column/);
  assert.match(containerRule, /position:\s*relative/);
  assert.doesNotMatch(containerRule, /display:\s*grid|grid-template-rows/);
  // 2026-09-29 migration: the frame is capped to the real viewport. Telegram's
  // stable-height var alone can exceed the visible mini-app area (measured a
  // 655px frame inside a 599px Web panel), pushing the in-flow tab bar below
  // the fold. min(..., 100%) keeps the bar pinned without touching paint.
  assert.match(frameRule, /height:\s*min\(var\(--tg-viewport-stable-height,\s*100dvh\),\s*100%\)/);
  assert.match(frameRule, /max-height:\s*min\(var\(--tg-viewport-stable-height,\s*100dvh\),\s*100%\)/);
  assert.match(frameRule, /display:\s*flex/);
  assert.match(frameRule, /flex-direction:\s*column/);
  // The content clip must live on the container that does NOT hold the bar.
  assert.match(containerRule, /flex:\s*1 1 auto/);
  assert.match(containerRule, /min-height:\s*0/);
  assert.match(containerRule, /border-radius:\s*inherit/);
  assert.match(containerRule, /overflow:\s*hidden/);
  assert.doesNotMatch(frameRule, /overflow:\s*(?:hidden|clip)|clip-path\s*:|transform\s*:|filter\s*:|contain:\s*paint/);
  const containerAt = app.indexOf('<div className="app-container">');
  const navigationAt = app.indexOf('{showChrome && <BottomNavigation');
  assert.ok(containerAt > 0 && navigationAt > containerAt, 'the bar must follow the content container inside the frame');
  assert.match(app.slice(containerAt, navigationAt), /screen-content/);
  assert.doesNotMatch(app.slice(containerAt, navigationAt), /BottomNavigation/);
  assert.match(styles, /html, body, #root\s*\{[^}]*overflow:\s*hidden/);
  assert.match(contentRule, /flex:\s*1/);
  assert.match(contentRule, /min-height:\s*0/);
  assert.match(contentRule, /overflow-y:\s*auto/);
  assert.doesNotMatch(contentRule, /padding-bottom:\s*96px/);
  assert.match(navigationRule, /position:\s*relative/);
  assert.match(navigationRule, /flex:\s*0 0 auto/);
  assert.match(navigationRule, /margin:\s*8px 10px calc\(10px \+ env\(safe-area-inset-bottom,\s*0px\)\)/);
  assert.doesNotMatch(navigationRule, /backdrop-filter\s*:/);
  assert.doesNotMatch(redesignedNavigationRule, /(?:left|right|bottom|transform):\s*/);
  assert.match(styles, /\.telegram-frame\[data-platform='telegram'\] \.page\s*\{\s*animation:\s*none;/);
  assert.doesNotMatch(styles, /\.app-tab-bar > button svg\s*\{[\s\S]*?transform/);
  assert.doesNotMatch(styles, /\.app-tab-bar > button\.active svg\s*\{[\s\S]*?transform/);
  // Three primary destinations share the bar equally. The legacy five-tab
  // `width: 20%` rule (still present on `.app-tab-bar > button`) would leave a
  // three-tab bar at 60% width with a dead 40% tail.
  assert.match(redesignedButtonRule, /flex:\s*1 1 0/);
  assert.match(redesignedButtonRule, /width:\s*auto/);
  assert.doesNotMatch(redesignedButtonRule, /width:\s*\d+%/);
  const navigationRules = [...styles.matchAll(/([^{}]*app-tab-bar[^{}]*)\{([^{}]*)\}/g)];
  assert.ok(navigationRules.length > 0, 'navigation CSS rules must remain explicit');
  assert.doesNotMatch(navigationRules.map(([, , declarations]) => declarations).join('\n'), /\b(?:transform|transition|animation)\s*:/);
  for (const [, selector, declarations] of navigationRules.filter(([, selector]) => selector.includes('.active'))) {
    assert.doesNotMatch(declarations, /\b(?:box-shadow|text-shadow|transform|transition|animation)\s*:/, `active navigation feedback stays to color, opacity, background, or border: ${selector.trim()}`);
  }
  assert.doesNotMatch(app, /createPortal|shellGeneration|telegramStartupBlocked|app-container--play/);
});

test('navigation has no clipping or paint boundary in its ancestor chain', () => {
  const styles = source('src/App.css');
  const app = source('src/App.jsx');
  const frameRule = styles.match(/(?:^|\n)\.telegram-frame\s*\{([\s\S]*?)\}/)?.[1] || '';
  const bodyRule = styles.match(/(?:^|\n)body\s*\{([\s\S]*?)\}/)?.[1] || '';

  assert.ok(frameRule, 'the frame keeps a dedicated viewport rule');
  // `.telegram-frame` is the only element between the bar and the document, so
  // it must never clip or promote a paint layer for the navigation.
  assert.doesNotMatch(frameRule, /\b(?:overflow\s*:\s*(?:hidden|clip)|clip-path\s*:|transform\s*:|filter\s*:|contain\s*:\s*paint)/);
  assert.doesNotMatch(bodyRule, /\btransform\s*:|\bfilter\s*:|contain\s*:\s*paint/);
  const containerAt = app.indexOf('<div className="app-container">');
  const navigationAt = app.indexOf('{showChrome && <BottomNavigation');
  assert.ok(containerAt > 0 && navigationAt > containerAt, 'navigation must be a sibling of the content container');
  assert.doesNotMatch(app.slice(containerAt, navigationAt), /BottomNavigation/);
});

test('navigation shell contains no speculative iOS paint workarounds', () => {
  const app = source('src/App.jsx');
  const styles = source('src/App.css');
  const telegram = source('src/lib/telegram.js');
  const main = source('src/main.jsx');

  assert.doesNotMatch(app, /createPortal|isRealTelegramIosSession|iosNavigationHost|shellGeneration|telegramStartupBlocked/);
  assert.doesNotMatch(styles, /ios-primary|primary-navigation--portal|telegram-startup-surface|data-tg-ios|app-tab-bar--repaint|translateZ\(0\)|grid-template-rows/);
  assert.doesNotMatch(telegram, /syncTelegramViewportCssVars|bindTelegramViewportLifecycle|requestFullscreen|exitFullscreen/);
  assert.doesNotMatch(main, /ViewportSelfHeal|viewportDiagnostic|flushSync|shellGeneration/);
  assert.match(telegram, /webApp\.ready\(\)[\s\S]*webApp\.expand\?\.\(\)/);
  assert.doesNotMatch(telegram, /shouldAutoExpandTelegramWebApp/);
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
