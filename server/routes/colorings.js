import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import { all, get, run } from '../db.js';
import { authMiddleware } from '../middleware/auth.js';
import { asyncRoute } from '../middleware/asyncRoute.js';
import { deletePrivateOriginal, storePrivateOriginal } from '../services/media-storage.js';

const router = Router();

async function touchStreak(userId) {
  const now = new Date().toISOString();
  const today = now.slice(0, 10);
  const streak = await get('SELECT * FROM daily_streaks WHERE user_id=?', [userId]);
  if (!streak) {
    await run('INSERT INTO daily_streaks (user_id,current_streak,longest_streak,total_days,last_active_date,created_at,updated_at) VALUES (?,?,?,?,?,?,?)',
      [userId, 1, 1, 1, today, now, now]);
  } else if (streak.last_active_date !== today) {
    const gap = streak.last_active_date ? Math.round((new Date(today).getTime() - new Date(streak.last_active_date).getTime()) / 86_400_000) : 999;
    const nextCurrent = gap === 1 ? streak.current_streak + 1 : 1;
    await run('UPDATE daily_streaks SET current_streak=?, longest_streak=?, total_days=total_days+1, last_active_date=?, updated_at=? WHERE user_id=?',
      [nextCurrent, Math.max(streak.longest_streak, nextCurrent), today, now, userId]);
  }
}

async function unlockAchievement(userId, achievementId) {
  const def = await get('SELECT * FROM achievements WHERE id=?', [achievementId]);
  if (!def) return;
  const existing = await get('SELECT 1 FROM user_achievements WHERE user_id=? AND achievement_id=?', [userId, achievementId]);
  if (existing) return;
  await run('INSERT INTO user_achievements (user_id,achievement_id,unlocked_at) VALUES (?,?,?)', [userId, achievementId, new Date().toISOString()]);
}

function parseTemplate(row) {
  if (!row) return null;
  return {
    ...row,
    width: Number(row.width),
    height: Number(row.height),
    est_minutes: Number(row.est_minutes || 3),
    zone_count: Number(row.zone_count || 1),
    daily_featured: Number(row.daily_featured || 0),
    palette: Array.isArray(row.palette_json) ? row.palette_json : JSON.parse(row.palette_json),
    cells: Array.isArray(row.cells_json) ? row.cells_json : JSON.parse(row.cells_json),
    palette_json: undefined,
    cells_json: undefined,
    original_media_key: undefined,
  };
}

function canRead(template, userId) {
  return template.visibility === 'public' || template.owner_id === userId;
}

function emptyProgress(template) {
  return Array(template.width * template.height).fill(-1);
}

function validateMap(template, filled) {
  if (!Array.isArray(filled) || filled.length !== template.cells.length) return 'Некорректный размер карты раскраски';
  if (filled.some((color) => !Number.isInteger(color) || color < -1 || color >= template.palette.length)) return 'Некорректный цвет в карте раскраски';
  return null;
}

function validateResultDataUrl(dataUrl) {
  if (dataUrl === null || dataUrl === undefined) return true;
  if (typeof dataUrl !== 'string' || dataUrl.length > 500_000 || !/^data:image\/png;base64,/i.test(dataUrl)) return false;
  const bytes = Buffer.from(dataUrl.split(',')[1], 'base64');
  return bytes.length > 32 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
}

function isComplete(template, filled) {
  return filled.every((color, index) => color === template.cells[index]);
}

function progressPayload(template, row) {
  const parsedFilled = row ? (Array.isArray(row.filled_json) ? row.filled_json : JSON.parse(row.filled_json)) : null;
  const compatible = parsedFilled?.length === template.cells.length;
  const filled = compatible ? parsedFilled : emptyProgress(template);
  const completedCount = filled.reduce((count, color, index) => count + (color === template.cells[index] ? 1 : 0), 0);
  return {
    template_id: template.id,
    filled,
    revision: compatible ? Number(row.revision) : 0,
    completed_at: compatible ? (row?.completed_at ?? null) : null,
    completed_cells: completedCount,
    total_cells: template.cells.length,
    percent: Math.round((completedCount / template.cells.length) * 100),
  };
}

