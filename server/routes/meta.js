// server/routes/meta.js — meta-game: streaks, achievements, collections, analytics
import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import { all, get, run, withDbTransaction } from '../db.js';
import { authMiddleware } from '../middleware/auth.js';
import { asyncRoute } from '../middleware/asyncRoute.js';
import { getDailyChallengeStatus, getUserProgression, getWeeklyChallengeStatus } from '../services/progression.js';
import { assertCollectionAccessible } from '../services/unlock-service.js';
import { buildCollectionContentMetadata, buildContentMetadata } from '../services/content-quality.js';
import { CATALOG_COLLECTION_BY_ID, CATALOG_COLLECTION_IDS } from '../services/catalog-merchandising.js';

const router = Router();
// Only events actually emitted by the client are accepted here. Keep this in
// sync with src/* metaApi.track/onTrack call sites.
const ANALYTICS_EVENTS = new Set([
  'open_level', 'first_pixel', 'zone_complete',
  'camera_activate_target', 'camera_next_cluster', 'coloring_manual_color_change',
  'coloring_stroke_commit', 'coloring_color_complete',
  'publish', 'share_native', 'share_telegram',
  'pack_preview_opened', 'pack_opened', 'pack_purchase_confirmed', 'pack_purchase_restored',
  'shelf_view', 'shelf_open', 'collection_open', 'album_open', 'coloring_open', 'coloring_start',
  'coloring_complete', 'premium_preview_open', 'premium_content_open', 'premium_cta_click',
  'store_open_from_content', 'search_used', 'search_result_open',
  'download_result', 'create_coloring', 'create_manual_coloring', 'like', 'comment',
  'app_open', 'primary_action_seen', 'primary_action_started',
  'first_success', 'goal_completed',
  'artwork_completed', 'reward_shown',
  'unlock_preview_seen', 'unlock_locked_view',
  'choice_window_seen', 'choice_selected', 'recommendation_opened',
  'session_natural_exit', 'next_session_started',
  'special_cell_claimed', 'special_targets_presented', 'special_applied', 'special_target_selected',
  'special_cell_discovered', 'powerup_received', 'powerup_used', 'special_action_selected',
  'session_continued_after_special',
  'special_help_hint_shown', 'special_help_opened',
  'core_feel_experiment_open', 'core_feel_first_handmade_action', 'core_feel_resume_action',
  'core_feel_manual_fragment_reveal', 'core_feel_next_beat_selected', 'core_feel_session_stop',
  'session_game_experiment_open', 'session_game_first_action', 'session_game_special_offered', 'session_game_special_selected',
  'session_game_special_applied', 'session_game_artifact_discovered', 'session_game_first_manual_reveal', 'session_game_stop',
]);

