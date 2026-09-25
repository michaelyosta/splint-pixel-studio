import initSqlJs from 'sql.js';
import pg from 'pg';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { runMigrations } from './database/migrations.js';
import { withTransaction } from './database/transaction.js';
import { getTransactionContext } from './database/runtime-context.js';
import { scheduleSqliteOperation } from './database/sqlite-scheduler.js';
import { toPostgres } from './database/sql.js';
import { CATALOG_COLLECTIONS, CATALOG_SHELF_DEFINITIONS, catalogAssetUrl, catalogTemplateSeedMetadata } from './services/catalog-merchandising.js';

const { Pool } = pg;
const directory = dirname(fileURLToPath(import.meta.url));
const dbPath = process.env.SQLITE_DB_PATH || join(directory, 'splint.db.bin');
const catalogPath = join(directory, 'catalog-templates.json');

let mode = null;
let sqlite = null;
let pool = null;

function persist() {
  if (mode !== 'sqlite') return;
  writeFileSync(dbPath, Buffer.from(sqlite.export()));
}

export async function initDb() {
  if (mode) return getDb();

  if (process.env.DATABASE_URL) {
    mode = 'postgres';
    pool = new Pool({ connectionString: process.env.DATABASE_URL });

    const result = await runMigrations({
      mode,
      pool,
      sqlite: null,
      persistFn: null,
      migrationsDir: join(directory, 'migrations'),
    });
    console.log(`PostgreSQL migrations: ${result.applied} applied, ${result.skipped} skipped`);
  } else {
    mode = 'sqlite';
    const SQL = await initSqlJs();
    sqlite = existsSync(dbPath) ? new SQL.Database(readFileSync(dbPath)) : new SQL.Database();
    sqlite.run('PRAGMA foreign_keys = ON;');

    const isLegacy = hasLegacyTables();

    const result = await runMigrations({
      mode,
      pool: null,
      sqlite,
      persistFn: persist,
      migrationsDir: join(directory, 'migrations', 'sqlite'),
    });

    if (isLegacy && result.applied === 0) {
      console.log(`SQLite legacy database: migrations already recorded, 0 new applied`);
    } else {
      console.log(`SQLite migrations: ${result.applied} applied, ${result.skipped} skipped`);
    }
  }

  return getDb();
}

function hasLegacyTables() {
  try {
    const stmt = sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='users'");
    const hasUsers = stmt.step();
    stmt.free();
    return hasUsers;
  } catch {
    return false;
  }
}

export function getDb() {
  if (!mode) throw new Error('Database not initialized. Call initDb() first.');
  return { mode, sqlite, pool };
}

function routeThroughContext(operation) {
  const ctx = getTransactionContext();
  if (!ctx) return null;
  if (!mode) return operation(ctx.tx);
  if (ctx.mode === mode && ctx.databaseIdentity === (mode === 'postgres' ? pool : sqlite)) {
    return operation(ctx.tx);
  }
  return null;
}

export async function all(sql, params = []) {
  const routed = routeThroughContext((tx) => tx.all(sql, params));
  if (routed !== null) return routed;

  if (!mode) throw new Error('Database not initialized. Call initDb() first.');

  if (mode === 'postgres') {
    const result = await pool.query(toPostgres(sql), params);
    return result.rows;
  }

  return scheduleSqliteOperation(sqlite, () => {
    const statement = sqlite.prepare(sql);
    statement.bind(params);
    const rows = [];
    while (statement.step()) rows.push(statement.getAsObject());
    statement.free();
    return rows;
  });
}

export async function get(sql, params = []) {
  const rows = await all(sql, params);
  return rows[0] ?? null;
}

export async function run(sql, params = []) {
  const routed = routeThroughContext((tx) => tx.run(sql, params));
  if (routed !== null) return routed;

  if (!mode) throw new Error('Database not initialized. Call initDb() first.');

  if (mode === 'postgres') {
    const result = await pool.query(toPostgres(sql), params);
    return { changes: result.rowCount };
  }

  return scheduleSqliteOperation(sqlite, () => {
    sqlite.run(sql, params);
    const changes = sqlite.getRowsModified();
    persist();
    return { changes };
  });
}

export async function withDbTransaction(callback) {
  if (!mode) throw new Error('Database not initialized. Call initDb() first.');
  return withTransaction({ mode, pool, sqlite, persistFn: persist }, callback);
}

export async function closeDb() {
  if (mode === 'sqlite') {
    persist();
    sqlite?.close();
  }
  if (mode === 'postgres') await pool?.end();
  mode = null;
  sqlite = null;
  pool = null;
}

