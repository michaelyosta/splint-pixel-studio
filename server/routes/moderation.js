// server/routes/moderation.js
import { Router } from 'express';
import { get, all, run, withDbTransaction } from '../db.js';
import { authMiddleware } from '../middleware/auth.js';
import { requireRole } from '../middleware/authorization.js';
import { asyncRoute } from '../middleware/asyncRoute.js';
import { createReport, logModerationAction, sendReportError } from '../services/reporting.js';

const router = Router();

// POST /reports/create  (generic report)
router.post('/reports/create', authMiddleware, asyncRoute(async (req, res) => {
  try {
    res.json(await createReport({
      reporterId: req.userId,
      targetType: req.body.targetType,
      targetId: req.body.targetId,
      reason: req.body.reason,
    }));
  } catch (error) {
    return sendReportError(res, error);
  }
}));

// GET /moderation/reports  (mod only)
router.get('/reports', authMiddleware, requireRole('moderator', 'admin'), asyncRoute(async (req, res) => {
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
}));

router.get('/actions', authMiddleware, requireRole('moderator', 'admin'), asyncRoute(async (_req, res) => {
  const actions = await all('SELECT * FROM moderation_actions ORDER BY created_at DESC');
  res.json(actions);
}));

// POST /moderation/hide  (mod only)
router.post('/hide', authMiddleware, requireRole('moderator', 'admin'), asyncRoute(async (req, res) => {
  const { targetType, targetId, reason = 'manual_moderation' } = req.body;
  const result = await withDbTransaction(async () => {
    const table = targetType === 'post' ? 'posts' : targetType === 'comment' ? 'comments' : null;
    if (!table) return { invalid: true };
    const target = await get(`SELECT status FROM ${table} WHERE id=?`, [targetId]);
    if (!target) return { notFound: true };
    const now = new Date().toISOString();
    await run(`UPDATE ${table} SET status='hidden', updated_at=? WHERE id=?`, [now, targetId]);
    await run("UPDATE reports SET status='resolved' WHERE target_type=? AND target_id=?", [targetType, targetId]);
    await logModerationAction({
      actorUserId: req.userId, action: 'hide', targetType, targetId, reason: String(reason).slice(0, 120),
      previousState: target.status, newState: 'hidden',
    });
    return { success: true };
  });
  if (result.invalid) return res.status(400).json({ error: 'Invalid moderation target', code: 'INVALID_TARGET' });
  if (result.notFound) return res.status(404).json({ error: 'Moderation target not found', code: 'TARGET_NOT_FOUND' });
  res.json({ success: true });
}));

// POST /moderation/approve  (mod only)
router.post('/approve', authMiddleware, requireRole('moderator', 'admin'), asyncRoute(async (req, res) => {
  const { targetType, targetId, reason = 'manual_approval' } = req.body;
  const result = await withDbTransaction(async () => {
    const table = targetType === 'post' ? 'posts' : targetType === 'comment' ? 'comments' : null;
    if (!table) return { invalid: true };
    const target = await get(`SELECT status FROM ${table} WHERE id=?`, [targetId]);
    if (!target) return { notFound: true };
    const now = new Date().toISOString();
    await run(`UPDATE ${table} SET status='active', updated_at=? WHERE id=?`, [now, targetId]);
    await run("UPDATE reports SET status='resolved' WHERE target_type=? AND target_id=?", [targetType, targetId]);
    await logModerationAction({
      actorUserId: req.userId, action: 'approve', targetType, targetId, reason: String(reason).slice(0, 120),
      previousState: target.status, newState: 'active',
    });
    return { success: true };
  });
  if (result.invalid) return res.status(400).json({ error: 'Invalid moderation target', code: 'INVALID_TARGET' });
  if (result.notFound) return res.status(404).json({ error: 'Moderation target not found', code: 'TARGET_NOT_FOUND' });
  res.json({ success: true });
}));

// POST /moderation/ban  (mod only)
router.post('/ban', authMiddleware, requireRole('moderator', 'admin'), asyncRoute(async (req, res) => {
  const { userId, reason = 'manual_ban' } = req.body;
  const result = await withDbTransaction(async () => {
    const user = await get('SELECT is_banned FROM users WHERE id=?', [userId]);
    if (!user) return { notFound: true };
    await run('UPDATE users SET is_banned=1, updated_at=? WHERE id=?', [new Date().toISOString(), userId]);
    await logModerationAction({
      actorUserId: req.userId, action: 'ban', targetType: 'user', targetId: userId, reason: String(reason).slice(0, 120),
      previousState: user.is_banned ? 'banned' : 'active', newState: 'banned',
    });
    return { success: true };
  });
  if (result.notFound) return res.status(404).json({ error: 'User not found', code: 'TARGET_NOT_FOUND' });
  res.json({ success: true });
}));

// POST /moderation/unban  (mod only)
router.post('/unban', authMiddleware, requireRole('moderator', 'admin'), asyncRoute(async (req, res) => {
  const { userId, reason = 'manual_unban' } = req.body;
  const result = await withDbTransaction(async () => {
    const user = await get('SELECT is_banned FROM users WHERE id=?', [userId]);
    if (!user) return { notFound: true };
    await run('UPDATE users SET is_banned=0, updated_at=? WHERE id=?', [new Date().toISOString(), userId]);
    await logModerationAction({
      actorUserId: req.userId, action: 'unban', targetType: 'user', targetId: userId, reason: String(reason).slice(0, 120),
      previousState: user.is_banned ? 'banned' : 'active', newState: 'active',
    });
    return { success: true };
  });
  if (result.notFound) return res.status(404).json({ error: 'User not found', code: 'TARGET_NOT_FOUND' });
  res.json({ success: true });
}));

// GET /moderation/banned-users  (mod only)
router.get('/banned-users', authMiddleware, requireRole('moderator', 'admin'), asyncRoute(async (req, res) => {
  const users = await all('SELECT id,nickname,avatar_url FROM users WHERE is_banned=1');
  res.json(users);
}));

export default router;
