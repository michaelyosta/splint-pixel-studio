import { CATALOG_COLLECTION_IDS } from './catalog-merchandising.js';
import { ADMIN_PERMISSIONS, auditId, correlationId } from './admin-acl.js';

const JSON_ARRAY_FIELDS = new Set(['tags', 'season', 'audience']);
const ENTITY_TYPES = new Set(['collection', 'album', 'coloring', 'shelf', 'product']);
const VISIBILITIES = new Set(['public', 'private']);
const COLLECTION_STATUSES = new Set(['draft', 'published', 'archived']);
const CONTENT_STATUSES = new Set(['active', 'hidden', 'archived']);
const RESERVED_KEYS = new Set(['id', 'created_at', 'updated_at', 'owner_id', 'cells', 'cells_json', 'palette_json', 'original_media_key']);

function parseJson(value, fallback) {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { return fallback; }
}

function json(value) { return JSON.stringify(value); }

function boundedString(value, field, { max = 300, required = false } = {}) {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') throw Object.assign(new Error(`${field} must be a string`), { code: 'ADMIN_INVALID_INPUT', status: 400 });
  const trimmed = value.trim();
  if (required && !trimmed) throw Object.assign(new Error(`${field} is required`), { code: 'ADMIN_INVALID_INPUT', status: 400 });
  if (trimmed.length > max) throw Object.assign(new Error(`${field} is too long`), { code: 'ADMIN_INVALID_INPUT', status: 400 });
  return trimmed;
}

function integer(value, field, { min = 0, max = 100000 } = {}) {
  if (value === undefined) return undefined;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < min || number > max) throw Object.assign(new Error(`${field} must be an integer in range`), { code: 'ADMIN_INVALID_INPUT', status: 400 });
  return number;
}

function arrayOfStrings(value, field) {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > 64) throw Object.assign(new Error(`${field} must be an array`), { code: 'ADMIN_INVALID_INPUT', status: 400 });
  return [...new Set(value.map((item) => boundedString(String(item), field, { max: 80, required: true })))] ;
}

function assertKnownFields(changes, allowed) {
  for (const key of Object.keys(changes || {})) {
    if (RESERVED_KEYS.has(key) || !allowed.has(key)) {
      throw Object.assign(new Error(`Field ${key} cannot be edited`), { code: 'ADMIN_FIELD_FORBIDDEN', status: 400 });
    }
  }
}

