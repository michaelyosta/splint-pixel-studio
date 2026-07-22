import initSqlJs from 'sql.js';
import pg from 'pg';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const { Pool } = pg;
const directory = dirname(fileURLToPath(import.meta.url));
const dbPath = process.env.SQLITE_DB_PATH || join(directory, 'splint.db.bin');
const migrationPath = join(directory, 'migrations', '001_initial.sql');
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
    const migration = readFileSync(migrationPath, 'utf8');
    const migration2 = readFileSync(join(directory, 'migrations', '002_meta.sql'), 'utf8');
    const migration3 = readFileSync(join(directory, 'migrations', '003_auth_roles.sql'), 'utf8');
    await pool.query(migration);
    await pool.query(migration2);
    await pool.query(migration3);
  } else {
    mode = 'sqlite';
    const SQL = await initSqlJs();
    sqlite = existsSync(dbPath) ? new SQL.Database(readFileSync(dbPath)) : new SQL.Database();
    sqlite.run('PRAGMA foreign_keys = ON;');
    initSqliteSchema();
  }

  await seedDemoData();
  persist();
  return getDb();
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

export async function resetDemoData() {
  const tables = ['reports', 'message_requests', 'likes', 'follows', 'comments', 'posts', 'artworks', 'coloring_progress', 'coloring_templates', 'collections', 'users'];
  for (const table of tables) await run(`DELETE FROM ${table}`);
  await seedDemoData();
}

const ZONE_PRESETS = {
  'color_neon-cat': ['Фон ночного города', 'Уши и мордочка', 'Неоновые глаза', 'Передние лапы', 'Хвост с подсветкой', 'Звёздная пыль'],
  'color_astro-whale': ['Звёздное небо', 'Голова кита', 'Тело и плавники', 'Хвост-комета', 'Созвездия вокруг', 'Глубокий космос'],
  'color_tea-dragon': ['Пар чая', 'Голова дракона', 'Тело и крылья', 'Чашка и блюдце', 'Узоры на паре', 'Уютный фон'],
  'color_alpine-train': ['Горное небо', 'Корпус поезда', 'Окна и фары', 'Рельсы и туннель', 'Сосны по бокам', 'Снежные вершины'],
  'color_lantern-fox': ['Ночной лес', 'Мордочка лиса', 'Фонарь и свет', 'Лапы и хвост', 'Трава и кусты', 'Млечный путь'],
  'color_coral-jellyfish': ['Водная гладь', 'Купол медузы', 'Щупальца', 'Пузырьки воздуха', 'Кораллы вокруг', 'Глубинное свечение'],
};