const ZONE_PRESETS = {
  'color_neon-cat': ['Фон ночного города', 'Уши и мордочка', 'Неоновые глаза', 'Передние лапы', 'Хвост с подсветкой', 'Звёздная пыль'],
  'color_astro-whale': ['Звёздное небо', 'Голова кита', 'Тело и плавники', 'Хвост-комета', 'Созвездия вокруг', 'Глубокий космос'],
  'color_tea-dragon': ['Пар чая', 'Голова дракона', 'Тело и крылья', 'Чашка и блюдце', 'Узоры на паре', 'Уютный фон'],
  'color_alpine-train': ['Горное небо', 'Корпус поезда', 'Окна и фары', 'Рельсы и туннель', 'Сосны по бокам', 'Снежные вершины'],
  'color_lantern-fox': ['Ночной лес', 'Мордочка лиса', 'Фонарь и свет', 'Лапы и хвост', 'Трава и кусты', 'Млечный путь'],
  'color_coral-jellyfish': ['Водная гладь', 'Купол медузы', 'Щупальца', 'Пузырьки воздуха', 'Кораллы вокруг', 'Глубинное свечение'],
};

export function buildZones(template) {
  // Tiled maps are navigated by the bounded tile/guidance indexes. Building
  // legacy zone JSON for a 1200x1200 catalog grid would allocate hundreds of
  // millions of cell indices and duplicate the tiled representation.
  if (template?.storage_mode === 'tiled') return [];
  const { width, height, id } = template;
  const labels = ZONE_PRESETS[id] || ['Верхняя часть', 'Центр', 'Низ', 'Левый край', 'Правый край', 'Фон'];
  const rows = 3;
  const cols = 2;
  const zoneH = Math.ceil(height / rows);
  const zoneW = Math.ceil(width / cols);
  const zones = [];
  let index = 0;
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const x0 = c * zoneW;
      const y0 = r * zoneH;
      const x1 = Math.min(width, x0 + zoneW);
      const y1 = Math.min(height, y0 + zoneH);
      const indices = [];
      for (let y = y0; y < y1; y += 1) {
        for (let x = x0; x < x1; x += 1) indices.push(y * width + x);
      }
      zones.push({ title: labels[index % labels.length] || `Участок ${index + 1}`, indices });
      index += 1;
    }
  }
  return zones;
}

export const ACHIEVEMENTS = [
  { id: 'ach_first_pixel', title: 'Первый мазок', description: 'Закрасьте первый пиксель.', category: 'ritual', icon: 'sparkles', rarity: 'common' },
  { id: 'ach_first_zone', title: 'Зона закрыта', description: 'Завершите первую раскраску.', category: 'ritual', icon: 'target', rarity: 'common' },
  { id: 'ach_daily_3', title: 'Трёхдневка', description: 'Раскрашивайте 3 дня подряд.', category: 'streak', icon: 'flame', rarity: 'rare' },
  { id: 'ach_daily_7', title: 'Неделя ритма', description: 'Серия из 7 дней подряд.', category: 'streak', icon: 'flame', rarity: 'epic' },
  { id: 'ach_style_night', title: 'Ночной страж', description: 'Завершите 3 ночных раскраски.', category: 'style', icon: 'moon', rarity: 'rare' },
  { id: 'ach_style_forest', title: 'Лесной след', description: 'Завершите 3 раскраски про лес.', category: 'style', icon: 'tree', rarity: 'rare' },
  { id: 'ach_style_space', title: 'Космический дальнобойщик', description: 'Завершите 3 космических раскраски.', category: 'style', icon: 'rocket', rarity: 'rare' },
  { id: 'ach_collector', title: 'Коллекционер', description: 'Откройте альбом коллекции.', category: 'collection', icon: 'book', rarity: 'epic' },
  { id: 'ach_complete_5', title: 'Пять шедевров', description: 'Завершите 5 раскрасок.', category: 'ritual', icon: 'star', rarity: 'rare' },
];

export const COLLECTIONS = [
  { id: 'col_night-city', title: 'Ночной город', pack_type: 'free', rarity: 'common', total_artworks: 6, image_url: '/assets/catalog/neon-cat-pixel.png' },
  { id: 'col_cozy-forest', title: 'Уютный лес', pack_type: 'free', rarity: 'common', total_artworks: 6, image_url: '/assets/catalog/lantern-fox-pixel.png' },
  { id: 'col_space', title: 'Космос', pack_type: 'free', rarity: 'rare', total_artworks: 6, image_url: '/assets/catalog/astro-whale-pixel.png' },
];

// Server-authoritative unlockable content seeded by bootstrapSystemData.
// These rows use source_type='unlockable' so the legacy editorial catalog
// stays byte-compatible; discovery happens through /unlocks and
// /colorings/recommendations. Premium collections keep the existing
// collection_ownerships purchase path and can never be granted by
// progression rules.
const UNLOCKABLE_COLLECTIONS = [
  {
    id: 'col_starter-path',
    title: 'Путь новичка',
    pack_type: 'free',
    rarity: 'common',
    total_artworks: 2,
    price_in_stars: 0,
    image_url: null,
    description: 'Открывается прогрессией: второй уровень и первая завершённая раскраска.',
    rules: [
      { rule_type: 'level', target_value: '2', rule_order: 1 },
      { rule_type: 'completed_artworks', target_value: '1', rule_order: 2 },
    ],
  },
  {
    id: 'col_premium-gallery',
    title: 'Премиум-галерея',
    pack_type: 'premium',
    rarity: 'epic',
    total_artworks: 2,
    price_in_stars: 120,
    image_url: null,
    description: 'Покупается только за Stars. Прогрессия не обходит платный доступ.',
    rules: [],
  },
  {
    id: 'col_master-gallery',
    title: 'Мастерская галерея',
    pack_type: 'free',
    rarity: 'rare',
    total_artworks: 1,
    price_in_stars: 0,
    image_url: null,
    description: 'Открывается после полного прохождения коллекции Путь новичка.',
    rules: [
      { rule_type: 'collection_completion', target_value: 'col_starter-path', rule_order: 1 },
    ],
  },
];

