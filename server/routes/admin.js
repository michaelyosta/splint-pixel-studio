import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { all, get, withDbTransaction } from '../db.js';
import { asyncRoute } from '../middleware/asyncRoute.js';
import { authMiddleware } from '../middleware/auth.js';
import {
  ADMIN_PERMISSIONS,
  adminPermissionMiddleware,
  correlationId,
  getAdminContext,
  hasAdminPermission,
  normalizePermissionList,
  ownerOnlyMiddleware,
} from '../services/admin-acl.js';
import {
  applyDraft,
  assertDraftPermission,
  estimateDraftImpact,
  json,
  normalizeAdminChanges,
  parseJson,
  publicDraft,
  validateDraftAgainstCatalog,
  writeAudit,
} from '../services/admin-merchandising.js';

const router = Router();
const MAX_DRAFTS = 100;

function adminAsync(handler) {
  return asyncRoute(async (req, res, next) => {
    try {
      return await handler(req, res, next);
    } catch (error) {
      if (error?.code && (error.status || String(error.code).startsWith('ADMIN_'))) {
        return res.status(error.status || 400).json({ error: error.message, code: error.code, ...(error.missing ? { missing: error.missing } : {}) });
      }
      throw error;
    }
  });
}

function entityId(value) {
  const normalized = String(value || '').trim();
  if (!normalized || normalized.length > 160 || !/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(normalized)) {
    throw Object.assign(new Error('Invalid entity id'), { code: 'ADMIN_INVALID_INPUT', status: 400 });
  }
  return normalized;
}

function requireConfirm(body, message = 'Sensitive action requires explicit confirmation') {
  if (body?.confirm !== true && body?.confirm_impact !== true) throw Object.assign(new Error(message), { code: 'ADMIN_CONFIRMATION_REQUIRED', status: 400 });
}

function draftActor(req) {
  return { userId: req.admin.userId, telegramId: req.admin.telegramId, role: req.admin.role };
}

router.get('/me', authMiddleware, adminAsync(async (req, res) => {
  const admin = await getAdminContext(req.userId);
  if (!admin) return res.status(403).json({ error: 'Admin access denied', code: 'ADMIN_FORBIDDEN' });
  return res.json({ user_id: admin.userId, telegram_id: admin.telegramId, role: admin.role, permissions: admin.permissions });
}));

router.get('/catalog', authMiddleware, adminPermissionMiddleware('catalog.read'), adminAsync(async (_req, res) => {
  const [collections, albums, colorings, shelves, products, drafts] = await Promise.all([
    all(`SELECT id,title,description,pack_type,status,visibility,price_in_stars,catalog_scope,catalog_slug,catalog_theme,catalog_mood,catalog_tags_json,catalog_rank,catalog_cover_url,catalog_managed
           FROM collections WHERE catalog_scope='merchandising' ORDER BY catalog_rank,title`),
    all('SELECT id,collection_id,slug,title,description,visibility,status,cover_url,sort_rank,featured,is_new,tags_json FROM catalog_albums ORDER BY collection_id,sort_rank,title'),
    all(`SELECT id,collection_id,album_id,title,description,visibility,status,access_type,featured_rank,is_new,tags_json,season_json,audience_json
           FROM coloring_templates WHERE source_type='catalog' ORDER BY featured_rank,title LIMIT 500`),
    all('SELECT id,title,description,filter_json,status,sort_rank,cover_url FROM catalog_shelves ORDER BY sort_rank,title'),
    all(`SELECT p.product_id AS id,p.price_xtr,p.price_version,p.updated_at,c.title,c.pack_type,c.status,c.visibility
           FROM catalog_product_prices p JOIN collections c ON c.id=p.product_id ORDER BY c.title`),
    all(`SELECT id,entity_type,entity_id,status,payload_json,created_by,created_at,updated_at,previewed_at,published_at
           FROM merchandising_drafts WHERE status <> 'archived' ORDER BY updated_at DESC LIMIT ${MAX_DRAFTS}`),
  ]);
  return res.json({
    collections,
    albums: albums.map((row) => ({ ...row, tags: parseJson(row.tags_json, []) })),
    colorings: colorings.map((row) => ({ ...row, tags: parseJson(row.tags_json, []), season: parseJson(row.season_json, []), audience: parseJson(row.audience_json, []) })),
    shelves: shelves.map((row) => ({ ...row, filter: parseJson(row.filter_json, {}) })),
    products,
    drafts: drafts.map(publicDraft),
  });
}));

