// Bounded feed DTOs with stable cursor pagination and one query per page.
import { Router } from 'express';
import { all } from '../db.js';
import { authMiddleware } from '../middleware/auth.js';
import { asyncRoute } from '../middleware/asyncRoute.js';
import { publicMediaUrl } from '../services/media-storage.js';

const router = Router();
const MAX_PAGE_SIZE = 30;
const SCORE_EXPRESSION = '(p.like_count * 2 + p.comment_count * 5)';

function decodeCursor(value) {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(String(value), 'base64url').toString('utf8'));
    if (!parsed || typeof parsed !== 'object' || typeof parsed.id !== 'string') return null;
    return parsed;
  } catch {
    return null;
  }
}

function encodeCursor(value) {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

function safeImageUrl(row) {
  if (row.artwork_thumbnail_key) return publicMediaUrl(row.artwork_thumbnail_key);
  const candidate = row.artwork_image_url;
  if (typeof candidate === 'string' && !candidate.startsWith('data:image/')) return candidate;
  return '/assets/catalog/neon-cat-pixel.png';
}

function toFeedDto(row, score) {
  const artwork = row.artwork_row_id ? {
    id: row.artwork_row_id,
    image_url: safeImageUrl(row),
    thumbnail_url: safeImageUrl(row),
    width: row.artwork_width == null ? null : Number(row.artwork_width),
    height: row.artwork_height == null ? null : Number(row.artwork_height),
    aspect_ratio: row.artwork_width && row.artwork_height ? Number(row.artwork_width) / Number(row.artwork_height) : null,
    content_hash: row.artwork_content_hash || null,
  } : null;
  return {
    id: row.id,
    author_id: row.author_id,
    post_type: row.post_type,
    title: row.title,
    caption: row.caption,
    comments_enabled: Boolean(row.comments_enabled),
    visibility: row.visibility,
    status: row.status,
    like_count: Number(row.like_count || 0),
    comment_count: Number(row.comment_count || 0),
    published_at: row.published_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
    author: {
      id: row.author_id,
      nickname: row.author_nickname,
      avatar_url: row.author_avatar_url,
      karma: Number(row.author_karma || 0),
    },
    artwork,
    is_liked: Boolean(row.is_liked),
    is_following: Boolean(row.is_following),
    _score: score == null ? undefined : Number(score),
  };
}

function selectFeedFields() {
  return `
    SELECT p.*,
      u.nickname AS author_nickname,
      u.avatar_url AS author_avatar_url,
      u.karma AS author_karma,
      a.id AS artwork_row_id,
      a.image_url AS artwork_image_url,
      a.thumbnail_key AS artwork_thumbnail_key,
      a.width AS artwork_width,
      a.height AS artwork_height,
      a.content_hash AS artwork_content_hash,
      ${SCORE_EXPRESSION} AS feed_score,
      CASE WHEN EXISTS (SELECT 1 FROM likes viewer_like WHERE viewer_like.user_id=? AND viewer_like.post_id=p.id) THEN 1 ELSE 0 END AS is_liked,
      CASE WHEN EXISTS (SELECT 1 FROM follows viewer_follow WHERE viewer_follow.follower_id=? AND viewer_follow.following_id=p.author_id) THEN 1 ELSE 0 END AS is_following
    FROM posts p
    INNER JOIN users u ON u.id=p.author_id
    LEFT JOIN artworks a ON a.id=p.artwork_id`;
}

async function readPage({ mode, userId, cursor, limit }) {
  const pageSize = Math.min(Math.max(Number(limit) || 20, 1), MAX_PAGE_SIZE);
  const decoded = decodeCursor(cursor);
  if (cursor && !decoded) return { error: 'Некорректный cursor' };

  const params = [userId, userId];
  let where = "p.status='active' AND p.visibility='public'";
  if (mode === 'following') {
    where += ' AND EXISTS (SELECT 1 FROM follows page_follow WHERE page_follow.follower_id=? AND page_follow.following_id=p.author_id)';
    params.push(userId);
    if (decoded) {
      where += ' AND (p.published_at < ? OR (p.published_at = ? AND p.id < ?))';
      params.push(decoded.published_at, decoded.published_at, decoded.id);
    }
  } else if (decoded) {
    where += ` AND (${SCORE_EXPRESSION} < ? OR (${SCORE_EXPRESSION} = ? AND (p.published_at < ? OR (p.published_at = ? AND p.id < ?))))`;
    params.push(Number(decoded.score), Number(decoded.score), decoded.published_at, decoded.published_at, decoded.id);
  }

  const order = mode === 'following'
    ? 'p.published_at DESC, p.id DESC'
    : `${SCORE_EXPRESSION} DESC, p.published_at DESC, p.id DESC`;
  params.push(pageSize + 1);
  const rows = await all(`${selectFeedFields()} WHERE ${where} ORDER BY ${order} LIMIT ?`, params);
  const hasMore = rows.length > pageSize;
  const items = rows.slice(0, pageSize);
  const last = items.at(-1);
  const nextCursor = hasMore && last
    ? encodeCursor(mode === 'following'
      ? { published_at: last.published_at, id: last.id }
      : { score: Number(last.feed_score), published_at: last.published_at, id: last.id })
    : null;
  return { items: items.map((row) => toFeedDto(row, mode === 'following' ? null : row.feed_score)), next_cursor: nextCursor, has_more: hasMore };
}

router.get('/recommended', authMiddleware, asyncRoute(async (req, res) => {
  const page = await readPage({ mode: 'recommended', userId: req.userId, cursor: req.query.cursor, limit: req.query.limit });
  if (page.error) return res.status(400).json({ error: page.error });
  return res.json(page);
}));

router.get('/following', authMiddleware, asyncRoute(async (req, res) => {
  const page = await readPage({ mode: 'following', userId: req.userId, cursor: req.query.cursor, limit: req.query.limit });
  if (page.error) return res.status(400).json({ error: page.error });
  return res.json(page);
}));

export { decodeCursor, encodeCursor, MAX_PAGE_SIZE };
export default router;