// Core-feel is an experiment fixture rather than a merchandising asset. Keep
// its authored 28x28 coordinates available to the dev/E2E route even though
// the production catalog is now manifest-driven and contains 320 items.
const CORE_FEEL_CELLS = (() => {
  const cells = Array(28 * 28).fill(0);
  const paint = (color, indices) => indices.forEach((index) => { cells[index] = color; });
  paint(2, [
    148, 149, 150, 177, 178, 179, 180, 204, 205, 206, 207, 208, 209,
    231, 232, 234, 235, 236, 237, 238, 265, 266, 294, 295, 323, 351,
  ]);
  paint(3, [
    233, 258, 259, 260, 261, 262, 263, 264, 285, 286, 287, 288, 289,
    290, 291, 292, 293, 313, 314, 315, 316, 317, 318, 319, 320, 321,
    322, 340, 341, 342, 343, 344, 345, 346, 347, 348, 349, 350, 369,
    370, 371, 372, 373, 375, 376, 377, 378, 401, 402, 403, 404, 405,
    430, 431, 432,
  ]);
  paint(8, [397, 398, 426, 427, 428, 429, 455, 456, 457]);
  return cells;
})();

const UNLOCKABLE_TEMPLATES = [
  {
    id: 'color_astro-whale',
    title: 'Космический кит',
    description: 'Экспериментальный fixture для core-feel E2E, не часть merchandising-каталога.',
    category: 'space',
    difficulty: 'easy',
    theme: 'space',
    mood: 'calm',
    est_minutes: 3,
    collection_id: null,
    width: 28,
    height: 28,
    palette: ['#010643', '#6e3b5d', '#256086', '#0677fc', '#b25b6d', '#15bfd5', '#8f879c', '#60b2bd', '#b5f7fb'],
    cells: CORE_FEEL_CELLS,
  },
  {
    id: 'color_starter_night',
    title: 'Ночной огонь',
    description: 'Тёплая ночная раскраска для первого шага.',
    category: 'animals',
    difficulty: 'easy',
    theme: 'night-city',
    mood: 'focus',
    est_minutes: 4,
    collection_id: 'col_starter-path',
    width: 16,
    height: 16,
  },
  {
    id: 'color_starter_forest',
    title: 'Лесной шаг',
    description: 'Спокойный лесной сюжет.',
    category: 'nature',
    difficulty: 'easy',
    theme: 'forest',
    mood: 'calm',
    est_minutes: 4,
    collection_id: 'col_starter-path',
    width: 16,
    height: 16,
  },
  {
    id: 'color_premium_whale',
    title: 'Звёздный кит',
    description: 'Премиум-раскраска в космической галерее.',
    category: 'animals',
    difficulty: 'medium',
    theme: 'space',
    mood: 'focus',
    est_minutes: 6,
    collection_id: 'col_premium-gallery',
    width: 24,
    height: 24,
  },
  {
    id: 'color_premium_dragon',
    title: 'Чайный дракон',
    description: 'Премиум-раскраска с морским сюжетом.',
    category: 'fantasy',
    difficulty: 'medium',
    theme: 'sea',
    mood: 'calm',
    est_minutes: 6,
    collection_id: 'col_premium-gallery',
    width: 24,
    height: 24,
  },
  {
    id: 'color_streak_badge',
    title: 'Знак трёхдневной серии',
    description: 'Открывается после трёх дней подряд.',
    category: 'featured',
    difficulty: 'easy',
    theme: 'featured',
    mood: 'calm',
    est_minutes: 3,
    collection_id: null,
    width: 16,
    height: 16,
  },
  {
    id: 'color_master_dream',
    title: 'Сон мастера',
    description: 'Финальная раскраска в теме космоса.',
    category: 'fantasy',
    difficulty: 'hard',
    theme: 'space',
    mood: 'focus',
    est_minutes: 9,
    collection_id: 'col_master-gallery',
    width: 32,
    height: 32,
  },
  // Compatibility fixture retained for the tiled API contract tests. It is
  // deliberately source_type='unlockable', so it never inflates the 320-item
  // merchandising catalog or appears in public shelves.
  {
    id: 'color_neon-cat',
    title: 'Неоновый кот',
    description: 'Совместимый tiled-fixture для серверного контракта.',
    category: 'animals',
    difficulty: 'medium',
    theme: 'night-city',
    mood: 'focus',
    est_minutes: 4,
    collection_id: null,
    width: 32,
    height: 32,
    storage_mode: 'tiled',
    tile_size: 32,
  },
];

