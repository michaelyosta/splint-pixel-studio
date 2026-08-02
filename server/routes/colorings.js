import { Router } from 'express';
import { createHash } from 'node:crypto';
import { v4 as uuid } from 'uuid';
import { all, get, run, withDbTransaction } from '../db.js';
import { isUniqueConstraintError } from '../database/sql.js';
import { authMiddleware } from '../middleware/auth.js';
import { asyncRoute } from '../middleware/asyncRoute.js';
import { decodeImageDataUrl, deletePrivateOriginal, publicMediaUrl, storeMediaObject, storePrivateOriginal } from '../services/media-storage.js';
import { renderCanonicalPng, renderCanonicalThumbnail } from '../services/canonical-renderer.js';
import { validatePublicTemplateComplexity } from '../services/template-complexity.js';

const router = Router();

function parseJsonArray(value) {
  if (Array.isArray(value)) return value;
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }
  return null;
}

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
    rating_average: Number(row.rating_average || 0),
    rating_count: Number(row.rating_count || 0),
    viewer_rating: row.viewer_rating == null ? null : Number(row.viewer_rating),
    palette: parseJsonArray(row.palette_json),
    cells: parseJsonArray(row.cells_json),
    palette_json: undefined,
    cells_json: undefined,
    original_media_key: undefined,
  };
}

function canRead(template, userId) {
  return template.visibility === 'public' || template.owner_id === userId;
}

async function attachRatings(rows, userId) {
  if (!rows.length) return rows;
  const placeholders = rows.map(() => '?').join(',');
  const ids = rows.map((row) => row.id);
  const [summaries, viewerRatings] = await Promise.all([
    all(`SELECT template_id, AVG(rating) AS rating_average, COUNT(*) AS rating_count
      FROM template_ratings WHERE template_id IN (${placeholders}) GROUP BY template_id`, ids),
    all(`SELECT template_id, rating AS viewer_rating
      FROM template_ratings WHERE user_id=? AND template_id IN (${placeholders})`, [userId, ...ids]),
  ]);
  const summaryById = new Map(summaries.map((item) => [item.template_id, item]));
  const viewerById = new Map(viewerRatings.map((item) => [item.template_id, item.viewer_rating]));
  return rows.map((row) => ({
    ...row,
    rating_average: Number(summaryById.get(row.id)?.rating_average || 0),
    rating_count: Number(summaryById.get(row.id)?.rating_count || 0),
    viewer_rating: viewerById.has(row.id) ? Number(viewerById.get(row.id)) : null,
  }));
}

async function ratingPayload(templateId, userId) {
  const [summary, viewer] = await Promise.all([
    get('SELECT AVG(rating) AS rating_average, COUNT(*) AS rating_count FROM template_ratings WHERE template_id=?', [templateId]),
    get('SELECT rating AS viewer_rating FROM template_ratings WHERE template_id=? AND user_id=?', [templateId, userId]),
  ]);
  return {
    rating_average: Number(summary?.rating_average || 0),
    rating_count: Number(summary?.rating_count || 0),
    viewer_rating: viewer ? Number(viewer.viewer_rating) : null,
  };
}

function emptyProgress(template) {
  return Array(template.width * template.height).fill(-1);
}

function validateChanges(template, changes) {
  if (!Array.isArray(changes) || !changes.length || changes.length > 64) return 'Некорректный набор изменений раскраски';
  const seen = new Set();
  for (const change of changes) {
    if (!change || !Number.isInteger(change.index) || !Number.isInteger(change.color)
      || change.index < 0 || change.index >= template.cells.length
      || change.color < -1 || change.color >= template.palette.length
      || seen.has(change.index)) return 'Некорректный набор изменений раскраски';
    seen.add(change.index);
  }
  return null;
}

function isComplete(template, filled) {
  return filled.every((color, index) => color === template.cells[index]);
}

function changesHash(changes) {
  return createHash('sha256').update(JSON.stringify(changes)).digest('hex');
}

function normalizeClientBatchId(value, revision, hash) {
  const candidate = typeof value === 'string' ? value.trim() : '';
  if (candidate && /^[\x21-\x7e]{8,128}$/.test(candidate)) return candidate;
  return `legacy-${revision}-${hash.slice(0, 32)}`;
}

function canonicalStorageKey(userId, artworkId) {
  return `artworks/${String(userId).replace(/[^a-zA-Z0-9_-]/g, '_')}/${artworkId}.png`;
}