function todayKey(date = new Date()) {
  return date.toISOString().slice(0, 10);
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
router.post('/streak/touch', authMiddleware, (_req, res) => {
  res.status(403).json({ error: 'Серия обновляется только серверной игровой логикой', code: 'STREAK_TOUCH_FORBIDDEN' });
});

// GET /meta/progression — persistent server-derived XP and level. The client
// cannot mutate these values; they are granted from validated game actions.
router.get('/progression', authMiddleware, asyncRoute(async (req, res) => {
  const progression = await withDbTransaction((tx) => getUserProgression(tx, req.userId));
  res.json(progression);
}));

// GET /meta/daily-challenge — creates/fetches today's frozen assignment and
// returns only progress computed from persisted coloring state.
router.get('/daily-challenge', authMiddleware, asyncRoute(async (req, res) => {
  const challenge = await withDbTransaction((tx) => getDailyChallengeStatus(tx, req.userId));
  if (!challenge) return res.status(404).json({ error: 'Нет доступных раскрасок для ежедневного задания', code: 'DAILY_CHALLENGE_UNAVAILABLE' });
  res.json(challenge);
}));

// GET /meta/weekly-challenge — one UTC-week goal shared across verified painting actions.
router.get('/weekly-challenge', authMiddleware, asyncRoute(async (req, res) => {
  const challenge = await withDbTransaction((tx) => getWeeklyChallengeStatus(tx, req.userId));
  if (!challenge) return res.status(404).json({ error: 'Недельное задание пока недоступно', code: 'WEEKLY_CHALLENGE_UNAVAILABLE' });
  res.json(challenge);
}));

// GET /meta/achievements — all definitions with unlocked state for the user
router.get('/achievements', authMiddleware, asyncRoute(async (req, res) => {
  const defs = await all('SELECT * FROM achievements ORDER BY category, title');
  const unlocked = await all('SELECT achievement_id, unlocked_at FROM user_achievements WHERE user_id=?', [req.userId]);
  const map = new Map(unlocked.map((u) => [u.achievement_id, u.unlocked_at]));
  res.json(defs.map((def) => ({ ...def, unlocked: map.has(def.id), unlocked_at: map.get(def.id) || null })));
}));

// Achievements are granted only by server-side game routes after they validate a game event.
router.post('/achievements/:id/unlock', authMiddleware, (_req, res) => {
  res.status(403).json({ error: 'Достижения выдаются только серверной игровой логикой', code: 'ACHIEVEMENT_UNLOCK_FORBIDDEN' });
});

// GET /meta/collections — collection catalog with completion per user
router.get('/collections', authMiddleware, asyncRoute(async (req, res) => {
  const cols = await all(`SELECT * FROM collections
    WHERE (owner_id IS NULL AND status <> 'archived')
      OR owner_id=?
      OR (status='published' AND visibility='public')
    ORDER BY CASE WHEN catalog_scope='merchandising' THEN 0 ELSE 1 END,
      COALESCE(catalog_rank, 1000), title`, [req.userId]);
  const rows = await Promise.all(cols.map(async (col) => {
    const completed = await all("SELECT COUNT(*) as c FROM artworks a JOIN coloring_templates t ON a.template_id=t.id WHERE a.owner_id=? AND a.collection_id=? AND a.is_completed=1", [req.userId, col.id]);
    const total = await all('SELECT COUNT(*) as c FROM coloring_templates WHERE collection_id=?', [col.id]);
    // Collection cards need one bounded, authoritative summary. Do not load
    // cells here; tiled rows must remain metadata-only at this endpoint.
    const templates = await all(`SELECT width,height,difficulty,est_minutes,storage_mode
      FROM coloring_templates WHERE collection_id=? AND status='active' ORDER BY title LIMIT 48`, [col.id]);
    const catalogDefinition = CATALOG_COLLECTION_BY_ID.get(col.id);
    const accessCounts = col.catalog_scope === 'merchandising'
      ? await all(`SELECT access_type, COUNT(*) AS c FROM coloring_templates
        WHERE collection_id=? AND status='active' GROUP BY access_type`, [col.id])
      : [];
    const freeCount = Number(accessCounts.find((row) => row.access_type === 'free')?.c || 0);
    const premiumCount = Number(accessCounts.find((row) => row.access_type === 'premium')?.c || 0);
    const persistedAlbums = col.catalog_scope === 'merchandising'
      ? await all(`SELECT * FROM catalog_albums WHERE collection_id=? AND status <> 'archived' ORDER BY sort_rank ASC, title ASC`, [col.id])
      : [];
    const albumDefinitions = persistedAlbums.length ? persistedAlbums : (catalogDefinition?.albums || []);
    const albums = albumDefinitions.length
      ? await Promise.all(albumDefinitions.map(async (album) => ({
        ...album,
        title: album.title || album.album_title,
        total_count: Number((await all(`SELECT COUNT(*) AS c FROM coloring_templates WHERE collection_id=? AND album_id=? AND status='active'`, [col.id, album.id]))[0]?.c || 0),
      })))
      : [];
    const isShowcase = col.id === 'col_premium-gallery';
    const premiumGalleryTotal = isShowcase
      ? Number((await get("SELECT COUNT(*) AS c FROM coloring_templates WHERE access_type='premium' AND status='active' AND visibility='public'", []))?.c || 0)
      : null;
    const catalogCoverUrl = col.catalog_cover_url || col.image_url || catalogDefinition?.image_url || (isShowcase ? '/assets/catalog/astro-whale-pixel.png' : null);
    return {
      ...col,
      image_url: catalogCoverUrl,
      completed_count: completed[0]?.c || 0,
      total_count: isShowcase ? premiumGalleryTotal : total[0]?.c || 0,
      access: col.catalog_scope === 'merchandising'
        ? (premiumCount === 0 ? 'free' : freeCount === 0 ? 'premium' : 'mixed')
        : (col.pack_type === 'premium' ? 'premium' : 'free'),
      free_count: col.catalog_scope === 'merchandising' ? freeCount : 0,
      premium_count: col.catalog_scope === 'merchandising' ? premiumCount : premiumGalleryTotal || 0,
      is_catalog: CATALOG_COLLECTION_IDS.has(col.id),
      is_store_product: isShowcase,
      albums,
      catalog_cover_url: catalogCoverUrl,
      content_metadata: buildCollectionContentMetadata(templates),
    };
  }));
  res.json(rows);
}));

// GET /meta/collections/:id/templates — templates belonging to a collection
router.get('/collections/:id/templates', authMiddleware, asyncRoute(async (req, res) => {
  const albumId = req.query.album_id === undefined ? null : String(req.query.album_id || '').trim();
  if (albumId && (albumId.length > 120 || !/^[\x21-\x7e_-]+$/.test(albumId))) {
    return res.status(400).json({ error: 'Некорректный альбом', code: 'INVALID_ALBUM_ID' });
  }
  const collection = await get('SELECT id, owner_id, status, visibility, pack_type, price_in_stars, catalog_scope FROM collections WHERE id=?', [req.params.id]);
  const isOwner = collection?.owner_id === req.userId;
  const isPublic = collection && (collection.owner_id === null || (collection.status === 'published' && collection.visibility === 'public'));
  if (!collection || (!isOwner && !isPublic)) {
    return res.status(404).json({ error: 'Коллекция не найдена' });
  }
  // Merchandising collections can be browsed as a hierarchy even when some
  // individual entries are premium. The template start endpoint remains the
  // authoritative per-item gate.
  if (collection.catalog_scope !== 'merchandising') {
    const collectionAccess = await withDbTransaction((tx) => assertCollectionAccessible(tx, req.userId, collection, { grant: true }));
    if (collectionAccess.locked) {
      return res.status(403).json({
        error: collectionAccess.state === 'premium_locked'
          ? 'Контент доступен после покупки премиум-коллекции'
          : 'Контент ещё не открыт',
        code: collectionAccess.reason_code,
        unlock: collectionAccess,
      });
    }
  }
  const rows = await all(`SELECT * FROM coloring_templates WHERE collection_id=? AND status='active'
    ${isOwner ? '' : "AND visibility='public'"}
    ${albumId ? 'AND album_id=?' : ''}
    ORDER BY featured_rank ASC, title`, albumId ? [req.params.id, albumId] : [req.params.id]);
  res.json(rows.map(publicTemplateSummary));
}));

function publicTemplateSummary(row) {
  const template = { ...parseSafeTemplate(row) };
  const totalCells = template.cells.length;
  delete template.cells;
  delete template.original_media_key;
  delete template.palette_json;
  delete template.cells_json;
  return {
    ...template,
    content_metadata: buildContentMetadata(template),
    total_cells: totalCells,
  };
}

function parseSafeTemplate(row) {
  if (!row) return null;
  const parseArray = (value) => {
    if (Array.isArray(value)) return value;
    try {
      const parsed = JSON.parse(value || '[]');
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  };
  return {
    ...row,
    width: Number(row.width),
    height: Number(row.height),
    est_minutes: Number(row.est_minutes || 3),
    zone_count: Number(row.zone_count || 1),
    palette: parseArray(row.palette_json),
    cells: parseArray(row.cells_json),
    tags: parseArray(row.tags_json),
    season: parseArray(row.season_json),
    audience: parseArray(row.audience_json),
    tags_json: undefined,
    season_json: undefined,
    audience_json: undefined,
  };
}

// POST /meta/analytics — record a lightweight analytics event
router.post('/analytics', authMiddleware, asyncRoute(async (req, res) => {
  const { event, payload = {} } = req.body;
  const isKnownEvent = ANALYTICS_EVENTS.has(event) || /^reach_(25|50|75|100)$/.test(event);
  if (typeof event !== 'string' || !isKnownEvent) return res.status(400).json({ error: 'Некорректное событие' });
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) || Buffer.byteLength(JSON.stringify(payload)) > 4096) {
    return res.status(400).json({ error: 'Некорректный payload события' });
  }
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