const UNLOCKABLE_TEMPLATE_RULES = [
  { subject_type: 'template', subject_id: 'color_streak_badge', rule_type: 'streak', target_value: '3', rule_order: 1 },
];

export async function bootstrapSystemData() {
  if (!mode) throw new Error('Database not initialized. Call initDb() first.');
  return withDbTransaction(async () => {
    const now = new Date().toISOString();

  const templates = JSON.parse(readFileSync(catalogPath, 'utf8'));

  for (const collection of COLLECTIONS) {
    await run(`INSERT INTO collections (id,title,pack_type,rarity,total_artworks,image_url) VALUES (?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET
        title=CASE WHEN collections.catalog_managed THEN collections.title ELSE excluded.title END,
        pack_type=CASE WHEN collections.catalog_managed THEN collections.pack_type ELSE excluded.pack_type END,
        rarity=CASE WHEN collections.catalog_managed THEN collections.rarity ELSE excluded.rarity END,
        total_artworks=CASE WHEN collections.catalog_managed THEN collections.total_artworks ELSE excluded.total_artworks END,
        price_in_stars=CASE WHEN collections.catalog_managed THEN collections.price_in_stars ELSE collections.price_in_stars END,
        image_url=CASE WHEN collections.catalog_managed THEN collections.image_url ELSE excluded.image_url END`,
    [collection.id, collection.title, collection.pack_type, collection.rarity, collection.total_artworks, collection.image_url]);
  }

  // The merchandising catalog is manifest-driven. Keep the legacy system
  // collections above for progression compatibility, while exposing the
  // 16 real catalog collections with their album/cover metadata below.
  for (const collection of CATALOG_COLLECTIONS) {
    await run(`INSERT INTO collections
      (id,title,pack_type,rarity,total_artworks,price_in_stars,image_url,
       catalog_scope,catalog_slug,catalog_theme,catalog_mood,catalog_tags_json,
       catalog_rank,catalog_cover_url)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET
        title=CASE WHEN collections.catalog_managed THEN collections.title ELSE excluded.title END,
        pack_type=CASE WHEN collections.catalog_managed THEN collections.pack_type ELSE excluded.pack_type END,
        rarity=CASE WHEN collections.catalog_managed THEN collections.rarity ELSE excluded.rarity END,
        total_artworks=CASE WHEN collections.catalog_managed THEN collections.total_artworks ELSE excluded.total_artworks END,
        price_in_stars=CASE WHEN collections.catalog_managed THEN collections.price_in_stars ELSE excluded.price_in_stars END,
        image_url=CASE WHEN collections.catalog_managed THEN collections.image_url ELSE excluded.image_url END,
        catalog_scope=CASE WHEN collections.catalog_managed THEN collections.catalog_scope ELSE excluded.catalog_scope END,
        catalog_slug=CASE WHEN collections.catalog_managed THEN collections.catalog_slug ELSE excluded.catalog_slug END,
        catalog_theme=CASE WHEN collections.catalog_managed THEN collections.catalog_theme ELSE excluded.catalog_theme END,
        catalog_mood=CASE WHEN collections.catalog_managed THEN collections.catalog_mood ELSE excluded.catalog_mood END,
        catalog_tags_json=CASE WHEN collections.catalog_managed THEN collections.catalog_tags_json ELSE excluded.catalog_tags_json END,
        catalog_rank=CASE WHEN collections.catalog_managed THEN collections.catalog_rank ELSE excluded.catalog_rank END,
        catalog_cover_url=CASE WHEN collections.catalog_managed THEN collections.catalog_cover_url ELSE excluded.catalog_cover_url END`,
    [collection.id, collection.title, collection.pack_type, collection.rarity,
      collection.total_artworks, collection.price_in_stars, collection.image_url,
      collection.catalog_scope, collection.slug, collection.theme, collection.mood,
      JSON.stringify(collection.tags || []), collection.catalog_rank, collection.image_url]);
  }

  // Albums and shelves are durable merchandising entities. Their seed is
  // insert-only so an editor's published changes survive a later bootstrap.
  for (const collection of CATALOG_COLLECTIONS) {
    for (const [albumIndex, album] of (collection.albums || []).entries()) {
      await run(`INSERT INTO catalog_albums
        (id,collection_id,slug,title,description,visibility,status,cover_url,sort_rank,featured,is_new,tags_json,created_at,updated_at)
        VALUES (?,?,?,?,?,'public','active',?,?,?,?,?,?,?)
        ON CONFLICT(id) DO NOTHING`,
      [album.id, collection.id, album.slug || album.id, album.title || album.id, album.description || '',
        album.cover_url || null, albumIndex * 10, album.featured ? 1 : 0, album.is_new ? 1 : 0,
        JSON.stringify(album.tags || []), now, now]);
    }
  }
  for (const [shelfIndex, shelf] of CATALOG_SHELF_DEFINITIONS.entries()) {
    await run(`INSERT INTO catalog_shelves
      (id,title,description,filter_json,status,sort_rank,cover_url,created_at,updated_at)
      VALUES (?,?,?,?,'active',?,?,?,?) ON CONFLICT(id) DO NOTHING`,
    [shelf.id, shelf.label, shelf.description || '', JSON.stringify({ definition_id: shelf.id }), shelfIndex, null, now, now]);
  }

  for (const achievement of ACHIEVEMENTS) {
    await run(`INSERT INTO achievements (id,title,description,category,icon,rarity,created_at) VALUES (?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET title=excluded.title, description=excluded.description, category=excluded.category, icon=excluded.icon, rarity=excluded.rarity`,
    [achievement.id, achievement.title, achievement.description, achievement.category, achievement.icon, achievement.rarity, now]);
  }

  // Keep catalog entries that are no longer in the fixture out of the public catalog.
  // `hidden` is part of the persisted status contract; `archived` is not.
  await run("UPDATE coloring_templates SET status='hidden' WHERE source_type='catalog'");

  const sql = `INSERT INTO coloring_templates
    (id,owner_id,title,description,category,difficulty,width,height,palette_json,cells_json,preview_url,original_media_key,source_type,visibility,status,mood,theme,est_minutes,collection_id,daily_featured,added_at,created_at,updated_at,
     album_id,album_title,access_type,tags_json,season_json,audience_json,featured_rank,is_new)
    VALUES (${Array.from({ length: 31 }, () => '?').join(',')})
    ON CONFLICT(id) DO UPDATE SET title=excluded.title, description=excluded.description, category=excluded.category,
      difficulty=CASE WHEN coloring_templates.catalog_managed THEN coloring_templates.difficulty ELSE excluded.difficulty END,
      width=CASE WHEN coloring_templates.catalog_managed THEN coloring_templates.width ELSE excluded.width END,
      height=CASE WHEN coloring_templates.catalog_managed THEN coloring_templates.height ELSE excluded.height END,
      palette_json=CASE WHEN coloring_templates.catalog_managed THEN coloring_templates.palette_json ELSE excluded.palette_json END,
      cells_json=CASE WHEN coloring_templates.catalog_managed THEN coloring_templates.cells_json ELSE excluded.cells_json END,
      preview_url=CASE WHEN coloring_templates.catalog_managed THEN coloring_templates.preview_url ELSE excluded.preview_url END,
      visibility=CASE WHEN coloring_templates.catalog_managed THEN coloring_templates.visibility ELSE 'public' END,
      status=CASE WHEN coloring_templates.catalog_managed THEN coloring_templates.status ELSE 'active' END,
      mood=CASE WHEN coloring_templates.catalog_managed THEN coloring_templates.mood ELSE excluded.mood END,
      theme=CASE WHEN coloring_templates.catalog_managed THEN coloring_templates.theme ELSE excluded.theme END,
      est_minutes=CASE WHEN coloring_templates.catalog_managed THEN coloring_templates.est_minutes ELSE excluded.est_minutes END,
      collection_id=CASE WHEN coloring_templates.catalog_managed THEN coloring_templates.collection_id ELSE excluded.collection_id END,
      daily_featured=CASE WHEN coloring_templates.catalog_managed THEN coloring_templates.daily_featured ELSE excluded.daily_featured END,
      added_at=CASE WHEN coloring_templates.catalog_managed THEN coloring_templates.added_at ELSE excluded.added_at END,
      updated_at=CASE WHEN coloring_templates.catalog_managed THEN coloring_templates.updated_at ELSE excluded.updated_at END,
      album_id=CASE WHEN coloring_templates.catalog_managed THEN coloring_templates.album_id ELSE excluded.album_id END,
      album_title=CASE WHEN coloring_templates.catalog_managed THEN coloring_templates.album_title ELSE excluded.album_title END,
      access_type=CASE WHEN coloring_templates.catalog_managed THEN coloring_templates.access_type ELSE excluded.access_type END,
      tags_json=CASE WHEN coloring_templates.catalog_managed THEN coloring_templates.tags_json ELSE excluded.tags_json END,
      season_json=CASE WHEN coloring_templates.catalog_managed THEN coloring_templates.season_json ELSE excluded.season_json END,
      audience_json=CASE WHEN coloring_templates.catalog_managed THEN coloring_templates.audience_json ELSE excluded.audience_json END,
      featured_rank=CASE WHEN coloring_templates.catalog_managed THEN coloring_templates.featured_rank ELSE excluded.featured_rank END,
      is_new=CASE WHEN coloring_templates.catalog_managed THEN coloring_templates.is_new ELSE excluded.is_new END`;

  // One read for the whole catalog keeps cold SQLite/demo boot comfortably
  // below the local health-test deadline. Zone rows themselves remain
  // durable and are only inserted for templates that have none.
  const existingZoneCounts = new Map((await all('SELECT template_id, COUNT(*) AS c FROM coloring_zones GROUP BY template_id')).map((row) => [row.template_id, Number(row.c || 0)]));

  for (const template of templates) {
    const merchandising = catalogTemplateSeedMetadata(template);
    // Card and player surfaces must load the lightweight pixelized preview
    // (~7KB), never the full-resolution optimized master (~1.8MB). The
    // pixel variant renders the same artwork and upscales cleanly with the
    // pixelated canvas aesthetic; the full master stays available on disk
    // for regeneration but is not referenced at runtime.
    const runtimePreviewUrl = catalogAssetUrl(template.preview_asset || template.preview);
    await run(sql, [template.id, null, template.title, template.description, template.category, template.difficulty, template.width, template.height, JSON.stringify(template.palette), JSON.stringify(template.cells), runtimePreviewUrl, null, 'catalog', 'public', 'active', template.mood || 'calm', template.theme || 'featured', template.est_minutes || 3, merchandising.collection_id, merchandising.daily_featured, template.added_at || now, now, now, merchandising.album_id, merchandising.album_title, merchandising.access_type, merchandising.tags_json, merchandising.season_json, merchandising.audience_json, merchandising.featured_rank, merchandising.is_new]);

    const existingZoneCount = existingZoneCounts.get(template.id) || 0;
    if (existingZoneCount === 0) {
      const zones = buildZones(template);
      for (let zoneIndex = 0; zoneIndex < zones.length; zoneIndex += 1) {
        const zone = zones[zoneIndex];
        await run('INSERT INTO coloring_zones (id,template_id,title,cell_indices_json,created_at) VALUES (?,?,?,?,?)',
        [`zone_${template.id}_${zoneIndex}`, template.id, zone.title, JSON.stringify(zone.indices), now]);
      }
    }
    const zoneCount = existingZoneCount || (template.storage_mode === 'tiled' ? 0 : 6);
    await run(`UPDATE coloring_templates SET
      zone_count=?, collection_id=CASE WHEN catalog_managed THEN collection_id ELSE ? END,
      theme=CASE WHEN catalog_managed THEN theme ELSE ? END,
      mood=CASE WHEN catalog_managed THEN mood ELSE ? END,
      est_minutes=CASE WHEN catalog_managed THEN est_minutes ELSE ? END,
      daily_featured=CASE WHEN catalog_managed THEN daily_featured ELSE ? END,
      added_at=CASE WHEN catalog_managed THEN added_at ELSE ? END,
      album_id=CASE WHEN catalog_managed THEN album_id ELSE ? END,
      album_title=CASE WHEN catalog_managed THEN album_title ELSE ? END,
      access_type=CASE WHEN catalog_managed THEN access_type ELSE ? END,
      tags_json=CASE WHEN catalog_managed THEN tags_json ELSE ? END,
      season_json=CASE WHEN catalog_managed THEN season_json ELSE ? END,
      audience_json=CASE WHEN catalog_managed THEN audience_json ELSE ? END,
      featured_rank=CASE WHEN catalog_managed THEN featured_rank ELSE ? END,
      is_new=CASE WHEN catalog_managed THEN is_new ELSE ? END
      WHERE id=?`,
    [zoneCount, merchandising.collection_id, template.theme || 'featured', template.mood || 'calm', template.est_minutes || 3, merchandising.daily_featured, template.added_at || now, merchandising.album_id, merchandising.album_title, merchandising.access_type, merchandising.tags_json, merchandising.season_json, merchandising.audience_json, merchandising.featured_rank, merchandising.is_new, template.id]);
  }

  await seedUnlockableContent(now);

  const brokenArtworks = await all("SELECT * FROM artworks WHERE image_url LIKE 'data:image/%' AND LENGTH(image_url) < 100");
  for (const artwork of brokenArtworks) {
    const template = artwork.template_id ? await get('SELECT preview_url FROM coloring_templates WHERE id=?', [artwork.template_id]) : null;
    if (template?.preview_url && (!template.preview_url.startsWith('data:') || template.preview_url.length >= 100)) {
      await run('UPDATE artworks SET image_url=?, updated_at=? WHERE id=?', [template.preview_url, now, artwork.id]);
    } else {
      await run("UPDATE posts SET status='deleted', updated_at=? WHERE artwork_id=?", [now, artwork.id]);
    }
  }
  });
}

