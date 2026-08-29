// server/routes/comments.js
import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import { all, get, withDbTransaction } from '../db.js';
import { authMiddleware, hasProfanity, hasUrl } from '../middleware/auth.js';
import { asyncRoute } from '../middleware/asyncRoute.js';
import { createReport, sendReportError } from '../services/reporting.js';
import { AbuseLimitError, consumeAbuseBudget, abuseLimitResponse } from '../services/abuse-limiter.js';

const router = Router();
export const commentActionsRouter = Router();

async function enrichComments(rows) {
  if (!rows.length) return [];
  const authorIds = [...new Set(rows.map((row) => row.author_id))];
  const placeholders = authorIds.map(() => '?').join(',');
  const authors = await all(`SELECT id,nickname,avatar_url FROM users WHERE id IN (${placeholders})`, authorIds);
  const byId = new Map(authors.map((author) => [author.id, author]));
  return rows.map((row) => ({ ...row, author: byId.get(row.author_id) || null }));
}

router.get('/:id/comments', authMiddleware, asyncRoute(async (req, res) => {
  const post = await get("SELECT id FROM posts WHERE id=? AND status='active'", [req.params.id]);
  if (!post) return res.status(404).json({ error: 'Post not found' });
  const rows = await all("SELECT * FROM comments WHERE post_id=? AND status='active' ORDER BY created_at ASC", [req.params.id]);
  return res.json(await enrichComments(rows));
}));

router.post('/:id/comments', authMiddleware, asyncRoute(async (req, res) => {
  const postId = req.params.id;
  const userId = req.userId;
  const clean = String(req.body.text || '').trim();
  const user = await get('SELECT * FROM users WHERE id=?', [userId]);
  if (!user || user.is_banned) return res.status(403).json({ error: 'Действие недоступно' });
  if (clean.length < 1 || clean.length > 300) return res.status(400).json({ error: 'Комментарий должен быть от 1 до 300 символов' });
  if (hasUrl(clean)) return res.status(400).json({ error: 'В комментариях запрещены ссылки' });
  if (hasProfanity(clean)) return res.status(400).json({ error: 'Комментарий содержит недопустимые слова' });

  const ago20s = new Date(Date.now() - 20000).toISOString();
  let result;
  try {
    result = await withDbTransaction(async (tx) => {
      const post = await tx.get("SELECT * FROM posts WHERE id=? AND status='active'", [postId]);
      if (!post) return { missing: true };
      if (!post.comments_enabled) return { disabled: true };
      const recent = await tx.get('SELECT COUNT(*) as c FROM comments WHERE author_id=? AND created_at>?', [userId, ago20s]);
      if (Number(recent.c) > 0) return { rateLimited: true };
      const last = await tx.get('SELECT text FROM comments WHERE author_id=? ORDER BY created_at DESC LIMIT 1', [userId]);
      if (last && last.text === clean) return { duplicate: true };
      await consumeAbuseBudget(tx, { scope: 'comment:create', actorKey: userId, limit: 30, windowMs: 60_000 });
      const now = new Date().toISOString();
      const id = `comm_${uuid()}`;
      await tx.run('INSERT INTO comments (id,post_id,author_id,text,parent_comment_id,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)',
        [id, postId, userId, clean, null, 'active', now, now]);
      await tx.run('UPDATE posts SET comment_count=comment_count+1, updated_at=? WHERE id=?', [now, postId]);
      return { id };
    });
  } catch (error) {
    if (error instanceof AbuseLimitError) return abuseLimitResponse(res, error);
    throw error;
  }
  if (result.missing) return res.status(404).json({ error: 'Пост не найден' });
  if (result.disabled) return res.status(403).json({ error: 'Комментарии к этому посту отключены' });
  if (result.rateLimited) return res.status(429).json({ error: 'Подождите 20 секунд перед следующим комментарием' });
  if (result.duplicate) return res.status(400).json({ error: 'Запрещено отправлять одинаковые комментарии подряд' });
  const comment = await get('SELECT * FROM comments WHERE id=?', [result.id]);
  return res.status(201).json((await enrichComments([comment]))[0]);
}));

commentActionsRouter.delete('/:id', authMiddleware, asyncRoute(async (req, res) => {
  const c = await get("SELECT * FROM comments WHERE id=? AND status='active'", [req.params.id]);
  if (!c) return res.status(404).json({ error: 'Комментарий не найден' });
  const post = await get('SELECT author_id FROM posts WHERE id=?', [c.post_id]);
  const currentUser = await get('SELECT role FROM users WHERE id=?', [req.userId]);
  const isMod = currentUser && (currentUser.role === 'moderator' || currentUser.role === 'admin');
  if (c.author_id !== req.userId && post?.author_id !== req.userId && !isMod) {
    return res.status(403).json({ error: 'Нет прав на удаление этого комментария' });
  }

  const result = await withDbTransaction(async (tx) => {
    const now = new Date().toISOString();
    const deleted = await tx.run("UPDATE comments SET status='deleted', updated_at=? WHERE id=? AND status='active'", [now, c.id]);
    if (deleted.changes !== 1) return { conflict: true };
    await tx.run('UPDATE posts SET comment_count=MAX(0,comment_count-1), updated_at=? WHERE id=?', [now, c.post_id]);
    return { ok: true };
  });
  if (result.conflict) return res.status(409).json({ error: 'Комментарий уже удалён' });
  return res.json({ success: true });
}));

commentActionsRouter.post('/:id/report', authMiddleware, asyncRoute(async (req, res) => {
  try {
    res.json(await createReport({
      reporterId: req.userId,
      targetType: 'comment',
      targetId: req.params.id,
      reason: req.body.reason,
    }));
  } catch (error) {
    return sendReportError(res, error);
  }
}));

export default router;