router.get('/audit', authMiddleware, adminPermissionMiddleware('catalog.read'), adminAsync(async (req, res) => {
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));
  const rows = await all(`SELECT id,actor_user_id,actor_telegram_id,actor_role,action,entity_type,entity_id,before_json,after_json,correlation_id,created_at
                           FROM admin_audit_log ORDER BY created_at DESC,id DESC LIMIT ${limit}`);
  return res.json(rows.map((row) => ({ ...row, before: parseJson(row.before_json, null), after: parseJson(row.after_json, null) })));
}));

router.get('/acl', authMiddleware, adminPermissionMiddleware('admin.manage'), adminAsync(async (_req, res) => {
  const rows = await all(`SELECT a.user_id,a.role,a.permissions_json,a.created_at,a.updated_at,u.telegram_id,u.nickname
                           FROM admin_acl a JOIN users u ON u.id=a.user_id ORDER BY CASE WHEN a.role='owner' THEN 0 ELSE 1 END,u.nickname`);
  return res.json(rows.map((row) => ({ user_id: row.user_id, telegram_id: row.telegram_id, nickname: row.nickname, role: row.role, permissions: row.role === 'owner' ? [...ADMIN_PERMISSIONS] : parseJson(row.permissions_json, []) })));
}));

router.get('/users', authMiddleware, ownerOnlyMiddleware(), adminAsync(async (req, res) => {
  const query = String(req.query.q || '').trim().slice(0, 80);
  const rows = await all(`SELECT id,telegram_id,nickname,role FROM users
    WHERE (?='' OR id LIKE ? OR nickname LIKE ? OR CAST(telegram_id AS TEXT) LIKE ?)
    ORDER BY nickname LIMIT 50`, [query, `%${query}%`, `%${query}%`, `%${query}%`]);
  return res.json(rows.map((row) => ({ id: row.id, telegram_id: row.telegram_id, nickname: row.nickname, app_role: row.role })));
}));

router.put('/acl/:userId', authMiddleware, ownerOnlyMiddleware(), adminAsync(async (req, res) => {
  const targetId = entityId(req.params.userId);
  const target = await get('SELECT id,telegram_id,nickname FROM users WHERE id=?', [targetId]);
  if (!target) return res.status(404).json({ error: 'User not found', code: 'ADMIN_USER_NOT_FOUND' });
  const requestedRole = req.body?.role;
  if (!['owner', 'admin'].includes(requestedRole)) return res.status(400).json({ error: 'Role must be owner or admin', code: 'ADMIN_INVALID_INPUT' });
  const permissions = requestedRole === 'owner' ? [...ADMIN_PERMISSIONS] : normalizePermissionList(req.body?.permissions);
  if (!permissions) return res.status(400).json({ error: 'Invalid permissions list', code: 'ADMIN_INVALID_INPUT' });
  if (targetId === req.admin.userId && requestedRole !== 'owner') return res.status(409).json({ error: 'The active owner cannot demote itself', code: 'ADMIN_LAST_OWNER' });
  if (requestedRole === 'admin' && permissions.includes('admin.manage') && req.admin.role !== 'owner') return res.status(403).json({ error: 'Only an owner may grant admin.manage', code: 'ADMIN_OWNER_REQUIRED' });
  requireConfirm(req.body);
  return withDbTransaction(async (tx) => {
    const before = await tx.get('SELECT * FROM admin_acl WHERE user_id=?', [targetId]);
    if (before?.role === 'owner' && requestedRole !== 'owner') {
      const count = await tx.get("SELECT COUNT(*) AS c FROM admin_acl WHERE role='owner'");
      if (Number(count?.c || 0) <= 1) throw Object.assign(new Error('Cannot remove or demote the last owner'), { code: 'ADMIN_LAST_OWNER', status: 409 });
    }
    const now = new Date().toISOString();
    await tx.run(`INSERT INTO admin_acl (user_id,role,permissions_json,created_at,updated_at)
      VALUES (?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET role=?,permissions_json=?,updated_at=?`,
    [targetId, requestedRole, JSON.stringify(permissions), now, now, requestedRole, JSON.stringify(permissions), now]);
    const after = await tx.get('SELECT * FROM admin_acl WHERE user_id=?', [targetId]);
    await writeAudit(tx, { actor: draftActor(req), action: 'acl.upsert', entityType: 'admin_acl', entityId: targetId, before: before ? { user_id: before.user_id, role: before.role, permissions: parseJson(before.permissions_json, []) } : null, after: { user_id: after.user_id, role: after.role, permissions }, correlationId: correlationId('acl') });
    return res.json({ user_id: targetId, role: requestedRole, permissions });
  });
}));