async function seedUnlockableContent(now) {
  const unlockAddedAt = '2026-07-01T00:00:00.000Z';
  for (const collection of UNLOCKABLE_COLLECTIONS) {
    await run(`INSERT INTO collections
      (id,title,pack_type,rarity,total_artworks,price_in_stars,image_url,owner_id,status,visibility,description)
      VALUES (?,?,?,?,?,?,?,NULL,'published','public',?)
      ON CONFLICT(id) DO UPDATE SET
        title=excluded.title, pack_type=excluded.pack_type, rarity=excluded.rarity,
        total_artworks=excluded.total_artworks, price_in_stars=excluded.price_in_stars,
        image_url=excluded.image_url, status='published', visibility='public',
        description=excluded.description`,
    [collection.id, collection.title, collection.pack_type, collection.rarity,
      collection.total_artworks, collection.price_in_stars, collection.image_url, collection.description]);

    for (const rule of collection.rules) {
      await run(`INSERT INTO unlock_rules
        (subject_type,subject_id,rule_type,target_value,rule_order,created_at)
        VALUES (?,?,?,?,?,?)
        ON CONFLICT (subject_type,subject_id,rule_type,target_value) DO UPDATE SET
          rule_order=excluded.rule_order`,
      ['collection', collection.id, rule.rule_type, rule.target_value, rule.rule_order, now]);
    }
  }

  const palette = JSON.stringify(['#102030', '#00b5d8']);
  for (const template of UNLOCKABLE_TEMPLATES) {
    const templatePalette = JSON.stringify(Array.isArray(template.palette) ? template.palette : JSON.parse(palette));
    const cells = JSON.stringify(Array.isArray(template.cells) ? template.cells : Array(template.width * template.height).fill(0));
    await run(`INSERT INTO coloring_templates
      (id,owner_id,title,description,category,difficulty,width,height,palette_json,cells_json,preview_url,original_media_key,source_type,visibility,status,mood,theme,est_minutes,collection_id,daily_featured,added_at,created_at,updated_at,storage_mode,tile_size)
      VALUES (?,?,?,?,?,?,?,?,?,?,NULL,NULL,'unlockable','public','active',?,?,?,?,0,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET
        title=excluded.title, description=excluded.description, category=excluded.category,
        difficulty=excluded.difficulty, width=excluded.width, height=excluded.height,
        palette_json=excluded.palette_json, cells_json=excluded.cells_json,
        visibility='public', status='active', mood=excluded.mood, theme=excluded.theme,
      est_minutes=excluded.est_minutes, collection_id=excluded.collection_id,
        daily_featured=0, added_at=excluded.added_at, updated_at=excluded.updated_at,
        storage_mode=excluded.storage_mode, tile_size=excluded.tile_size`,
    [template.id, null, template.title, template.description, template.category,
      template.difficulty, template.width, template.height, templatePalette, cells,
      template.mood, template.theme, template.est_minutes, template.collection_id,
      unlockAddedAt, now, now, template.storage_mode || 'legacy', template.tile_size || 32]);
    if (template.storage_mode === 'tiled') {
      await run(`INSERT INTO coloring_template_tiles
        (template_id,tile_x,tile_y,width,height,cells_json,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?)
        ON CONFLICT(template_id,tile_x,tile_y) DO UPDATE SET
          width=excluded.width, height=excluded.height, cells_json=excluded.cells_json,
          updated_at=excluded.updated_at`,
      [template.id, 0, 0, template.width, template.height,
        JSON.stringify(Array(template.width * template.height).fill(0)), now, now]);
    }
  }

  for (const rule of UNLOCKABLE_TEMPLATE_RULES) {
    await run(`INSERT INTO unlock_rules
      (subject_type,subject_id,rule_type,target_value,rule_order,created_at)
      VALUES (?,?,?,?,?,?)
      ON CONFLICT (subject_type,subject_id,rule_type,target_value) DO UPDATE SET
        rule_order=excluded.rule_order`,
    [rule.subject_type, rule.subject_id, rule.rule_type, rule.target_value, rule.rule_order, now]);
  }
}

