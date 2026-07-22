// server/routes/profiles.js
import { Router } from 'express';
import { get, all, run } from '../db.js';
import { authMiddleware } from '../middleware/auth.js';
import { asyncRoute } from '../middleware/asyncRoute.js';
import { purchaseCollection, StarsTransactionError } from '../services/stars-transactions.js';

const router = Router();

async function buildProfile(user, viewerId) {
  const followersCount = (await get('SELECT COUNT(*) as c FROM follows WHERE following_id=?', [user.id]) || {}).c || 0;
  const followingCount = (await get('SELECT COUNT(*) as c FROM follows WHERE follower_id=?', [user.id]) || {}).c || 0;
  const postsCount     = (await get("SELECT COUNT(*) as c FROM posts WHERE author_id=? AND status='active'", [user.id]) || {}).c || 0;
  const isFollowing    = viewerId ? !!await get('SELECT 1 FROM follows WHERE follower_id=? AND following_id=?', [viewerId, user.id]) : false;
  return { ...user, followers_count: followersCount, following_count: followingCount, posts_count: postsCount, is_following: isFollowing };
}

// GET /users/me
router.get('/me', authMiddleware, asyncRoute(async (req, res) => {
  const user = await get('SELECT * FROM users WHERE id=?', [req.userId]);
  if (!user) return res.status(404).json({ error: 'Пользователь не найден' });
  res.json(await buildProfile(user, req.userId));
}));

// GET /users/:id/profile
router.get('/:id/profile', authMiddleware, asyncRoute(async (req, res) => {
  const user = await get('SELECT * FROM users WHERE id=?', [req.params.id]);
  if (!user) return res.status(404).json({ error: 'Пользователь не найден' });
  res.json(await buildProfile(user, req.userId));
}));

// GET /users/:id/posts
router.get('/:id/posts', authMiddleware, asyncRoute(async (req, res) => {
  const posts = await all("SELECT * FROM posts WHERE author_id=? AND status='active' ORDER BY published_at DESC", [req.params.id]);
  res.json(posts);
}));

// GET /users/:id/artworks
router.get('/:id/artworks', authMiddleware, asyncRoute(async (req, res) => {
  const artworks = await all('SELECT * FROM artworks WHERE owner_id=? ORDER BY created_at DESC', [req.params.id]);
  res.json(artworks);
}));

// GET /users — list all users (for switcher)
router.get('/', authMiddleware, asyncRoute(async (req, res) => {
  const users = await all('SELECT id,nickname,avatar_url,karma,stars_balance,is_banned FROM users');
  res.json(users);
}));

// PATCH /users/:id/settings
router.patch('/:id/settings', authMiddleware, asyncRoute(async (req, res) => {
  if (req.params.id !== req.userId) return res.status(403).json({ error: 'Нельзя редактировать чужой профиль' });

  const { messages_disabled, followers_only, paid_open, price_in_stars, status } = req.body;
  const now = new Date().toISOString();

  const fields = [];
  const vals   = [];
  if (messages_disabled !== undefined) { fields.push('messages_disabled=?'); vals.push(messages_disabled ? 1 : 0); }
  if (followers_only    !== undefined) { fields.push('followers_only=?');    vals.push(followers_only ? 1 : 0); }
  if (paid_open         !== undefined) { fields.push('paid_open=?');         vals.push(paid_open ? 1 : 0); }
  if (price_in_stars    !== undefined) { fields.push('price_in_stars=?');    vals.push(Math.max(1, parseInt(price_in_stars) || 10)); }
  if (status            !== undefined) { fields.push('status=?');            vals.push(String(status).slice(0,100)); }

  if (!fields.length) return res.status(400).json({ error: 'Нет полей для обновления' });

  vals.push(now, req.params.id);
  await run(`UPDATE users SET ${fields.join(',')}, updated_at=? WHERE id=?`, vals);

  const user = await get('SELECT * FROM users WHERE id=?', [req.params.id]);
  res.json(await buildProfile(user, req.userId));
}));

// POST /users/:id/add-stars (dev-only debug endpoint)
if (process.env.NODE_ENV !== 'production' && process.env.ALLOW_DEV_AUTH === 'true') {
  router.post('/:id/add-stars', authMiddleware, asyncRoute(async (req, res) => {
    if (req.params.id !== req.userId) return res.status(403).json({ error: 'Запрещено' });
    await run('UPDATE users SET stars_balance=stars_balance+100 WHERE id=?', [req.userId]);
    const user = await get('SELECT stars_balance FROM users WHERE id=?', [req.userId]);
    res.json({ stars_balance: user.stars_balance });
  }));
}

// GET /collections  — catalog data
router.get('/collections/all', authMiddleware, asyncRoute(async (req, res) => {
  const cols = await all('SELECT * FROM collections');
  res.json(cols);
}));

// POST /collections/:id/add — add collection to user profile
router.post('/collections/:id/add', authMiddleware, asyncRoute(async (req, res) => {
  const userId = req.userId;
  const colId  = req.params.id;
  const idempotencyKey = req.headers['idempotency-key'];

  if (!colId || typeof colId !== 'string') {
    return res.status(400).json({ error: 'collection id обязателен' });
  }

  try {
    const result = await purchaseCollection({
      collectionId: colId,
      authenticatedUserId: userId,
      idempotencyKey,
    });

    return res.json({
      success: true,
      idempotent: result.idempotent || false,
      stars_balance: result.stars_balance,
    });
  } catch (error) {
    if (error instanceof StarsTransactionError) {
      return res.status(error.statusCode).json({ error: error.message, code: error.code });
    }
    throw error;
  }
}));

// POST /artworks/:id/complete — simulate finishing drawing
router.post('/artworks/:id/complete', authMiddleware, asyncRoute(async (req, res) => {
  const art = await get('SELECT * FROM artworks WHERE id=?', [req.params.id]);
  if (!art) return res.status(404).json({ error: 'Работа не найдена' });
  if (art.owner_id !== req.userId) return res.status(403).json({ error: 'Чужая работа' });
  await run('UPDATE artworks SET is_completed=1, updated_at=? WHERE id=?', [new Date().toISOString(), art.id]);
  res.json({ success: true });
}));

export default router;