// GET /colorings — editorial catalog with filters
router.get('/', authMiddleware, asyncRoute(async (req, res) => {
  const { mood, theme, max_minutes, featured } = req.query;
  const clauses = ["status='active'", "visibility='public'"];
  const params = [];
  if (mood) { clauses.push('mood=?'); params.push(mood); }
  if (theme) { clauses.push('theme=?'); params.push(theme); }
  if (max_minutes) { clauses.push('est_minutes<=?'); params.push(Number(max_minutes)); }
  if (featured === '1') { clauses.push('daily_featured=1'); }
  const where = clauses.join(' AND ');
  const rows = await all(`SELECT * FROM coloring_templates WHERE ${where} ORDER BY daily_featured DESC, added_at DESC, title`, params);
  res.json(rows.map(parseTemplate).map(({ cells, ...template }) => ({ ...template, total_cells: cells.length })));
}));

// GET /colorings/today — editorial "for you today" + quick picks
router.get('/today', authMiddleware, asyncRoute(async (req, res) => {
  const featured = await get("SELECT * FROM coloring_templates WHERE status='active' AND visibility='public' AND daily_featured=1 ORDER BY added_at DESC LIMIT 1");
  const quick = await all("SELECT * FROM coloring_templates WHERE status='active' AND visibility='public' AND est_minutes<=3 ORDER BY added_at DESC LIMIT 6");
  const allTemplates = await all("SELECT * FROM coloring_templates WHERE status='active' AND visibility='public' ORDER BY added_at DESC");
  const summarize = (row) => row ? { ...parseTemplate(row), cells: undefined, total_cells: parseTemplate(row).cells.length } : null;
  res.json({
    for_you: summarize(featured),
    quick: quick.map((row) => { const t = parseTemplate(row); return { ...t, cells: undefined, total_cells: t.cells.length }; }),
    newest: allTemplates.slice(0, 8).map((row) => { const t = parseTemplate(row); return { ...t, cells: undefined, total_cells: t.cells.length }; }),
  });
}));

// GET /colorings/:id/zones — fragmented session chunks with per-zone progress
router.get('/:id/zones', authMiddleware, asyncRoute(async (req, res) => {
  const template = parseTemplate(await get("SELECT * FROM coloring_templates WHERE id=? AND status='active'", [req.params.id]));
  if (!template || !canRead(template, req.userId)) return res.status(404).json({ error: 'Раскраска не найдена' });
  const progress = await get('SELECT * FROM coloring_progress WHERE user_id=? AND template_id=?', [req.userId, template.id]);
  const filled = progress ? (Array.isArray(progress.filled_json) ? progress.filled_json : JSON.parse(progress.filled_json)) : emptyProgress(template);
  const zoneRows = await all('SELECT * FROM coloring_zones WHERE template_id=? ORDER BY id', [template.id]);
  const zones = zoneRows.map((row) => {
    const indices = Array.isArray(row.cell_indices_json) ? row.cell_indices_json : JSON.parse(row.cell_indices_json);
    const done = indices.reduce((count, index) => count + (filled[index] === template.cells[index] ? 1 : 0), 0);
    return { id: row.id, title: row.title, total: indices.length, done, percent: indices.length ? Math.round((done / indices.length) * 100) : 100, indices };
  });
  res.json({ template_id: template.id, zones });
}));

// DELETE /colorings/:id - only the owner can delete a user-created template
router.delete('/:id', authMiddleware, asyncRoute(async (req, res) => {
  const template = await get("SELECT * FROM coloring_templates WHERE id=? AND status='active'", [req.params.id]);
  if (!template) return res.status(404).json({ error: 'Раскраска не найдена' });
  if (template.owner_id !== req.userId || template.source_type !== 'user') return res.status(403).json({ error: 'Можно удалить только свою загруженную раскраску' });

  const artworks = await all('SELECT id FROM artworks WHERE owner_id=? AND collection_id=?', [req.userId, template.id]);
  for (const artwork of artworks) {
    const posts = await all('SELECT id FROM posts WHERE artwork_id=?', [artwork.id]);
    for (const post of posts) {
      await run('DELETE FROM likes WHERE post_id=?', [post.id]);
      await run('DELETE FROM comments WHERE post_id=?', [post.id]);
      await run("DELETE FROM reports WHERE target_type='post' AND target_id=?", [post.id]);
      await run('DELETE FROM posts WHERE id=?', [post.id]);
    }
    await run('DELETE FROM artworks WHERE id=?', [artwork.id]);
  }
  await run('DELETE FROM coloring_progress WHERE template_id=?', [template.id]);
  await run('DELETE FROM coloring_templates WHERE id=?', [template.id]);
  await deletePrivateOriginal(template.original_media_key).catch((error) => console.warn('Could not delete original media:', error.message));
  res.json({ success: true });
}));