export function normalizeAdminChanges(entityType, input = {}) {
  if (!ENTITY_TYPES.has(entityType)) throw Object.assign(new Error('Unsupported merchandising entity'), { code: 'ADMIN_INVALID_INPUT', status: 400 });
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw Object.assign(new Error('Changes must be an object'), { code: 'ADMIN_INVALID_INPUT', status: 400 });

  if (entityType === 'collection') {
    const allowed = new Set(['title', 'description', 'visibility', 'status', 'catalog_slug', 'catalog_theme', 'catalog_mood', 'catalog_tags', 'catalog_rank', 'catalog_cover_url']);
    assertKnownFields(input, allowed);
    const result = {
      ...(input.title !== undefined ? { title: boundedString(input.title, 'title', { max: 160, required: true }) } : {}),
      ...(input.description !== undefined ? { description: boundedString(input.description, 'description', { max: 2_000 }) } : {}),
      ...(input.visibility !== undefined ? { visibility: boundedString(input.visibility, 'visibility') } : {}),
      ...(input.status !== undefined ? { status: boundedString(input.status, 'status') } : {}),
      ...(input.catalog_slug !== undefined ? { catalog_slug: boundedString(input.catalog_slug, 'catalog_slug', { max: 120, required: true }) } : {}),
      ...(input.catalog_theme !== undefined ? { catalog_theme: boundedString(input.catalog_theme, 'catalog_theme', { max: 80 }) } : {}),
      ...(input.catalog_mood !== undefined ? { catalog_mood: boundedString(input.catalog_mood, 'catalog_mood', { max: 80 }) } : {}),
      ...(input.catalog_tags !== undefined ? { catalog_tags: arrayOfStrings(input.catalog_tags, 'catalog_tags') } : {}),
      ...(input.catalog_rank !== undefined ? { catalog_rank: integer(input.catalog_rank, 'catalog_rank', { max: 10000 }) } : {}),
      ...(input.catalog_cover_url !== undefined ? { catalog_cover_url: boundedString(input.catalog_cover_url, 'catalog_cover_url', { max: 2_000 }) || null } : {}),
    };
    if (result.visibility !== undefined && !VISIBILITIES.has(result.visibility)) throw Object.assign(new Error('Invalid collection visibility'), { code: 'ADMIN_INVALID_INPUT', status: 400 });
    if (result.status !== undefined && !COLLECTION_STATUSES.has(result.status)) throw Object.assign(new Error('Invalid collection status'), { code: 'ADMIN_INVALID_INPUT', status: 400 });
    return result;
  }

  if (entityType === 'album') {
    const allowed = new Set(['collection_id', 'slug', 'title', 'description', 'visibility', 'status', 'cover_url', 'sort_rank', 'featured', 'is_new', 'tags']);
    assertKnownFields(input, allowed);
    const result = {
      ...(input.collection_id !== undefined ? { collection_id: boundedString(input.collection_id, 'collection_id', { max: 120, required: true }) } : {}),
      ...(input.slug !== undefined ? { slug: boundedString(input.slug, 'slug', { max: 120, required: true }) } : {}),
      ...(input.title !== undefined ? { title: boundedString(input.title, 'title', { max: 160, required: true }) } : {}),
      ...(input.description !== undefined ? { description: boundedString(input.description, 'description', { max: 2_000 }) } : {}),
      ...(input.visibility !== undefined ? { visibility: boundedString(input.visibility, 'visibility') } : {}),
      ...(input.status !== undefined ? { status: boundedString(input.status, 'status') } : {}),
      ...(input.cover_url !== undefined ? { cover_url: boundedString(input.cover_url, 'cover_url', { max: 2_000 }) || null } : {}),
      ...(input.sort_rank !== undefined ? { sort_rank: integer(input.sort_rank, 'sort_rank', { max: 10000 }) } : {}),
      ...(input.featured !== undefined ? { featured: input.featured === true || input.featured === 1 } : {}),
      ...(input.is_new !== undefined ? { is_new: input.is_new === true || input.is_new === 1 } : {}),
      ...(input.tags !== undefined ? { tags: arrayOfStrings(input.tags, 'tags') } : {}),
    };
    if (result.visibility !== undefined && !VISIBILITIES.has(result.visibility)) throw Object.assign(new Error('Invalid album visibility'), { code: 'ADMIN_INVALID_INPUT', status: 400 });
    if (result.status !== undefined && !CONTENT_STATUSES.has(result.status)) throw Object.assign(new Error('Invalid album status'), { code: 'ADMIN_INVALID_INPUT', status: 400 });
    return result;
  }

  if (entityType === 'coloring') {
    const allowed = new Set(['collection_id', 'album_id', 'title', 'description', 'visibility', 'status', 'access_type', 'featured_rank', 'is_new', 'tags', 'season', 'audience']);
    assertKnownFields(input, allowed);
    const result = {
      ...(input.collection_id !== undefined ? { collection_id: boundedString(input.collection_id, 'collection_id', { max: 120, required: true }) } : {}),
      ...(input.album_id !== undefined ? { album_id: input.album_id === null || input.album_id === '' ? null : boundedString(input.album_id, 'album_id', { max: 120 }) } : {}),
      ...(input.title !== undefined ? { title: boundedString(input.title, 'title', { max: 160, required: true }) } : {}),
      ...(input.description !== undefined ? { description: boundedString(input.description, 'description', { max: 2_000 }) } : {}),
      ...(input.visibility !== undefined ? { visibility: boundedString(input.visibility, 'visibility') } : {}),
      ...(input.status !== undefined ? { status: boundedString(input.status, 'status') } : {}),
      ...(input.access_type !== undefined ? { access_type: boundedString(input.access_type, 'access_type') } : {}),
      ...(input.featured_rank !== undefined ? { featured_rank: integer(input.featured_rank, 'featured_rank', { max: 100000 }) } : {}),
      ...(input.is_new !== undefined ? { is_new: input.is_new === true || input.is_new === 1 } : {}),
      ...(input.tags !== undefined ? { tags: arrayOfStrings(input.tags, 'tags') } : {}),
      ...(input.season !== undefined ? { season: arrayOfStrings(input.season, 'season') } : {}),
      ...(input.audience !== undefined ? { audience: arrayOfStrings(input.audience, 'audience') } : {}),
    };
    if (result.visibility !== undefined && !VISIBILITIES.has(result.visibility)) throw Object.assign(new Error('Invalid coloring visibility'), { code: 'ADMIN_INVALID_INPUT', status: 400 });
    if (result.status !== undefined && !CONTENT_STATUSES.has(result.status)) throw Object.assign(new Error('Invalid coloring status'), { code: 'ADMIN_INVALID_INPUT', status: 400 });
    if (result.access_type !== undefined && !['free', 'premium'].includes(result.access_type)) throw Object.assign(new Error('Invalid coloring access type'), { code: 'ADMIN_INVALID_INPUT', status: 400 });
    return result;
  }

  if (entityType === 'shelf') {
    const allowed = new Set(['title', 'description', 'status', 'sort_rank', 'cover_url', 'filter']);
    assertKnownFields(input, allowed);
    const result = {
      ...(input.title !== undefined ? { title: boundedString(input.title, 'title', { max: 160, required: true }) } : {}),
      ...(input.description !== undefined ? { description: boundedString(input.description, 'description', { max: 2_000 }) } : {}),
      ...(input.status !== undefined ? { status: boundedString(input.status, 'status') } : {}),
      ...(input.sort_rank !== undefined ? { sort_rank: integer(input.sort_rank, 'sort_rank', { max: 10000 }) } : {}),
      ...(input.cover_url !== undefined ? { cover_url: boundedString(input.cover_url, 'cover_url', { max: 2_000 }) || null } : {}),
      ...(input.filter !== undefined ? { filter: input.filter } : {}),
    };
    if (result.status !== undefined && !CONTENT_STATUSES.has(result.status)) throw Object.assign(new Error('Invalid shelf status'), { code: 'ADMIN_INVALID_INPUT', status: 400 });
    if (result.filter !== undefined && (!result.filter || typeof result.filter !== 'object' || Array.isArray(result.filter))) throw Object.assign(new Error('Invalid shelf filter'), { code: 'ADMIN_INVALID_INPUT', status: 400 });
    return result;
  }

  const allowed = new Set(['price_xtr']);
  assertKnownFields(input, allowed);
  return { price_xtr: integer(input.price_xtr, 'price_xtr', { min: 1, max: 100000 }) };
}