function canonicalThumbnailStorageKey(userId, artworkId) {
  return `thumbnails/${String(userId).replace(/[^a-zA-Z0-9_-]/g, '_')}/${artworkId}.png`;
}

function progressPayload(template, row) {
  const parsedFilled = row ? parseJsonArray(row.filled_json) : null;
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
  const rows = await attachRatings(
    await all(`SELECT * FROM coloring_templates WHERE ${where} ORDER BY daily_featured DESC, added_at DESC, title`, params),
    req.userId,
  );
  res.json(rows.map(parseTemplate).map(({ cells, ...template }) => ({ ...template, total_cells: cells.length })));
}));

// GET /colorings/today — editorial "for you today" + quick picks
router.get('/today', authMiddleware, asyncRoute(async (req, res) => {
  const featured = await get("SELECT * FROM coloring_templates WHERE status='active' AND visibility='public' AND daily_featured=1 ORDER BY added_at DESC LIMIT 1");
  const quick = await all("SELECT * FROM coloring_templates WHERE status='active' AND visibility='public' AND est_minutes<=3 ORDER BY added_at DESC LIMIT 6");
  const allTemplates = await all("SELECT * FROM coloring_templates WHERE status='active' AND visibility='public' ORDER BY added_at DESC");
  const ratedRows = await attachRatings(
    [...new Map([featured, ...quick, ...allTemplates].filter(Boolean).map((row) => [row.id, row])).values()],
    req.userId,
  );
  const ratedById = new Map(ratedRows.map((row) => [row.id, row]));
  const summarize = (row) => {
    if (!row) return null;
    const parsed = parseTemplate(ratedById.get(row.id) || row);
    return { ...parsed, cells: undefined, total_cells: parsed.cells.length };
  };
  res.json({
    for_you: summarize(featured),
    quick: quick.map(summarize),
    newest: allTemplates.slice(0, 8).map(summarize),
  });
}));

// PATCH /colorings/:id/visibility — publish or withdraw an owned import.
router.patch('/:id/visibility', authMiddleware, asyncRoute(async (req, res) => {
  const template = await get("SELECT * FROM coloring_templates WHERE id=? AND status='active'", [req.params.id]);
  if (!template) return res.status(404).json({ error: 'Раскраска не найдена' });
  if (template.owner_id !== req.userId || template.source_type !== 'user') {
    return res.status(403).json({ error: 'Публиковать можно только свои загруженные раскраски' });
  }
  const visibility = req.body.visibility;
  if (!['public', 'private'].includes(visibility)) {
    return res.status(400).json({ error: 'Некорректная видимость раскраски' });
  }
  if (visibility === 'public') {
    const parsedTemplate = parseTemplate(template);
    const complexity = validatePublicTemplateComplexity({
      width: parsedTemplate.width,
      height: parsedTemplate.height,
      palette: parsedTemplate.palette,
      cells: parsedTemplate.cells,
    });
    if (!complexity.allowed) {
      return res.status(422).json({ error: 'Раскраска слишком сложная для публичного каталога', code: 'TEMPLATE_TOO_COMPLEX', complexity });
    }
  }
  const now = new Date().toISOString();
  await run('UPDATE coloring_templates SET visibility=?, updated_at=? WHERE id=?', [visibility, now, template.id]);
  const rated = await attachRatings([await get('SELECT * FROM coloring_templates WHERE id=?', [template.id])], req.userId);
  res.json(parseTemplate(rated[0]));
}));

// PUT /colorings/:id/rating — one current 1–5 score per user and public template.
router.put('/:id/rating', authMiddleware, asyncRoute(async (req, res) => {
  const rating = Number(req.body.rating);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return res.status(400).json({ error: 'Оценка должна быть от 1 до 5' });
  }
  const template = await get("SELECT id, owner_id FROM coloring_templates WHERE id=? AND status='active' AND visibility='public'", [req.params.id]);
  if (!template) return res.status(404).json({ error: 'Публичная раскраска не найдена' });
  if (template.owner_id === req.userId) {
    return res.status(403).json({ error: 'Свою раскраску нельзя оценивать' });
  }
  const now = new Date().toISOString();
  await run(`INSERT INTO template_ratings (template_id,user_id,rating,created_at,updated_at)
    VALUES (?,?,?,?,?)
    ON CONFLICT (template_id,user_id) DO UPDATE SET rating=excluded.rating, updated_at=excluded.updated_at`,
  [template.id, req.userId, rating, now, now]);
  res.json(await ratingPayload(template.id, req.userId));
}));

