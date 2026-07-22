// server/routes/posts.js
import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import { all, get, run } from '../db.js';
import { authMiddleware, hasProfanity, hasUrl } from '../middleware/auth.js';
import { asyncRoute } from '../middleware/asyncRoute.js';

const router = Router();

async function enrichPost(post, userId) {
  const author  = await get('SELECT id,nickname,avatar_url,karma,messages_disabled,followers_only,paid_open,price_in_stars FROM users WHERE id=?', [post.author_id]);
  let artwork = post.artwork_id ? await get('SELECT * FROM artworks WHERE id=?', [post.artwork_id]) : null;
  if (artwork && (!artwork.image_url || (artwork.image_url.startsWith('data:') && artwork.image_url.length < 100))) {
    const template = artwork.collection_id ? await get('SELECT preview_url FROM coloring_templates WHERE id=?', [artwork.collection_id]) : null;
    const fallback = template?.preview_url && (!template.preview_url.startsWith('data:') || template.preview_url.length >= 100) ? template.preview_url : '/assets/catalog/neon-cat-pixel.png';
    artwork = { ...artwork, image_url: fallback };
  }
  const isLiked = !!await get('SELECT 1 FROM likes WHERE user_id=? AND post_id=?', [userId, post.id]);
  const isFollowing = !!await get('SELECT 1 FROM follows WHERE follower_id=? AND following_id=?', [userId, post.author_id]);
  return { ...post, author, artwork, is_liked: isLiked, is_following: isFollowing };
}

// POST /posts/create
router.post('/create', authMiddleware, asyncRoute(async (req, res) => {
  const { artworkId, postType, title, caption = '', commentsEnabled = true } = req.body;
  const userId = req.userId;

  const user = await get('SELECT * FROM users WHERE id=?', [userId]);
  if (!user) return res.status(404).json({ error: 'Пользователь не найден' });
  if (user.is_banned) return res.status(403).json({ error: 'Вы временно заблокированы в социальных функциях' });

  const artwork = await get('SELECT * FROM artworks WHERE id=?', [artworkId]);
  if (!artwork) return res.status(404).json({ error: 'Работа не найдена' });
  if (artwork.owner_id !== userId) return res.status(403).json({ error: 'Эту работу нельзя опубликовать: она принадлежит другому автору' });
  if (!artwork.is_completed) return res.status(400).json({ error: 'Работа ещё не завершена' });

  const alreadyPublished = await get("SELECT id FROM posts WHERE artwork_id=? AND status!='deleted'", [artworkId]);
  if (alreadyPublished) return res.status(409).json({ error: 'Вы уже публиковали эту работу' });

  // Rate limit: 3/day new users (<500 karma), 10/day others
  const maxPerDay = user.karma < 500 ? 3 : 10;
  const dayAgo    = new Date(Date.now() - 86400000).toISOString();
  const todayCount = await get("SELECT COUNT(*) as c FROM posts WHERE author_id=? AND created_at>? AND status!='deleted'", [userId, dayAgo]);
  if (todayCount.c >= maxPerDay) return res.status(429).json({ error: `Превышен лимит публикаций (${maxPerDay} в сутки)` });

  // Cooldown 60s
  const last = await get("SELECT created_at FROM posts WHERE author_id=? AND status!='deleted' ORDER BY created_at DESC LIMIT 1", [userId]);
  if (last && (Date.now() - new Date(last.created_at).getTime()) < 60000) {
    return res.status(429).json({ error: 'Слишком частые публикации. Подождите 60 секунд' });
  }

  const clean = (caption || '').trim();
  if (clean.length > 300) return res.status(400).json({ error: 'Описание не должно превышать 300 символов' });
  if (hasUrl(clean)) return res.status(400).json({ error: 'В описании запрещены внешние ссылки' });
  if (hasProfanity(clean)) return res.status(400).json({ error: 'Описание содержит недопустимые слова' });

  const now = new Date().toISOString();
  const id  = `post_${uuid()}`;
  const type = postType || (artwork.collection_id ? 'collection_art' : 'user_art');

  await run(`INSERT INTO posts (id,author_id,artwork_id,achievement_id,post_type,title,caption,
    comments_enabled,visibility,status,like_count,comment_count,published_at,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id, userId, artworkId, null, type, title || artwork.title, clean,
     commentsEnabled ? 1 : 0, 'public', 'active', 0, 0, now, now, now]);

  const post = await get('SELECT * FROM posts WHERE id=?', [id]);
  res.status(201).json(await enrichPost(post, userId));
}));

// GET /posts/:id
router.get('/:id', authMiddleware, asyncRoute(async (req, res) => {
  const post = await get('SELECT * FROM posts WHERE id=?', [req.params.id]);
  if (!post) return res.status(404).json({ error: 'Пост не найден' });
  res.json(await enrichPost(post, req.userId));
}));

// GET /posts/:id/by-user — posts for profile tab
router.get('/by-user/:authorId', authMiddleware, asyncRoute(async (req, res) => {
  const posts = await all("SELECT * FROM posts WHERE author_id=? AND status='active' ORDER BY published_at DESC", [req.params.authorId]);
  res.json(await Promise.all(posts.map((post) => enrichPost(post, req.userId))));
}));

// DELETE /posts/:id
router.delete('/:id', authMiddleware, asyncRoute(async (req, res) => {
  const post = await get('SELECT * FROM posts WHERE id=?', [req.params.id]);
  if (!post) return res.status(404).json({ error: 'Пост не найден' });
  const currentUser = await get('SELECT role FROM users WHERE id=?', [req.userId]);
  const isMod = currentUser && (currentUser.role === 'moderator' || currentUser.role === 'admin');
  if (post.author_id !== req.userId && !isMod) {
    return res.status(403).json({ error: 'У вас нет прав на удаление этого поста' });
  }
  await run("UPDATE posts SET status='deleted', updated_at=? WHERE id=?", [new Date().toISOString(), req.params.id]);
  res.json({ success: true });
}));

// POST /posts/:id/toggle-comments
router.post('/:id/toggle-comments', authMiddleware, asyncRoute(async (req, res) => {
  const post = await get('SELECT * FROM posts WHERE id=?', [req.params.id]);
  if (!post) return res.status(404).json({ error: 'Пост не найден' });
  if (post.author_id !== req.userId) return res.status(403).json({ error: 'Только автор может менять настройки комментариев' });
  const next = post.comments_enabled ? 0 : 1;
  await run('UPDATE posts SET comments_enabled=?, updated_at=? WHERE id=?', [next, new Date().toISOString(), req.params.id]);
  res.json({ success: true, comments_enabled: !!next });
}));

// POST /posts/:id/report
router.post('/:id/report', authMiddleware, asyncRoute(async (req, res) => {
  const { reason = 'other' } = req.body;
  const now = new Date().toISOString();
  const id  = `rep_${uuid()}`;
  await run(`INSERT INTO reports (id,reporter_id,target_type,target_id,reason,status,created_at) VALUES (?,?,?,?,?,?,?)`,
    [id, req.userId, 'post', req.params.id, reason, 'pending', now]);

  // Auto-hide at 3 reports
  const cnt = await get('SELECT COUNT(*) as c FROM reports WHERE target_type=? AND target_id=?', ['post', req.params.id]);
  if (cnt.c >= 3) await run("UPDATE posts SET status='hidden', updated_at=? WHERE id=? AND status='active'", [now, req.params.id]);

  res.json({ success: true });
}));

export default router;
