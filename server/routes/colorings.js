import { Router } from 'express';
import { createHash } from 'node:crypto';
import { v4 as uuid } from 'uuid';
import { all, get, run, withDbTransaction } from '../db.js';
import { isUniqueConstraintError } from '../database/sql.js';
import { authMiddleware } from '../middleware/auth.js';
import { asyncRoute } from '../middleware/asyncRoute.js';
import { decodeImageDataUrl, deletePrivateOriginal, publicMediaUrl, readMediaObject, storeMediaObject, storePrivateOriginal } from '../services/media-storage.js';
import { abuseLimitResponse, consumeAbuseBudget } from '../services/abuse-limiter.js';
import { renderCanonicalPng, renderCanonicalThumbnail } from '../services/canonical-renderer.js';
import { validatePublicTemplateComplexity } from '../services/template-complexity.js';
import { buildContentMetadata } from '../services/content-quality.js';
import { rewardVerifiedPainting, rewardVerifiedTiledPainting } from '../services/progression.js';
import { grantPaintingAchievements, touchDailyStreak } from '../services/progression-achievements.js';
import { assertTemplateAccessible, STATE_PREMIUM_LOCKED } from '../services/unlock-service.js';
import { buildRecommendations } from '../services/recommendations.js';
import {
  enqueueRenderJob,
  markArtworkAndJobReady,
  retryRenderJob,
} from '../services/render-outbox.js';
import {
  buildColoringManifest,
  buildColoringTile,
  getTileBounds,
  isColoringChunkContractError,
  PUBLIC_GRID_MAX_DIMENSION,
  validatePublicGridDimensions,
} from '../services/coloring-chunks.js';
import {
  applyTiledChanges,
  ensureTiledSpecialCells,
  insertTiledTemplate,
  isTiledColoringError,
  isTiledTemplate,
  persistTiledChanges,
  readTiledTile,
  tiledProgressPayload,
  tiledTilePayload,
  TILED_MAX_DIMENSION,
  validateTiledGridDimensions,
} from '../services/tiled-coloring.js';
import {
  buildGuidancePlan,
  guidanceErrorPayload,
  isTiledGuidanceError,
  parseRecentTiles,
  targetForSpecialCell,
  GUIDANCE_REASON,
} from '../services/tiled-guidance.js';
import {
  BOMB_RADIUS,
  buildArtifactProgress,
  buildSpecialDiagnostics,
  createOfferToken,
  deriveBombChanges,
  deriveLegacyBombChanges,
  deriveFuseChanges,
  deriveTiledFuseChanges,
  buildFuseOfferSteps,
  findStoredFuseChain,
  remainingFuseChangesFromChain,
  takeFuseStepChanges,
  remainingFuseStepChanges,
  deriveSparkChanges,
  deriveLegacySparkChanges,
  buildLegacySpecialTriggerEffort,
  buildLegacySparkTargetOptions,
  describeSpecialTargetEffort,
  findSpecial,
  findSpark,
  findActiveSpecialProgress,
  findStoredSparkOffer,
  generateLegacySparkCells,
  getSparkProgress,
  getSparkExperimentGroup,
  hashOfferToken,
  isSpecialDiagnosticsEnabled,
  isSpecialTargetEligible,
  isTiledSpecialError,
  markSparkConsumed,
  markSpecialConsumedDirect,
  markSpecialSkippedDirect,
  markSparkOffered,
  markSparkSkipped,
  persistSparkCells,
  SPECIAL_MAX_DERIVED_CHANGES,
  SPARK_TARGET_MAX_CELLS,
  specialError,
  specialActionMeta,
} from '../services/tiled-specials.js';
import {
  buildHazardMissPenalty,
  buildHazardOffer,
  deriveHazardDisarmChanges,
  deriveTiledHazardDisarmChanges,
  generateLegacyHazardCells,
  persistHazardCells,
} from '../services/tiled-hazard.js';

const router = Router();

const CREATE_UPLOAD_LIMIT = Number.isSafeInteger(Number(process.env.CREATE_UPLOAD_LIMIT))
  && Number(process.env.CREATE_UPLOAD_LIMIT) > 0
  ? Number(process.env.CREATE_UPLOAD_LIMIT)
  : 10;
const CREATE_UPLOAD_WINDOW_MS = Number.isSafeInteger(Number(process.env.CREATE_UPLOAD_WINDOW_MS))
  && Number(process.env.CREATE_UPLOAD_WINDOW_MS) >= 60_000
  ? Number(process.env.CREATE_UPLOAD_WINDOW_MS)
  : 10 * 60_000;
const RENDER_RETRY_LIMIT = Number.isSafeInteger(Number(process.env.RENDER_RETRY_LIMIT))
  && Number(process.env.RENDER_RETRY_LIMIT) > 0
  ? Number(process.env.RENDER_RETRY_LIMIT)
  : 3;
const RENDER_RETRY_WINDOW_MS = Number.isSafeInteger(Number(process.env.RENDER_RETRY_WINDOW_MS))
  && Number(process.env.RENDER_RETRY_WINDOW_MS) >= 60_000
  ? Number(process.env.RENDER_RETRY_WINDOW_MS)
  : 60 * 60_000;
// 10 MiB decoded image bytes are accepted by media-storage. This leaves room
// for the base64 expansion while still failing oversized source strings
// before the decoder allocates a large buffer.
const MAX_SOURCE_DATA_URL_CHARS = 14_000_000;

async function deletePrivateOriginalIfUnreferenced(mediaKey, excludedTemplateId = null) {
  if (!mediaKey) return;
  const reference = excludedTemplateId
    ? await get('SELECT id FROM coloring_templates WHERE original_media_key=? AND id<>? LIMIT 1', [mediaKey, excludedTemplateId])
    : await get('SELECT id FROM coloring_templates WHERE original_media_key=? LIMIT 1', [mediaKey]);
  if (!reference) {
    await deletePrivateOriginal(mediaKey).catch((error) => console.warn('Could not delete private original:', error.message));
  }
}

async function assertNoOtherActiveSpecialOffer(tx, { userId, templateId, specialId } = {}) {
  const active = await findActiveSpecialProgress(tx, { userId, templateId });
  if (active && String(active.special_id) !== String(specialId)) {
    throw specialError('Resolve the current special event first', 'SPECIAL_ACTIVE_OFFER', 409);
  }
}

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

function parseJsonObject(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
  return null;
}

function parseCameraCenterQuery(query = {}) {
  const rawX = query.camera_x;
  const rawY = query.camera_y;
  if (rawX === undefined || rawX === null || rawX === ''
    || rawY === undefined || rawY === null || rawY === '') {
    return null;
  }
  const x = Number(rawX);
  const y = Number(rawY);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x, y };
}

async function ensureLegacySparkCells(db, template) {
  if (isTiledTemplate(template) || !Array.isArray(template?.cells)) return [];
  const existing = await db.all(
    'SELECT special_id,kind,cell_index,tile_x,tile_y,local_index,generation_version FROM coloring_special_cells WHERE template_id=? ORDER BY cell_index',
    [template.id],
  );
  const generated = existing.length
    ? existing
    : generateLegacySparkCells({
      templateId: template.id,
      width: template.width,
      height: template.height,
      cells: template.cells,
    });
  if (!existing.length) {
    await persistSparkCells(db, { templateId: template.id, cells: generated });
  }
  if (!generated.some((cell) => cell.kind === 'hazard')) {
    const hazard = generateLegacyHazardCells({
      templateId: template.id,
      width: template.width,
      height: template.height,
      cells: template.cells,
      occupiedIndices: generated.map((cell) => cell.cell_index),
    });
    await persistHazardCells(db, { templateId: template.id, cells: hazard });
    if (hazard.length) generated.push(...hazard);
  }
  return generated;
}

async function readLegacySparkPayload(db, { template, userId, progress } = {}) {
  const experimentGroup = getSparkExperimentGroup(userId, template.id);
  if (experimentGroup !== 'treatment') {
    return { specials: [], specials_experiment_group: experimentGroup };
  }
  const generated = await ensureLegacySparkCells(db, template);
  const rows = await db.all(`
    SELECT c.special_id, c.kind, c.cell_index, c.local_index,
           COALESCE(p.status, 'unseen') AS status
      FROM coloring_special_cells c
      LEFT JOIN coloring_special_progress p
        ON p.template_id=c.template_id AND p.special_id=c.special_id AND p.user_id=?
     WHERE c.template_id=?
     ORDER BY c.cell_index`,
  [userId, template.id]);
  const filled = parseJsonArray(progress?.filled_json) || progress?.filled || [];
  return {
    specials: rows.map((row) => ({
      id: String(row.special_id),
      kind: String(row.kind),
      cell_index: Number(row.cell_index),
      local_index: Number(row.local_index),
      state: String(row.status || 'unseen'),
      filled: filled[Number(row.cell_index)] ?? -1,
    })),
    specials_experiment_group: experimentGroup,
    special_generation_version: Number(generated[0]?.generation_version || 0),
  };
}

function withSparkCohort(payload, userId, template) {
  return {
    ...payload,
    specials_experiment_group: getSparkExperimentGroup(userId, template.id),
  };
}

function parseTemplate(row) {
  if (!row) return null;
  const access = row.collection_pack_type === 'premium' ? 'premium' : 'free';
  const storageMode = row.storage_mode || 'legacy';
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
    completion_count: Number(row.completion_count || 0),
    is_favorite: Boolean(Number(row.is_favorite || 0)),
    access,
    purchasing_available: false,
    collection_pack_type: row.collection_pack_type || 'free',
    collection_price_in_stars: Number(row.collection_price_in_stars || 0),
    palette: parseJsonArray(row.palette_json),
    // Tiled templates intentionally keep only an empty sentinel in the
    // legacy column; never parse or expose a 1200×1200 row-major map here.
    cells: storageMode === 'tiled' ? [] : parseJsonArray(row.cells_json),
    storage_mode: storageMode,
    tile_size: Number(row.tile_size || 32),
    palette_json: undefined,
    cells_json: undefined,
    original_media_key: undefined,
  };
}

function canRead(template, userId) {
  return template.visibility === 'public' || template.owner_id === userId;
}

function sendUnlockLocked(res, state) {
  return res.status(403).json({
    error: state.state === STATE_PREMIUM_LOCKED
      ? 'Контент доступен после покупки премиум-коллекции'
      : 'Контент ещё не открыт',
    code: state.reason_code,
    unlock: state,
  });
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

async function attachFavorites(rows, userId) {
  if (!rows.length) return rows;
  const placeholders = rows.map(() => '?').join(',');
  const ids = rows.map((row) => row.id);
  const favorites = await all(`SELECT template_id FROM user_favorite_templates
    WHERE user_id=? AND template_id IN (${placeholders})`, [userId, ...ids]);
  const favoriteIds = new Set(favorites.map((item) => item.template_id));
  return rows.map((row) => ({ ...row, is_favorite: favoriteIds.has(row.id) ? 1 : 0 }));
}

async function attachCatalogPopularity(rows) {
  if (!rows.length) return rows;
  const placeholders = rows.map(() => '?').join(',');
  const ids = rows.map((row) => row.id);
  const completed = await all(`SELECT template_id, COUNT(*) AS completion_count
    FROM artworks
    WHERE is_completed=1 AND template_id IN (${placeholders})
    GROUP BY template_id`, ids);
  const byId = new Map(completed.map((row) => [row.template_id, Number(row.completion_count || 0)]));
  return rows.map((row) => ({ ...row, completion_count: byId.get(row.id) || 0 }));
}

async function attachViewerCatalogData(rows, userId, { popularity = false } = {}) {
  let result = await attachRatings(rows, userId);
  result = await attachFavorites(result, userId);
  return popularity ? attachCatalogPopularity(result) : result;
}

function catalogSummary(row) {
  const parsed = parseTemplate(row);
  const { cells, ...template } = parsed;
  return {
    ...template,
    // Keep this metadata bounded and advisory: no full raster is exposed to
    // catalog callers, and an unassessed style never silently opts into the
    // paintable creator pipeline.
    content_metadata: buildContentMetadata(parsed),
    total_cells: parsed.storage_mode === 'tiled'
      ? parsed.width * parsed.height
      : cells?.length || 0,
  };
}

function parseNonNegativeInteger(value, { fallback, max }) {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) return null;
  return Math.min(parsed, max);
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

function progressPayload(template, row, artworkId = null) {
  if (isTiledTemplate(template)) return tiledProgressPayload(template, row, artworkId);
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
    updated_at: compatible ? (row?.updated_at ?? null) : null,
    artwork_id: artworkId,
  };
}

function sendChunkContractError(res, error) {
  if (!isColoringChunkContractError(error) && !isTiledColoringError(error)) return false;
  return res.status(error.status).json({ error: error.message, code: error.code });
}