export function permissionForDraft(entityType, changes = {}) {
  const permissions = new Set();
  if (entityType === 'product') permissions.add('pricing.write');
  else {
    permissions.add('merchandising.write');
    if (entityType === 'collection') permissions.add('collection.write');
    if (entityType === 'album') permissions.add('album.write');
    if (entityType === 'coloring' && Object.hasOwn(changes, 'access_type')) permissions.add('access.write');
  }
  return [...permissions];
}

export function assertDraftPermission(admin, entityType, changes, hasPermission) {
  const missing = permissionForDraft(entityType, changes).filter((permission) => !hasPermission(admin, permission));
  if (missing.length) throw Object.assign(new Error('Admin permission required'), { code: 'ADMIN_FORBIDDEN', status: 403, missing });
}

function safeRow(row, entityType) {
  if (!row) return null;
  if (entityType === 'collection') return {
    id: row.id, title: row.title, description: row.description || '', visibility: row.visibility,
    status: row.status, pack_type: row.pack_type, price_in_stars: Number(row.price_in_stars || 0),
    catalog_slug: row.catalog_slug, catalog_theme: row.catalog_theme, catalog_mood: row.catalog_mood,
    catalog_tags: parseJson(row.catalog_tags_json, []), catalog_rank: Number(row.catalog_rank || 0),
    catalog_cover_url: row.catalog_cover_url || null, catalog_managed: Boolean(row.catalog_managed),
  };
  if (entityType === 'album') return {
    id: row.id, collection_id: row.collection_id, slug: row.slug, title: row.title, description: row.description,
    visibility: row.visibility, status: row.status, cover_url: row.cover_url || null, sort_rank: Number(row.sort_rank),
    featured: Boolean(row.featured), is_new: Boolean(row.is_new), tags: parseJson(row.tags_json, []),
  };
  if (entityType === 'coloring') return {
    id: row.id, collection_id: row.collection_id, album_id: row.album_id, title: row.title, description: row.description,
    visibility: row.visibility, status: row.status, access_type: row.access_type, featured_rank: Number(row.featured_rank || 0),
    is_new: Boolean(row.is_new), tags: parseJson(row.tags_json, []), season: parseJson(row.season_json, []), audience: parseJson(row.audience_json, []),
  };
  if (entityType === 'shelf') return {
    id: row.id, title: row.title, description: row.description, status: row.status, sort_rank: Number(row.sort_rank),
    cover_url: row.cover_url || null, filter: parseJson(row.filter_json, {}),
  };
  return { id: row.id, price_xtr: Number(row.price_xtr), price_version: Number(row.price_version) };
}