router.delete('/acl/:userId', authMiddleware, ownerOnlyMiddleware(), adminAsync(async (req, res) => {
  const targetId = entityId(req.params.userId);
  if (targetId === req.admin.userId) return res.status(409).json({ error: 'The active owner cannot remove itself', code: 'ADMIN_LAST_OWNER' });
  requireConfirm(req.body);
  return withDbTransaction(async (tx) => {
    const before = await tx.get('SELECT * FROM admin_acl WHERE user_id=?', [targetId]);
    if (!before) return res.status(404).json({ error: 'Admin ACL entry not found', code: 'ADMIN_ACL_NOT_FOUND' });
    if (before.role === 'owner') {
      const count = await tx.get("SELECT COUNT(*) AS c FROM admin_acl WHERE role='owner'");
      if (Number(count?.c || 0) <= 1) throw Object.assign(new Error('Cannot remove the last owner'), { code: 'ADMIN_LAST_OWNER', status: 409 });
    }
    await tx.run('DELETE FROM admin_acl WHERE user_id=?', [targetId]);
    await writeAudit(tx, { actor: draftActor(req), action: 'acl.remove', entityType: 'admin_acl', entityId: targetId, before: { user_id: before.user_id, role: before.role, permissions: parseJson(before.permissions_json, []) }, after: null, correlationId: correlationId('acl') });
    return res.status(204).end();
  });
}));

router.post('/drafts', authMiddleware, adminPermissionMiddleware('catalog.read'), adminAsync(async (req, res) => {
  const type = String(req.body?.entity_type || '').trim();
  const id = entityId(req.body?.entity_id);
  const changes = normalizeAdminChanges(type, req.body?.changes || {});
  const context = req.admin;
  assertDraftPermission(context, type, changes, (admin, permission) => hasAdminPermission(admin, permission));
  const draft = await withDbTransaction(async (tx) => {
    await validateDraftAgainstCatalog(tx, type, id, changes);
    const now = new Date().toISOString();
    const idValue = `merch_draft_${randomUUID()}`;
    await tx.run(`INSERT INTO merchandising_drafts
      (id,entity_type,entity_id,status,payload_json,base_version,created_by,created_at,updated_at)
      VALUES (?,?,?,'draft',?,?,?, ?,?)`, [idValue, type, id, json(changes), 0, req.admin.userId, now, now]);
    return tx.get('SELECT * FROM merchandising_drafts WHERE id=?', [idValue]);
  });
  return res.status(201).json({ draft: publicDraft(draft) });
}));