router.delete('/:id/rating', authMiddleware, asyncRoute(async (req, res) => {
  const template = await get("SELECT id FROM coloring_templates WHERE id=? AND status='active' AND visibility='public'", [req.params.id]);
  if (!template) return res.status(404).json({ error: 'Публичная раскраска не найдена' });
  await run('DELETE FROM template_ratings WHERE template_id=? AND user_id=?', [template.id, req.userId]);
  res.json(await ratingPayload(template.id, req.userId));
}));

// GET /colorings/:id/zones — fragmented session chunks with per-zone progress
router.get('/:id/zones', authMiddleware, asyncRoute(async (req, res) => {
  const template = parseTemplate(await get("SELECT * FROM coloring_templates WHERE id=? AND status='active'", [req.params.id]));
  if (!template || !canRead(template, req.userId)) return res.status(404).json({ error: 'Раскраска не найдена' });
  const progress = await get('SELECT * FROM coloring_progress WHERE user_id=? AND template_id=?', [req.userId, template.id]);
  const filled = progress ? parseJsonArray(progress.filled_json) : emptyProgress(template);
  const zoneRows = await all('SELECT * FROM coloring_zones WHERE template_id=? ORDER BY id', [template.id]);
  const zones = zoneRows.map((row) => {
    const indices = parseJsonArray(row.cell_indices_json);
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

  const artworks = await all('SELECT id FROM artworks WHERE owner_id=? AND template_id=?', [req.userId, template.id]);
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
  if (!safeTitle || !Number.isInteger(safeWidth) || !Number.isInteger(safeHeight) || safeWidth < 8 || safeHeight < 8 || safeWidth > 160 || safeHeight > 160) {
    return res.status(400).json({ error: 'Выберите название и размер от 8×8 до 160×160' });
  }
  if (!Array.isArray(palette) || palette.length < 2 || palette.length > 32 || palette.some((color) => !/^#[0-9a-f]{6}$/i.test(color))) {
    return res.status(400).json({ error: 'Палитра должна содержать от 2 до 32 HEX-цветов' });
  }
  if (!Array.isArray(cells) || cells.length !== safeWidth * safeHeight || cells.some((color) => !Number.isInteger(color) || color < 0 || color >= palette.length)) {
    return res.status(400).json({ error: 'Карта клеток не соответствует раскраске' });
  }
  if (previewDataUrl !== null && (typeof previewDataUrl !== 'string' || previewDataUrl.length > 300_000 || !/^data:image\/png;base64,/i.test(previewDataUrl) || !decodeImageDataUrl(previewDataUrl))) {
    return res.status(400).json({ error: 'Некорректная миниатюра раскраски' });
  }
  const now = new Date().toISOString();
  const id = `color_${uuid()}`;
  const originalMediaKey = await storePrivateOriginal(originalDataUrl, req.userId);
  await run(`INSERT INTO coloring_templates (id,owner_id,title,description,category,difficulty,width,height,palette_json,cells_json,preview_url,original_media_key,source_type,visibility,status,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id, req.userId, safeTitle, String(description).slice(0, 280), 'custom', 'custom', safeWidth, safeHeight, JSON.stringify(palette), JSON.stringify(cells), null, originalMediaKey, 'user', 'private', 'active', now, now]);
  res.status(201).json({ ...parseTemplate(await get('SELECT * FROM coloring_templates WHERE id=?', [id])), source_stored: Boolean(originalMediaKey) });
}));

// GET /colorings/mine - private and catalog templates with the caller's progress
router.get('/mine', authMiddleware, asyncRoute(async (req, res) => {
  const templateRows = await attachRatings(await all(`
    SELECT t.* FROM coloring_templates t
    LEFT JOIN coloring_progress p ON p.template_id=t.id AND p.user_id=?
    WHERE t.status='active' AND (t.owner_id=? OR p.user_id IS NOT NULL)
    ORDER BY t.updated_at DESC
  `, [req.userId, req.userId]), req.userId);
  const templates = templateRows.map(parseTemplate);
  const rows = await Promise.all(templates.map(async (template) => {
    const progress = await get('SELECT * FROM coloring_progress WHERE user_id=? AND template_id=?', [req.userId, template.id]);
    return { ...template, progress: progressPayload(template, progress) };
  }));
  res.json(rows);
}));

// GET /colorings/:id
router.get('/:id', authMiddleware, asyncRoute(async (req, res) => {
  const row = await get('SELECT * FROM coloring_templates WHERE id=? AND status=\'active\'', [req.params.id]);
  const template = parseTemplate((await attachRatings(row ? [row] : [], req.userId))[0]);
  if (!template || !canRead(template, req.userId)) return res.status(404).json({ error: 'Раскраска не найдена' });
  res.json(template);
}));

// GET /colorings/:id/progress
router.get('/:id/progress', authMiddleware, asyncRoute(async (req, res) => {
  const template = parseTemplate(await get('SELECT * FROM coloring_templates WHERE id=? AND status=\'active\'', [req.params.id]));
  if (!template || !canRead(template, req.userId)) return res.status(404).json({ error: 'Раскраска не найдена' });
  const progress = await get('SELECT * FROM coloring_progress WHERE user_id=? AND template_id=?', [req.userId, template.id]);
  const artwork = await get("SELECT id FROM artworks WHERE owner_id=? AND source_type='coloring' AND template_id=?", [req.userId, template.id]);
  res.json({ ...progressPayload(template, progress), artwork_id: artwork?.id || null });
}));

// PUT was intentionally retired: a client must never replace the whole progress map.
router.put('/:id/progress', authMiddleware, (_req, res) => {
  res.status(405).json({ error: 'Используйте действия раскраски, а не полную карту прогресса' });
});

// POST /colorings/:id/progress/actions — server derives the new map and completion state.
router.post('/:id/progress/actions', authMiddleware, asyncRoute(async (req, res) => {
  const template = parseTemplate(await get('SELECT * FROM coloring_templates WHERE id=? AND status=\'active\'', [req.params.id]));
  if (!template || !canRead(template, req.userId)) return res.status(404).json({ error: 'Раскраска не найдена' });

  const changes = req.body.changes;
  const validationError = validateChanges(template, changes);
  if (validationError) return res.status(400).json({ error: validationError });

  const clientRevision = Number(req.body.revision);
  if (!Number.isInteger(clientRevision) || clientRevision < 0) {
    return res.status(400).json({ error: 'Некорректная revision' });
  }

  const batchHash = changesHash(changes);
  const clientBatchId = normalizeClientBatchId(req.body.clientBatchId || req.headers['idempotency-key'], clientRevision, batchHash);

  const now = new Date().toISOString();
  const casResult = await withDbTransaction(async (tx) => {
      const existingBatch = await tx.get(
        'SELECT * FROM coloring_progress_batches WHERE user_id=? AND template_id=? AND client_batch_id=?',
        [req.userId, template.id, clientBatchId],
      );
      if (existingBatch) {
        if (existingBatch.changes_hash !== batchHash || Number(existingBatch.revision_before) !== clientRevision) {
          return { badBatch: true };
        }
        const existingProgress = await tx.get('SELECT * FROM coloring_progress WHERE user_id=? AND template_id=?', [req.userId, template.id]);
        const existingArtwork = await tx.get("SELECT id,storage_key,render_status FROM artworks WHERE owner_id=? AND source_type='coloring' AND template_id=?", [req.userId, template.id]);
        return {
          conflict: false,
          replay: true,
          revision: Number(existingBatch.revision_after),
          artworkId: existingArtwork?.id || null,
          renderStatus: existingArtwork?.render_status || null,
          progress: existingProgress ? progressPayload(template, existingProgress) : null,
        };
      }

      const existing = await tx.get('SELECT * FROM coloring_progress WHERE user_id=? AND template_id=?', [req.userId, template.id]);

      if (existing) {
        const serverRevision = Number(existing.revision);
        if (clientRevision !== serverRevision) {
          return { conflict: true, progress: progressPayload(template, existing) };
        }
      } else {
        if (clientRevision !== 0) {
          return { conflict: true, progress: null, badRequest: true };
        }
      }

      const currentFilled = existing ? (parseJsonArray(existing.filled_json) || emptyProgress(template)) : emptyProgress(template);
      if (currentFilled.length !== template.cells.length) return { conflict: true, progress: existing ? progressPayload(template, existing) : null };
      const filled = [...currentFilled];
      for (const change of changes) {
        if (change.color !== -1 && change.color !== template.cells[change.index]) {
          return { badAction: true };
        }
        filled[change.index] = change.color;
      }
      const completed = isComplete(template, filled);
      const nextRevision = clientRevision + 1;
      const completedAt = completed ? (existing?.completed_at || now) : null;
      let artworkId = null;
      let renderArtifact = null;
      let renderStatus = null;

      if (existing) {
        const updateResult = await tx.run(
          'UPDATE coloring_progress SET filled_json=?, revision=?, completed_at=?, updated_at=? WHERE user_id=? AND template_id=? AND revision=?',
          [JSON.stringify(filled), nextRevision, completedAt, now, req.userId, template.id, clientRevision],
        );

        if (updateResult.changes === 0) {
          const serverProgress = await tx.get('SELECT * FROM coloring_progress WHERE user_id=? AND template_id=?', [req.userId, template.id]);
          return { conflict: true, progress: progressPayload(template, serverProgress) };
        }
      } else {
        try {
          await tx.run(
            'INSERT INTO coloring_progress (user_id,template_id,filled_json,revision,completed_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?)',
            [req.userId, template.id, JSON.stringify(filled), nextRevision, completedAt, now, now],
          );
        } catch (e) {
          if (isUniqueConstraintError(e, 'sqlite') || isUniqueConstraintError(e, 'postgres')) {
            return { conflict: true, progress: null, insertConflict: true };
          }
          throw e;
        }
      }

      const wasEmpty = !existing || currentFilled.every((color) => color === -1);
      const justCompleted = completed && !existing?.completed_at;
      if (justCompleted) {
        renderArtifact = renderCanonicalPng({
          width: template.width,
          height: template.height,
          palette: template.palette,
          cells: template.cells,
          filled,
        });
        const existingArtwork = await tx.get("SELECT * FROM artworks WHERE owner_id=? AND source_type='coloring' AND template_id=?", [req.userId, template.id]);
        artworkId = existingArtwork?.id || `art_${uuid()}`;
        const storageKey = existingArtwork?.storage_key || canonicalStorageKey(req.userId, artworkId);
        const thumbnailKey = existingArtwork?.thumbnail_key || canonicalThumbnailStorageKey(req.userId, artworkId);
        renderStatus = existingArtwork?.render_status === 'ready' && existingArtwork?.content_hash === renderArtifact.contentHash ? 'ready' : 'pending';
        if (existingArtwork) {
          await tx.run(`UPDATE artworks SET image_url=?, storage_key=?, thumbnail_key=?, content_hash=?, mime_type=?, width=?, height=?, byte_size=?, render_status=?, is_completed=1, title=?, updated_at=? WHERE id=?`,
            [publicMediaUrl(storageKey), storageKey, thumbnailKey, renderArtifact.contentHash, renderArtifact.mimeType, renderArtifact.width, renderArtifact.height, renderArtifact.byteSize, renderStatus, template.title, now, artworkId]);
        } else {
          await tx.run(`INSERT INTO artworks (id,owner_id,source_type,image_url,title,template_id,collection_id,collection_title,rarity,is_completed,storage_key,thumbnail_key,content_hash,mime_type,width,height,byte_size,render_status,created_at,updated_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          [artworkId, req.userId, 'coloring', publicMediaUrl(storageKey), template.title, template.id, template.collection_id || null, template.title, template.difficulty, 1, storageKey, thumbnailKey, renderArtifact.contentHash, renderArtifact.mimeType, renderArtifact.width, renderArtifact.height, renderArtifact.byteSize, 'pending', now, now]);
          renderStatus = 'pending';
        }
      }

      if (changes.some((change) => change.color !== -1)) await touchStreak(req.userId);
      if (wasEmpty && changes.some((change) => change.color !== -1)) await unlockAchievement(req.userId, 'ach_first_pixel');
      if (justCompleted) {
        await unlockAchievement(req.userId, 'ach_first_zone');
        const finished = await all("SELECT COUNT(*) as c FROM artworks WHERE owner_id=? AND is_completed=1", [req.userId]);
        if (Number(finished[0]?.c || 0) >= 5) await unlockAchievement(req.userId, 'ach_complete_5');
        if (template.theme === 'night-city' || template.theme === 'space') {
          const nightCount = await all("SELECT COUNT(*) as c FROM artworks a JOIN coloring_templates t ON a.template_id=t.id WHERE a.owner_id=? AND a.is_completed=1 AND t.theme IN ('night-city','space')", [req.userId]);
          if (Number(nightCount[0]?.c || 0) >= 3) await unlockAchievement(req.userId, 'ach_style_night');
        }
        if (template.theme === 'forest' || template.theme === 'cozy') {
          const forestCount = await all("SELECT COUNT(*) as c FROM artworks a JOIN coloring_templates t ON a.template_id=t.id WHERE a.owner_id=? AND a.is_completed=1 AND t.theme IN ('forest','cozy')", [req.userId]);
          if (Number(forestCount[0]?.c || 0) >= 3) await unlockAchievement(req.userId, 'ach_style_forest');
        }
        if (template.theme === 'space' || template.theme === 'sea') {
          const spaceCount = await all("SELECT COUNT(*) as c FROM artworks a JOIN coloring_templates t ON a.template_id=t.id WHERE a.owner_id=? AND a.is_completed=1 AND t.theme IN ('space','sea')", [req.userId]);
          if (Number(spaceCount[0]?.c || 0) >= 3) await unlockAchievement(req.userId, 'ach_style_space');
        }
      }

      await tx.run(`INSERT INTO coloring_progress_batches (user_id,template_id,client_batch_id,changes_hash,revision_before,revision_after,response_json,created_at)
        VALUES (?,?,?,?,?,?,?,?)`,
      [req.userId, template.id, clientBatchId, batchHash, clientRevision, nextRevision, JSON.stringify({ revision: nextRevision, artwork_id: artworkId, render_status: renderStatus }), now]);

      return { conflict: false, revision: nextRevision, completed, justCompleted, wasEmpty, painted: changes.some((change) => change.color !== -1), artworkId, renderStatus, renderArtifact, renderThumbnailArtifact: justCompleted ? renderCanonicalThumbnail({ width: template.width, height: template.height, palette: template.palette, cells: template.cells, filled }) : null };
    });

  if (casResult.badBatch) return res.status(409).json({ error: 'client_batch_id уже использован для другого набора изменений' });
  if (casResult.badAction) return res.status(400).json({ error: 'Сервер отклонил цвет, не соответствующий клетке' });
  if (casResult.conflict) {
    if (casResult.badRequest) {
      return res.status(400).json({ error: 'Прогресс не найден, начните с revision 0' });
    }
    let progress = casResult.progress;
    if (!progress) {
      const serverProgress = await get('SELECT * FROM coloring_progress WHERE user_id=? AND template_id=?', [req.userId, template.id]);
      progress = serverProgress ? progressPayload(template, serverProgress) : null;
    }
    return res.status(409).json({ error: 'Прогресс уже обновлён на другом устройстве', progress });
  }

  const saved = await get('SELECT * FROM coloring_progress WHERE user_id=? AND template_id=?', [req.userId, template.id]);
  let artworkId = casResult.artworkId || null;
  if (!artworkId) {
    const existingArtwork = await get("SELECT id FROM artworks WHERE owner_id=? AND source_type='coloring' AND template_id=?", [req.userId, template.id]);
    artworkId = existingArtwork?.id || null;
  }
  const artwork = artworkId ? await get('SELECT id,storage_key,thumbnail_key,render_status FROM artworks WHERE id=?', [artworkId]) : null;
  if (artwork && artwork.render_status !== 'ready' && saved && isComplete(template, parseJsonArray(saved.filled_json) || [])) {
    const renderArtifact = casResult.renderArtifact || renderCanonicalPng({
      width: template.width,
      height: template.height,
      palette: template.palette,
      cells: template.cells,
      filled: parseJsonArray(saved.filled_json),
    });
    const thumbnailArtifact = casResult.renderThumbnailArtifact || renderCanonicalThumbnail({
      width: template.width,
      height: template.height,
      palette: template.palette,
      cells: template.cells,
      filled: parseJsonArray(saved.filled_json),
    });
    try {
      await storeMediaObject({ key: artwork.storage_key, body: renderArtifact.buffer, contentType: renderArtifact.mimeType });
      await storeMediaObject({ key: artwork.thumbnail_key || canonicalThumbnailStorageKey(req.userId, artworkId), body: thumbnailArtifact.buffer, contentType: thumbnailArtifact.mimeType });
      await run("UPDATE artworks SET render_status='ready', updated_at=? WHERE id=?", [new Date().toISOString(), artworkId]);
      casResult.renderStatus = 'ready';
    } catch {
      await run("UPDATE artworks SET render_status='failed', updated_at=? WHERE id=?", [new Date().toISOString(), artworkId]);
      return res.status(503).json({ error: 'Результат сохранён, но медиа ещё не готово к публикации', code: 'MEDIA_RETRY_REQUIRED', artwork_id: artworkId });
    }
  }

  res.json({ ...progressPayload(template, saved), artwork_id: artworkId, render_status: casResult.renderStatus || null, idempotent: Boolean(casResult.replay) });
}));

export default router;