function buildZones(template) {
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

const ACHIEVEMENTS = [
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

const COLLECTIONS = [
  { id: 'col_night-city', title: 'Ночной город', pack_type: 'free', rarity: 'common', total_artworks: 6, image_url: '/assets/catalog/neon-cat-pixel.png' },
  { id: 'col_cozy-forest', title: 'Уютный лес', pack_type: 'free', rarity: 'common', total_artworks: 6, image_url: '/assets/catalog/lantern-fox-pixel.png' },
  { id: 'col_space', title: 'Космос', pack_type: 'free', rarity: 'rare', total_artworks: 6, image_url: '/assets/catalog/astro-whale-pixel.png' },
];

async function seedDemoData() {
  const now = new Date().toISOString();
  if (!await get('SELECT id FROM users LIMIT 1')) {
    const userSql = `INSERT INTO users
      (id,telegram_id,nickname,avatar_url,status,karma,stars_balance,messages_disabled,followers_only,paid_open,price_in_stars,is_banned,role,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`;
    await run(userSql, ['user_pixelhunter', 1234567, 'PixelHunter', '/assets/pixel_hunter_avatar.jpg', 'Люблю пиксели и неон.', 1250, 450, 0, 0, 0, 10, 0, 'user', now, now]);
    await run(userSql, ['user_lenaart', 7654321, 'LenaArt', '/assets/lena_art_avatar.jpg', 'Раскрашиваю фантастические миры.', 3420, 120, 0, 1, 0, 25, 0, 'user', now, now]);
    await run(userSql, ['user_artvibe', 9988776, 'ArtVibe', '/assets/lena_art_avatar.jpg', 'Pixel art и lo-fi.', 410, 50, 0, 0, 0, 0, 0, 'user', now, now]);
    await run(userSql, ['user_splintmod', 0, 'SplintMod', null, '', 0, 0, 0, 0, 0, 10, 0, 'moderator', now, now]);
  }

  const templates = JSON.parse(readFileSync(catalogPath, 'utf8'));
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
    const savedProgress = await all('SELECT * FROM coloring_progress WHERE template_id=?', [template.id]);
    for (const progress of savedProgress) {
      const filled = Array.isArray(progress.filled_json) ? progress.filled_json : JSON.parse(progress.filled_json);
      if (filled.length === template.cells.length) continue;
      const artworks = await all("SELECT id FROM artworks WHERE owner_id=? AND collection_id=? AND source_type='coloring'", [progress.user_id, template.id]);
      for (const artwork of artworks) {
        const posts = await all('SELECT id FROM posts WHERE artwork_id=?', [artwork.id]);
        for (const post of posts) {
          await run('DELETE FROM likes WHERE post_id=?', [post.id]);
          await run('DELETE FROM comments WHERE post_id=?', [post.id]);
          await run("DELETE FROM reports WHERE target_type='post' AND target_id=?", [post.id]);
          await run('DELETE FROM posts WHERE id=?', [post.id]);
        }
        await run('DELETE FROM artworks WHERE id=?', [artwork.id]);
      }
      await run('DELETE FROM coloring_progress WHERE user_id=? AND template_id=?', [progress.user_id, template.id]);
    }
  }

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

  for (const template of templates) {
    const existingZones = await all('SELECT id FROM coloring_zones WHERE template_id=?', [template.id]);
    if (existingZones.length) continue;
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
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING`,
    [postId, item.owner, artworkId, null, 'catalog_showcase', item.title, item.caption, 1, 'public', 'active', item.likes, 0, now, now, now]);
  }
}

function initSqliteSchema() {
  sqlite.run(`
    CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, telegram_id INTEGER UNIQUE, nickname TEXT NOT NULL, avatar_url TEXT, status TEXT DEFAULT '', karma INTEGER DEFAULT 0, stars_balance INTEGER DEFAULT 0, messages_disabled INTEGER DEFAULT 0, followers_only INTEGER DEFAULT 0, paid_open INTEGER DEFAULT 0, price_in_stars INTEGER DEFAULT 10, is_banned INTEGER DEFAULT 0, role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user','moderator','admin')), created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS collections (id TEXT PRIMARY KEY, title TEXT NOT NULL, pack_type TEXT DEFAULT 'free', rarity TEXT DEFAULT 'common', total_artworks INTEGER DEFAULT 10, price_in_stars INTEGER DEFAULT 0, image_url TEXT);
    CREATE TABLE IF NOT EXISTS artworks (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, source_type TEXT DEFAULT 'user', image_url TEXT, title TEXT NOT NULL, collection_id TEXT, collection_title TEXT, rarity TEXT, is_completed INTEGER DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS posts (id TEXT PRIMARY KEY, author_id TEXT NOT NULL, artwork_id TEXT, achievement_id TEXT, post_type TEXT NOT NULL, title TEXT NOT NULL, caption TEXT DEFAULT '', comments_enabled INTEGER DEFAULT 1, visibility TEXT DEFAULT 'public', status TEXT DEFAULT 'active', like_count INTEGER DEFAULT 0, comment_count INTEGER DEFAULT 0, published_at TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS comments (id TEXT PRIMARY KEY, post_id TEXT NOT NULL, author_id TEXT NOT NULL, text TEXT NOT NULL, parent_comment_id TEXT, status TEXT DEFAULT 'active', created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS follows (follower_id TEXT NOT NULL, following_id TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY (follower_id, following_id));
    CREATE TABLE IF NOT EXISTS likes (user_id TEXT NOT NULL, post_id TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY (user_id, post_id));
    CREATE TABLE IF NOT EXISTS message_requests (id TEXT PRIMARY KEY, sender_id TEXT NOT NULL, receiver_id TEXT NOT NULL, related_post_id TEXT, price_in_stars INTEGER DEFAULT 0, text TEXT NOT NULL, reply_text TEXT, status TEXT DEFAULT 'created', created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS reports (id TEXT PRIMARY KEY, reporter_id TEXT NOT NULL, target_type TEXT NOT NULL, target_id TEXT NOT NULL, reason TEXT DEFAULT 'other', status TEXT DEFAULT 'pending', created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS coloring_templates (id TEXT PRIMARY KEY, owner_id TEXT, title TEXT NOT NULL, description TEXT DEFAULT '', category TEXT DEFAULT 'featured', difficulty TEXT DEFAULT 'easy', width INTEGER NOT NULL, height INTEGER NOT NULL, palette_json TEXT NOT NULL, cells_json TEXT NOT NULL, preview_url TEXT, original_media_key TEXT, source_type TEXT DEFAULT 'catalog', visibility TEXT DEFAULT 'public', status TEXT DEFAULT 'active', created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS coloring_progress (user_id TEXT NOT NULL, template_id TEXT NOT NULL, filled_json TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 0, completed_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY (user_id, template_id));
    CREATE INDEX IF NOT EXISTS idx_coloring_templates_catalog ON coloring_templates(visibility, status, category);
    CREATE INDEX IF NOT EXISTS idx_coloring_progress_user ON coloring_progress(user_id, updated_at);
    CREATE INDEX IF NOT EXISTS idx_posts_feed ON posts(status, published_at);
    CREATE INDEX IF NOT EXISTS idx_comments_post ON comments(post_id, created_at);
    CREATE TABLE IF NOT EXISTS daily_streaks (user_id TEXT PRIMARY KEY, current_streak INTEGER NOT NULL DEFAULT 0, longest_streak INTEGER NOT NULL DEFAULT 0, total_days INTEGER NOT NULL DEFAULT 0, last_active_date TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS achievements (id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT NOT NULL, category TEXT NOT NULL DEFAULT 'style', icon TEXT NOT NULL DEFAULT 'star', rarity TEXT NOT NULL DEFAULT 'common', created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS user_achievements (user_id TEXT NOT NULL, achievement_id TEXT NOT NULL, unlocked_at TEXT NOT NULL, PRIMARY KEY (user_id, achievement_id));
    CREATE TABLE IF NOT EXISTS coloring_zones (id TEXT PRIMARY KEY, template_id TEXT NOT NULL, title TEXT NOT NULL, cell_indices_json TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS analytics_events (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, event TEXT NOT NULL, payload_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL);
  `);
  try { sqlite.run('ALTER TABLE coloring_templates ADD COLUMN original_media_key TEXT'); } catch { /* Existing local databases already migrated. */ }
  try { sqlite.run("ALTER TABLE coloring_templates ADD COLUMN mood TEXT NOT NULL DEFAULT 'calm'"); } catch { /* Existing local databases already migrated. */ }
  try { sqlite.run("ALTER TABLE coloring_templates ADD COLUMN theme TEXT NOT NULL DEFAULT 'featured'"); } catch { /* Existing local databases already migrated. */ }
  try { sqlite.run("ALTER TABLE coloring_templates ADD COLUMN est_minutes INTEGER NOT NULL DEFAULT 3"); } catch { /* Existing local databases already migrated. */ }
  try { sqlite.run("ALTER TABLE coloring_templates ADD COLUMN collection_id TEXT"); } catch { /* Existing local databases already migrated. */ }
  try { sqlite.run("ALTER TABLE coloring_templates ADD COLUMN zone_count INTEGER NOT NULL DEFAULT 1"); } catch { /* Existing local databases already migrated. */ }
  try { sqlite.run("ALTER TABLE coloring_templates ADD COLUMN daily_featured INTEGER NOT NULL DEFAULT 0"); } catch { /* Existing local databases already migrated. */ }
  try { sqlite.run("ALTER TABLE coloring_templates ADD COLUMN added_at TEXT"); } catch { /* Existing local databases already migrated. */ }
  try { sqlite.run('CREATE INDEX IF NOT EXISTS idx_coloring_zones_template ON coloring_zones(template_id)'); } catch { /* noop */ }
  try { sqlite.run('CREATE INDEX IF NOT EXISTS idx_analytics_user_event ON analytics_events(user_id, event, created_at DESC)'); } catch { /* noop */ }
  try { sqlite.run('ALTER TABLE coloring_templates ADD COLUMN original_media_key TEXT'); } catch { /* Existing local databases already migrated. */ }
  try { sqlite.run("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user','moderator','admin'))"); } catch { /* Existing local databases already migrated. */ }
}
