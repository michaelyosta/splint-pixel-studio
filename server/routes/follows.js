// server/routes/follows.js
import { Router } from 'express';
import { get, run, all } from '../db.js';
import { authMiddleware } from '../middleware/auth.js';
import { asyncRoute } from '../middleware/asyncRoute.js';

const router = Router();

// POST /users/:id/follow  (toggle)
router.post('/:id/follow', authMiddleware, asyncRoute(async (req, res) => {
  const followingId = req.params.id;
  const followerId  = req.userId;

  if (followerId === followingId) return res.status(400).json({ error: 'Нельзя подписаться на самого себя' });

  const follower = await get('SELECT * FROM users WHERE id=?', [followerId]);
  if (!follower || follower.is_banned) return res.status(403).json({ error: 'Действие ограничено' });

  const exists = await get('SELECT 1 FROM follows WHERE follower_id=? AND following_id=?', [followerId, followingId]);

  if (exists) {
    await run('DELETE FROM follows WHERE follower_id=? AND following_id=?', [followerId, followingId]);
    return res.json({ success: true, is_following: false });
  }

  // Rate limit: max 30 follows per hour
  const hourAgo = new Date(Date.now() - 3600000).toISOString();
  const cnt = await get('SELECT COUNT(*) as c FROM follows WHERE follower_id=? AND created_at>?', [followerId, hourAgo]);
  if (cnt.c >= 30) return res.status(429).json({ error: 'Превышен лимит подписок. Попробуйте позже' });

  await run('INSERT INTO follows (follower_id,following_id,created_at) VALUES (?,?,?)',
    [followerId, followingId, new Date().toISOString()]);
  res.json({ success: true, is_following: true });
}));

// GET /users/:id/followers
router.get('/:id/followers', authMiddleware, asyncRoute(async (req, res) => {
  const rows = await all(`
    SELECT u.id, u.nickname, u.avatar_url, u.karma FROM follows f
    JOIN users u ON u.id = f.follower_id
    WHERE f.following_id=?
  `, [req.params.id]);
  res.json(rows);
}));

// GET /users/:id/following
router.get('/:id/following', authMiddleware, asyncRoute(async (req, res) => {
  const rows = await all(`
    SELECT u.id, u.nickname, u.avatar_url, u.karma FROM follows f
    JOIN users u ON u.id = f.following_id
    WHERE f.follower_id=?
  `, [req.params.id]);
  res.json(rows);
}));

export default router;
