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
  assert.match(app, /<BottomNavigation\b[^>]*\bonNavigate=\{navigatePrimary\}/);
  assert.match(
    app,
    /\['catalog',\s*'create',\s*'profile'\]\.includes\(initialResume\?\.route\)/,
    'resume fallback must preserve the three primary destinations',
  );
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