async function loadChunkTemplate(templateId, userId) {
  // Validate dimensions before parsing cells. A future or corrupted row with
  // a large array must not be expanded just to be rejected by this API.
  const row = await get("SELECT * FROM coloring_templates WHERE id=? AND status='active'", [templateId]);
  if (!row) return { notFound: true };
  if (row.visibility !== 'public' && row.owner_id !== userId) return { notFound: true };
  try {
    if (row.storage_mode === 'tiled') {
      validateTiledGridDimensions(row.width, row.height, row.tile_size);
    } else {
      validatePublicGridDimensions(row.width, row.height);
    }
  } catch (error) {
    return { error };
  }
  const template = parseTemplate(row);
  if (!canRead(template, userId)) return { notFound: true };
  const access = await withDbTransaction((tx) => assertTemplateAccessible(tx, userId, template, { grant: true }));
  if (access.locked) return { locked: access };
  return { template };
}

// GET /colorings — editorial catalog with filters
router.get('/', authMiddleware, asyncRoute(async (req, res) => {
  const { mood, theme, max_minutes, featured } = req.query;
  const sort = req.query.sort === undefined ? 'new' : req.query.sort;
  const access = req.query.access ?? req.query.pack_type;
  const rawQuery = req.query.q === undefined ? '' : req.query.q;
  const limit = parseNonNegativeInteger(req.query.limit, { fallback: 100, max: 100 });
  const offset = parseNonNegativeInteger(req.query.offset, { fallback: 0, max: 10_000 });

  if (!['new', 'popular', 'rating'].includes(sort)) {
    return res.status(400).json({ error: 'Некорректная сортировка каталога', code: 'INVALID_CATALOG_SORT' });
  }
  if (access !== undefined && !['free', 'premium'].includes(access)) {
    return res.status(400).json({ error: 'Некорректный тип доступа', code: 'INVALID_CATALOG_ACCESS' });
  }
  if (limit === null || offset === null || limit < 1) {
    return res.status(400).json({ error: 'Некорректная пагинация каталога', code: 'INVALID_CATALOG_PAGE' });
  }
  if (typeof rawQuery !== 'string' || rawQuery.trim().length > 100) {
    return res.status(400).json({ error: 'Поисковый запрос слишком длинный', code: 'INVALID_CATALOG_QUERY' });
  }
  if (max_minutes !== undefined && (!/^\d+$/.test(String(max_minutes)) || Number(max_minutes) < 1 || Number(max_minutes) > 1_440)) {
    return res.status(400).json({ error: 'Некорректная длительность', code: 'INVALID_CATALOG_DURATION' });
  }

  const clauses = ["t.status='active'", "t.visibility='public'", "t.source_type <> 'unlockable'"];
  const params = [];
  if (typeof mood === 'string' && mood) { clauses.push('t.mood=?'); params.push(mood.slice(0, 80)); }
  if (typeof theme === 'string' && theme) { clauses.push('t.theme=?'); params.push(theme.slice(0, 80)); }
  if (max_minutes !== undefined) { clauses.push('t.est_minutes<=?'); params.push(Number(max_minutes)); }
  if (featured === '1') { clauses.push('t.daily_featured=1'); }
  if (access) { clauses.push("COALESCE(c.pack_type,'free')=?"); params.push(access); }
  const where = clauses.join(' AND ');
  const rows = await all(`SELECT t.*,
      c.pack_type AS collection_pack_type,
      c.price_in_stars AS collection_price_in_stars,
      owner.nickname AS owner_nickname
    FROM coloring_templates t
    LEFT JOIN collections c ON c.id=t.collection_id
    LEFT JOIN users owner ON owner.id=t.owner_id
    WHERE ${where}
    ORDER BY t.daily_featured DESC, t.added_at DESC, t.created_at DESC, t.title ASC
    LIMIT ?`, [...params, 500]);
  // JavaScript case-folding keeps Cyrillic search usable in SQLite builds
  // without ICU, while the database query stays fully parameterized.
  const normalizedQuery = rawQuery.trim().toLocaleLowerCase();
  const matchedRows = normalizedQuery
    ? rows.filter((row) => [row.title, row.description, row.owner_nickname]
      .some((value) => String(value || '').toLocaleLowerCase().includes(normalizedQuery)))
    : rows;
  const decorated = await attachViewerCatalogData(matchedRows, req.userId, { popularity: sort === 'popular' });
  const sorted = [...decorated].sort((a, b) => {
    if (sort === 'rating') {
      return Number(b.rating_average) - Number(a.rating_average)
        || Number(b.rating_count) - Number(a.rating_count)
        || String(b.added_at || b.created_at || '').localeCompare(String(a.added_at || a.created_at || ''));
    }
    if (sort === 'popular') {
      return Number(b.completion_count) - Number(a.completion_count)
        || Number(b.rating_count) - Number(a.rating_count)
        || Number(b.rating_average) - Number(a.rating_average)
        || String(b.added_at || b.created_at || '').localeCompare(String(a.added_at || a.created_at || ''));
    }
    return String(b.added_at || b.created_at || '').localeCompare(String(a.added_at || a.created_at || ''))
      || String(a.title).localeCompare(String(b.title));
  });

  res.json(sorted.slice(offset, offset + limit).map(catalogSummary));
}));