export async function seedDemoData() {
  if (!mode) throw new Error('Database not initialized. Call initDb() first.');

  if (process.env.NODE_ENV === 'production') {
    throw new Error('SEED_DEMO_DATA cannot be enabled in production');
  }

  const now = new Date().toISOString();

  const demoUsers = [
    { id: 'user_pixelhunter', telegram_id: 1234567, nickname: 'PixelHunter', avatar_url: '/assets/pixel_hunter_avatar.jpg', status: 'Люблю пиксели и неон.', karma: 1250, stars_balance: 450, role: 'user' },
    { id: 'user_lenaart', telegram_id: 7654321, nickname: 'LenaArt', avatar_url: '/assets/lena_art_avatar.jpg', status: 'Раскрашиваю фантастические миры.', karma: 3420, stars_balance: 120, role: 'user' },
    { id: 'user_artvibe', telegram_id: 9988776, nickname: 'ArtVibe', avatar_url: '/assets/lena_art_avatar.jpg', status: 'Pixel art и lo-fi.', karma: 410, stars_balance: 50, role: 'user' },
    { id: 'user_splintmod', telegram_id: 0, nickname: 'SplintMod', avatar_url: null, status: '', karma: 0, stars_balance: 0, role: 'moderator' },
  ];

  for (const u of demoUsers) {
    await run(`INSERT INTO users
      (id,telegram_id,nickname,avatar_url,status,karma,stars_balance,messages_disabled,followers_only,paid_open,price_in_stars,is_banned,role,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET nickname=excluded.nickname, avatar_url=excluded.avatar_url, status=excluded.status, role=excluded.role, updated_at=excluded.updated_at`,
    [u.id, u.telegram_id, u.nickname, u.avatar_url, u.status, u.karma, u.stars_balance, 0, 0, 0, 10, 0, u.role, now, now]);
  }

  const showcase = [
    { id: 'fox', owner: 'user_lenaart', image: '/assets/catalog/lantern-fox-pixel.png', title: 'Лис с фонарём', caption: 'Тёплая палитра для тихого вечера ✨', likes: 24 },
    { id: 'whale', owner: 'user_artvibe', image: '/assets/catalog/astro-whale-pixel.png', title: 'Космический кит', caption: 'Этот маленький путешественник точно долетит до звёзд.', likes: 17 },
    { id: 'dragon', owner: 'user_lenaart', image: '/assets/catalog/tea-dragon-pixel.png', title: 'Чайный дракон', caption: 'Мой любимый уютный сюжет из новой коллекции.', likes: 31 },
  ];

  for (const item of showcase) {
    const artworkId = `art_showcase_${item.id}`;
    const postId = `post_showcase_${item.id}`;

    const templateId = `color_${item.id === 'fox' ? 'lantern-fox' : item.id === 'whale' ? 'astro-whale' : 'tea-dragon'}`;
    const template = await get('SELECT collection_id FROM coloring_templates WHERE id=?', [templateId]);
    // The demo showcase is valid even when a legacy fixture template has been
    // retired from the catalog. Keep the artwork/post seed idempotent without
    // violating the PostgreSQL template foreign key.
    const linkedTemplateId = template ? templateId : null;
    await run(`INSERT INTO artworks (id,owner_id,source_type,image_url,title,template_id,collection_id,collection_title,rarity,is_completed,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET image_url=excluded.image_url, title=excluded.title, template_id=excluded.template_id, collection_id=excluded.collection_id, updated_at=excluded.updated_at`,
    [artworkId, item.owner, 'showcase', item.image, item.title, linkedTemplateId, template?.collection_id || null, item.title, 'featured', 1, now, now]);

    await run(`INSERT INTO posts (id,author_id,artwork_id,achievement_id,post_type,title,caption,comments_enabled,visibility,status,like_count,comment_count,published_at,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO NOTHING`,
    [postId, item.owner, artworkId, null, 'catalog_showcase', item.title, item.caption, 1, 'public', 'active', item.likes, 0, now, now, now]);
  }
}

