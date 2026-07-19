// server/routes/likes.js
import { Router } from 'express';
import { get, run } from '../db.js';
import { authMiddleware } from '../middleware/auth.js';

const router = Router();

// POST /posts/:id/like
router.post('/:id/like', authMiddleware, async (req, res) => {
  const { id: postId } = req.params;
  const userId = req.userId;

  const user = await get('SELECT * FROM users WHERE id=?', [userId]);
  if (!user || user.is_banned) return res.status(403).json({ error: 'Действие недоступно' });

  const post = await get('SELECT * FROM posts WHERE id=?', [postId]);
  if (!post) return res.status(404).json({ error: 'Пост не найден' });

  const exists = await get('SELECT 1 FROM likes WHERE user_id=? AND post_id=?', [userId, postId]);
  if (exists) return res.status(409).json({ error: 'Лайк уже поставлен' });

  const now = new Date().toISOString();
  await run('INSERT INTO likes (user_id,post_id,created_at) VALUES (?,?,?)', [userId, postId, now]);
  await run('UPDATE posts SET like_count=like_count+1, updated_at=? WHERE id=?', [now, postId]);
  await run('UPDATE users SET karma=karma+1 WHERE id=?', [post.author_id]);

  const updated = await get('SELECT like_count FROM posts WHERE id=?', [postId]);
  res.json({ success: true, is_liked: true, like_count: updated.like_count });
});

// DELETE /posts/:id/like
router.delete('/:id/like', authMiddleware, async (req, res) => {
  const { id: postId } = req.params;
  const userId = req.userId;

  const post = await get('SELECT * FROM posts WHERE id=?', [postId]);
  if (!post) return res.status(404).json({ error: 'Пост не найден' });

  const exists = await get('SELECT 1 FROM likes WHERE user_id=? AND post_id=?', [userId, postId]);
  if (!exists) return res.status(404).json({ error: 'Лайк не найден' });

  const now = new Date().toISOString();
  await run('DELETE FROM likes WHERE user_id=? AND post_id=?', [userId, postId]);
  await run('UPDATE posts SET like_count=MAX(0,like_count-1), updated_at=? WHERE id=?', [now, postId]);
  await run('UPDATE users SET karma=MAX(0,karma-1) WHERE id=?', [post.author_id]);

  const updated = await get('SELECT like_count FROM posts WHERE id=?', [postId]);
  res.json({ success: true, is_liked: false, like_count: updated.like_count });
});

export default router;
