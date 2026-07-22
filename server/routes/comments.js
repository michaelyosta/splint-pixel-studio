// server/routes/comments.js
import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import { all, get, run } from '../db.js';
import { authMiddleware, hasProfanity, hasUrl } from '../middleware/auth.js';
import { asyncRoute } from '../middleware/asyncRoute.js';

const router = Router();

async function enrichComment(c) {
  const author = await get('SELECT id,nickname,avatar_url FROM users WHERE id=?', [c.author_id]);
  return { ...c, author };
}

// GET /posts/:id/comments
router.get('/:id/comments', authMiddleware, asyncRoute(async (req, res) => {
  const comments = await all("SELECT * FROM comments WHERE post_id=? AND status='active' ORDER BY created_at ASC", [req.params.id]);
  res.json(await Promise.all(comments.map(enrichComment)));
}));

// POST /posts/:id/comments
router.post('/:id/comments', authMiddleware, asyncRoute(async (req, res) => {
  const postId = req.params.id;
  const userId = req.userId;
  const { text } = req.body;

  const user = await get('SELECT * FROM users WHERE id=?', [userId]);
  if (!user || user.is_banned) return res.status(403).json({ error: 'Действие недоступно' });

  const post = await get('SELECT * FROM posts WHERE id=?', [postId]);
  if (!post) return res.status(404).json({ error: 'Пост не найден' });
  if (!post.comments_enabled) return res.status(403).json({ error: 'Комментарии к этому посту отключены' });

  const clean = (text || '').trim();
  if (clean.length < 1 || clean.length > 300) return res.status(400).json({ error: 'Комментарий должен быть от 1 до 300 символов' });
  if (hasUrl(clean)) return res.status(400).json({ error: 'В комментариях запрещены ссылки' });
  if (hasProfanity(clean)) return res.status(400).json({ error: 'Комментарий содержит недопустимые слова' });

  // Rate limit: 1 per 20 seconds
  const ago20s = new Date(Date.now() - 20000).toISOString();
  const recent = await get('SELECT COUNT(*) as c FROM comments WHERE author_id=? AND created_at>?', [userId, ago20s]);
  if (recent.c > 0) return res.status(429).json({ error: 'Подождите 20 секунд перед следующим комментарием' });

  // Dedup: same text as last comment
  const last = await get('SELECT text FROM comments WHERE author_id=? ORDER BY created_at DESC LIMIT 1', [userId]);
  if (last && last.text === clean) return res.status(400).json({ error: 'Запрещено отправлять одинаковые комментарии подряд' });

  const now = new Date().toISOString();
  const id  = `comm_${uuid()}`;
  await run(`INSERT INTO comments (id,post_id,author_id,text,parent_comment_id,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)`,
    [id, postId, userId, clean, null, 'active', now, now]);
  await run('UPDATE posts SET comment_count=comment_count+1, updated_at=? WHERE id=?', [now, postId]);

  const comment = await get('SELECT * FROM comments WHERE id=?', [id]);
  res.status(201).json(await enrichComment(comment));
}));

// DELETE /comments/:id
router.delete('/:id', authMiddleware, asyncRoute(async (req, res) => {
  const c    = await get('SELECT * FROM comments WHERE id=?', [req.params.id]);
  if (!c) return res.status(404).json({ error: 'Комментарий не найден' });

  const post = await get('SELECT author_id FROM posts WHERE id=?', [c.post_id]);
  const currentUser = await get('SELECT role FROM users WHERE id=?', [req.userId]);
  const isMod = currentUser && (currentUser.role === 'moderator' || currentUser.role === 'admin');
  const isOwner = c.author_id === req.userId;
  const isPostAuthor = post?.author_id === req.userId;

  if (!isOwner && !isPostAuthor && !isMod) {
    return res.status(403).json({ error: 'Нет прав на удаление этого комментария' });
  }

  const now = new Date().toISOString();
  await run("UPDATE comments SET status='deleted', updated_at=? WHERE id=?", [now, c.id]);
  await run('UPDATE posts SET comment_count=MAX(0,comment_count-1), updated_at=? WHERE id=?', [now, c.post_id]);
  res.json({ success: true });
}));

// POST /comments/:id/report
router.post('/:id/report', authMiddleware, asyncRoute(async (req, res) => {
  const { reason = 'other' } = req.body;
  const now = new Date().toISOString();
  await run(`INSERT INTO reports (id,reporter_id,target_type,target_id,reason,status,created_at) VALUES (?,?,?,?,?,?,?)`,
    [`rep_${uuid()}`, req.userId, 'comment', req.params.id, reason, 'pending', now]);
  res.json({ success: true });
}));

export default router;
