BEGIN;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  telegram_id BIGINT UNIQUE,
  nickname TEXT NOT NULL,
  avatar_url TEXT,
  status TEXT NOT NULL DEFAULT '',
  karma INTEGER NOT NULL DEFAULT 0,
  stars_balance INTEGER NOT NULL DEFAULT 0,
  messages_disabled INTEGER NOT NULL DEFAULT 0,
  followers_only INTEGER NOT NULL DEFAULT 0,
  paid_open INTEGER NOT NULL DEFAULT 0,
  price_in_stars INTEGER NOT NULL DEFAULT 10,
  is_banned INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS collections (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  pack_type TEXT NOT NULL DEFAULT 'free',
  rarity TEXT NOT NULL DEFAULT 'common',
  total_artworks INTEGER NOT NULL DEFAULT 10,
  price_in_stars INTEGER NOT NULL DEFAULT 0,
  image_url TEXT
);

CREATE TABLE IF NOT EXISTS coloring_templates (
  id TEXT PRIMARY KEY,
  owner_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT 'featured',
  difficulty TEXT NOT NULL DEFAULT 'easy',
  width INTEGER NOT NULL CHECK (width BETWEEN 8 AND 64),
  height INTEGER NOT NULL CHECK (height BETWEEN 8 AND 64),
  palette_json JSONB NOT NULL,
  cells_json JSONB NOT NULL,
  preview_url TEXT,
  original_media_key TEXT,
  source_type TEXT NOT NULL DEFAULT 'catalog',
  visibility TEXT NOT NULL DEFAULT 'public' CHECK (visibility IN ('public', 'private')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'hidden', 'deleted')),
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS coloring_progress (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  template_id TEXT NOT NULL REFERENCES coloring_templates(id) ON DELETE CASCADE,
  filled_json JSONB NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (user_id, template_id)
);

CREATE TABLE IF NOT EXISTS artworks (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source_type TEXT NOT NULL DEFAULT 'user',
  image_url TEXT,
  title TEXT NOT NULL,
  collection_id TEXT,
  collection_title TEXT,
  rarity TEXT,
  is_completed INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS posts (
  id TEXT PRIMARY KEY,
  author_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  artwork_id TEXT REFERENCES artworks(id) ON DELETE SET NULL,
  achievement_id TEXT,
  post_type TEXT NOT NULL,
  title TEXT NOT NULL,
  caption TEXT NOT NULL DEFAULT '',
  comments_enabled INTEGER NOT NULL DEFAULT 1,
  visibility TEXT NOT NULL DEFAULT 'public',
  status TEXT NOT NULL DEFAULT 'active',
  like_count INTEGER NOT NULL DEFAULT 0,
  comment_count INTEGER NOT NULL DEFAULT 0,
  published_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS comments (
  id TEXT PRIMARY KEY,
  post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  author_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  text TEXT NOT NULL CHECK (char_length(text) BETWEEN 1 AND 300),
  parent_comment_id TEXT REFERENCES comments(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS follows (
  follower_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  following_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (follower_id, following_id),
  CHECK (follower_id <> following_id)
);

CREATE TABLE IF NOT EXISTS likes (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (user_id, post_id)
);

CREATE TABLE IF NOT EXISTS message_requests (
  id TEXT PRIMARY KEY,
  sender_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  receiver_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  related_post_id TEXT REFERENCES posts(id) ON DELETE SET NULL,
  price_in_stars INTEGER NOT NULL DEFAULT 0,
  text TEXT NOT NULL,
  reply_text TEXT,
  status TEXT NOT NULL DEFAULT 'created',
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS reports (
  id TEXT PRIMARY KEY,
  reporter_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT 'other',
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_coloring_templates_catalog ON coloring_templates(visibility, status, category);
CREATE INDEX IF NOT EXISTS idx_coloring_progress_user ON coloring_progress(user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_artworks_owner ON artworks(owner_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_posts_feed ON posts(status, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_posts_author ON posts(author_id, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_comments_post ON comments(post_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_likes_post ON likes(post_id);
CREATE INDEX IF NOT EXISTS idx_follows_following ON follows(following_id);

COMMIT;
