import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import { all, get, run } from '../db.js';
import { authMiddleware } from '../middleware/auth.js';
import { asyncRoute } from '../middleware/asyncRoute.js';

const router = Router();

function cleanText(value, maxLength) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : null;
}

function cleanImageUrl(value) {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  if (typeof value !== 'string' || value.length > 2_000) return undefined;
  const candidate = value.trim();
  if (candidate.startsWith('/assets/') || candidate.startsWith('/media/')) return candidate;
  try {
    const parsed = new URL(candidate);
    return parsed.protocol === 'https:' ? parsed.href : undefined;
  } catch {
    return undefined;
  }
}

function cleanPosition(value) {
  if (value === undefined) return undefined;
  if (!Number.isInteger(value) || value < 0 || value > 10_000) return null;
  return value;
}

function isOwner(collection, userId) {
  return collection?.owner_id === userId;
}

function publicCollection(collection) {
  return collection && collection.status === 'published' && collection.visibility === 'public';
}

function collectionPayload(collection, itemCount = 0) {
  return {
    ...collection,
    item_count: Number(itemCount || collection.item_count || 0),
    is_user_collection: Boolean(collection.owner_id),
    purchasing_available: false,
  };
}

async function getCollection(id) {
  return get('SELECT * FROM collections WHERE id=?', [id]);
}

async function getItemCount(collectionId) {
  const row = await get('SELECT COUNT(*) AS count FROM collection_items WHERE collection_id=?', [collectionId]);
  return Number(row?.count || 0);
}

async function listCollectionTemplates(collectionId, { includePrivate }) {
  const itemTemplates = await all(`SELECT t.id,t.title,t.description,t.preview_url,t.difficulty,t.est_minutes,
      t.visibility,t.source_type,t.owner_id,ci.position,ci.created_at AS item_created_at
    FROM collection_items ci
    JOIN coloring_templates t ON t.id=ci.template_id
    WHERE ci.collection_id=? AND t.status='active'
      ${includePrivate ? '' : "AND t.visibility='public'"}
    ORDER BY ci.position ASC, ci.created_at ASC, t.title ASC`, [collectionId]);

  // Editorial packs predate collection_items and still use collection_id on
  // templates. Keep them readable without a data migration.
  const legacyTemplates = await all(`SELECT t.id,t.title,t.description,t.preview_url,t.difficulty,t.est_minutes,
      t.visibility,t.source_type,t.owner_id,100000 AS position,t.added_at AS item_created_at
    FROM coloring_templates t
    WHERE t.collection_id=? AND t.status='active'
      ${includePrivate ? '' : "AND t.visibility='public'"}
    ORDER BY t.added_at DESC, t.title ASC`, [collectionId]);

  const byId = new Map();
  for (const template of [...itemTemplates, ...legacyTemplates]) {
    if (!byId.has(template.id)) byId.set(template.id, template);
  }
  return [...byId.values()];
}

async function validatePublication(collectionId, ownerId) {
  const items = await all(`SELECT t.id,t.owner_id,t.visibility,t.status
    FROM collection_items ci
    JOIN coloring_templates t ON t.id=ci.template_id
    WHERE ci.collection_id=?`, [collectionId]);
  if (!items.length) {
    return { ok: false, error: 'Добавьте хотя бы одну свою раскраску в набор', code: 'COLLECTION_EMPTY' };
  }
  const invalid = items.find((item) => (
    item.owner_id !== ownerId || item.status !== 'active' || item.visibility !== 'public'
  ));
  if (invalid) {
    return {
      ok: false,
      error: 'Для публикации все раскраски набора должны быть вашими, активными и публичными',
      code: 'COLLECTION_ITEMS_NOT_PUBLISHABLE',
    };
  }
  return { ok: true };
}

// GET /collections/mine — owner-only draft and published sets.
router.get('/mine', authMiddleware, asyncRoute(async (req, res) => {
  const collections = await all(`SELECT c.*,
      (SELECT COUNT(*) FROM collection_items ci WHERE ci.collection_id=c.id) AS item_count
    FROM collections c
    WHERE c.owner_id=? AND c.status <> 'archived'
    ORDER BY CASE c.status WHEN 'draft' THEN 0 ELSE 1 END, c.title ASC`, [req.userId]);
  res.json(collections.map((collection) => collectionPayload(collection)));
}));