router.patch('/drafts/:draftId', authMiddleware, adminPermissionMiddleware('catalog.read'), adminAsync(async (req, res) => {
  const draftId = entityId(req.params.draftId);
  const existing = await get('SELECT * FROM merchandising_drafts WHERE id=?', [draftId]);
  if (!existing || existing.status === 'archived') return res.status(404).json({ error: 'Draft not found', code: 'ADMIN_DRAFT_NOT_FOUND' });
  const mergedInput = { ...parseJson(existing.payload_json, {}), ...(req.body?.changes || {}) };
  const changes = normalizeAdminChanges(existing.entity_type, mergedInput);
  assertDraftPermission(req.admin, existing.entity_type, changes, (admin, permission) => hasAdminPermission(admin, permission));
  const draft = await withDbTransaction(async (tx) => {
    await validateDraftAgainstCatalog(tx, existing.entity_type, existing.entity_id, changes);
    const now = new Date().toISOString();
    await tx.run("UPDATE merchandising_drafts SET status='draft',payload_json=?,updated_at=?,previewed_at=NULL WHERE id=?", [json(changes), now, draftId]);
    return tx.get('SELECT * FROM merchandising_drafts WHERE id=?', [draftId]);
  });
  return res.json({ draft: publicDraft(draft) });
}));

router.post('/drafts/:draftId/preview', authMiddleware, adminPermissionMiddleware('catalog.read'), adminAsync(async (req, res) => {
  const draftId = entityId(req.params.draftId);
  const draft = await get('SELECT * FROM merchandising_drafts WHERE id=?', [draftId]);
  if (!draft || draft.status === 'archived') return res.status(404).json({ error: 'Draft not found', code: 'ADMIN_DRAFT_NOT_FOUND' });
  const changes = normalizeAdminChanges(draft.entity_type, parseJson(draft.payload_json, {}));
  assertDraftPermission(req.admin, draft.entity_type, changes, (admin, permission) => hasAdminPermission(admin, permission));
  const response = await withDbTransaction(async (tx) => {
    await validateDraftAgainstCatalog(tx, draft.entity_type, draft.entity_id, changes);
    const impact = await estimateDraftImpact(tx, draft.entity_type, draft.entity_id, changes);
    const now = new Date().toISOString();
    await tx.run("UPDATE merchandising_drafts SET status='preview',updated_at=?,previewed_at=? WHERE id=?", [now, now, draftId]);
    return { draft: publicDraft(await tx.get('SELECT * FROM merchandising_drafts WHERE id=?', [draftId])), impact };
  });
  return res.json(response);
}));

router.post('/drafts/:draftId/publish', authMiddleware, adminPermissionMiddleware('catalog.read'), adminAsync(async (req, res) => {
  const draftId = entityId(req.params.draftId);
  requireConfirm(req.body, 'Publish requires explicit confirmation after preview');
  const result = await withDbTransaction(async (tx) => {
    const draft = await tx.get('SELECT * FROM merchandising_drafts WHERE id=?', [draftId]);
    if (!draft || draft.status === 'archived') throw Object.assign(new Error('Draft not found'), { code: 'ADMIN_DRAFT_NOT_FOUND', status: 404 });
    if (draft.status !== 'preview') throw Object.assign(new Error('Draft must be previewed before publishing'), { code: 'ADMIN_PREVIEW_REQUIRED', status: 409 });
    const changes = normalizeAdminChanges(draft.entity_type, parseJson(draft.payload_json, {}));
    assertDraftPermission(req.admin, draft.entity_type, changes, (admin, permission) => hasAdminPermission(admin, permission));
    if (['collection', 'album', 'coloring', 'shelf'].includes(draft.entity_type) && (changes.status === 'archived' || changes.visibility === 'private')) requireConfirm(req.body);
    const impact = await estimateDraftImpact(tx, draft.entity_type, draft.entity_id, changes);
    const applied = await applyDraft(tx, { entityType: draft.entity_type, entityId: draft.entity_id, changes, actor: draftActor(req) });
    await writeAudit(tx, { actor: draftActor(req), action: applied.audit.action, entityType: draft.entity_type, entityId: draft.entity_id, before: applied.before, after: applied.after, correlationId: applied.audit.correlationId });
    const now = new Date().toISOString();
    await tx.run("UPDATE merchandising_drafts SET status='published',updated_at=?,published_at=? WHERE id=? AND status='preview'", [now, now, draftId]);
    return { draft: publicDraft(await tx.get('SELECT * FROM merchandising_drafts WHERE id=?', [draftId])), impact, audit_id: applied.audit.id };
  });
  return res.json(result);
}));

export default router;
