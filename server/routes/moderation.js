// server/routes/moderation.js
import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import { get, all, run } from '../db.js';
import { authMiddleware } from '../middleware/auth.js';

const router = Router();

function isMod(req, res) {
  if (req.userId !== 'user_splintmod') {
    res.status(403).json({ error: 'Только модератор имеет доступ к этому разделу' });
    return false;
  }
  return true;
}

// POST /reports/create  (generic report)
router.post('/reports/create', authMiddleware, async (req, res) => {
  const { targetType, targetId, reason = 'other' } = req.body;
  const now = new Date().toISOString();
  const id  = `rep_${uuid()}`;
  await run(`INSERT INTO reports (id,reporter_id,target_type,target_id,reason,status,created_at) VALUES (?,?,?,?,?,?,?)`,
    [id, req.userId, targetType, targetId, reason, 'pending', now]);

  const cnt = await get('SELECT COUNT(*) as c FROM reports WHERE target_type=? AND target_id=?', [targetType, targetId]);
  if (cnt.c >= 3 && targetType === 'post') {
    await run("UPDATE posts SET status='hidden', updated_at=? WHERE id=? AND status='active'", [now, targetId]);
  }
  res.json({ success: true });
});

// GET /moderation/reports  (mod only)
router.get('/reports', authMiddleware, async (req, res) => {
  if (!isMod(req, res)) return;
  const reports = await all('SELECT * FROM reports ORDER BY created_at DESC');
  const enriched = await Promise.all(reports.map(async (r) => {
    const reporter = await get('SELECT nickname FROM users WHERE id=?', [r.reporter_id]);
    let targetInfo = null;
    if (r.target_type === 'post') {
      const p = await get('SELECT title,author_id FROM posts WHERE id=?', [r.target_id]);
      if (p) { const a = await get('SELECT nickname FROM users WHERE id=?', [p.author_id]); targetInfo = { title: p.title, author: a?.nickname }; }
    } else if (r.target_type === 'comment') {
      const c = await get('SELECT text,author_id FROM comments WHERE id=?', [r.target_id]);
      if (c) { const a = await get('SELECT nickname FROM users WHERE id=?', [c.author_id]); targetInfo = { text: c.text, author: a?.nickname }; }
    } else if (r.target_type === 'user') {
      const u = await get('SELECT nickname FROM users WHERE id=?', [r.target_id]);
      targetInfo = u ? { nickname: u.nickname } : null;
    }
    return { ...r, reporter_name: reporter?.nickname, target_info: targetInfo };
  }));
  res.json(enriched);
});

// POST /moderation/hide  (mod only)
router.post('/hide', authMiddleware, async (req, res) => {
  if (!isMod(req, res)) return;
  const { targetType, targetId } = req.body;
  const now = new Date().toISOString();
  if (targetType === 'post')    await run("UPDATE posts    SET status='hidden',  updated_at=? WHERE id=?", [now, targetId]);
  if (targetType === 'comment') await run("UPDATE comments SET status='hidden',  updated_at=? WHERE id=?", [now, targetId]);
  await run("UPDATE reports SET status='resolved' WHERE target_type=? AND target_id=?", [targetType, targetId]);
  res.json({ success: true });
});

// POST /moderation/approve  (mod only)
router.post('/approve', authMiddleware, async (req, res) => {
  if (!isMod(req, res)) return;
  const { targetType, targetId } = req.body;
  const now = new Date().toISOString();
  if (targetType === 'post')    await run("UPDATE posts    SET status='active', updated_at=? WHERE id=?", [now, targetId]);
  if (targetType === 'comment') await run("UPDATE comments SET status='active', updated_at=? WHERE id=?", [now, targetId]);
  await run("UPDATE reports SET status='resolved' WHERE target_type=? AND target_id=?", [targetType, targetId]);
  res.json({ success: true });
});

// POST /moderation/ban  (mod only)
router.post('/ban', authMiddleware, async (req, res) => {
  if (!isMod(req, res)) return;
  const { userId } = req.body;
  await run('UPDATE users SET is_banned=1, updated_at=? WHERE id=?', [new Date().toISOString(), userId]);
  res.json({ success: true });
});

// POST /moderation/unban  (mod only)
router.post('/unban', authMiddleware, async (req, res) => {
  if (!isMod(req, res)) return;
  const { userId } = req.body;
  await run('UPDATE users SET is_banned=0, updated_at=? WHERE id=?', [new Date().toISOString(), userId]);
  res.json({ success: true });
});

// GET /moderation/banned-users  (mod only)
router.get('/banned-users', authMiddleware, async (req, res) => {
  if (!isMod(req, res)) return;
  const users = await all('SELECT id,nickname,avatar_url FROM users WHERE is_banned=1');
  res.json(users);
});

export default router;