export async function loadAdminEntity(tx, entityType, entityId) {
  if (entityType === 'collection') return tx.get('SELECT * FROM collections WHERE id=?', [entityId]);
  if (entityType === 'album') return tx.get('SELECT * FROM catalog_albums WHERE id=?', [entityId]);
  if (entityType === 'coloring') return tx.get('SELECT * FROM coloring_templates WHERE id=? AND source_type=\'catalog\'', [entityId]);
  if (entityType === 'shelf') return tx.get('SELECT * FROM catalog_shelves WHERE id=?', [entityId]);
  return tx.get('SELECT p.product_id AS id,p.price_xtr,p.price_version,c.pack_type,c.status,c.visibility FROM catalog_product_prices p JOIN collections c ON c.id=p.product_id WHERE p.product_id=?', [entityId]);
}

export async function validateDraftAgainstCatalog(tx, entityType, entityId, changes = {}) {
  const row = await loadAdminEntity(tx, entityType, entityId);
  if (!row) throw Object.assign(new Error('Merchandising entity not found'), { code: 'ADMIN_ENTITY_NOT_FOUND', status: 404 });

  if (entityType === 'collection') {
    if (!CATALOG_COLLECTION_IDS.has(entityId) && row.catalog_scope !== 'merchandising') throw Object.assign(new Error('Only merchandising collections are editable here'), { code: 'ADMIN_SCOPE_FORBIDDEN', status: 400 });
    if (changes.catalog_cover_url && !String(changes.catalog_cover_url).startsWith('/')) throw Object.assign(new Error('Cover must reference an internal asset'), { code: 'ADMIN_INVALID_COVER', status: 400 });
  }
  if (entityType === 'album') {
    const collectionId = changes.collection_id || row.collection_id;
    const collection = await tx.get('SELECT id,catalog_scope FROM collections WHERE id=?', [collectionId]);
    if (!collection || collection.catalog_scope !== 'merchandising') throw Object.assign(new Error('Album must belong to a merchandising collection'), { code: 'ADMIN_ORPHAN_ALBUM', status: 400 });
    if (changes.slug && await tx.get('SELECT id FROM catalog_albums WHERE collection_id=? AND slug=? AND id<>?', [collectionId, changes.slug, entityId])) throw Object.assign(new Error('Album slug already exists in this collection'), { code: 'ADMIN_DUPLICATE_SLUG', status: 409 });
    if (changes.cover_url && !String(changes.cover_url).startsWith('/')) throw Object.assign(new Error('Cover must reference an internal asset'), { code: 'ADMIN_INVALID_COVER', status: 400 });
  }
  if (entityType === 'coloring') {
    const collectionId = changes.collection_id === undefined ? row.collection_id : changes.collection_id;
    const albumId = changes.album_id === undefined ? row.album_id : changes.album_id;
    const collection = await tx.get('SELECT id,catalog_scope FROM collections WHERE id=?', [collectionId]);
    if (!collection || collection.catalog_scope !== 'merchandising') throw Object.assign(new Error('Coloring must belong to a merchandising collection'), { code: 'ADMIN_ORPHAN_COLORING', status: 400 });
    if (albumId !== null) {
      const album = await tx.get('SELECT id,collection_id,status FROM catalog_albums WHERE id=?', [albumId]);
      if (!album || album.collection_id !== collectionId || album.status === 'archived') throw Object.assign(new Error('Coloring album reference is invalid'), { code: 'ADMIN_BROKEN_REFERENCE', status: 400 });
    }
  }
  if (entityType === 'product') {
    if (row.pack_type !== 'premium' || row.status !== 'published' || row.visibility !== 'public') throw Object.assign(new Error('Only a published public premium product can be priced'), { code: 'ADMIN_PRODUCT_INVALID', status: 400 });
  }
  return { row, before: safeRow(row, entityType) };
}

