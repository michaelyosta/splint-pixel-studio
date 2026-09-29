import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

let cached = null;
async function loadSource() {
  if (!cached) cached = await readFile(new URL('../src/views/CatalogView.jsx', import.meta.url), 'utf8');
  return cached;
}

test('default catalog is a staged showcase: hero, top shelves, premium gallery, collections, collapsed all-works', async () => {
  const source = await loadSource();
  const markers = [
    'data-catalog-hero',
    'topShelves.map(renderShelf)',
    'data-premium-gallery-block',
    'restShelves.map(renderShelf)',
    "renderCollectionGrid(catalogCollections, 'Коллекции витрины')",
    'data-catalog-all-works',
  ];
  let last = -1;
  for (const marker of markers) {
    const at = source.indexOf(marker);
    assert.ok(at > last, `showcase marker out of order or missing: ${marker}`);
    last = at;
  }
});

test('default view no longer dumps the full artwork grid on first paint', async () => {
  const source = await loadSource();
  assert.doesNotMatch(source, /searchedTemplates\.slice\(0, 12\)/);
  assert.doesNotMatch(source, /catalog-featured-grid/);
  assert.match(source, /data-catalog-all-works-toggle/);
  assert.match(source, /Показать все работы/);
  assert.match(source, /const \[allWorksExpanded, setAllWorksExpanded\] = useState\(false\)/);
});

test('showcase keeps the nine-shelf budget with popular and new on top', async () => {
  const source = await loadSource();
  assert.match(source, /SHOWCASE_SHELF_BUDGET = 9/);
  assert.match(source, /\['popular', 'new'\]\.map\(findShelf\)/);
  assert.match(source, /\['free', 'premium'\]\.map\(findShelf\)/);
});

test('locked premium artwork cards are badged and route to the premium showcase', async () => {
  const source = await loadSource();
  assert.match(source, /const isLockedPremium = item\.access === 'premium' && !\(progressPercent > 0\)/);
  assert.match(source, /catalog-art-premium-badge/);
  assert.match(source, /openPremiumShowcase\(item\)/);
  assert.match(source, /onChangeChip\('premium'\)/);
  assert.match(source, /Открыть витрину Premium Gallery для/);
  assert.match(source, /premiumPack\.price_in_stars\} Stars/);
});

test('showcase keeps catalog contracts: hero copy, teaser, chips, no progression UI', async () => {
  const source = await loadSource();
  assert.match(source, /\{templates\.length\} сцен/);
  assert.match(source, /<PremiumPackTeaser pack=\{premiumPack\} state=\{premiumState\} onOpen=\{\(\) => onChangeChip\('premium'\)\} \/>/);
  const chipsBlock = source.match(/const chipItems = \[([\s\S]*?)\];/);
  assert.ok(chipsBlock, 'chipItems block must exist');
  assert.deepEqual(
    [...chipsBlock[1].matchAll(/id: '([a-z]+)'/g)].map((entry) => entry[1]),
    ['all', 'free', 'collections'],
  );
  const showcaseBlock = source.slice(source.indexOf('topShelves.map(renderShelf)'));
  assert.doesNotMatch(showcaseBlock, /\bXP\b|уровень|достижени|серия|наград|streak/i);
});