// POST /colorings/create - a private template built in the browser from a user image
router.post('/create', authMiddleware, asyncRoute(async (req, res) => {
  const { title, description = '', width, height, palette, cells, previewDataUrl = null, originalDataUrl = null } = req.body;
  const safeTitle = String(title || '').trim().slice(0, 80);
  const safeWidth = Number(width);
  const safeHeight = Number(height);
  if (!safeTitle || !Number.isInteger(safeWidth) || !Number.isInteger(safeHeight) || safeWidth < 8 || safeHeight < 8 || safeWidth > 64 || safeHeight > 64) {
    return res.status(400).json({ error: 'Выберите название и размер от 8×8 до 64×64' });
  }
  if (!Array.isArray(palette) || palette.length < 2 || palette.length > 32 || palette.some((color) => !/^#[0-9a-f]{6}$/i.test(color))) {
    return res.status(400).json({ error: 'Палитра должна содержать от 2 до 32 HEX-цветов' });
  }
  if (!Array.isArray(cells) || cells.length !== safeWidth * safeHeight || cells.some((color) => !Number.isInteger(color) || color < 0 || color >= palette.length)) {
    return res.status(400).json({ error: 'Карта клеток не соответствует раскраске' });
  }
  if (previewDataUrl !== null && (typeof previewDataUrl !== 'string' || previewDataUrl.length > 300_000 || !/^data:image\/png;base64,/i.test(previewDataUrl))) {
    return res.status(400).json({ error: 'Некорректная миниатюра раскраски' });
  }
  const now = new Date().toISOString();
  const id = `color_${uuid()}`;
  const originalMediaKey = await storePrivateOriginal(originalDataUrl, req.userId);
  await run(`INSERT INTO coloring_templates (id,owner_id,title,description,category,difficulty,width,height,palette_json,cells_json,preview_url,original_media_key,source_type,visibility,status,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id, req.userId, safeTitle, String(description).slice(0, 280), 'custom', 'custom', safeWidth, safeHeight, JSON.stringify(palette), JSON.stringify(cells), previewDataUrl, originalMediaKey, 'user', 'private', 'active', now, now]);
  res.status(201).json({ ...parseTemplate(await get('SELECT * FROM coloring_templates WHERE id=?', [id])), source_stored: Boolean(originalMediaKey) });
}));

// GET /colorings/mine - private and catalog templates with the caller's progress
router.get('/mine', authMiddleware, asyncRoute(async (req, res) => {
  const templates = (await all(`
    SELECT t.* FROM coloring_templates t
    LEFT JOIN coloring_progress p ON p.template_id=t.id AND p.user_id=?
    WHERE t.status='active' AND (t.owner_id=? OR p.user_id IS NOT NULL)
    ORDER BY t.updated_at DESC
  `, [req.userId, req.userId])).map(parseTemplate);
  const rows = await Promise.all(templates.map(async (template) => {
    const progress = await get('SELECT * FROM coloring_progress WHERE user_id=? AND template_id=?', [req.userId, template.id]);
    return { ...template, progress: progressPayload(template, progress) };
  }));
  res.json(rows);
}));

// GET /colorings/:id
router.get('/:id', authMiddleware, asyncRoute(async (req, res) => {
  const template = parseTemplate(await get('SELECT * FROM coloring_templates WHERE id=? AND status=\'active\'', [req.params.id]));
  if (!template || !canRead(template, req.userId)) return res.status(404).json({ error: 'Раскраска не найдена' });
  res.json(template);
}));

// GET /colorings/:id/progress
router.get('/:id/progress', authMiddleware, asyncRoute(async (req, res) => {
  const template = parseTemplate(await get('SELECT * FROM coloring_templates WHERE id=? AND status=\'active\'', [req.params.id]));
  if (!template || !canRead(template, req.userId)) return res.status(404).json({ error: 'Раскраска не найдена' });
  const progress = await get('SELECT * FROM coloring_progress WHERE user_id=? AND template_id=?', [req.userId, template.id]);
  const artwork = await get("SELECT id FROM artworks WHERE owner_id=? AND source_type='coloring' AND collection_id=?", [req.userId, template.id]);
  res.json({ ...progressPayload(template, progress), artwork_id: artwork?.id || null });
}));

// PUT /colorings/:id/progress
router.put('/:id/progress', authMiddleware, asyncRoute(async (req, res) => {
  const template = parseTemplate(await get('SELECT * FROM coloring_templates WHERE id=? AND status=\'active\'', [req.params.id]));
  if (!template || !canRead(template, req.userId)) return res.status(404).json({ error: 'Раскраска не найдена' });
  const existing = await get('SELECT * FROM coloring_progress WHERE user_id=? AND template_id=?', [req.userId, template.id]);
  const clientRevision = Number(req.body.revision);
  if (existing && Number.isInteger(clientRevision) && clientRevision < Number(existing.revision)) {
    return res.status(409).json({ error: 'Прогресс уже обновлён на другом устройстве', progress: progressPayload(template, existing) });
  }
  const filled = req.body.filled;
  const validationError = validateMap(template, filled);
  if (validationError) return res.status(400).json({ error: validationError });
  if (!validateResultDataUrl(req.body.resultDataUrl)) return res.status(400).json({ error: 'Некорректное изображение результата' });

  const now = new Date().toISOString();
  const completed = isComplete(template, filled);
  const completedAt = completed ? (existing?.completed_at || now) : null;
  const wasEmpty = !existing || JSON.parse(existing.filled_json).every((color) => color === -1);
  const revision = Number(existing?.revision || 0) + 1;
  await run(`INSERT INTO coloring_progress (user_id,template_id,filled_json,revision,completed_at,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?)
    ON CONFLICT(user_id,template_id) DO UPDATE SET filled_json=excluded.filled_json, revision=excluded.revision, completed_at=excluded.completed_at, updated_at=excluded.updated_at`,
    [req.userId, template.id, JSON.stringify(filled), revision, completedAt, existing?.created_at || now, now]);

  await touchStreak(req.userId);
  if (wasEmpty && filled.some((color) => color !== -1)) await unlockAchievement(req.userId, 'ach_first_pixel');
  if (completed) {
    await unlockAchievement(req.userId, 'ach_first_zone');
    const finished = await all("SELECT COUNT(*) as c FROM artworks a JOIN coloring_templates t ON a.collection_id=t.id WHERE a.owner_id=? AND a.is_completed=1 AND t.source_type='catalog'", [req.userId]);
    if ((finished[0]?.c || 0) >= 5) await unlockAchievement(req.userId, 'ach_complete_5');
    if (template.theme === 'night-city' || template.theme === 'space') {
      const nightCount = await all("SELECT COUNT(*) as c FROM artworks a JOIN coloring_templates t ON a.collection_id=t.id WHERE a.owner_id=? AND a.is_completed=1 AND t.theme IN ('night-city','space')", [req.userId]);
      if ((nightCount[0]?.c || 0) >= 3) await unlockAchievement(req.userId, 'ach_style_night');
    }
    if (template.theme === 'forest' || template.theme === 'cozy') {
      const forestCount = await all("SELECT COUNT(*) as c FROM artworks a JOIN coloring_templates t ON a.collection_id=t.id WHERE a.owner_id=? AND a.is_completed=1 AND t.theme IN ('forest','cozy')", [req.userId]);
      if ((forestCount[0]?.c || 0) >= 3) await unlockAchievement(req.userId, 'ach_style_forest');
    }
    if (template.theme === 'space' || template.theme === 'sea') {
      const spaceCount = await all("SELECT COUNT(*) as c FROM artworks a JOIN coloring_templates t ON a.collection_id=t.id WHERE a.owner_id=? AND a.is_completed=1 AND t.theme IN ('space','sea')", [req.userId]);
      if ((spaceCount[0]?.c || 0) >= 3) await unlockAchievement(req.userId, 'ach_style_space');
    }
  }

  let artworkId = null;
  if (completed) {
    const artwork = await get("SELECT id FROM artworks WHERE owner_id=? AND source_type='coloring' AND collection_id=?", [req.userId, template.id]);
    artworkId = artwork?.id || `art_${uuid()}`;
    if (!artwork) {
      await run(`INSERT INTO artworks (id,owner_id,source_type,image_url,title,collection_id,collection_title,rarity,is_completed,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?)`, [artworkId, req.userId, 'coloring', req.body.resultDataUrl || template.preview_url, template.title, template.id, template.title, template.difficulty, 1, now, now]);
    } else if (req.body.resultDataUrl) {
      await run('UPDATE artworks SET image_url=?, title=?, updated_at=? WHERE id=?', [req.body.resultDataUrl, template.title, now, artworkId]);
    }
  }
  const saved = await get('SELECT * FROM coloring_progress WHERE user_id=? AND template_id=?', [req.userId, template.id]);
  res.json({ ...progressPayload(template, saved), artwork_id: artworkId });
}));

export default router;