export const DEMO_USER_IDS = ['user_pixelhunter', 'user_lenaart', 'user_artvibe', 'user_splintmod'];

export const DEMO_ARTWORK_IDS = ['art_showcase_fox', 'art_showcase_whale', 'art_showcase_dragon'];

export const DEMO_POST_IDS = ['post_showcase_fox', 'post_showcase_whale', 'post_showcase_dragon'];

export async function resetDemoData() {
  if (!mode) throw new Error('Database not initialized. Call initDb() first.');

  if (process.env.NODE_ENV === 'production') {
    throw new Error('Destructive reset is not allowed in production');
  }

  if (mode === 'postgres' && process.env.ALLOW_DESTRUCTIVE_DB_RESET !== 'true') {
    throw new Error('ALLOW_DESTRUCTIVE_DB_RESET must be set to "true" for PostgreSQL reset');
  }

  await withDbTransaction(async (tx) => {
    await tx.run('DELETE FROM analytics_events WHERE user_id IN (?,?,?,?)', DEMO_USER_IDS);

    for (const postId of DEMO_POST_IDS) {
      await tx.run('DELETE FROM likes WHERE post_id=?', [postId]);
      await tx.run('DELETE FROM comments WHERE post_id=?', [postId]);
      await tx.run("DELETE FROM reports WHERE target_type='post' AND target_id=?", [postId]);
    }

    await tx.run('DELETE FROM posts WHERE id IN (?,?,?)', DEMO_POST_IDS);
    await tx.run('DELETE FROM artworks WHERE id IN (?,?,?)', DEMO_ARTWORK_IDS);

    await tx.run('DELETE FROM message_requests WHERE sender_id IN (?,?,?,?) OR receiver_id IN (?,?,?,?)',
      [...DEMO_USER_IDS, ...DEMO_USER_IDS]);

    await tx.run('DELETE FROM follows WHERE follower_id IN (?,?,?,?) OR following_id IN (?,?,?,?)',
      [...DEMO_USER_IDS, ...DEMO_USER_IDS]);

    await tx.run('DELETE FROM likes WHERE user_id IN (?,?,?,?)', DEMO_USER_IDS);
    await tx.run('DELETE FROM comments WHERE author_id IN (?,?,?,?)', DEMO_USER_IDS);
    await tx.run('DELETE FROM reports WHERE reporter_id IN (?,?,?,?)', DEMO_USER_IDS);
    await tx.run('DELETE FROM user_achievements WHERE user_id IN (?,?,?,?)', DEMO_USER_IDS);
    await tx.run('DELETE FROM coloring_progress WHERE user_id IN (?,?,?,?)', DEMO_USER_IDS);
    await tx.run('DELETE FROM daily_streaks WHERE user_id IN (?,?,?,?)', DEMO_USER_IDS);
    await tx.run('DELETE FROM users WHERE id IN (?,?,?,?)', DEMO_USER_IDS);
  });
}
