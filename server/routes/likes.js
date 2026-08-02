// server/routes/likes.js
import { Router } from 'express';
import { withDbTransaction } from '../db.js';
import { authMiddleware } from '../middleware/auth.js';
import { asyncRoute } from '../middleware/asyncRoute.js';

const router = Router();

router.post('/:id/like', authMiddleware, asyncRoute(async (req, res) => {
  const postId = req.params.id;
  const userId = req.userId;
  const result = await withDbTransaction(async (tx) => {
    const user = await tx.get('SELECT * FROM users WHERE id=?', [userId]);
    if (!user || user.is_banned) return { forbidden: true };
    const post = await tx.get("SELECT * FROM posts WHERE id=? AND status='active'", [postId]);
    if (!post) return { missing: true };
    const now = new Date().toISOString();
    const inserted = await tx.run('INSERT INTO likes (user_id,post_id,created_at) VALUES (?,?,?) ON CONFLICT(user_id,post_id) DO NOTHING', [userId, postId, now]);
    if (inserted.changes !== 1) return { duplicate: true };
    await tx.run('UPDATE posts SET like_count=like_count+1, updated_at=? WHERE id=?', [now, postId]);
    await tx.run('UPDATE users SET karma=karma+1 WHERE id=?', [post.author_id]);
    const updated = await tx.get('SELECT like_count FROM posts WHERE id=?', [postId]);
    return { likeCount: Number(updated.like_count) };
  });
  if (result.forbidden) return res.status(403).json({ error: 'Действие недоступно' });
  if (result.missing) return res.status(404).json({ error: 'Пост не найден' });
  if (result.duplicate) return res.status(409).json({ error: 'Лайк уже поставлен' });
  return res.json({ success: true, is_liked: true, like_count: result.likeCount });
}));

router.delete('/:id/like', authMiddleware, asyncRoute(async (req, res) => {
  const postId = req.params.id;
  const userId = req.userId;
  const result = await withDbTransaction(async (tx) => {
    const post = await tx.get("SELECT * FROM posts WHERE id=? AND status='active'", [postId]);
    if (!post) return { missing: true };
    const now = new Date().toISOString();
    const deleted = await tx.run('DELETE FROM likes WHERE user_id=? AND post_id=?', [userId, postId]);
    if (deleted.changes !== 1) return { absent: true };
    await tx.run('UPDATE posts SET like_count=MAX(0,like_count-1), updated_at=? WHERE id=?', [now, postId]);
    await tx.run('UPDATE users SET karma=MAX(0,karma-1) WHERE id=?', [post.author_id]);
    const updated = await tx.get('SELECT like_count FROM posts WHERE id=?', [postId]);
    return { likeCount: Number(updated.like_count) };
  });
  if (result.missing) return res.status(404).json({ error: 'Пост не найден' });
  if (result.absent) return res.status(404).json({ error: 'Лайк не найден' });
  return res.json({ success: true, is_liked: false, like_count: result.likeCount });
}));

export default router;
