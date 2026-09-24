import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const serviceDirectory = dirname(fileURLToPath(import.meta.url));
const manifestPath = join(serviceDirectory, '..', '..', 'content', 'catalog-manifest.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const catalogAssetBaseUrl = String(process.env.CATALOG_ASSET_BASE_URL || '').replace(/\/+$/, '');

export function catalogAssetUrl(assetPath, baseUrl = catalogAssetBaseUrl) {
  const value = String(assetPath || '').replaceAll('\\', '/');
  if (!value) return null;
  const base = String(baseUrl || '').replace(/\/+$/, '');
  const generatedPrefix = 'public/assets/catalog/generated/';
  if (base && value.startsWith(generatedPrefix)) {
    const generatedPath = value.slice(generatedPrefix.length);
    const filename = generatedPath.split('/').at(-1);
    if (generatedPath.startsWith('covers/')) return `${base}/covers/${filename}`;
    if (filename.endsWith('-pixel.png')) return `${base}/previews/${filename}`;
    return `${base}/full/${filename}`;
  }
  return value.startsWith('public/') ? `/${value.slice('public/'.length)}` : value;
}

function unique(values) {
  return [...new Set(values.map((value) => String(value || '').trim().toLocaleLowerCase()).filter(Boolean))];
}

const entries = Array.isArray(manifest.entries) ? manifest.entries : [];
const entryById = new Map(entries.map((entry) => [entry.id, entry]));
const coverByParent = new Map((Array.isArray(manifest.covers) ? manifest.covers : [])
  .map((cover) => [cover.parent_id, cover]));
const rawCollections = new Map((Array.isArray(manifest.collections) ? manifest.collections : [])
  .map((collection) => [collection.id, collection]));
const collectionIds = [...new Set(entries.map((entry) => entry.collection_id).filter(Boolean))];

function derivedCollectionDefinition(collectionId, collectionEntries) {
  const first = collectionEntries[0] || {};
  const accessCounts = new Set(collectionEntries.map((entry) => entry.access));
  const albums = [...new Map(collectionEntries.map((entry) => [entry.album_id, {
    id: entry.album_id,
    slug: String(entry.album_id || '').replace(/^alb_[^_]+_/, ''),
    title: entry.album_title || entry.album_id,
    count: collectionEntries.filter((candidate) => candidate.album_id === entry.album_id).length,
  }])).values()];
  return {
    id: collectionId,
    slug: String(collectionId).replace(/^col_/, ''),
    title: first.collection_title || collectionId,
    access: accessCounts.size === 1 ? [...accessCounts][0] : 'mixed',
    theme: first.theme || 'featured',
    mood: first.mood || 'calm',
    season: first.season || ['evergreen'],
    albums,
  };
}

export const CATALOG_COLLECTIONS = (Array.isArray(manifest.collections) ? manifest.collections : [])
  .filter((collection) => collectionIds.includes(collection.id))
  .concat(collectionIds.filter((collectionId) => !rawCollections.has(collectionId)).map((collectionId) => derivedCollectionDefinition(collectionId, entries.filter((entry) => entry.collection_id === collectionId))))
  .map((collection, index) => {
    const collectionEntries = entries.filter((entry) => entry.collection_id === collection.id);
    const cover = coverByParent.get(collection.id);
    const albums = (Array.isArray(collection.albums) ? collection.albums : []).map((album, albumIndex) => {
      const albumEntries = collectionEntries.filter((entry) => entry.album_id === album.id);
      const albumCover = coverByParent.get(album.id);
      const albumAccess = albumEntries.length && albumEntries.every((entry) => entry.access === 'premium')
        ? 'premium'
        : 'free';
      return {
        ...album,
        access: albumAccess,
        count: albumEntries.length,
        free_count: albumEntries.filter((entry) => entry.access === 'free').length,
        premium_count: albumEntries.filter((entry) => entry.access === 'premium').length,
        cover_url: catalogAssetUrl(albumCover?.optimized_asset || albumCover?.source_asset),
        featured_rank: index * 100 + albumIndex * 10,
      };
    });
    return {
      ...collection,
      pack_type: 'free',
      price_in_stars: 0,
      rarity: collection.access === 'premium' ? 'epic' : 'common',
      total_artworks: collectionEntries.length,
      free_count: collectionEntries.filter((entry) => entry.access === 'free').length,
      premium_count: collectionEntries.filter((entry) => entry.access === 'premium').length,
      tags: unique(collectionEntries.flatMap((entry) => entry.tags || [])),
      image_url: catalogAssetUrl(cover?.optimized_asset || cover?.source_asset),
      catalog_scope: 'merchandising',
      catalog_rank: index,
      albums,
    };
  });

export const CATALOG_COLLECTION_BY_ID = new Map(CATALOG_COLLECTIONS.map((collection) => [collection.id, collection]));
export const CATALOG_COLLECTION_IDS = new Set(CATALOG_COLLECTIONS.map((collection) => collection.id));
export const CATALOG_ALBUM_BY_ID = new Map(CATALOG_COLLECTIONS.flatMap((collection) => collection.albums.map((album) => [album.id, { ...album, collection_id: collection.id, collection_title: collection.title }])));

const MODERN_COLLECTIONS = new Set([
  'col_blockbound-worlds',
  'col_minigame-mayhem',
  'col_creature-collectors',
  'col_neon-city-rush',
  'col_cyber-arena',
  'col_streamer-stickerverse',
  'col_dreamcore-idols',
]);

const modernTags = new Set([
  'voxel', 'sandbox', 'blocks', 'minigame', 'obstacle', 'arcade', 'esports',
  'creatures', 'collecting', 'neon', 'racing', 'tuner', 'cyber', 'arena',
  'tactical', 'battle', 'streaming', 'stickers', 'meme', 'internet-core',
  'anime-inspired', 'idols', 'fashion', 'dreamcore',
]);

export const CATALOG_SHELF_DEFINITIONS = Object.freeze([
  { id: 'quick-start', label: 'Быстрый старт', description: 'Короткие бесплатные сцены, чтобы сразу войти в ритм.', match: (item) => item.access === 'free' && item.difficulty === 'simple' },
  { id: 'new', label: 'Новинки', description: 'Свежие миры Phase 2 — ярче, смелее, современнее.', match: (item) => MODERN_COLLECTIONS.has(item.collection_id) },
  { id: 'free', label: 'Бесплатно', description: 'Сильные работы, которые можно начать прямо сейчас.', match: (item) => item.access === 'free' },
  { id: 'premium', label: 'Premium', description: '148 работ в полной Premium Gallery.', match: (item) => item.access === 'premium' },
  { id: 'gaming-worlds', label: 'Игровые миры', description: 'Voxel, minigame, arena и adventure energy.', match: (item) => modernTags.has(item.theme) || [...(item.tags || [])].some((tag) => modernTags.has(tag)) },
  { id: 'anime-vibes', label: 'Anime vibes', description: 'Оригинальные digital-персонажи, idols и dreamcore.', match: (item) => [...(item.tags || [])].some((tag) => ['anime-inspired', 'idols', 'dreamcore'].includes(tag)) },
  { id: 'block-voxel', label: 'Block / Voxel', description: 'Собирайте собственные блочные вселенные.', match: (item) => item.collection_id === 'col_blockbound-worlds' },
  { id: 'neon-cyber', label: 'Neon / Cyber', description: 'Неоновые улицы, кибер-арены и дождь в огнях.', match: (item) => ['col_neon-city-rush', 'col_cyber-arena'].includes(item.collection_id) },
  { id: 'racing-street', label: 'Racing / Street', description: 'Скорость, тюнинг и ночной город.', match: (item) => [...(item.tags || [])].some((tag) => ['racing', 'tuner', 'street'].includes(tag)) },
  { id: 'internet-chaos', label: 'Meme / Sticker / Internet', description: 'Стикеры, стриминг и оригинальные интернет-маскоты.', match: (item) => [...(item.tags || [])].some((tag) => ['streaming', 'stickers', 'meme', 'internet-core'].includes(tag)) },
  { id: 'creatures', label: 'Creatures', description: 'Коллекционные существа из оригинальных миров.', match: (item) => [...(item.tags || [])].some((tag) => ['creatures', 'collecting', 'fantasy', 'discovery'].includes(tag)) },
  { id: 'dark-weird', label: 'Dark / Weird / Cursed', description: 'Милое, странное и немного тревожное.', match: (item) => [...(item.tags || [])].some((tag) => ['dark-cute', 'cursed', 'spooky', 'haunted'].includes(tag)) || item.mood === 'cursed-cozy' },
  { id: 'fantasy', label: 'Fantasy', description: 'Магия, тайные тропы и невозможные приключения.', match: (item) => [...(item.tags || [])].some((tag) => ['fantasy', 'magic', 'magical', 'mythic'].includes(tag)) },
  { id: 'calm-cozy', label: 'Calm / Cozy', description: 'Спокойный слой Phase 1 для мягкого темпа.', match: (item) => ['cozy', 'calm'].includes(item.mood) && !MODERN_COLLECTIONS.has(item.collection_id) },
  { id: 'seasonal', label: 'Seasonal', description: 'Сюжеты, которые меняются вместе с сезоном.', match: (item) => Array.isArray(item.season) && item.season.some((season) => ['autumn', 'winter', 'christmas', 'halloween'].includes(season)) },
  { id: 'popular', label: 'Популярное', description: 'Работы, к которым чаще возвращаются.', match: () => true, sort: (a, b) => Number(b.completion_count || 0) - Number(a.completion_count || 0) || Number(b.rating_count || 0) - Number(a.rating_count || 0) },
]);

const SEARCH_ALIASES = new Map([
  ['anime', ['anime', 'аниме', 'anime-inspired']],
  ['аниме', ['anime', 'аниме', 'anime-inspired']],
  ['gaming', ['gaming', 'game', 'игра', 'игровой', 'esports', 'minigame']],
  ['game', ['gaming', 'game', 'игра', 'игровой', 'esports', 'minigame']],
  ['игра', ['gaming', 'game', 'игра', 'игровой', 'esports', 'minigame']],
  ['voxel', ['voxel', 'block', 'блок', 'sandbox']],
  ['block', ['voxel', 'block', 'блок', 'sandbox']],
  ['блок', ['voxel', 'block', 'блок', 'sandbox']],
  ['neon', ['neon', 'неон', 'cyber', 'кибер']],
  ['неон', ['neon', 'неон', 'cyber', 'кибер']],
  ['cyber', ['neon', 'неон', 'cyber', 'кибер']],
  ['кибер', ['neon', 'неон', 'cyber', 'кибер']],
  ['racing', ['racing', 'гонки', 'street', 'tuner']],
  ['гонки', ['racing', 'гонки', 'street', 'tuner']],
  ['creature', ['creature', 'monster', 'существа', 'collecting']],
  ['monster', ['creature', 'monster', 'существа', 'collecting']],
  ['meme', ['meme', 'мем', 'internet', 'stickers']],
  ['мем', ['meme', 'мем', 'internet', 'stickers']],
  ['dark', ['dark', 'тёмный', 'cursed', 'spooky']],
  ['cursed', ['dark', 'тёмный', 'cursed', 'spooky']],
  ['fantasy', ['fantasy', 'фэнтези', 'magic', 'магия']],
  ['cozy', ['cozy', 'уют', 'calm', 'спокойный']],
  ['calm', ['cozy', 'уют', 'calm', 'спокойный']],
]);

export function catalogSearchTerms(query) {
  const normalized = String(query || '').trim().toLocaleLowerCase();
  return unique([normalized, ...(SEARCH_ALIASES.get(normalized) || [])]);
}

export function catalogSearchText(row) {
  let tags = [];
  try {
    tags = Array.isArray(row?.tags) ? row.tags : JSON.parse(row?.tags_json || '[]');
  } catch {
    tags = [];
  }
  return unique([
    row?.title,
    row?.description,
    row?.owner_nickname,
    row?.collection_title,
    row?.album_title,
    row?.category,
    row?.theme,
    row?.mood,
    ...tags,
  ]).join(' ');
}

export function catalogRowMatchesSearch(row, query) {
  const terms = catalogSearchTerms(query);
  if (!terms.length || !String(query || '').trim()) return true;
  const haystack = catalogSearchText(row);
  return terms.some((term) => haystack.includes(term));
}

export function catalogEntryMetadata(id) {
  return entryById.get(id) || null;
}

export function catalogTemplateSeedMetadata(template) {
  const entry = entryById.get(template.id) || {};
  const collection = CATALOG_COLLECTION_BY_ID.get(entry.collection_id || template.collection_id);
  const modernRank = collection && MODERN_COLLECTIONS.has(collection.id)
    ? [...MODERN_COLLECTIONS].indexOf(collection.id)
    : 99;
  return {
    collection_id: entry.collection_id || template.collection_id || null,
    album_id: entry.album_id || null,
    album_title: entry.album_title || '',
    access_type: entry.access || 'free',
    tags_json: JSON.stringify(Array.isArray(entry.tags) ? entry.tags : []),
    season_json: JSON.stringify(Array.isArray(entry.season) ? entry.season : []),
    audience_json: JSON.stringify(Array.isArray(entry.audience) ? entry.audience : []),
    featured_rank: collection ? collection.catalog_rank * 100 + (collection.albums.findIndex((album) => album.id === entry.album_id) * 10) + (String(template.id).endsWith('_01') ? 0 : 1) : 1000,
    daily_featured: modernRank < 99 && String(template.id).endsWith('_01') ? 1 : 0,
    is_new: modernRank < 99 ? 1 : 0,
  };
}

function parseShelfFilter(value) {
  if (value && typeof value === 'object') return value;
  try { return JSON.parse(value || '{}'); } catch { return {}; }
}

function filterMatches(item, filter, baseMatch) {
  if (typeof baseMatch === 'function' && !baseMatch(item)) return false;
  const collectionIds = Array.isArray(filter.collection_ids) ? filter.collection_ids.map(String) : [];
  const albumIds = Array.isArray(filter.album_ids) ? filter.album_ids.map(String) : [];
  const tags = Array.isArray(item.tags) ? item.tags.map(String) : [];
  const requiredTags = Array.isArray(filter.tags) ? filter.tags.map(String) : [];
  if (collectionIds.length && !collectionIds.includes(String(item.collection_id))) return false;
  if (albumIds.length && !albumIds.includes(String(item.album_id))) return false;
  if (filter.access && String(item.access) !== String(filter.access)) return false;
  if (requiredTags.length && !requiredTags.some((tag) => tags.includes(tag))) return false;
  return true;
}

export function buildCatalogShelves(items, { itemLimit = 8, shelfRows = null } = {}) {
  const safeItems = Array.isArray(items) ? items : [];
  const definitions = Array.isArray(shelfRows) && shelfRows.length
    ? shelfRows.filter((row) => row?.status === undefined || row.status === 'active').map((row) => {
      const base = CATALOG_SHELF_DEFINITIONS.find((candidate) => candidate.id === row.id);
      const filter = parseShelfFilter(row.filter_json);
      return {
        id: row.id,
        label: row.title || base?.label || row.id,
        description: row.description || base?.description || '',
        match: (item) => filterMatches(item, filter, base?.match),
        sort: base?.sort,
        rank: Number(row.sort_rank || 1000),
      };
    }).sort((a, b) => a.rank - b.rank || a.label.localeCompare(b.label))
    : CATALOG_SHELF_DEFINITIONS;
  return definitions.map((definition) => {
    const matched = safeItems.filter((item) => {
      try {
        return definition.match(item);
      } catch {
        return false;
      }
    });
    const sorted = [...matched].sort(definition.sort || ((a, b) => Number(a.featured_rank || 1000) - Number(b.featured_rank || 1000) || String(a.title || '').localeCompare(String(b.title || ''))));
    return {
      id: definition.id,
      label: definition.label,
      description: definition.description,
      total_count: matched.length,
      item_ids: sorted.map((item) => item.id),
      items: sorted.slice(0, Math.max(1, itemLimit)),
    };
  }).filter((shelf) => shelf.total_count > 0);
}
