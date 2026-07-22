import initSqlJs from 'sql.js';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync, existsSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const serverDir = join(__dirname, '..', '..');

let sqlJsInstance = null;

export async function getSqlJs() {
  if (!sqlJsInstance) sqlJsInstance = await initSqlJs();
  return sqlJsInstance;
}

export function createTestDbPath(label) {
  const ts = Date.now();
  const rand = Math.random().toString(36).slice(2, 8);
  const filename = `splint-test-${label}-${ts}-${rand}.db.bin`;
  const tmpdir = join(__dirname, '..', '..', '.test-tmp');
  if (!existsSync(tmpdir)) mkdirSync(tmpdir, { recursive: true });
  return join(tmpdir, filename);
}

export function createFreshSqliteDb() {
  throw new Error('Use createFreshSqliteDbAsync() instead');
}

export async function createFreshSqliteDbAsync() {
  const SQL = await getSqlJs();
  const db = new SQL.Database();
  db.run('PRAGMA foreign_keys = ON;');
  return db;
}

export async function createLegacySqliteDb() {
  const SQL = await getSqlJs();
  const db = new SQL.Database();
  db.run('PRAGMA foreign_keys = ON;');

  db.run(`CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, telegram_id INTEGER UNIQUE, nickname TEXT NOT NULL, avatar_url TEXT, status TEXT DEFAULT '', karma INTEGER DEFAULT 0, stars_balance INTEGER DEFAULT 0, messages_disabled INTEGER DEFAULT 0, followers_only INTEGER DEFAULT 0, paid_open INTEGER DEFAULT 0, price_in_stars INTEGER DEFAULT 10, is_banned INTEGER DEFAULT 0, role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user','moderator','admin')), created_at TEXT NOT NULL, updated_at TEXT NOT NULL);`);

  db.run(`CREATE TABLE IF NOT EXISTS coloring_templates (id TEXT PRIMARY KEY, owner_id TEXT, title TEXT NOT NULL, description TEXT DEFAULT '', category TEXT DEFAULT 'featured', difficulty TEXT DEFAULT 'easy', width INTEGER NOT NULL, height INTEGER NOT NULL, palette_json TEXT NOT NULL, cells_json TEXT NOT NULL, preview_url TEXT, source_type TEXT DEFAULT 'catalog', visibility TEXT DEFAULT 'public', status TEXT DEFAULT 'active', created_at TEXT NOT NULL, updated_at TEXT NOT NULL);`);

  db.run(`CREATE TABLE IF NOT EXISTS posts (id TEXT PRIMARY KEY, author_id TEXT NOT NULL, artwork_id TEXT, post_type TEXT NOT NULL, title TEXT NOT NULL, caption TEXT DEFAULT '', status TEXT DEFAULT 'active', like_count INTEGER DEFAULT 0, comment_count INTEGER DEFAULT 0, published_at TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);`);

  return db;
}

export { serverDir };