export async function estimateDraftImpact(tx, entityType, entityId, changes = {}) {
  if (entityType === 'coloring' && (changes.access_type || changes.collection_id || changes.album_id)) {
    const row = await tx.get('SELECT collection_id,album_id,access_type FROM coloring_templates WHERE id=?', [entityId]);
    return { affected_items: 1, from: { collection_id: row?.collection_id, album_id: row?.album_id, access_type: row?.access_type }, to: { collection_id: changes.collection_id ?? row?.collection_id, album_id: changes.album_id ?? row?.album_id, access_type: changes.access_type ?? row?.access_type } };
  }
  if (entityType === 'collection') {
    const count = await tx.get("SELECT COUNT(*) AS c FROM coloring_templates WHERE collection_id=? AND status='active'", [entityId]);
    return { affected_items: Number(count?.c || 0), entity: 'collection' };
  }
  return { affected_items: 1, entity: entityType };
}

export async function applyDraft(tx, { entityType, entityId, changes, actor }) {
  const now = new Date().toISOString();
  const beforeRow = await loadAdminEntity(tx, entityType, entityId);
  const validated = await validateDraftAgainstCatalog(tx, entityType, entityId, changes);
  if (entityType === 'collection') {
    const values = {
      title: changes.title ?? beforeRow.title,
      description: changes.description ?? beforeRow.description,
      visibility: changes.visibility ?? beforeRow.visibility,
      status: changes.status ?? beforeRow.status,
      catalog_slug: changes.catalog_slug ?? beforeRow.catalog_slug,
      catalog_theme: changes.catalog_theme ?? beforeRow.catalog_theme,
      catalog_mood: changes.catalog_mood ?? beforeRow.catalog_mood,
      catalog_tags_json: json(changes.catalog_tags ?? parseJson(beforeRow.catalog_tags_json, [])),
      catalog_rank: changes.catalog_rank ?? beforeRow.catalog_rank,
      catalog_cover_url: changes.catalog_cover_url ?? beforeRow.catalog_cover_url,
    };
    await tx.run(`UPDATE collections SET title=?,description=?,visibility=?,status=?,catalog_slug=?,catalog_theme=?,catalog_mood=?,catalog_tags_json=?,catalog_rank=?,catalog_cover_url=?,catalog_managed=TRUE WHERE id=?`, [values.title, values.description, values.visibility, values.status, values.catalog_slug, values.catalog_theme, values.catalog_mood, values.catalog_tags_json, values.catalog_rank, values.catalog_cover_url, entityId]);
  } else if (entityType === 'album') {
    const values = {
      collection_id: changes.collection_id ?? beforeRow.collection_id, slug: changes.slug ?? beforeRow.slug, title: changes.title ?? beforeRow.title,
      description: changes.description ?? beforeRow.description, visibility: changes.visibility ?? beforeRow.visibility, status: changes.status ?? beforeRow.status,
      cover_url: changes.cover_url ?? beforeRow.cover_url, sort_rank: changes.sort_rank ?? beforeRow.sort_rank, featured: changes.featured ?? Boolean(beforeRow.featured),
      is_new: changes.is_new ?? Boolean(beforeRow.is_new), tags_json: json(changes.tags ?? parseJson(beforeRow.tags_json, [])),
    };
    await tx.run(`UPDATE catalog_albums SET collection_id=?,slug=?,title=?,description=?,visibility=?,status=?,cover_url=?,sort_rank=?,featured=?,is_new=?,tags_json=?,updated_at=? WHERE id=?`, [values.collection_id, values.slug, values.title, values.description, values.visibility, values.status, values.cover_url, values.sort_rank, values.featured ? 1 : 0, values.is_new ? 1 : 0, values.tags_json, now, entityId]);
    await tx.run('UPDATE coloring_templates SET album_title=? WHERE album_id=?', [values.title, entityId]);
  } else if (entityType === 'coloring') {
    const values = {
      collection_id: changes.collection_id ?? beforeRow.collection_id, album_id: changes.album_id ?? beforeRow.album_id, title: changes.title ?? beforeRow.title,
      description: changes.description ?? beforeRow.description, visibility: changes.visibility ?? beforeRow.visibility, status: changes.status ?? beforeRow.status,
      access_type: changes.access_type ?? beforeRow.access_type, featured_rank: changes.featured_rank ?? beforeRow.featured_rank, is_new: changes.is_new ?? Boolean(beforeRow.is_new),
      tags_json: json(changes.tags ?? parseJson(beforeRow.tags_json, [])), season_json: json(changes.season ?? parseJson(beforeRow.season_json, [])), audience_json: json(changes.audience ?? parseJson(beforeRow.audience_json, [])),
    };
    const album = values.album_id ? await tx.get('SELECT title FROM catalog_albums WHERE id=?', [values.album_id]) : null;
    await tx.run(`UPDATE coloring_templates SET collection_id=?,album_id=?,album_title=?,title=?,description=?,visibility=?,status=?,access_type=?,featured_rank=?,is_new=?,tags_json=?,season_json=?,audience_json=?,catalog_managed=TRUE,updated_at=? WHERE id=?`, [values.collection_id, values.album_id, album?.title || '', values.title, values.description, values.visibility, values.status, values.access_type, values.featured_rank, values.is_new ? 1 : 0, values.tags_json, values.season_json, values.audience_json, now, entityId]);
  } else if (entityType === 'shelf') {
    const values = { title: changes.title ?? beforeRow.title, description: changes.description ?? beforeRow.description, status: changes.status ?? beforeRow.status, sort_rank: changes.sort_rank ?? beforeRow.sort_rank, cover_url: changes.cover_url ?? beforeRow.cover_url, filter_json: json(changes.filter ?? parseJson(beforeRow.filter_json, {})) };
    await tx.run('UPDATE catalog_shelves SET title=?,description=?,status=?,sort_rank=?,cover_url=?,filter_json=?,updated_at=? WHERE id=?', [values.title, values.description, values.status, values.sort_rank, values.cover_url, values.filter_json, now, entityId]);
  } else {
    const nextPrice = changes.price_xtr;
    const current = await tx.get('SELECT price_version FROM catalog_product_prices WHERE product_id=?', [entityId]);
    const version = Number(current?.price_version || 0) + 1;
    await tx.run('UPDATE catalog_product_prices SET price_xtr=?,price_version=?,updated_by=?,updated_at=? WHERE product_id=?', [nextPrice, version, actor.userId, now, entityId]);
    await tx.run('UPDATE collections SET price_in_stars=?,catalog_managed=TRUE WHERE id=?', [nextPrice, entityId]);
  }
  const afterRow = await loadAdminEntity(tx, entityType, entityId);
  return { before: validated.before, after: safeRow(afterRow, entityType), audit: { id: auditId(), actor, action: 'merchandising.publish', entityType, entityId, correlationId: correlationId('merch') } };
}

export async function writeAudit(tx, { actor, action, entityType, entityId, before, after, correlationId: id }) {
  await tx.run(`INSERT INTO admin_audit_log
    (id,actor_user_id,actor_telegram_id,actor_role,action,entity_type,entity_id,before_json,after_json,correlation_id,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`, [auditId(), actor.userId, actor.telegramId ? Number(actor.telegramId) : null, actor.role, action, entityType, entityId, before ? json(before) : null, after ? json(after) : null, id || correlationId('merch'), new Date().toISOString()]);
}

export function publicDraft(row) {
  return { id: row.id, entity_type: row.entity_type, entity_id: row.entity_id, status: row.status, changes: parseJson(row.payload_json, {}), base_version: Number(row.base_version || 0), created_by: row.created_by, created_at: row.created_at, updated_at: row.updated_at, previewed_at: row.previewed_at, published_at: row.published_at };
}

export { ADMIN_PERMISSIONS, JSON_ARRAY_FIELDS, parseJson, json, safeRow };
