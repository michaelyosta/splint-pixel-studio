import initSqlJs from 'sql.js';
import pg from 'pg';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { runMigrations } from './database/migrations.js';
import { withTransaction } from './database/transaction.js';

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

function toPostgres(sql) {
  let position = 0;
  return sql
    .replace(/\?/g, () => `$${++position}`)
    .replace(/MAX\(0,\s*([^)]+)\)/gi, 'GREATEST(0, $1)');
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

export async function all(sql, params = []) {
  if (mode === 'postgres') {
    const result = await pool.query(toPostgres(sql), params);
    return result.rows;
  }
  const statement = sqlite.prepare(sql);
  statement.bind(params);
  const rows = [];
  while (statement.step()) rows.push(statement.getAsObject());
  statement.free();
  return rows;
}

export async function get(sql, params = []) {
  return (await all(sql, params))[0] ?? null;
}

export async function run(sql, params = []) {
  if (mode === 'postgres') {
    await pool.query(toPostgres(sql), params);
    return;
  }
  sqlite.run(sql, params);
  persist();
}

export async function withDbTransaction(callback) {
  if (!mode) throw new Error('Database not initialized. Call initDb() first.');
  return withTransaction({ mode, pool, sqlite, persistFn: persist }, callback);
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
  { id: 'ach_first_zone', title: 'Зона закрыта', description: 'Завершите первый участок раскраски.', category: 'ritual', icon: 'target', rarity: 'common' },
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

export async function bootstrapSystemData() {
  if (!mode) throw new Error('Database not initialized. Call initDb() first.');
  const now = new Date().toISOString();

  const templates = JSON.parse(readFileSync(catalogPath, 'utf8'));

  for (const collection of COLLECTIONS) {
    await run(`INSERT INTO collections (id,title,pack_type,rarity,total_artworks,image_url) VALUES (?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET title=excluded.title, pack_type=excluded.pack_type, rarity=excluded.rarity, total_artworks=excluded.total_artworks, image_url=excluded.image_url`,
    [collection.id, collection.title, collection.pack_type, collection.rarity, collection.total_artworks, collection.image_url]);
  }

  for (const achievement of ACHIEVEMENTS) {
    await run(`INSERT INTO achievements (id,title,description,category,icon,rarity,created_at) VALUES (?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET title=excluded.title, description=excluded.description, category=excluded.category, icon=excluded.icon, rarity=excluded.rarity`,
    [achievement.id, achievement.title, achievement.description, achievement.category, achievement.icon, achievement.rarity, now]);
  }

  await run("UPDATE coloring_templates SET status='archived' WHERE source_type='catalog'");

  const sql = `INSERT INTO coloring_templates
    (id,owner_id,title,description,category,difficulty,width,height,palette_json,cells_json,preview_url,original_media_key,source_type,visibility,status,mood,theme,est_minutes,collection_id,daily_featured,added_at,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET title=excluded.title, description=excluded.description, category=excluded.category,
      difficulty=excluded.difficulty, width=excluded.width, height=excluded.height, palette_json=excluded.palette_json,
      cells_json=excluded.cells_json, preview_url=excluded.preview_url, visibility='public', status='active',
      mood=excluded.mood, theme=excluded.theme, est_minutes=excluded.est_minutes, collection_id=excluded.collection_id,
      daily_featured=excluded.daily_featured, added_at=excluded.added_at, updated_at=excluded.updated_at`;

  for (const template of templates) {
    await run(sql, [template.id, null, template.title, template.description, template.category, template.difficulty, template.width, template.height, JSON.stringify(template.palette), JSON.stringify(template.cells), template.preview, null, 'catalog', 'public', 'active', template.mood || 'calm', template.theme || 'featured', template.est_minutes || 3, template.collection_id || null, template.daily_featured || 0, template.added_at || now, now, now]);

    const existingZones = await all('SELECT id FROM coloring_zones WHERE template_id=?', [template.id]);
    if (existingZones.length > 0) continue;

    const zones = buildZones(template);
    for (let zoneIndex = 0; zoneIndex < zones.length; zoneIndex += 1) {
      const zone = zones[zoneIndex];
      await run('INSERT INTO coloring_zones (id,template_id,title,cell_indices_json,created_at) VALUES (?,?,?,?,?)',
      [`zone_${template.id}_${zoneIndex}`, template.id, zone.title, JSON.stringify(zone.indices), now]);
    }
    await run('UPDATE coloring_templates SET zone_count=?, collection_id=?, theme=?, mood=?, est_minutes=?, daily_featured=?, added_at=? WHERE id=?',
    [zones.length, template.collection_id || null, template.theme || 'featured', template.mood || 'calm', template.est_minutes || 3, template.daily_featured || 0, template.added_at || now, template.id]);
  }

  const brokenArtworks = await all("SELECT * FROM artworks WHERE image_url LIKE 'data:image/%' AND LENGTH(image_url) < 100");
  for (const artwork of brokenArtworks) {
    const template = artwork.collection_id ? await get('SELECT preview_url FROM coloring_templates WHERE id=?', [artwork.collection_id]) : null;
    if (template?.preview_url && (!template.preview_url.startsWith('data:') || template.preview_url.length >= 100)) {
      await run('UPDATE artworks SET image_url=?, updated_at=? WHERE id=?', [template.preview_url, now, artwork.id]);
    } else {
      await run("UPDATE posts SET status='deleted', updated_at=? WHERE artwork_id=?", [now, artwork.id]);
    }
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

    await run(`INSERT INTO artworks (id,owner_id,source_type,image_url,title,collection_id,collection_title,rarity,is_completed,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET image_url=excluded.image_url, title=excluded.title, updated_at=excluded.updated_at`,
    [artworkId, item.owner, 'showcase', item.image, item.title, `color_${item.id === 'fox' ? 'lantern-fox' : item.id === 'whale' ? 'astro-whale' : 'tea-dragon'}`, item.title, 'featured', 1, now, now]);

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

  const now = new Date().toISOString();

  await run('DELETE FROM analytics_events WHERE user_id IN (SELECT id FROM users WHERE id IN (?,?,?,?))',
    DEMO_USER_IDS);

  for (const postId of DEMO_POST_IDS) {
    await run('DELETE FROM likes WHERE post_id=?', [postId]);
    await run('DELETE FROM comments WHERE post_id=?', [postId]);
    await run("DELETE FROM reports WHERE target_type='post' AND target_id=?", [postId]);
  }

  await run('DELETE FROM posts WHERE id IN (?,?,?)', DEMO_POST_IDS);
  await run('DELETE FROM artworks WHERE id IN (?,?,?)', DEMO_ARTWORK_IDS);

  for (const artId of DEMO_ARTWORK_IDS) {
    const artwork = await get('SELECT id FROM artworks WHERE id=?', [artId]);
    if (!artwork) continue;
    await run('DELETE FROM posts WHERE artwork_id=?', [artId]);
    await run('DELETE FROM artworks WHERE id=?', [artId]);
  }

  await run('DELETE FROM message_requests WHERE sender_id IN (?,?,?,?) OR receiver_id IN (?,?,?,?)',
    [...DEMO_USER_IDS, ...DEMO_USER_IDS]);

  await run('DELETE FROM follows WHERE follower_id IN (?,?,?,?) OR following_id IN (?,?,?,?)',
    [...DEMO_USER_IDS, ...DEMO_USER_IDS]);

  await run('DELETE FROM likes WHERE user_id IN (?,?,?,?)', DEMO_USER_IDS);
  await run('DELETE FROM comments WHERE author_id IN (?,?,?,?)', DEMO_USER_IDS);
  await run('DELETE FROM reports WHERE reporter_id IN (?,?,?,?)', DEMO_USER_IDS);
  await run('DELETE FROM user_achievements WHERE user_id IN (?,?,?,?)', DEMO_USER_IDS);
  await run('DELETE FROM coloring_progress WHERE user_id IN (?,?,?,?)', DEMO_USER_IDS);
  await run('DELETE FROM daily_streaks WHERE user_id IN (?,?,?,?)', DEMO_USER_IDS);
  await run('DELETE FROM users WHERE id IN (?,?,?,?)', DEMO_USER_IDS);
}
