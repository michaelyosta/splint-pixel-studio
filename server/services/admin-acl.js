import { randomUUID } from 'node:crypto';
import { get, run } from '../db.js';

export const ADMIN_PERMISSIONS = Object.freeze([
  'catalog.read',
  'catalog.write',
  'collection.write',
  'album.write',
  'merchandising.write',
  'access.write',
  'pricing.write',
  'admin.manage',
]);

const ADMIN_PERMISSION_SET = new Set(ADMIN_PERMISSIONS);
const OWNER_BOOTSTRAP_ENV = 'SPLINT_ADMIN_OWNER_TELEGRAM_ID';

function parsePermissions(value) {
  let parsed = value;
  if (typeof value === 'string') {
    try { parsed = JSON.parse(value); } catch { parsed = []; }
  }
  if (!Array.isArray(parsed)) return [];
  return [...new Set(parsed.map((permission) => String(permission).trim()).filter((permission) => ADMIN_PERMISSION_SET.has(permission)))];
}

function normalizedTelegramId(value) {
  const normalized = String(value ?? '').trim().replace(/^tg_/, '');
  return /^\d{1,30}$/.test(normalized) ? normalized : null;
}

export function permissionsForAcl(row) {
  if (!row) return [];
  if (row.role === 'owner') return [...ADMIN_PERMISSIONS];
  return parsePermissions(row.permissions_json);
}

export function hasAdminPermission(context, permission) {
  return Boolean(context?.role && permissionsForAcl(context.acl).includes(permission));
}

export async function getAdminContext(userId, { dbGet = get } = {}) {
  if (!userId) return null;
  const row = await dbGet(
    `SELECT a.user_id,a.role,a.permissions_json,u.telegram_id,u.nickname
       FROM admin_acl a JOIN users u ON u.id=a.user_id
      WHERE a.user_id=? AND u.is_banned=0`,
    [String(userId)],
  );
  if (!row || !['owner', 'admin'].includes(row.role)) return null;
  return {
    userId: row.user_id,
    telegramId: normalizedTelegramId(row.telegram_id),
    nickname: row.nickname,
    role: row.role,
    acl: row,
    permissions: permissionsForAcl(row),
  };
}

export function adminPermissionMiddleware(permission) {
  return async (req, res, next) => {
    try {
      const context = await getAdminContext(req.userId);
      if (!context || !hasAdminPermission(context, permission)) {
        return res.status(403).json({ error: 'Admin permission required', code: 'ADMIN_FORBIDDEN' });
      }
      req.admin = context;
      return next();
    } catch (error) {
      return next(error);
    }
  };
}

export function ownerOnlyMiddleware() {
  return async (req, res, next) => {
    try {
      const context = await getAdminContext(req.userId);
      if (!context || context.role !== 'owner') {
        return res.status(403).json({ error: 'Owner permission required', code: 'ADMIN_OWNER_REQUIRED' });
      }
      req.admin = context;
      return next();
    } catch (error) {
      return next(error);
    }
  };
}

export function normalizePermissionList(value) {
  if (!Array.isArray(value)) return null;
  const permissions = parsePermissions(value);
  if (permissions.length !== value.length || new Set(value.map((item) => String(item).trim())).size !== permissions.length) return null;
  return permissions;
}

export async function ensureConfiguredAdminOwner({ userId, telegramId, dbGet = get, dbRun = run } = {}) {
  const configured = normalizedTelegramId(process.env[OWNER_BOOTSTRAP_ENV]);
  const candidate = normalizedTelegramId(telegramId);
  if (!configured || !candidate || configured !== candidate || !userId) return false;
  const existing = await dbGet('SELECT user_id,role FROM admin_acl WHERE user_id=?', [userId]);
  const now = new Date().toISOString();
  if (!existing) {
    await dbRun(
      `INSERT INTO admin_acl (user_id,role,permissions_json,created_at,updated_at)
       VALUES (?,?,?,?,?)`,
      [userId, 'owner', JSON.stringify(ADMIN_PERMISSIONS), now, now],
    );
  } else if (existing.role !== 'owner') {
    await dbRun('UPDATE admin_acl SET role=?,permissions_json=?,updated_at=? WHERE user_id=?', ['owner', JSON.stringify(ADMIN_PERMISSIONS), now, userId]);
  }
  return true;
}

export function auditId() {
  return `admin_audit_${randomUUID()}`;
}

export function correlationId(prefix = 'admin') {
  return `${prefix}_${randomUUID()}`;
}

export { normalizedTelegramId, parsePermissions, ADMIN_PERMISSION_SET };