// GET /colorings/today — editorial "for you today" + quick picks
router.get('/today', authMiddleware, asyncRoute(async (req, res) => {
  const featured = await get("SELECT * FROM coloring_templates WHERE status='active' AND visibility='public' AND source_type <> 'unlockable' AND daily_featured=1 ORDER BY added_at DESC LIMIT 1");
  const quick = await all("SELECT * FROM coloring_templates WHERE status='active' AND visibility='public' AND source_type <> 'unlockable' AND est_minutes<=3 ORDER BY added_at DESC LIMIT 6");
  const allTemplates = await all("SELECT * FROM coloring_templates WHERE status='active' AND visibility='public' AND source_type <> 'unlockable' ORDER BY added_at DESC");
  const ratedRows = await attachViewerCatalogData(
    [...new Map([featured, ...quick, ...allTemplates].filter(Boolean).map((row) => [row.id, row])).values()],
    req.userId,
  );
  const ratedById = new Map(ratedRows.map((row) => [row.id, row]));
  const summarize = (row) => {
    if (!row) return null;
    return catalogSummary(ratedById.get(row.id) || row);
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

// GET /colorings/:id/manifest — bounded metadata for progressive tile loading.
// The legacy cells_json/filled_json arrays are intentionally absent here.
router.get('/:id/manifest', authMiddleware, asyncRoute(async (req, res) => {
  const loaded = await loadChunkTemplate(req.params.id, req.userId);
  if (loaded.notFound) return res.status(404).json({ error: 'Раскраска не найдена' });
  if (loaded.locked) return sendUnlockLocked(res, loaded.locked);
  if (loaded.error) return sendChunkContractError(res, loaded.error);

  const progress = await get(
    isTiledTemplate(loaded.template)
      ? 'SELECT * FROM coloring_tiled_progress WHERE user_id=? AND template_id=?'
      : 'SELECT * FROM coloring_progress WHERE user_id=? AND template_id=?',
    [req.userId, loaded.template.id],
  );
  return res.json(buildColoringManifest({
    template: loaded.template,
    progress: progressPayload(loaded.template, progress),
  }));
}));

async function getColoringTile(req, res) {
  const loaded = await loadChunkTemplate(req.params.id, req.userId);
  if (loaded.notFound) return res.status(404).json({ error: 'Раскраска не найдена' });
  if (loaded.locked) return sendUnlockLocked(res, loaded.locked);
  if (loaded.error) return sendChunkContractError(res, loaded.error);

  if (isTiledTemplate(loaded.template)) {
    await withDbTransaction((tx) => ensureTiledSpecialCells(tx, loaded.template));
    const progressRow = await get('SELECT * FROM coloring_tiled_progress WHERE user_id=? AND template_id=?', [req.userId, loaded.template.id]);
    const progress = tiledProgressPayload(loaded.template, progressRow);
    const tile = await readTiledTile({ get, all, run }, {
      template: loaded.template,
      userId: req.userId,
      tileX: req.params.tileX,
      tileY: req.params.tileY,
      progress,
    });
    // Control users never receive special positions; the legacy payload
    // already applies the same boundary.
    if (getSparkExperimentGroup(req.userId, loaded.template.id) !== 'treatment') {
      tile.specials = [];
    }
    return res.json(tiledTilePayload({ template: loaded.template, tile, progress }));
  }

  let bounds;
  try {
    bounds = getTileBounds({
      width: loaded.template.width,
      height: loaded.template.height,
      tileX: req.params.tileX,
      tileY: req.params.tileY,
    });
  } catch (error) {
    if (sendChunkContractError(res, error)) return;
    throw error;
  }

  const progressRow = await get('SELECT * FROM coloring_progress WHERE user_id=? AND template_id=?', [req.userId, loaded.template.id]);
  const progress = progressPayload(loaded.template, progressRow);
  try {
    return res.json(buildColoringTile({
      template: loaded.template,
      filled: progressRow ? parseJsonArray(progressRow.filled_json) : null,
      progress,
      tileX: bounds.tile_x,
      tileY: bounds.tile_y,
    }));
  } catch (error) {
    if (sendChunkContractError(res, error)) return;
    throw error;
  }
}

// The /chunks alias keeps the contract explicit for clients that use chunks
// as their domain term; both routes are read-only projections of legacy data.
router.get('/:id/tiles/:tileX/:tileY', authMiddleware, asyncRoute(getColoringTile));
router.get('/:id/chunks/:tileX/:tileY', authMiddleware, asyncRoute(getColoringTile));

// GET /colorings/:id/guidance — bounded server-assisted navigation for the
// tiled player. The response never contains full-grid arrays: it carries
// global per-color counts plus one compact actionable window.
router.get('/:id/guidance', authMiddleware, asyncRoute(async (req, res) => {
  const template = parseTemplate(await get('SELECT * FROM coloring_templates WHERE id=? AND status=\'active\'', [req.params.id]));
  if (!template || !canRead(template, req.userId)) return res.status(404).json({ error: 'Раскраска не найдена' });
  const guidanceAccess = await withDbTransaction((tx) => assertTemplateAccessible(tx, req.userId, template, { grant: true }));
  if (guidanceAccess.locked) return sendUnlockLocked(res, guidanceAccess);
  if (!isTiledTemplate(template)) {
    return res.status(400).json({ error: 'Guidance доступен только для tiled-раскрасок', code: 'NOT_TILED' });
  }
  try {
    const reason = String(req.query.reason || GUIDANCE_REASON.INITIAL_TARGET).toUpperCase();
    const supported = new Set(Object.values(GUIDANCE_REASON));
    // The whole plan build runs in one transaction: reads stay consistent,
    // and the one-time per-template static index build (pre-021 templates)
    // is batched instead of issuing thousands of individual persisted writes
    // that would stall the sqlite scheduler for tens of seconds.
    const plan = await withDbTransaction((tx) => buildGuidancePlan({
      db: tx,
      userId: req.userId,
      template,
      selectedColor: req.query.selected_color === undefined || req.query.selected_color === ''
        ? null
        : Number(req.query.selected_color),
      targetColor: req.query.target_color === undefined || req.query.target_color === ''
        ? null
        : Number(req.query.target_color),
      reason: supported.has(reason) ? reason : GUIDANCE_REASON.INITIAL_TARGET,
      cameraCenter: parseCameraCenterQuery(req.query),
      recentKeys: parseRecentTiles(req.query.recent),
      preferredTileKey: req.query.tile_x !== undefined && req.query.tile_y !== undefined
        ? `${Number(req.query.tile_x)}:${Number(req.query.tile_y)}`
        : null,
      specialId: req.query.special_id ? String(req.query.special_id) : null,
      sparkTreatment: getSparkExperimentGroup(req.userId, template.id) === 'treatment',
      sessionGame: req.query.session_game === '1' || req.query.session_game === 'true',
    }));
    return res.json(plan);
  } catch (error) {
    if (isTiledGuidanceError(error)) return res.status(error.status || 400).json(guidanceErrorPayload(error));
    throw error;
  }
}));

// GET /colorings/:id/zones — fragmented session chunks with per-zone progress
router.get('/:id/zones', authMiddleware, asyncRoute(async (req, res) => {
  const template = parseTemplate(await get("SELECT * FROM coloring_templates WHERE id=? AND status='active'", [req.params.id]));
  if (!template || !canRead(template, req.userId)) return res.status(404).json({ error: 'Раскраска не найдена' });
  const zoneAccess = await withDbTransaction((tx) => assertTemplateAccessible(tx, req.userId, template, { grant: true }));
  if (zoneAccess.locked) return sendUnlockLocked(res, zoneAccess);
  if (isTiledTemplate(template)) return res.json({ zones: [] });
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
  // Originals are content-addressed and may be shared by duplicate uploads;
  // only remove the object after the last referencing template is gone.
  await deletePrivateOriginalIfUnreferenced(template.original_media_key, template.id);
  res.json({ success: true });
}));

// POST /colorings/create - a private template built in the browser from a user image
router.post('/create', authMiddleware, asyncRoute(async (req, res) => {
  const { title, description = '', width, height, palette, cells, tiles = null, tileSize = 32, storageMode = null, previewDataUrl = null, originalDataUrl = null } = req.body || {};
  const safeTitle = String(title || '').trim().slice(0, 80);
  const safeWidth = Number(width);
  const safeHeight = Number(height);
  const tiledRequested = safeWidth > PUBLIC_GRID_MAX_DIMENSION || safeHeight > PUBLIC_GRID_MAX_DIMENSION || storageMode === 'tiled';
  if (!safeTitle || !Number.isInteger(safeWidth) || !Number.isInteger(safeHeight) || safeWidth < 8 || safeHeight < 8 || safeWidth > TILED_MAX_DIMENSION || safeHeight > TILED_MAX_DIMENSION) {
    return res.status(400).json({ error: 'Выберите название и размер от 8×8 до 1200×1200' });
  }
  if (!Array.isArray(palette) || palette.length < 2 || palette.length > 32 || palette.some((color) => !/^#[0-9a-f]{6}$/i.test(color))) {
    return res.status(400).json({ error: 'Палитра должна содержать от 2 до 32 HEX-цветов' });
  }
  if (!tiledRequested && (!Array.isArray(cells) || cells.length !== safeWidth * safeHeight || cells.some((color) => !Number.isInteger(color) || color < 0 || color >= palette.length))) {
    return res.status(400).json({ error: 'Карта клеток не соответствует раскраске' });
  }
  if (previewDataUrl !== null && (typeof previewDataUrl !== 'string' || previewDataUrl.length > 300_000 || !/^data:image\/png;base64,/i.test(previewDataUrl) || !decodeImageDataUrl(previewDataUrl))) {
    return res.status(400).json({ error: 'Некорректная миниатюра раскраски' });
  }
  if (originalDataUrl !== null && (typeof originalDataUrl !== 'string' || originalDataUrl.length > MAX_SOURCE_DATA_URL_CHARS)) {
    return res.status(413).json({ error: 'Исходное изображение слишком большое', code: 'SOURCE_IMAGE_TOO_LARGE' });
  }
  const sourceImage = originalDataUrl === null ? null : decodeImageDataUrl(originalDataUrl);
  if (originalDataUrl !== null && !sourceImage) {
    return res.status(400).json({ error: 'Некорректное исходное изображение', code: 'INVALID_SOURCE_IMAGE' });
  }

  // Creation performs browser conversion and persists a private original, so
  // it needs a durable per-user budget in addition to the global IP limiter.
  // Consume after shape validation so malformed probes do not exhaust it.
  try {
    await withDbTransaction((tx) => consumeAbuseBudget(tx, {
      scope: 'colorings:create',
      actorKey: req.userId,
      limit: CREATE_UPLOAD_LIMIT,
      windowMs: CREATE_UPLOAD_WINDOW_MS,
    }));
  } catch (error) {
    if (abuseLimitResponse(res, error)) return;
    throw error;
  }

  const now = new Date().toISOString();
  const id = `color_${uuid()}`;
  let originalMediaKey = null;
  try {
    originalMediaKey = await storePrivateOriginal(originalDataUrl, req.userId, sourceImage);
    if (tiledRequested) {
      await withDbTransaction(async (tx) => {
        await insertTiledTemplate(tx, {
          id,
          ownerId: req.userId,
          title: safeTitle,
          description: String(description).slice(0, 280),
          width: safeWidth,
          height: safeHeight,
          palette,
          previewUrl: previewDataUrl,
          originalMediaKey,
          createdAt: now,
          updatedAt: now,
          tileSize,
          tiles,
        });
        // The shared tiled insert now generates production hazard rows. The
        // fixture-only flag is not needed for tiled templates.
      });
      return res.status(201).json({ ...parseTemplate(await get('SELECT * FROM coloring_templates WHERE id=?', [id])), source_stored: Boolean(originalMediaKey) });
    }
    await withDbTransaction(async (tx) => {
      await tx.run(`INSERT INTO coloring_templates (id,owner_id,title,description,category,difficulty,width,height,palette_json,cells_json,preview_url,original_media_key,source_type,visibility,status,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [id, req.userId, safeTitle, String(description).slice(0, 280), 'custom', 'custom', safeWidth, safeHeight, JSON.stringify(palette), JSON.stringify(cells), null, originalMediaKey, 'user', 'private', 'active', now, now]);
      const legacy = generateLegacySparkCells({ templateId: id, width: safeWidth, height: safeHeight, cells });
      await persistSparkCells(tx, {
        templateId: id,
        cells: legacy,
      });
      await persistHazardCells(tx, {
        templateId: id,
        cells: generateLegacyHazardCells({
          templateId: id,
          width: safeWidth,
          height: safeHeight,
          cells,
          occupiedIndices: legacy.map((cell) => cell.cell_index),
        }),
      });
    });
    return res.status(201).json({ ...parseTemplate(await get('SELECT * FROM coloring_templates WHERE id=?', [id])), source_stored: Boolean(originalMediaKey) });
  } catch (error) {
    // If validation or persistence fails after storage, remove only an
    // unreferenced object; duplicate uploads may already share this key.
    await deletePrivateOriginalIfUnreferenced(originalMediaKey, id);
    if (tiledRequested && sendChunkContractError(res, error)) return;
    throw error;
  }
}));

// GET /colorings/mine - private and catalog templates with the caller's progress
router.get('/mine', authMiddleware, asyncRoute(async (req, res) => {
  const templateRows = await attachViewerCatalogData(await all(`
    SELECT DISTINCT t.* FROM coloring_templates t
    LEFT JOIN coloring_progress p ON p.template_id=t.id AND p.user_id=?
    LEFT JOIN coloring_tiled_progress tp ON tp.template_id=t.id AND tp.user_id=?
    WHERE t.status='active' AND (t.owner_id=? OR p.user_id IS NOT NULL OR tp.user_id IS NOT NULL)
    ORDER BY t.updated_at DESC
  `, [req.userId, req.userId, req.userId]), req.userId);
  const templates = templateRows.map(parseTemplate);
  const rows = await Promise.all(templates.map(async (template) => {
    const progress = await get(
      isTiledTemplate(template)
        ? 'SELECT * FROM coloring_tiled_progress WHERE user_id=? AND template_id=?'
      : 'SELECT * FROM coloring_progress WHERE user_id=? AND template_id=?',
      [req.userId, template.id],
    );
    const artwork = await get("SELECT id FROM artworks WHERE owner_id=? AND source_type='coloring' AND template_id=?", [req.userId, template.id]);
    return {
      ...template,
      content_metadata: buildContentMetadata(template),
      progress: progressPayload(template, progress, artwork?.id || null),
    };
  }));
  res.json(rows);
}));

// GET /colorings/favorites — templates saved by the current user. Private
// templates remain visible only to their owner through the normal read rule.
router.get('/favorites', authMiddleware, asyncRoute(async (req, res) => {
  const rows = await all(`SELECT t.*, f.created_at AS favorited_at
    FROM user_favorite_templates f
    JOIN coloring_templates t ON t.id=f.template_id
    WHERE f.user_id=? AND t.status='active'
      AND (t.visibility='public' OR t.owner_id=?)
    ORDER BY f.created_at DESC`, [req.userId, req.userId]);
  const decorated = await attachViewerCatalogData(rows, req.userId);
  res.json(decorated.map(catalogSummary));
}));

// GET /colorings/history — a bounded, server-recorded list of opened levels.
router.get('/history', authMiddleware, asyncRoute(async (req, res) => {
  const limit = parseNonNegativeInteger(req.query.limit, { fallback: 20, max: 50 });
  if (limit === null || limit < 1) {
    return res.status(400).json({ error: 'Некорректный размер истории', code: 'INVALID_HISTORY_LIMIT' });
  }
  const rows = await all(`SELECT t.*, h.opened_at
    FROM user_template_history h
    JOIN coloring_templates t ON t.id=h.template_id
    WHERE h.user_id=? AND t.status='active'
      AND (t.visibility='public' OR t.owner_id=?)
    ORDER BY h.opened_at DESC
    LIMIT ?`, [req.userId, req.userId, limit]);
  const decorated = await attachViewerCatalogData(rows, req.userId);
  res.json(decorated.map(catalogSummary));
}));

// PUT /colorings/:id/favorite — idempotently save an accessible template.
// GET /colorings/recommendations — bounded personalized recommendations built
// from verified server history and unlock/ownership state.
router.get('/recommendations', authMiddleware, asyncRoute(async (req, res) => {
  const limit = parseNonNegativeInteger(req.query.limit, { fallback: 8, max: 20 });
  if (limit === null || limit < 1) {
    return res.status(400).json({ error: 'Некорректный размер рекомендаций', code: 'INVALID_RECOMMENDATION_LIMIT' });
  }
  const result = await withDbTransaction((tx) => buildRecommendations(tx, req.userId, { limit }));
  res.json(result);
}));

router.put('/:id/favorite', authMiddleware, asyncRoute(async (req, res) => {
  const template = parseTemplate(await get("SELECT * FROM coloring_templates WHERE id=? AND status='active'", [req.params.id]));
  if (!template || !canRead(template, req.userId)) {
    return res.status(404).json({ error: 'Раскраска не найдена' });
  }
  const favoriteAccess = await withDbTransaction((tx) => assertTemplateAccessible(tx, req.userId, template, { grant: true }));
  if (favoriteAccess.locked) return sendUnlockLocked(res, favoriteAccess);
  await run(`INSERT INTO user_favorite_templates (user_id,template_id,created_at)
    VALUES (?,?,?) ON CONFLICT (user_id,template_id) DO NOTHING`,
  [req.userId, template.id, new Date().toISOString()]);
  res.json({ template_id: template.id, is_favorite: true });
}));

router.delete('/:id/favorite', authMiddleware, asyncRoute(async (req, res) => {
  const result = await run('DELETE FROM user_favorite_templates WHERE user_id=? AND template_id=?', [req.userId, req.params.id]);
  res.json({ template_id: req.params.id, is_favorite: false, removed: Boolean(result.changes) });
}));

// GET /colorings/:id
router.get('/:id', authMiddleware, asyncRoute(async (req, res) => {
  const row = await get('SELECT * FROM coloring_templates WHERE id=? AND status=\'active\'', [req.params.id]);
  const template = parseTemplate((await attachViewerCatalogData(row ? [row] : [], req.userId))[0]);
  if (!template || !canRead(template, req.userId)) return res.status(404).json({ error: 'Раскраска не найдена' });
  const detailAccess = await withDbTransaction((tx) => assertTemplateAccessible(tx, req.userId, template, { grant: true }));
  if (detailAccess.locked) return sendUnlockLocked(res, detailAccess);
  await run(`INSERT INTO user_template_history (user_id,template_id,opened_at)
    VALUES (?,?,?) ON CONFLICT (user_id,template_id) DO UPDATE SET opened_at=excluded.opened_at`,
  [req.userId, template.id, new Date().toISOString()]);
  res.json({
    ...template,
    content_metadata: buildContentMetadata(template),
    unlock_state: detailAccess.state,
    unlock_reason_code: detailAccess.reason_code,
    unlock_granted: detailAccess.granted || false,
  });
}));

// GET /colorings/:id/progress
router.get('/:id/progress', authMiddleware, asyncRoute(async (req, res) => {
  const template = parseTemplate(await get('SELECT * FROM coloring_templates WHERE id=? AND status=\'active\'', [req.params.id]));
  if (!template || !canRead(template, req.userId)) return res.status(404).json({ error: 'Раскраска не найдена' });
  const progressAccess = await withDbTransaction((tx) => assertTemplateAccessible(tx, req.userId, template, { grant: true }));
  if (progressAccess.locked) return sendUnlockLocked(res, progressAccess);
  const progress = await get(
    isTiledTemplate(template)
      ? 'SELECT * FROM coloring_tiled_progress WHERE user_id=? AND template_id=?'
      : 'SELECT * FROM coloring_progress WHERE user_id=? AND template_id=?',
    [req.userId, template.id],
  );
  let artwork = await get("SELECT id,thumbnail_key,render_status FROM artworks WHERE owner_id=? AND source_type='coloring' AND template_id=?", [req.userId, template.id]);
  if (isTiledTemplate(template) && progress?.completed_at && !artwork?.id) {
    const now = new Date().toISOString();
    await withDbTransaction(async (tx) => {
      const metadata = await createTiledArtworkMetadata(tx, {
        userId: req.userId,
        template,
        now,
      });
      if (metadata.renderStatus !== 'ready') {
        await enqueueRenderJob(tx, {
          artworkId: metadata.artworkId,
          userId: req.userId,
          templateId: template.id,
          renderMode: 'tiled',
          now,
        });
      }
    });
    artwork = await get("SELECT id,thumbnail_key,render_status FROM artworks WHERE owner_id=? AND source_type='coloring' AND template_id=?", [req.userId, template.id]);
  }
  const completionReward = progress?.completed_at
    ? await get('SELECT xp_amount FROM user_xp_events WHERE user_id=? AND dedupe_key=?', [req.userId, `template-complete:${template.id}`])
    : null;
  const previewDataUrl = isTiledTemplate(template) && progress?.completed_at && artwork?.render_status === 'ready'
    ? await loadTiledPreviewDataUrl(artwork)
    : null;
  let generationInfo = null;
  if (isTiledTemplate(template)) {
    generationInfo = await withDbTransaction((tx) => ensureTiledSpecialCells(tx, template));
  }
  let payload = {
    ...withSparkCohort(progressPayload(template, progress, artwork?.id || null), req.userId, template),
    completion_reward_xp: Number(completionReward?.xp_amount || 0),
    render_status: artwork?.render_status || null,
    result_preview_data_url: previewDataUrl,
  };
  if (!isTiledTemplate(template)) {
    Object.assign(payload, await withDbTransaction((tx) => readLegacySparkPayload(
      tx,
      { template, userId: req.userId, progress },
    )));
  }
  if (isSpecialDiagnosticsEnabled()) {
    payload.special_diagnostics = await buildSpecialDiagnostics({ get, all }, {
      userId: req.userId,
      template,
      progress,
      generationInfo,
    });
  }
  payload.special_offer = await findStoredSparkOffer({ get, all }, {
    userId: req.userId,
    templateId: template.id,
  });
  payload.artifact_progress = await buildArtifactProgress({ get, all }, {
    userId: req.userId,
    templateId: template.id,
  });
  res.json(payload);
}));

// Full canonical results stay private until the owner publishes the artwork.
// The public /media route deliberately remains publication-gated.
router.get('/:id/result', authMiddleware, asyncRoute(async (req, res) => {
  const template = parseTemplate(await get("SELECT * FROM coloring_templates WHERE id=? AND status='active'", [req.params.id]));
  if (!template || template.owner_id !== req.userId) return res.status(404).json({ error: 'Р РµР·СѓР»СЊС‚Р°С‚ РЅРµ РЅР°Р№РґРµРЅ' });
  const resultAccess = await withDbTransaction((tx) => assertTemplateAccessible(tx, req.userId, template, { grant: true }));
  if (resultAccess.locked) return sendUnlockLocked(res, resultAccess);
  const artwork = await get(`SELECT storage_key,mime_type,render_status,is_completed
    FROM artworks WHERE owner_id=? AND source_type='coloring' AND template_id=? AND is_completed=1`, [req.userId, template.id]);
  if (!artwork || artwork.render_status !== 'ready') return res.status(409).json({ error: 'Р РµР·СѓР»СЊС‚Р°С‚ РµС‰С‘ РѕР±СЂР°Р±Р°С‚С‹РІР°РµС‚СЃСЏ', code: 'ARTWORK_NOT_READY' });
  let body;
  try {
    body = await readMediaObject(artwork.storage_key);
  } catch {
    return res.status(404).json({ error: 'Р¤Р°Р№Р» СЂРµР·СѓР»СЊС‚Р°С‚Р° РЅРµ РЅР°Р№РґРµРЅ', code: 'ARTWORK_MEDIA_MISSING' });
  }
  if (!body) return res.status(404).json({ error: 'Р¤Р°Р№Р» СЂРµР·СѓР»СЊС‚Р°С‚Р° РЅРµ РЅР°Р№РґРµРЅ', code: 'ARTWORK_MEDIA_MISSING' });
  res.set({
    'Content-Type': artwork.mime_type || 'image/png',
    'Content-Length': String(body.length),
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  return res.send(body);
}));

// POST /colorings/:id/render/retry - manually requeue a permanently failed render.
router.post('/:id/render/retry', authMiddleware, asyncRoute(async (req, res) => {
  // A dead render can be manually requeued, but each reset reopens the full
  // bounded render-attempt budget. Keep this recovery path durable and
  // user-scoped so it cannot become a storage amplification loop.
  try {
    await withDbTransaction((tx) => consumeAbuseBudget(tx, {
      scope: 'colorings:render-retry',
      actorKey: req.userId,
      limit: RENDER_RETRY_LIMIT,
      windowMs: RENDER_RETRY_WINDOW_MS,
    }));
  } catch (error) {
    if (abuseLimitResponse(res, error)) return;
    throw error;
  }
  const artwork = await get("SELECT id,render_status FROM artworks WHERE owner_id=? AND source_type='coloring' AND template_id=?", [req.userId, req.params.id]);
  if (!artwork) return res.status(404).json({ error: 'Artwork not found' });
  const reset = await retryRenderJob({ withTransaction: withDbTransaction }, { artworkId: artwork.id, now: new Date() });
  if (!reset) return res.status(409).json({ error: 'Render job is not dead', code: 'RENDER_JOB_NOT_DEAD' });
  return res.json({ artwork_id: artwork.id, render_status: 'pending', outbox_status: 'pending' });
}));

// PUT was intentionally retired: a client must never replace the whole progress map.
router.put('/:id/progress', authMiddleware, (_req, res) => {
  res.status(405).json({ error: 'Используйте действия раскраски, а не полную карту прогресса' });
});

async function createTiledArtworkMetadata(tx, { userId, template, now }) {
  const existingArtwork = await tx.get(
    "SELECT * FROM artworks WHERE owner_id=? AND source_type='coloring' AND template_id=?",
    [userId, template.id],
  );
  const artworkId = existingArtwork?.id || `art_${uuid()}`;
  const storageKey = existingArtwork?.storage_key || canonicalStorageKey(userId, artworkId);
  const thumbnailKey = existingArtwork?.thumbnail_key || canonicalThumbnailStorageKey(userId, artworkId);
  // Template content is immutable, so a previously rendered artwork stays
  // ready. New or incomplete artwork starts pending and is rendered by the
  // render outbox worker outside the user transaction.
  const renderStatus = existingArtwork?.render_status === 'ready' ? 'ready' : 'pending';
  const contentHash = existingArtwork?.content_hash || null;
  const width = Number(existingArtwork?.width || template.width);
  const height = Number(existingArtwork?.height || template.height);
  if (existingArtwork) {
    await tx.run(`UPDATE artworks SET image_url=?, storage_key=?, thumbnail_key=?, content_hash=?, mime_type=?, width=?, height=?, byte_size=?, render_status=?, is_completed=1, title=?, updated_at=? WHERE id=?`,
      [publicMediaUrl(storageKey), storageKey, thumbnailKey, contentHash, 'image/png', width, height, Number(existingArtwork?.byte_size || 0), renderStatus, template.title, now, artworkId]);
  } else {
    await tx.run(`INSERT INTO artworks (id,owner_id,source_type,image_url,title,template_id,collection_id,collection_title,rarity,is_completed,storage_key,thumbnail_key,content_hash,mime_type,width,height,byte_size,render_status,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [artworkId, userId, 'coloring', publicMediaUrl(storageKey), template.title, template.id, template.collection_id || null, template.title, template.difficulty, 1, storageKey, thumbnailKey, contentHash, 'image/png', width, height, 0, renderStatus, now, now]);
  }
  return {
    artworkId,
    storageKey,
    thumbnailKey,
    renderStatus,
  };
}

async function loadTiledPreviewDataUrl(artwork) {
  if (!artwork?.thumbnail_key) return null;
  let body;
  try {
    body = await readMediaObject(artwork.thumbnail_key);
  } catch {
    return null;
  }
  if (!body) return null;
  return `data:image/png;base64,${body.toString('base64')}`;
}

async function processTiledProgressAction(req, res, template) {
  const changes = Array.isArray(req.body.changes) ? req.body.changes : [];
  const rawSpecialAction = req.body.special_action;
  const specialAction = rawSpecialAction && typeof rawSpecialAction === 'object' && !Array.isArray(rawSpecialAction)
    ? {
      type: String(rawSpecialAction.type || ''),
      special_id: String(rawSpecialAction.special_id || ''),
      offer_token: rawSpecialAction.offer_token ? String(rawSpecialAction.offer_token) : null,
      option_id: rawSpecialAction.option_id ? String(rawSpecialAction.option_id) : null,
      camera_center: rawSpecialAction.camera_center || null,
      session_game: rawSpecialAction.session_game === true || rawSpecialAction.session_game === 'true',
      center_x: rawSpecialAction.center_x === undefined || rawSpecialAction.center_x === null || rawSpecialAction.center_x === ''
        ? null
        : Number(rawSpecialAction.center_x),
      center_y: rawSpecialAction.center_y === undefined || rawSpecialAction.center_y === null || rawSpecialAction.center_y === ''
        ? null
        : Number(rawSpecialAction.center_y),
    }
    : null;
  const actionMeta = specialAction ? specialActionMeta(specialAction.type) : null;
  if (specialAction && !actionMeta) {
    return res.status(400).json({ error: 'Неизвестное действие special cell', code: 'INVALID_SPECIAL_ACTION' });
  }
  if (specialAction && getSparkExperimentGroup(req.userId, template.id) !== 'treatment') {
    return res.status(404).json({ error: 'Special cells are unavailable for this cohort', code: 'SPECIAL_COHORT_CONTROL' });
  }
    if (specialAction && (!/^[\x21-\x7e]{2,128}$/.test(specialAction.special_id)
      || (!actionMeta.claim && !/^[a-f0-9]{16,128}$/i.test(specialAction.offer_token || ''))
      || ((specialAction.type === 'use_spark' || specialAction.type === 'use_choice')
        && !/^[a-z_]{1,32}$/.test(specialAction.option_id || ''))
    || (specialAction.type === 'use_bomb'
      && (!Number.isFinite(specialAction.center_x) || !Number.isFinite(specialAction.center_y))))) {
    return res.status(400).json({ error: 'Некорректное действие special cell', code: 'INVALID_SPECIAL_ACTION' });
  }
  if (specialAction && !actionMeta.claim && changes.length) {
    return res.status(400).json({ error: 'Special use/skip actions cannot contain paint changes', code: 'INVALID_SPECIAL_ACTION' });
  }
  if (!changes.length && (!specialAction || actionMeta.claim)) {
    return res.status(400).json({ error: 'Tiled action must contain changes', code: 'INVALID_TILED_CHANGES' });
  }
  const clientRevision = Number(req.body.revision);
  if (!Number.isInteger(clientRevision) || clientRevision < 0) {
    return res.status(400).json({ error: 'Некорректная revision' });
  }
  const batchHash = changesHash({ changes, special_action: specialAction });
  const clientBatchId = normalizeClientBatchId(req.body.clientBatchId || req.headers['idempotency-key'], clientRevision, batchHash);
  const now = new Date().toISOString();

  let result;
  try {
    result = await withDbTransaction(async (tx) => {
    const generationInfo = await ensureTiledSpecialCells(tx, template);
    const existingBatch = await tx.get(
      'SELECT * FROM coloring_progress_batches WHERE user_id=? AND template_id=? AND client_batch_id=?',
      [req.userId, template.id, clientBatchId],
    );
    if (existingBatch) {
        if (existingBatch.changes_hash !== batchHash || Number(existingBatch.revision_before) !== clientRevision) return { badBatch: true };
      const stored = parseJsonObject(existingBatch.response_json) || {};
      const progress = await tx.get('SELECT * FROM coloring_tiled_progress WHERE user_id=? AND template_id=?', [req.userId, template.id]);
      const existingArtwork = await tx.get("SELECT id,render_status FROM artworks WHERE owner_id=? AND source_type='coloring' AND template_id=?", [req.userId, template.id]);
      // Replay must be semantically equivalent to the original response and
      // must never repeat side effects (rewards, renders, enqueues).
      return {
        replay: true,
        response: {
          ...tiledProgressPayload(template, progress, existingArtwork?.id || stored.artwork_id || null),
          specials_experiment_group: getSparkExperimentGroup(req.userId, template.id),
          ...(isSpecialDiagnosticsEnabled()
            ? { special_diagnostics: await buildSpecialDiagnostics(tx, {
              userId: req.userId,
              template,
              progress,
              generationInfo,
            }) }
            : {}),
          artwork_id: existingArtwork?.id || stored.artwork_id || null,
          render_status: existingArtwork?.render_status || stored.render_status || null,
          result_preview_data_url: stored.result_preview_data_url || null,
          idempotent: true,
          rewards: stored.rewards || null,
          special_offer: stored.special_offer || null,
          special_applied_changes: stored.special_applied_changes || [],
          special_discovered: null,
          special_effort: stored.special_effort || null,
          artifact_progress: await buildArtifactProgress(tx, {
            userId: req.userId,
            templateId: template.id,
          }),
        },
      };
    }

    const existing = await tx.get('SELECT * FROM coloring_tiled_progress WHERE user_id=? AND template_id=?', [req.userId, template.id]);
    const serverRevision = Number(existing?.revision || 0);
    if (clientRevision !== serverRevision) {
      return { conflict: true, progress: tiledProgressPayload(template, existing) };
    }

    // A special offer is a server-side flow barrier, not only a client HUD
    // convention. This also prevents a second device from appending ordinary
    // batches until the bounded offer-recovery journal can no longer find its
    // token.
    await assertNoOtherActiveSpecialOffer(tx, {
      userId: req.userId,
      templateId: template.id,
      specialId: specialAction?.special_id || null,
    });

    let state = null;
    let persisted = {
      conflict: false,
      revision: serverRevision,
      completedAt: existing?.completed_at || null,
    };
    let specialOffer = null;
    let specialAppliedChanges = [];
    let specialDiscovered = null;
    let specialEffort = null;
    let claimedSpecialIndex = null;
    let fuseChain = [];
    let fuseRemainingAfterStep = [];

    if (specialAction?.type === 'skip_spark' || specialAction?.type === 'skip_fuse'
      || specialAction?.type === 'skip_hazard') {
      const special = await findSpecial(tx, {
        templateId: template.id,
        specialId: specialAction.special_id,
        kind: actionMeta.kind,
      });
      const specialProgress = await getSparkProgress(tx, {
        userId: req.userId, templateId: template.id, specialId: specialAction.special_id,
      });
      if (!special || !specialProgress || specialProgress.status !== 'offered'
        || specialProgress.offer_token_hash !== hashOfferToken(specialAction.offer_token)) {
        throw specialError(`${actionMeta.kind === 'fuse' ? 'Fuse' : actionMeta.kind === 'hazard' ? 'Hazard' : 'Spark'} offer is no longer available`, 'SPECIAL_OFFER_STALE', 409);
      }
      if (!await markSparkSkipped(tx, {
        userId: req.userId,
        templateId: template.id,
        specialId: specialAction.special_id,
        tokenHash: hashOfferToken(specialAction.offer_token),
        now,
      })) throw specialError(`${actionMeta.kind === 'fuse' ? 'Fuse' : actionMeta.kind === 'hazard' ? 'Hazard' : 'Spark'} offer is no longer available`, 'SPECIAL_OFFER_STALE', 409);
      if (specialAction.type === 'skip_hazard') {
        specialDiscovered = {
          special_id: specialAction.special_id,
          kind: 'hazard',
          missed: true,
          temporary_penalty: buildHazardMissPenalty({
            width: template.width,
            height: template.height,
            specialIndex: Number(special.cell_index),
          }),
        };
      }
    } else {
      let effectiveChanges = changes;
      if (specialAction?.type === 'claim_spark' || specialAction?.type === 'claim_bomb'
        || specialAction?.type === 'claim_fuse' || specialAction?.type === 'claim_choice'
        || specialAction?.type === 'claim_artifact' || specialAction?.type === 'claim_hazard') {
        const special = await findSpecial(tx, {
          templateId: template.id,
          specialId: specialAction.special_id,
          kind: actionMeta.kind,
        });
        const specialProgress = await getSparkProgress(tx, {
          userId: req.userId, templateId: template.id, specialId: specialAction.special_id,
        });
        await assertNoOtherActiveSpecialOffer(tx, {
          userId: req.userId,
          templateId: template.id,
          specialId: specialAction.special_id,
        });
        const hit = changes.find((change) => change?.index === Number(special?.cell_index));
        if (!special || (specialProgress && ['offered', 'consumed', 'skipped'].includes(specialProgress.status))
          || !hit || !Number.isInteger(hit.color) || hit.color < 0) {
          throw specialError(
            special?.kind === 'bomb' ? 'Bomb cell cannot be claimed'
            : special?.kind === 'fuse' ? 'Fuse cell cannot be claimed'
              : special?.kind === 'choice' ? 'Choice cell cannot be claimed'
                : special?.kind === 'artifact' ? 'Artifact cell cannot be claimed'
                  : special?.kind === 'hazard' ? 'Hazard cell cannot be claimed'
                    : 'Spark cell cannot be claimed',
            'SPECIAL_CLAIM_INVALID',
            409,
          );
        }
        claimedSpecialIndex = Number(special.cell_index);
        specialDiscovered = { special_id: specialAction.special_id, kind: special.kind };
        if (specialAction.type === 'claim_spark') {
          const triggerTile = await readTiledTile(tx, {
            template,
            userId: req.userId,
            tileX: Number(special.tile_x),
            tileY: Number(special.tile_y),
            progress: existing,
          });
          const triggerTarget = targetForSpecialCell(triggerTile, special);
          specialEffort = {
            trigger_target: describeSpecialTargetEffort(triggerTarget),
            selected_effect_target: null,
            suppression_reason: null,
          };
        }
      }
      if (specialAction?.type === 'use_spark') {
        const special = await findSpark(tx, { templateId: template.id, specialId: specialAction.special_id });
        const specialProgress = await getSparkProgress(tx, {
          userId: req.userId, templateId: template.id, specialId: specialAction.special_id,
        });
        if (!special || !specialProgress || specialProgress.status !== 'offered'
          || specialProgress.offer_token_hash !== hashOfferToken(specialAction.offer_token)) {
          throw specialError('Spark offer is no longer available', 'SPECIAL_OFFER_STALE', 409);
        }
        const storedOffer = await findStoredSparkOffer(tx, {
          userId: req.userId,
          templateId: template.id,
        });
        const option = String(storedOffer?.special_id || '') === String(specialAction.special_id)
          ? (storedOffer.target_options || []).find((candidate) => candidate.option_id === specialAction.option_id)
          : null;
        if (!option) throw specialError('Spark target is no longer available', 'SPECIAL_TARGET_STALE', 409);
        effectiveChanges = await deriveSparkChanges(tx, {
          userId: req.userId,
          template,
          target: option,
        });
        if (!effectiveChanges.length) throw specialError('Spark target has no remaining cells', 'SPECIAL_TARGET_EMPTY', 409);
      }
      if (specialAction?.type === 'use_bomb') {
        const special = await findSpecial(tx, {
          templateId: template.id,
          specialId: specialAction.special_id,
          kind: actionMeta.kind,
        });
        const specialProgress = await getSparkProgress(tx, {
          userId: req.userId, templateId: template.id, specialId: specialAction.special_id,
        });
        if (!special || !specialProgress || specialProgress.status !== 'offered'
          || specialProgress.offer_token_hash !== hashOfferToken(specialAction.offer_token)) {
          throw specialError('Bomb offer is no longer available', 'SPECIAL_OFFER_STALE', 409);
        }
        effectiveChanges = await deriveBombChanges(tx, {
          userId: req.userId,
          template,
          special,
          centerX: specialAction.center_x,
          centerY: specialAction.center_y,
        });
        if (!effectiveChanges.length) throw specialError('Bomb target has no remaining cells', 'SPECIAL_TARGET_EMPTY', 409);
      }
      if (specialAction?.type === 'use_choice') {
        const special = await findSpecial(tx, {
          templateId: template.id,
          specialId: specialAction.special_id,
          kind: actionMeta.kind,
        });
        const specialProgress = await getSparkProgress(tx, {
          userId: req.userId, templateId: template.id, specialId: specialAction.special_id,
        });
        if (!special || !specialProgress || specialProgress.status !== 'offered'
          || specialProgress.offer_token_hash !== hashOfferToken(specialAction.offer_token)) {
          throw specialError('Choice offer is no longer available', 'SPECIAL_OFFER_STALE', 409);
        }
        if (specialAction.option_id === 'smart_target') {
          const plan = await buildGuidancePlan({
            db: tx,
            userId: req.userId,
            template,
            reason: GUIDANCE_REASON.SPECIAL_TARGETS,
            specialId: specialAction.special_id,
            cameraCenter: specialAction.camera_center,
            sparkTreatment: getSparkExperimentGroup(req.userId, template.id) === 'treatment',
          });
          const target = plan.target_options?.[0];
          if (!target) throw specialError('Choice target is no longer available', 'SPECIAL_TARGET_STALE', 409);
          effectiveChanges = await deriveSparkChanges(tx, {
            userId: req.userId,
            template,
            target,
            maxChanges: SPECIAL_MAX_DERIVED_CHANGES,
          });
        } else if (specialAction.option_id === 'local_burst') {
          effectiveChanges = await deriveBombChanges(tx, {
            userId: req.userId,
            template,
            special,
            centerX: Number(special.cell_index) % Number(template.width),
            centerY: Math.floor(Number(special.cell_index) / Number(template.width)),
          });
        } else {
          throw specialError('Choice option is no longer available', 'SPECIAL_TARGET_STALE', 409);
        }
        if (!effectiveChanges.length) throw specialError('Choice target has no remaining cells', 'SPECIAL_TARGET_EMPTY', 409);
      }
      if (specialAction?.type === 'disarm_fuse') {
        const special = await findSpecial(tx, {
          templateId: template.id,
          specialId: specialAction.special_id,
          kind: actionMeta.kind,
        });
        const specialProgress = await getSparkProgress(tx, {
          userId: req.userId, templateId: template.id, specialId: specialAction.special_id,
        });
        if (!special || !specialProgress || specialProgress.status !== 'offered'
          || specialProgress.offer_token_hash !== hashOfferToken(specialAction.offer_token)) {
          throw specialError('Fuse offer is no longer available', 'SPECIAL_OFFER_STALE', 409);
        }
        const storedChain = await findStoredFuseChain(tx, {
          userId: req.userId,
          templateId: template.id,
          specialId: specialAction.special_id,
        });
        if (!storedChain) throw specialError('Fuse offer is no longer available', 'SPECIAL_OFFER_STALE', 409);
        const windowChanges = await deriveTiledFuseChanges(tx, {
          userId: req.userId,
          template,
          special,
          excludeFilled: true,
        });
        fuseChain = storedChain;
        const derived = remainingFuseChangesFromChain(windowChanges, storedChain);
        if (!derived.length) throw specialError('Fuse target has no remaining cells', 'SPECIAL_TARGET_EMPTY', 409);
        effectiveChanges = takeFuseStepChanges(derived);
        fuseRemainingAfterStep = remainingFuseStepChanges(derived);
      }
      if (specialAction?.type === 'disarm_hazard') {
        const special = await findSpecial(tx, {
          templateId: template.id,
          specialId: specialAction.special_id,
          kind: actionMeta.kind,
        });
        const specialProgress = await getSparkProgress(tx, {
          userId: req.userId, templateId: template.id, specialId: specialAction.special_id,
        });
        if (!special || !specialProgress || specialProgress.status !== 'offered'
          || specialProgress.offer_token_hash !== hashOfferToken(specialAction.offer_token)) {
          throw specialError('Hazard offer is no longer available', 'SPECIAL_OFFER_STALE', 409);
        }
        effectiveChanges = await deriveTiledHazardDisarmChanges(tx, {
          userId: req.userId,
          template,
          special,
        });
        if (!effectiveChanges.length) throw specialError('Hazard target has no remaining cells', 'SPECIAL_TARGET_EMPTY', 409);
      }
      state = await applyTiledChanges(tx, {
        userId: req.userId,
        template,
        existingProgress: existing,
        changes: effectiveChanges,
        maxChanges: specialAction?.type === 'use_spark'
          ? SPARK_TARGET_MAX_CELLS
          : undefined,
      });
      if ((specialAction?.type === 'claim_spark' || specialAction?.type === 'claim_bomb'
        || specialAction?.type === 'claim_fuse' || specialAction?.type === 'claim_choice'
        || specialAction?.type === 'claim_artifact' || specialAction?.type === 'claim_hazard')
        && !state.newlyCorrectIndices.includes(claimedSpecialIndex)) {
        throw specialError(
          specialAction.type === 'claim_bomb' ? 'Bomb cell cannot be claimed'
            : specialAction.type === 'claim_fuse' ? 'Fuse cell cannot be claimed'
              : specialAction.type === 'claim_choice' ? 'Choice cell cannot be claimed'
                : specialAction.type === 'claim_artifact' ? 'Artifact cell cannot be claimed'
                  : specialAction.type === 'claim_hazard' ? 'Hazard cell cannot be claimed'
                    : 'Spark cell cannot be claimed',
          'SPECIAL_CLAIM_INVALID',
          409,
        );
      }
      persisted = await persistTiledChanges(tx, {
        userId: req.userId,
        template,
        existingProgress: existing,
        clientRevision,
        now,
        state,
      });
      if (persisted.conflict) return { conflict: true, progress: tiledProgressPayload(template, await tx.get('SELECT * FROM coloring_tiled_progress WHERE user_id=? AND template_id=?', [req.userId, template.id])) };
      const suppressInteractiveSpecial = Boolean(specialAction?.type === 'claim_spark'
        && !isSpecialTargetEligible(specialEffort?.trigger_target));
      if (suppressInteractiveSpecial) {
        specialEffort.suppression_reason = 'trivial_trigger_target';
        specialDiscovered = null;
        await markSpecialSkippedDirect(tx, {
          userId: req.userId,
          templateId: template.id,
          specialId: specialAction.special_id,
          revision: persisted.revision,
          now,
        });
      } else if (specialAction?.type === 'claim_spark') {
        const token = createOfferToken();
        await markSparkOffered(tx, {
          userId: req.userId,
          templateId: template.id,
          specialId: specialAction.special_id,
          revision: persisted.revision,
          tokenHash: token.hash,
          now,
        });
        const offer = await buildGuidancePlan({
          db: tx,
          userId: req.userId,
          template,
          reason: GUIDANCE_REASON.SPECIAL_TARGETS,
          specialId: specialAction.special_id,
          cameraCenter: specialAction.camera_center,
          sparkTreatment: getSparkExperimentGroup(req.userId, template.id) === 'treatment',
          sessionGame: specialAction.session_game,
        });
        const defaultTarget = (offer.target_options || [])[0] || null;
        if (isSpecialTargetEligible(defaultTarget)) {
          specialOffer = {
            special_id: specialAction.special_id,
            offer_token: token.token,
            progress_revision: persisted.revision,
            kind: 'spark',
            target_options: specialAction.session_game ? (offer.target_options || []).slice(0, 2) : [defaultTarget],
            default_option_id: defaultTarget.option_id,
            auto_apply: !specialAction.session_game,
            interaction_cost: specialAction.session_game ? 1 : 0,
            session_game: Boolean(specialAction.session_game),
            target_effort: describeSpecialTargetEffort(defaultTarget),
          };
          specialEffort.selected_effect_target = describeSpecialTargetEffort(defaultTarget);
        } else {
          specialEffort.suppression_reason = 'no_eligible_effect_target';
          specialDiscovered = null;
          await markSpecialSkippedDirect(tx, {
            userId: req.userId,
            templateId: template.id,
            specialId: specialAction.special_id,
            revision: persisted.revision,
            now,
          });
        }
      } else if (specialAction?.type === 'claim_bomb') {
        const token = createOfferToken();
        await markSparkOffered(tx, {
          userId: req.userId,
          templateId: template.id,
          specialId: specialAction.special_id,
          revision: persisted.revision,
          tokenHash: token.hash,
          now,
        });
        const bombIndex = Number(claimedSpecialIndex);
        specialOffer = {
          special_id: specialAction.special_id,
          offer_token: token.token,
          progress_revision: persisted.revision,
          kind: actionMeta.kind,
          radius: BOMB_RADIUS,
          center_x: bombIndex % Number(template.width),
          center_y: Math.floor(bombIndex / Number(template.width)),
        };
      } else if (specialAction?.type === 'claim_fuse') {
        const token = createOfferToken();
        await markSparkOffered(tx, {
          userId: req.userId,
          templateId: template.id,
          specialId: specialAction.special_id,
          revision: persisted.revision,
          tokenHash: token.hash,
          now,
        });
        const claimedFuse = await findSpecial(tx, {
          templateId: template.id,
          specialId: specialAction.special_id,
          kind: actionMeta.kind,
        });
        const derived = await deriveTiledFuseChanges(tx, {
          userId: req.userId,
          template,
          special: claimedFuse,
          excludeFilled: false,
        });
        specialOffer = {
          special_id: specialAction.special_id,
          offer_token: token.token,
          progress_revision: persisted.revision,
          kind: actionMeta.kind,
          steps: buildFuseOfferSteps(derived),
          disarm: true,
          chain_cells: derived.map((change) => change.index),
        };
      } else if (specialAction?.type === 'claim_hazard') {
        const token = createOfferToken();
        await markSparkOffered(tx, {
          userId: req.userId,
          templateId: template.id,
          specialId: specialAction.special_id,
          revision: persisted.revision,
          tokenHash: token.hash,
          now,
        });
        const claimedHazard = await findSpecial(tx, {
          templateId: template.id,
          specialId: specialAction.special_id,
          kind: actionMeta.kind,
        });
        const derived = await deriveTiledHazardDisarmChanges(tx, {
          userId: req.userId,
          template,
          special: claimedHazard,
        });
        specialOffer = buildHazardOffer({
          specialId: specialAction.special_id,
          offerToken: token.token,
          progressRevision: persisted.revision,
          rewardCells: derived.length,
        });
      } else if (specialAction?.type === 'claim_choice') {
        const token = createOfferToken();
        await markSparkOffered(tx, {
          userId: req.userId,
          templateId: template.id,
          specialId: specialAction.special_id,
          revision: persisted.revision,
          tokenHash: token.hash,
          now,
        });
        specialOffer = {
          special_id: specialAction.special_id,
          offer_token: token.token,
          progress_revision: persisted.revision,
          kind: actionMeta.kind,
          choice_options: [
            { option_id: 'smart_target', label: 'Smart zone' },
            { option_id: 'local_burst', label: 'Local burst' },
          ],
        };
      } else if (specialAction?.type === 'claim_artifact') {
        await tx.run(`INSERT INTO coloring_special_progress
          (user_id,template_id,special_id,status,offer_revision,offer_token_hash,updated_at)
          VALUES (?,?,?,?,?,?,?)
          ON CONFLICT(user_id,template_id,special_id) DO UPDATE SET
            status='consumed', offer_revision=excluded.offer_revision,
            offer_token_hash=NULL, updated_at=excluded.updated_at`,
        [req.userId, template.id, specialAction.special_id, 'consumed', persisted.revision, null, now]);
        const fragmentRow = await tx.get(`SELECT COUNT(*) AS count
          FROM coloring_special_progress p
          JOIN coloring_special_cells c
            ON c.template_id=p.template_id AND c.special_id=p.special_id
         WHERE p.user_id=? AND p.template_id=? AND c.kind='artifact' AND p.status='consumed'`,
        [req.userId, template.id]);
        specialDiscovered = {
          special_id: specialAction.special_id,
          kind: 'artifact',
          artifact_fragments: Math.min(3, Number(fragmentRow?.count || 0)),
          artifact_complete: Number(fragmentRow?.count || 0) >= 3,
        };
      } else if (specialAction?.type === 'use_spark' || specialAction?.type === 'use_bomb'
        || specialAction?.type === 'disarm_fuse' || specialAction?.type === 'use_choice'
        || specialAction?.type === 'disarm_hazard') {
        if (specialAction.type === 'disarm_fuse' && fuseRemainingAfterStep.length) {
          await markSparkOffered(tx, {
            userId: req.userId,
            templateId: template.id,
            specialId: specialAction.special_id,
            revision: persisted.revision,
            tokenHash: hashOfferToken(specialAction.offer_token),
            now,
          });
          specialOffer = {
            special_id: specialAction.special_id,
            offer_token: specialAction.offer_token,
            progress_revision: persisted.revision,
            kind: actionMeta.kind,
            steps: buildFuseOfferSteps(fuseRemainingAfterStep),
            disarm: true,
            chain_cells: fuseChain,
          };
          specialAppliedChanges = state.changes.map((change) => ({ index: change.index, color: change.color }));
        } else if (specialAction.type === 'disarm_hazard') {
          if (!await markSparkConsumed(tx, {
            userId: req.userId,
            templateId: template.id,
            specialId: specialAction.special_id,
            tokenHash: hashOfferToken(specialAction.offer_token),
            now,
          })) throw specialError('Hazard offer is no longer available', 'SPECIAL_OFFER_STALE', 409);
          specialAppliedChanges = state.changes.map((change) => ({ index: change.index, color: change.color }));
        } else {
          const consumed = await markSparkConsumed(tx, {
            userId: req.userId,
            templateId: template.id,
            specialId: specialAction.special_id,
            tokenHash: hashOfferToken(specialAction.offer_token),
            now,
          });
          if (!consumed) throw specialError(
          specialAction.type === 'use_bomb' ? 'Bomb offer is no longer available'
            : specialAction.type === 'disarm_fuse' ? 'Fuse offer is no longer available'
              : specialAction.type === 'use_choice' ? 'Choice offer is no longer available'
                : specialAction.type === 'disarm_hazard' ? 'Hazard offer is no longer available'
                  : 'Spark offer is no longer available',
            'SPECIAL_OFFER_STALE',
            409,
          );
          specialAppliedChanges = state.changes.map((change) => ({ index: change.index, color: change.color }));
        }
      }
    }

    // A final-cell claim or a final Fuse/Hazard disarm must still report
    // discovery/effect, but it cannot leave a live offer behind because the
    // artwork is already complete.
    if (state?.justCompleted && (/^claim_(spark|bomb|fuse|choice|hazard)$/.test(String(specialAction?.type || ''))
      || specialAction?.type === 'disarm_fuse' || specialAction?.type === 'disarm_hazard')) {
      await markSpecialConsumedDirect(tx, {
        userId: req.userId,
        templateId: template.id,
        specialId: specialAction.special_id,
        revision: persisted.revision,
        now,
      });
      specialOffer = null;
    }

    const painted = Boolean(state?.painted);
    if (painted) await touchDailyStreak(tx, { userId: req.userId, now });
    const rewards = state ? await rewardVerifiedTiledPainting(tx, {
      userId: req.userId,
      template,
      newlyCorrectIndices: state.newlyCorrectIndices,
      completedCells: state.completedCells,
      deltaCorrectCells: state.completedCells - state.previousCompletedCells,
      revision: persisted.revision,
      justCompleted: state.justCompleted,
      now,
    }) : null;
    const artwork = state?.justCompleted
      ? await createTiledArtworkMetadata(tx, { userId: req.userId, template, now })
      : null;
    if (artwork && artwork.renderStatus !== 'ready') {
      await enqueueRenderJob(tx, {
        artworkId: artwork.artworkId,
        userId: req.userId,
        templateId: template.id,
        renderMode: 'tiled',
        now,
      });
    }
    if (state) await grantPaintingAchievements(tx, {
      userId: req.userId,
      template,
      painted,
      firstPaint: Boolean(painted && state.previousCompletedCells === 0),
      justCompleted: state.justCompleted,
      now,
    });
    const response = {
      ...tiledProgressPayload(template, {
        revision: persisted.revision,
        completed_cells: state?.completedCells ?? existing?.completed_cells ?? 0,
        completed_at: persisted.completedAt,
      }, artwork?.artworkId || null),
      specials_experiment_group: getSparkExperimentGroup(req.userId, template.id),
      ...(isSpecialDiagnosticsEnabled()
        ? { special_diagnostics: await buildSpecialDiagnostics(tx, {
          userId: req.userId,
          template,
          progress: {
            completed_cells: state?.completedCells ?? existing?.completed_cells ?? 0,
          },
          generationInfo,
        }) }
        : {}),
      artwork_id: artwork?.artworkId || null,
      render_status: artwork?.renderStatus || null,
      result_preview_data_url: null,
      idempotent: false,
      rewards,
      special_offer: specialOffer,
      special_applied_changes: specialAppliedChanges,
      special_discovered: specialDiscovered,
      special_effort: specialEffort,
      artifact_progress: await buildArtifactProgress(tx, {
        userId: req.userId,
        templateId: template.id,
      }),
    };
    await tx.run(`INSERT INTO coloring_progress_batches
      (user_id,template_id,client_batch_id,changes_hash,revision_before,revision_after,response_json,created_at)
      VALUES (?,?,?,?,?,?,?,?)`,
    [req.userId, template.id, clientBatchId, batchHash, clientRevision, persisted.revision, JSON.stringify(response), now]);
    return { response };
    });
  } catch (error) {
    if (sendChunkContractError(res, error)) return;
    if (isTiledSpecialError(error)) {
      return res.status(error.status || 400).json({ error: error.message, code: error.code });
    }
    throw error;
  }

  if (result.badBatch) return res.status(409).json({ error: 'client_batch_id уже использован для другого набора изменений' });
  if (result.conflict) return res.status(409).json({ error: 'Прогресс уже обновлён на другом устройстве', progress: result.progress });
  if (result.specialError) return res.status(result.specialError.status || 409).json({
    error: result.specialError.message,
    code: result.specialError.code,
    progress: result.progress || null,
  });
  return res.json(result.response);
}

// POST /colorings/:id/progress/actions — server derives the new map and completion state.
router.post('/:id/progress/actions', authMiddleware, asyncRoute(async (req, res) => {
  const template = parseTemplate(await get('SELECT * FROM coloring_templates WHERE id=? AND status=\'active\'', [req.params.id]));
  if (!template || !canRead(template, req.userId)) return res.status(404).json({ error: 'Раскраска не найдена' });

  const actionAccess = await withDbTransaction((tx) => assertTemplateAccessible(tx, req.userId, template, { grant: true }));
  if (actionAccess.locked) return sendUnlockLocked(res, actionAccess);

  if (isTiledTemplate(template)) return processTiledProgressAction(req, res, template);

  const changes = Array.isArray(req.body.changes) ? req.body.changes : [];
  const rawSpecialAction = req.body.special_action;
  const specialAction = rawSpecialAction && typeof rawSpecialAction === 'object' && !Array.isArray(rawSpecialAction)
    ? {
      type: String(rawSpecialAction.type || ''),
      special_id: String(rawSpecialAction.special_id || ''),
      offer_token: rawSpecialAction.offer_token ? String(rawSpecialAction.offer_token) : null,
      option_id: rawSpecialAction.option_id ? String(rawSpecialAction.option_id) : null,
      session_game: rawSpecialAction.session_game === true || rawSpecialAction.session_game === 'true',
      center_x: rawSpecialAction.center_x === undefined || rawSpecialAction.center_x === null || rawSpecialAction.center_x === ''
        ? null
        : Number(rawSpecialAction.center_x),
      center_y: rawSpecialAction.center_y === undefined || rawSpecialAction.center_y === null || rawSpecialAction.center_y === ''
        ? null
        : Number(rawSpecialAction.center_y),
    }
    : null;
  const actionMeta = specialAction ? specialActionMeta(specialAction.type) : null;
  if (specialAction && !actionMeta) {
    return res.status(400).json({ error: 'Unknown special cell action', code: 'INVALID_SPECIAL_ACTION' });
  }
  if (specialAction && getSparkExperimentGroup(req.userId, template.id) !== 'treatment') {
    return res.status(404).json({ error: 'Special cells are unavailable for this cohort', code: 'SPECIAL_COHORT_CONTROL' });
  }
  if (specialAction && (!/^[\x21-\x7e]{2,128}$/.test(specialAction.special_id)
    || (!actionMeta.claim && !/^[a-f0-9]{16,128}$/i.test(specialAction.offer_token || ''))
    || ((specialAction.type === 'use_spark' || specialAction.type === 'use_choice')
      && !/^[a-z_]{1,32}$/.test(specialAction.option_id || ''))
    || (specialAction.type === 'use_bomb'
      && (!Number.isFinite(specialAction.center_x) || !Number.isFinite(specialAction.center_y))))) {
    return res.status(400).json({ error: 'Invalid special cell action', code: 'INVALID_SPECIAL_ACTION' });
  }
  if (specialAction && !actionMeta.claim && changes.length) {
    return res.status(400).json({ error: 'Special use/skip actions cannot contain paint changes', code: 'INVALID_SPECIAL_ACTION' });
  }
  const validationError = changes.length || !specialAction || actionMeta.claim
    ? validateChanges(template, changes)
    : null;
  if (validationError) return res.status(400).json({ error: validationError });

  const clientRevision = Number(req.body.revision);
  if (!Number.isInteger(clientRevision) || clientRevision < 0) {
    return res.status(400).json({ error: 'Некорректная revision' });
  }

  const batchHash = changesHash({ changes, special_action: specialAction });
  const clientBatchId = normalizeClientBatchId(req.body.clientBatchId || req.headers['idempotency-key'], clientRevision, batchHash);

  const now = new Date().toISOString();
  let casResult;
  try {
    casResult = await withDbTransaction(async (tx) => {
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
        const storedResponse = parseJsonObject(existingBatch.response_json) || {};
        return {
          conflict: false,
          replay: true,
          revision: Number(existingBatch.revision_after),
          artworkId: existingArtwork?.id || null,
          renderStatus: existingArtwork?.render_status || null,
          progress: existingProgress ? progressPayload(template, existingProgress) : null,
          rewards: storedResponse.rewards || null,
          specialOffer: storedResponse.special_offer || null,
          specialAppliedChanges: storedResponse.special_applied_changes || [],
          specialDiscovered: null,
          specialEffort: storedResponse.special_effort || null,
        };
      }

      await ensureLegacySparkCells(tx, template);
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
      await assertNoOtherActiveSpecialOffer(tx, {
        userId: req.userId,
        templateId: template.id,
        specialId: specialAction?.special_id || null,
      });
      const filled = [...currentFilled];
      let effectiveChanges = changes;
      let specialOffer = null;
      let specialAppliedChanges = [];
      let specialDiscovered = null;
      let specialEffort = null;
      let fuseRemainingAfterStep = [];
      const special = specialAction ? await findSpecial(tx, {
        templateId: template.id,
        specialId: specialAction.special_id,
        kind: actionMeta.kind,
      }) : null;
      const specialProgress = specialAction ? await getSparkProgress(tx, {
        userId: req.userId, templateId: template.id, specialId: specialAction.special_id,
      }) : null;
      if (specialAction?.type === 'claim_spark' && special) {
        specialEffort = {
          trigger_target: buildLegacySpecialTriggerEffort({
            cells: template.cells,
            filled: currentFilled,
            width: template.width,
            height: template.height,
            specialIndex: Number(special.cell_index),
          }),
          selected_effect_target: null,
          suppression_reason: null,
        };
      }
      if (specialAction?.type === 'skip_spark' || specialAction?.type === 'skip_fuse'
        || specialAction?.type === 'skip_hazard') {
        if (!special || !specialProgress || specialProgress.status !== 'offered'
          || specialProgress.offer_token_hash !== hashOfferToken(specialAction.offer_token)) {
          throw specialError(`${actionMeta.kind === 'fuse' ? 'Fuse' : actionMeta.kind === 'hazard' ? 'Hazard' : 'Spark'} offer is no longer available`, 'SPECIAL_OFFER_STALE', 409);
        }
        if (!await markSparkSkipped(tx, {
          userId: req.userId,
          templateId: template.id,
          specialId: specialAction.special_id,
          tokenHash: hashOfferToken(specialAction.offer_token),
          now,
        })) throw specialError(`${actionMeta.kind === 'fuse' ? 'Fuse' : actionMeta.kind === 'hazard' ? 'Hazard' : 'Spark'} offer is no longer available`, 'SPECIAL_OFFER_STALE', 409);
        if (specialAction.type === 'skip_hazard') {
          specialDiscovered = {
            special_id: specialAction.special_id,
            kind: 'hazard',
            missed: true,
            temporary_penalty: buildHazardMissPenalty({
              width: template.width,
              height: template.height,
              specialIndex: Number(special.cell_index),
            }),
          };
        }
      }
      if (specialAction?.type === 'claim_spark' || specialAction?.type === 'claim_bomb'
        || specialAction?.type === 'claim_fuse' || specialAction?.type === 'claim_choice'
        || specialAction?.type === 'claim_artifact' || specialAction?.type === 'claim_hazard') {
        await assertNoOtherActiveSpecialOffer(tx, {
          userId: req.userId,
          templateId: template.id,
          specialId: specialAction.special_id,
        });
        const hit = changes.find((change) => change?.index === Number(special?.cell_index));
        if (!special || (specialProgress && ['offered', 'consumed', 'skipped'].includes(specialProgress.status))
          || !hit || currentFilled[Number(special.cell_index)] !== -1
          || hit.color !== template.cells[Number(special.cell_index)]) {
          throw specialError(
            special?.kind === 'bomb' ? 'Bomb cell cannot be claimed'
            : special?.kind === 'fuse' ? 'Fuse cell cannot be claimed'
              : special?.kind === 'choice' ? 'Choice cell cannot be claimed'
                : special?.kind === 'artifact' ? 'Artifact cell cannot be claimed'
                  : special?.kind === 'hazard' ? 'Hazard cell cannot be claimed'
                    : 'Spark cell cannot be claimed',
            'SPECIAL_CLAIM_INVALID',
            409,
          );
        }
        specialDiscovered = { special_id: specialAction.special_id, kind: special.kind };
      }
      if (specialAction?.type === 'use_spark') {
        if (!special || !specialProgress || specialProgress.status !== 'offered'
          || specialProgress.offer_token_hash !== hashOfferToken(specialAction.offer_token)) {
          throw specialError('Spark offer is no longer available', 'SPECIAL_OFFER_STALE', 409);
        }
        const storedOffer = await findStoredSparkOffer(tx, {
          userId: req.userId,
          templateId: template.id,
        });
        const option = String(storedOffer?.special_id || '') === String(specialAction.special_id)
          ? (storedOffer.target_options || []).find((candidate) => candidate.option_id === specialAction.option_id)
          : null;
        if (!option) throw specialError('Spark target is no longer available', 'SPECIAL_TARGET_STALE', 409);
        effectiveChanges = deriveLegacySparkChanges({
          cells: template.cells,
          filled: currentFilled,
          width: template.width,
          height: template.height,
          target: option,
        });
        if (!effectiveChanges.length) throw specialError('Spark target has no remaining cells', 'SPECIAL_TARGET_EMPTY', 409);
      }
      if (specialAction?.type === 'use_bomb') {
        if (!special || !specialProgress || specialProgress.status !== 'offered'
          || specialProgress.offer_token_hash !== hashOfferToken(specialAction.offer_token)) {
          throw specialError('Bomb offer is no longer available', 'SPECIAL_OFFER_STALE', 409);
        }
        effectiveChanges = deriveLegacyBombChanges({
          cells: template.cells,
          filled: currentFilled,
          width: template.width,
          height: template.height,
          specialIndex: Number(special.cell_index),
          centerX: specialAction.center_x,
          centerY: specialAction.center_y,
        });
        if (!effectiveChanges.length) throw specialError('Bomb target has no remaining cells', 'SPECIAL_TARGET_EMPTY', 409);
      }
      if (specialAction?.type === 'use_choice') {
        if (!special || !specialProgress || specialProgress.status !== 'offered'
          || specialProgress.offer_token_hash !== hashOfferToken(specialAction.offer_token)) {
          throw specialError('Choice offer is no longer available', 'SPECIAL_OFFER_STALE', 409);
        }
        if (specialAction.option_id === 'smart_target') {
          const options = buildLegacySparkTargetOptions({
            cells: template.cells,
            filled: currentFilled,
            width: template.width,
            height: template.height,
            specialIndex: Number(special.cell_index),
            maxOptions: 1,
          });
          if (!options.length) throw specialError('Choice target is no longer available', 'SPECIAL_TARGET_STALE', 409);
          effectiveChanges = deriveLegacySparkChanges({
            cells: template.cells,
            filled: currentFilled,
            width: template.width,
            height: template.height,
            target: options[0],
            maxChanges: SPECIAL_MAX_DERIVED_CHANGES,
          });
        } else if (specialAction.option_id === 'local_burst') {
          effectiveChanges = deriveLegacyBombChanges({
            cells: template.cells,
            filled: currentFilled,
            width: template.width,
            height: template.height,
            specialIndex: Number(special.cell_index),
          });
        } else {
          throw specialError('Choice option is no longer available', 'SPECIAL_TARGET_STALE', 409);
        }
        if (!effectiveChanges.length) throw specialError('Choice target has no remaining cells', 'SPECIAL_TARGET_EMPTY', 409);
      }
      if (specialAction?.type === 'disarm_fuse' || specialAction?.type === 'disarm_hazard') {
        if (!special || !specialProgress || specialProgress.status !== 'offered'
          || specialProgress.offer_token_hash !== hashOfferToken(specialAction.offer_token)) {
          throw specialError(`${specialAction.type === 'disarm_fuse' ? 'Fuse' : 'Hazard'} offer is no longer available`, 'SPECIAL_OFFER_STALE', 409);
        }
        if (specialAction.type === 'disarm_fuse') {
          const storedChain = await findStoredFuseChain(tx, {
            userId: req.userId,
            templateId: template.id,
            specialId: specialAction.special_id,
          });
          if (!storedChain) throw specialError('Fuse offer is no longer available', 'SPECIAL_OFFER_STALE', 409);
          const windowChanges = deriveFuseChanges({
            cells: template.cells,
            filled: Array(template.width * template.height).fill(-1),
            width: template.width,
            height: template.height,
            specialIndex: Number(special.cell_index),
          });
          fuseChain = storedChain;
          const derived = remainingFuseChangesFromChain(windowChanges, storedChain);
          if (!derived.length) throw specialError('Fuse target has no remaining cells', 'SPECIAL_TARGET_EMPTY', 409);
          effectiveChanges = takeFuseStepChanges(derived);
          fuseRemainingAfterStep = remainingFuseStepChanges(derived);
        } else {
          effectiveChanges = deriveHazardDisarmChanges({
            cells: template.cells,
            filled: currentFilled,
            width: template.width,
            height: template.height,
            specialIndex: Number(special.cell_index),
          });
          if (!effectiveChanges.length) throw specialError('Hazard target has no remaining cells', 'SPECIAL_TARGET_EMPTY', 409);
        }
      }
      for (const change of effectiveChanges) {
        if (change.color !== -1 && change.color !== template.cells[change.index]) {
          return { badAction: true };
        }
        filled[change.index] = change.color;
      }
      const completed = isComplete(template, filled);
      const isNonProgressSpecialSkip = ['skip_spark', 'skip_fuse', 'skip_hazard'].includes(specialAction?.type);
      const nextRevision = specialAction?.type === 'skip_spark'
        || specialAction?.type === 'skip_hazard' ? clientRevision : clientRevision + 1;
      const completedAt = completed ? (existing?.completed_at || now) : null;
      // Skipping an offered special is a session decision, not meaningful
      // painting activity. Keep the previous progress timestamp so Continue
      // remains anchored to the last accepted paint/reveal commit.
      const activityAt = isNonProgressSpecialSkip && existing?.updated_at
        ? existing.updated_at
        : now;
      let artworkId = null;
      let renderArtifact = null;
      let renderStatus = null;

      if (existing) {
        const updateResult = await tx.run(
          'UPDATE coloring_progress SET filled_json=?, revision=?, completed_at=?, updated_at=? WHERE user_id=? AND template_id=? AND revision=?',
          [JSON.stringify(filled), nextRevision, completedAt, activityAt, req.userId, template.id, clientRevision],
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

      const suppressInteractiveSpecial = Boolean(specialAction?.type === 'claim_spark'
        && !isSpecialTargetEligible(specialEffort?.trigger_target));
      if (suppressInteractiveSpecial) {
        specialEffort.suppression_reason = 'trivial_trigger_target';
        specialDiscovered = null;
        await markSpecialSkippedDirect(tx, {
          userId: req.userId,
          templateId: template.id,
          specialId: specialAction.special_id,
          revision: nextRevision,
          now,
        });
      } else if (specialAction?.type === 'claim_spark') {
        const options = buildLegacySparkTargetOptions({
          cells: template.cells,
          filled,
          width: template.width,
          height: template.height,
          specialIndex: Number(special.cell_index),
          maxOptions: 1,
        });
        const defaultTarget = options[0] || null;
        if (isSpecialTargetEligible(defaultTarget)) {
          const token = createOfferToken();
          await markSparkOffered(tx, {
            userId: req.userId,
            templateId: template.id,
            specialId: specialAction.special_id,
            revision: nextRevision,
            tokenHash: token.hash,
            now,
          });
          specialOffer = {
            special_id: specialAction.special_id,
            offer_token: token.token,
            progress_revision: nextRevision,
            kind: 'spark',
            target_options: [defaultTarget],
            default_option_id: defaultTarget.option_id,
            auto_apply: true,
            interaction_cost: 0,
            target_effort: describeSpecialTargetEffort(defaultTarget),
          };
          specialEffort.selected_effect_target = describeSpecialTargetEffort(defaultTarget);
        } else {
          specialEffort.suppression_reason = 'no_eligible_effect_target';
          specialDiscovered = null;
          await markSpecialSkippedDirect(tx, {
            userId: req.userId,
            templateId: template.id,
            specialId: specialAction.special_id,
            revision: nextRevision,
            now,
          });
        }
      } else if (specialAction?.type === 'claim_bomb') {
        const token = createOfferToken();
        await markSparkOffered(tx, {
          userId: req.userId,
          templateId: template.id,
          specialId: specialAction.special_id,
          revision: nextRevision,
          tokenHash: token.hash,
          now,
        });
        const bombIndex = Number(special?.cell_index);
        specialOffer = {
          special_id: specialAction.special_id,
          offer_token: token.token,
          progress_revision: nextRevision,
          kind: actionMeta.kind,
          radius: BOMB_RADIUS,
          center_x: bombIndex % Number(template.width),
          center_y: Math.floor(bombIndex / Number(template.width)),
        };
      } else if (specialAction?.type === 'claim_fuse') {
        const token = createOfferToken();
        await markSparkOffered(tx, {
          userId: req.userId,
          templateId: template.id,
          specialId: specialAction.special_id,
          revision: nextRevision,
          tokenHash: token.hash,
          now,
        });
        const derived = deriveFuseChanges({
          cells: template.cells,
          filled: Array(template.width * template.height).fill(-1),
          width: template.width,
          height: template.height,
          specialIndex: Number(special.cell_index),
        });
        specialOffer = {
          special_id: specialAction.special_id,
          offer_token: token.token,
          progress_revision: nextRevision,
          kind: actionMeta.kind,
          steps: buildFuseOfferSteps(derived),
          disarm: true,
          chain_cells: derived.map((change) => change.index),
        };
      } else if (specialAction?.type === 'claim_hazard') {
        const token = createOfferToken();
        await markSparkOffered(tx, {
          userId: req.userId,
          templateId: template.id,
          specialId: specialAction.special_id,
          revision: nextRevision,
          tokenHash: token.hash,
          now,
        });
        const derived = deriveHazardDisarmChanges({
          cells: template.cells,
          filled,
          width: template.width,
          height: template.height,
          specialIndex: Number(special.cell_index),
        });
        specialOffer = buildHazardOffer({
          specialId: specialAction.special_id,
          offerToken: token.token,
          progressRevision: nextRevision,
          rewardCells: derived.length,
        });
      } else if (specialAction?.type === 'claim_choice') {
        const token = createOfferToken();
        await markSparkOffered(tx, {
          userId: req.userId,
          templateId: template.id,
          specialId: specialAction.special_id,
          revision: nextRevision,
          tokenHash: token.hash,
          now,
        });
        specialOffer = {
          special_id: specialAction.special_id,
          offer_token: token.token,
          progress_revision: nextRevision,
          kind: actionMeta.kind,
          choice_options: [
            { option_id: 'smart_target', label: 'Smart zone' },
            { option_id: 'local_burst', label: 'Local burst' },
          ],
        };
      } else if (specialAction?.type === 'claim_artifact') {
        await tx.run(`INSERT INTO coloring_special_progress
          (user_id,template_id,special_id,status,offer_revision,offer_token_hash,updated_at)
          VALUES (?,?,?,?,?,?,?)
          ON CONFLICT(user_id,template_id,special_id) DO UPDATE SET
            status='consumed', offer_revision=excluded.offer_revision,
            offer_token_hash=NULL, updated_at=excluded.updated_at`,
        [req.userId, template.id, specialAction.special_id, 'consumed', nextRevision, null, now]);
        const fragmentRow = await tx.get(`SELECT COUNT(*) AS count
          FROM coloring_special_progress p
          JOIN coloring_special_cells c
            ON c.template_id=p.template_id AND c.special_id=p.special_id
         WHERE p.user_id=? AND p.template_id=? AND c.kind='artifact' AND p.status='consumed'`,
        [req.userId, template.id]);
        specialDiscovered = {
          special_id: specialAction.special_id,
          kind: 'artifact',
          artifact_fragments: Math.min(3, Number(fragmentRow?.count || 0)),
          artifact_complete: Number(fragmentRow?.count || 0) >= 3,
        };
      } else if (specialAction?.type === 'use_spark' || specialAction?.type === 'use_bomb'
        || specialAction?.type === 'disarm_fuse' || specialAction?.type === 'use_choice'
        || specialAction?.type === 'disarm_hazard') {
        if (specialAction.type === 'disarm_fuse' && fuseRemainingAfterStep.length) {
          await markSparkOffered(tx, {
            userId: req.userId,
            templateId: template.id,
            specialId: specialAction.special_id,
            revision: nextRevision,
            tokenHash: hashOfferToken(specialAction.offer_token),
            now,
          });
          specialOffer = {
            special_id: specialAction.special_id,
            offer_token: specialAction.offer_token,
            progress_revision: nextRevision,
            kind: actionMeta.kind,
            steps: buildFuseOfferSteps(fuseRemainingAfterStep),
            disarm: true,
            chain_cells: fuseChain,
          };
          specialAppliedChanges = effectiveChanges.map((change) => ({ index: change.index, color: change.color }));
        } else {
          if (!await markSparkConsumed(tx, {
            userId: req.userId,
            templateId: template.id,
            specialId: specialAction.special_id,
            tokenHash: hashOfferToken(specialAction.offer_token),
            now,
          })) throw specialError(
            specialAction.type === 'use_bomb' ? 'Bomb offer is no longer available'
              : specialAction.type === 'disarm_fuse' ? 'Fuse offer is no longer available'
                : specialAction.type === 'use_choice' ? 'Choice offer is no longer available'
                  : specialAction.type === 'disarm_hazard' ? 'Hazard offer is no longer available'
                    : 'Spark offer is no longer available',
            'SPECIAL_OFFER_STALE',
            409,
          );
          specialAppliedChanges = effectiveChanges.map((change) => ({ index: change.index, color: change.color }));
        }
      }

      const wasEmpty = !existing || currentFilled.every((color) => color === -1);
      const justCompleted = completed && !existing?.completed_at;
      if (justCompleted && (/^claim_(spark|bomb|fuse|choice|hazard)$/.test(String(specialAction?.type || ''))
        || specialAction?.type === 'disarm_fuse' || specialAction?.type === 'disarm_hazard')) {
        await markSpecialConsumedDirect(tx, {
          userId: req.userId,
          templateId: template.id,
          specialId: specialAction.special_id,
          revision: nextRevision,
          now,
        });
        specialOffer = null;
      }
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
      if (justCompleted && renderStatus !== 'ready') {
        await enqueueRenderJob(tx, {
          artworkId,
          userId: req.userId,
          templateId: template.id,
          renderMode: 'legacy',
          now,
        });
      }

      const painted = effectiveChanges.some((change) => change.color !== -1);
      if (painted) await touchDailyStreak(tx, { userId: req.userId, now });

      const rewards = await rewardVerifiedPainting(tx, {
        userId: req.userId,
        template,
        previousFilled: currentFilled,
        filled,
        revision: nextRevision,
        justCompleted,
        now,
      });

      await grantPaintingAchievements(tx, {
        userId: req.userId,
        template,
        painted,
        firstPaint: Boolean(wasEmpty && painted),
        justCompleted,
        now,
      });

      await tx.run(`INSERT INTO coloring_progress_batches (user_id,template_id,client_batch_id,changes_hash,revision_before,revision_after,response_json,created_at)
        VALUES (?,?,?,?,?,?,?,?)`,
      [req.userId, template.id, clientBatchId, batchHash, clientRevision, nextRevision, JSON.stringify({
        revision: nextRevision,
        artwork_id: artworkId,
        render_status: renderStatus,
        rewards,
        special_offer: specialOffer,
        special_applied_changes: specialAppliedChanges,
        special_discovered: specialDiscovered,
        special_effort: specialEffort,
      }), now]);

      return {
        conflict: false,
        revision: nextRevision,
        completed,
        justCompleted,
        wasEmpty,
        painted,
        artworkId,
        renderStatus,
        rewards,
        specialOffer,
        specialAppliedChanges,
        specialDiscovered,
        specialEffort,
        renderArtifact,
        renderThumbnailArtifact: justCompleted ? renderCanonicalThumbnail({ width: template.width, height: template.height, palette: template.palette, cells: template.cells, filled }) : null,
      };
    });
  } catch (error) {
    if (isTiledSpecialError(error)) {
      return res.status(error.status || 400).json({ error: error.message, code: error.code });
    }
    throw error;
  }

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
      await markArtworkAndJobReady({ withTransaction: withDbTransaction }, { artworkId, now: new Date() });
      casResult.renderStatus = 'ready';
    } catch {
      await run("UPDATE artworks SET render_status='failed', updated_at=? WHERE id=?", [new Date().toISOString(), artworkId]);
      return res.status(503).json({ error: 'Результат сохранён, но медиа ещё не готово к публикации', code: 'MEDIA_RETRY_REQUIRED', artwork_id: artworkId });
    }
  }

  const legacySpecialPayload = await readLegacySparkPayload(
    { all, run, get },
    { template, userId: req.userId, progress: saved },
  );
  res.json({
    ...withSparkCohort(progressPayload(template, saved), req.userId, template),
    ...legacySpecialPayload,
    artwork_id: artworkId,
    render_status: casResult.renderStatus || null,
    idempotent: Boolean(casResult.replay),
    rewards: casResult.rewards || null,
    special_offer: casResult.specialOffer || null,
    special_applied_changes: casResult.specialAppliedChanges || [],
    special_discovered: casResult.specialDiscovered || null,
    special_effort: casResult.specialEffort || null,
    artifact_progress: await buildArtifactProgress({ get }, {
      userId: req.userId,
      templateId: template.id,
    }),
  });
}));

export default router;
