// server/routes/meta.js — meta-game: streaks, achievements, collections, analytics
import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import { all, get, run } from '../db.js';
import { authMiddleware } from '../middleware/auth.js';
import { asyncRoute } from '../middleware/asyncRoute.js';

const router = Router();

function todayKey(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function dayDiff(first, second) {
  const a = new Date(first).getTime();
  const b = new Date(second).getTime();
  return Math.round((b - a) / 86_400_000);
}

// GET /meta/streak — current daily streak and today's status
router.get('/streak', authMiddleware, asyncRoute(async (req, res) => {
  const row = await get('SELECT * FROM daily_streaks WHERE user_id=?', [req.userId]);
  const today = todayKey();
  const streak = row || { user_id: req.userId, current_streak: 0, longest_streak: 0, total_days: 0, last_active_date: null };
  const doneToday = streak.last_active_date === today;
  res.json({
    current_streak: streak.current_streak,
    longest_streak: streak.longest_streak,
    total_days: streak.total_days,
    last_active_date: streak.last_active_date,
    done_today: doneToday,
  });
}));

// POST /meta/streak/touch — register a daily activity (idempotent per day)
router.post('/streak/touch', authMiddleware, asyncRoute(async (req, res) => {
  const now = new Date().toISOString();
  const today = todayKey();
  let streak = await get('SELECT * FROM daily_streaks WHERE user_id=?', [req.userId]);
  if (!streak) {
    await run('INSERT INTO daily_streaks (user_id,current_streak,longest_streak,total_days,last_active_date,created_at,updated_at) VALUES (?,?,?,?,?,?,?)',
      [req.userId, 1, 1, 1, today, now, now]);
    streak = { current_streak: 1, longest_streak: 1, total_days: 1, last_active_date: today };
  } else if (streak.last_active_date !== today) {
    const gap = streak.last_active_date ? dayDiff(streak.last_active_date, today) : 999;
    const nextCurrent = gap === 1 ? streak.current_streak + 1 : 1;
    const nextLongest = Math.max(streak.longest_streak, nextCurrent);
    await run('UPDATE daily_streaks SET current_streak=?, longest_streak=?, total_days=total_days+1, last_active_date=?, updated_at=? WHERE user_id=?',
      [nextCurrent, nextLongest, today, now, req.userId]);
    streak = { ...streak, current_streak: nextCurrent, longest_streak: nextLongest, total_days: streak.total_days + 1, last_active_date: today };
  }
  res.json({ current_streak: streak.current_streak, longest_streak: streak.longest_streak, total_days: streak.total_days, done_today: true });
}));

// GET /meta/achievements — all definitions with unlocked state for the user
router.get('/achievements', authMiddleware, asyncRoute(async (req, res) => {
  const defs = await all('SELECT * FROM achievements ORDER BY category, title');
  const unlocked = await all('SELECT achievement_id, unlocked_at FROM user_achievements WHERE user_id=?', [req.userId]);
  const map = new Map(unlocked.map((u) => [u.achievement_id, u.unlocked_at]));
  res.json(defs.map((def) => ({ ...def, unlocked: map.has(def.id), unlocked_at: map.get(def.id) || null })));
}));

// POST /meta/achievements/:id/unlock — idempotent unlock; returns whether it was new
router.post('/achievements/:id/unlock', authMiddleware, asyncRoute(async (req, res) => {
  const def = await get('SELECT * FROM achievements WHERE id=?', [req.params.id]);
  if (!def) return res.status(404).json({ error: 'Достижение не найдено' });
  const existing = await get('SELECT 1 FROM user_achievements WHERE user_id=? AND achievement_id=?', [req.userId, def.id]);
  if (existing) return res.json({ already_unlocked: true, achievement: def });
  const now = new Date().toISOString();
  await run('INSERT INTO user_achievements (user_id,achievement_id,unlocked_at) VALUES (?,?,?)', [req.userId, def.id, now]);
  res.json({ already_unlocked: false, achievement: def, unlocked_at: now });
}));

// GET /meta/collections — collection catalog with completion per user
router.get('/collections', authMiddleware, asyncRoute(async (req, res) => {
  const cols = await all('SELECT * FROM collections ORDER BY title');
  const rows = await Promise.all(cols.map(async (col) => {
    const completed = await all("SELECT COUNT(*) as c FROM artworks a JOIN coloring_templates t ON a.collection_id=t.id WHERE a.owner_id=? AND a.collection_id=? AND a.is_completed=1", [req.userId, col.id]);
    const total = await all('SELECT COUNT(*) as c FROM coloring_templates WHERE collection_id=?', [col.id]);
    return { ...col, completed_count: completed[0]?.c || 0, total_count: total[0]?.c || 0 };
  }));
  res.json(rows);
}));

// GET /meta/collections/:id/templates — templates belonging to a collection
router.get('/collections/:id/templates', authMiddleware, asyncRoute(async (req, res) => {
  const rows = await all("SELECT * FROM coloring_templates WHERE collection_id=? AND status='active' ORDER BY title", [req.params.id]);
  res.json(rows.map(parseSafeTemplate).map(({ cells, ...t }) => ({ ...t, total_cells: cells.length })));
}));

function parseSafeTemplate(row) {
  if (!row) return null;
  return {
    ...row,
    width: Number(row.width),
    height: Number(row.height),
    est_minutes: Number(row.est_minutes || 3),
    zone_count: Number(row.zone_count || 1),
    palette: Array.isArray(row.palette_json) ? row.palette_json : JSON.parse(row.palette_json),
    cells: Array.isArray(row.cells_json) ? row.cells_json : JSON.parse(row.cells_json),
  };
}

// POST /meta/analytics — record a lightweight analytics event
router.post('/analytics', authMiddleware, asyncRoute(async (req, res) => {
  const { event, payload = {} } = req.body;
  if (!event || typeof event !== 'string' || event.length > 64) return res.status(400).json({ error: 'Некорректное событие' });
  const now = new Date().toISOString();
  await run('INSERT INTO analytics_events (id,user_id,event,payload_json,created_at) VALUES (?,?,?,?,?)',
    [uuid(), req.userId, event, JSON.stringify(payload || {}), now]);
  res.json({ success: true });
}));

// GET /meta/analytics/summary — counts of key events for the user (for dashboards)
router.get('/analytics/summary', authMiddleware, asyncRoute(async (req, res) => {
  const events = await all('SELECT event, COUNT(*) as c FROM analytics_events WHERE user_id=? GROUP BY event', [req.userId]);
  const summary = {};
  events.forEach((row) => { summary[row.event] = row.c; });
  res.json(summary);
}));

// ── Test-only routes (never available in production) ─────────────────────────
if (process.env.NODE_ENV === 'test') {
  router.get('/_test/throw', asyncRoute(async () => {
    throw new Error('Controlled test error');
  }));

  router.get('/_test/auth-error', authMiddleware, asyncRoute(async () => {
    throw new Error('Controlled auth error');
  }));

  router.patch('/_test/set-role', authMiddleware, asyncRoute(async (req, res) => {
    const { userId, role } = req.body;
    if (!['user', 'moderator', 'admin'].includes(role)) {
      return res.status(400).json({ error: 'Invalid role' });
    }
    await run('UPDATE users SET role=? WHERE id=?', [role, userId]);
    res.json({ success: true });
  }));
}

export default router;