// POST /collections — creates only a free private draft. Monetization fields
// are intentionally absent from this contract.
router.post('/', authMiddleware, asyncRoute(async (req, res) => {
  const title = cleanText(req.body?.title, 80);
  const description = cleanText(req.body?.description ?? '', 280);
  const imageUrl = cleanImageUrl(req.body?.image_url ?? null);
  if (!title) return res.status(400).json({ error: 'Укажите название набора', code: 'INVALID_COLLECTION_TITLE' });
  if (description === null) return res.status(400).json({ error: 'Некорректное описание набора', code: 'INVALID_COLLECTION_DESCRIPTION' });
  if (imageUrl === undefined) return res.status(400).json({ error: 'Некорректное изображение набора', code: 'INVALID_COLLECTION_IMAGE' });

  const id = `col_${uuid()}`;
  await run(`INSERT INTO collections
    (id,title,pack_type,rarity,total_artworks,price_in_stars,image_url,owner_id,status,visibility,description)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
  [id, title, 'free', 'common', 0, 0, imageUrl ?? null, req.userId, 'draft', 'private', description]);
  res.status(201).json(collectionPayload(await getCollection(id)));
}));

// GET /collections/:id — public readers receive only published public sets;
// the owner can also inspect drafts.
router.get('/:id', authMiddleware, asyncRoute(async (req, res) => {
  const collection = await getCollection(req.params.id);
  if (!collection || (!isOwner(collection, req.userId) && !publicCollection(collection))) {
    return res.status(404).json({ error: 'Набор не найден' });
  }
  const owner = isOwner(collection, req.userId);
  const templates = await listCollectionTemplates(collection.id, { includePrivate: owner });
  res.json({ ...collectionPayload(collection, templates.length), templates });
}));

// PATCH /collections/:id — keeps a creator's set as a draft until it meets
// publication rules. The API never accepts a price or a paid pack type.
router.patch('/:id', authMiddleware, asyncRoute(async (req, res) => {
  const collection = await getCollection(req.params.id);
  if (!collection) return res.status(404).json({ error: 'Набор не найден' });
  if (!isOwner(collection, req.userId)) return res.status(403).json({ error: 'Можно менять только свои наборы' });
  if (collection.status === 'archived') return res.status(409).json({ error: 'Архивный набор нельзя менять', code: 'COLLECTION_ARCHIVED' });

  const fields = [];
  const params = [];
  if (req.body?.title !== undefined) {
    const title = cleanText(req.body.title, 80);
    if (!title) return res.status(400).json({ error: 'Укажите название набора', code: 'INVALID_COLLECTION_TITLE' });
    fields.push('title=?'); params.push(title);
  }
  if (req.body?.description !== undefined) {
    const description = cleanText(req.body.description, 280);
    if (description === null) return res.status(400).json({ error: 'Некорректное описание набора', code: 'INVALID_COLLECTION_DESCRIPTION' });
    fields.push('description=?'); params.push(description);
  }
  if (req.body?.image_url !== undefined) {
    const imageUrl = cleanImageUrl(req.body.image_url);
    if (imageUrl === undefined) return res.status(400).json({ error: 'Некорректное изображение набора', code: 'INVALID_COLLECTION_IMAGE' });
    fields.push('image_url=?'); params.push(imageUrl);
  }

  const requestedStatus = req.body?.status;
  const requestedVisibility = req.body?.visibility;
  if (requestedStatus !== undefined && !['draft', 'published'].includes(requestedStatus)) {
    return res.status(400).json({ error: 'Некорректный статус набора', code: 'INVALID_COLLECTION_STATUS' });
  }
  if (requestedVisibility !== undefined && !['public', 'private'].includes(requestedVisibility)) {
    return res.status(400).json({ error: 'Некорректная видимость набора', code: 'INVALID_COLLECTION_VISIBILITY' });
  }

  const nextStatus = requestedStatus ?? collection.status;
  const nextVisibility = requestedVisibility ?? collection.visibility;
  if (nextStatus === 'published') {
    if (nextVisibility !== 'public') {
      return res.status(422).json({ error: 'Опубликованный набор должен быть публичным', code: 'COLLECTION_PUBLICATION_VISIBILITY' });
    }
    const publication = await validatePublication(collection.id, req.userId);
    if (!publication.ok) return res.status(422).json({ error: publication.error, code: publication.code });
  }
  if (requestedStatus !== undefined) { fields.push('status=?'); params.push(nextStatus); }
  if (requestedVisibility !== undefined) { fields.push('visibility=?'); params.push(nextVisibility); }
  if (!fields.length) return res.status(400).json({ error: 'Нет полей для обновления', code: 'NO_COLLECTION_CHANGES' });

  params.push(collection.id, req.userId);
  await run(`UPDATE collections SET ${fields.join(',')} WHERE id=? AND owner_id=?`, params);
  res.json(collectionPayload(await getCollection(collection.id), await getItemCount(collection.id)));
}));

// POST /collections/:id/templates — add or reposition one owned import.
router.post('/:id/templates', authMiddleware, asyncRoute(async (req, res) => {
  const collection = await getCollection(req.params.id);
  if (!collection) return res.status(404).json({ error: 'Набор не найден' });
  if (!isOwner(collection, req.userId)) return res.status(403).json({ error: 'Можно менять только свои наборы' });
  if (collection.status === 'archived') return res.status(409).json({ error: 'Архивный набор нельзя менять', code: 'COLLECTION_ARCHIVED' });

  const templateId = cleanText(req.body?.template_id, 160);
  const requestedPosition = cleanPosition(req.body?.position);
  if (!templateId) return res.status(400).json({ error: 'Укажите раскраску', code: 'INVALID_TEMPLATE_ID' });
  if (requestedPosition === null) return res.status(400).json({ error: 'Некорректная позиция', code: 'INVALID_COLLECTION_POSITION' });
  const template = await get(`SELECT id,owner_id,status,source_type FROM coloring_templates WHERE id=?`, [templateId]);
  if (!template || template.owner_id !== req.userId || template.status !== 'active' || template.source_type !== 'user') {
    return res.status(422).json({ error: 'В набор можно добавить только свою активную загруженную раскраску', code: 'COLLECTION_TEMPLATE_NOT_OWNED' });
  }
  const position = requestedPosition ?? await getItemCount(collection.id);
  await run(`INSERT INTO collection_items (collection_id,template_id,position,created_at)
    VALUES (?,?,?,?) ON CONFLICT (collection_id,template_id)
    DO UPDATE SET position=excluded.position`,
  [collection.id, template.id, position, new Date().toISOString()]);
  await run(`UPDATE collections SET total_artworks=(
    SELECT COUNT(*) FROM collection_items WHERE collection_id=?
  ) WHERE id=?`, [collection.id, collection.id]);
  res.status(201).json({ collection_id: collection.id, template_id: template.id, position });
}));

router.delete('/:id/templates/:templateId', authMiddleware, asyncRoute(async (req, res) => {
  const collection = await getCollection(req.params.id);
  if (!collection) return res.status(404).json({ error: 'Набор не найден' });
  if (!isOwner(collection, req.userId)) return res.status(403).json({ error: 'Можно менять только свои наборы' });
  if (collection.status === 'archived') return res.status(409).json({ error: 'Архивный набор нельзя менять', code: 'COLLECTION_ARCHIVED' });
  await run('DELETE FROM collection_items WHERE collection_id=? AND template_id=?', [collection.id, req.params.templateId]);
  await run(`UPDATE collections SET total_artworks=(
    SELECT COUNT(*) FROM collection_items WHERE collection_id=?
  ) WHERE id=?`, [collection.id, collection.id]);
  res.json({ collection_id: collection.id, template_id: req.params.templateId, removed: true });
}));

// DELETE is an archive operation, not a destructive delete. It does not touch
// templates or ownership records and is safe to recover through moderation.
router.delete('/:id', authMiddleware, asyncRoute(async (req, res) => {
  const collection = await getCollection(req.params.id);
  if (!collection) return res.status(404).json({ error: 'Набор не найден' });
  if (!isOwner(collection, req.userId)) return res.status(403).json({ error: 'Можно архивировать только свои наборы' });
  await run("UPDATE collections SET status='archived', visibility='private' WHERE id=? AND owner_id=?", [collection.id, req.userId]);
  res.json({ id: collection.id, status: 'archived' });
}));

export default router;
