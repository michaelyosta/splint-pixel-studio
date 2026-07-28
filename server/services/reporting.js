import { v4 as uuid } from 'uuid';
import { get, getDb, run, withDbTransaction } from '../db.js';

const TARGET_TYPES = new Set(['post', 'comment', 'user']);
const REASONS = new Set(['spam', 'harassment', 'sexual', 'violence', 'copyright', 'other']);
const DAILY_REPORT_LIMIT = 20;
const AUTO_HIDE_REPORTERS = 3;

export class ReportError extends Error {
  constructor(message, statusCode = 400, code = 'INVALID_REPORT') {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

export async function logModerationAction({
  actorUserId = null,
  action,
  targetType,
  targetId,
  reason = null,
  previousState = null,
  newState = null,
  metadata = {},
}) {
  await run(
    `INSERT INTO moderation_actions
      (id,actor_user_id,action,target_type,target_id,reason,previous_state,new_state,metadata_json,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [`mod_${uuid()}`, actorUserId, action, targetType, targetId, reason, previousState, newState, JSON.stringify(metadata), new Date().toISOString()],
  );
}

async function getTarget(targetType, targetId) {
  const lock = getDb().mode === 'postgres' ? ' FOR UPDATE' : '';
  if (targetType === 'post') {
    return get(`SELECT id,author_id,status FROM posts WHERE id=? AND status='active'${lock}`, [targetId]);
  }
  if (targetType === 'comment') {
    return get(`SELECT c.id,c.author_id,c.status
      FROM comments c
      JOIN posts p ON p.id=c.post_id
      WHERE c.id=? AND c.status='active' AND p.status='active'${lock}`, [targetId]);
  }
  return get(`SELECT id,status,is_banned FROM users WHERE id=?${lock}`, [targetId]);
}

export async function createReport({ reporterId, targetType, targetId, reason }) {
  const normalizedType = String(targetType || '').trim();
  const normalizedTargetId = String(targetId || '').trim();
  const normalizedReason = String(reason || 'other').trim().toLowerCase();

  if (!TARGET_TYPES.has(normalizedType) || !normalizedTargetId) {
    throw new ReportError('Unsupported report target');
  }
  if (!REASONS.has(normalizedReason) || normalizedReason.length > 32) {
    throw new ReportError('Unsupported report reason');
  }

  return withDbTransaction(async () => {
    const target = await getTarget(normalizedType, normalizedTargetId);
    if (!target) throw new ReportError('Report target not found', 404, 'TARGET_NOT_FOUND');
    if (target.author_id === reporterId || (normalizedType === 'user' && target.id === reporterId)) {
      throw new ReportError('You cannot report your own content', 400, 'SELF_REPORT');
    }

    const existing = await get(
      'SELECT id FROM reports WHERE reporter_id=? AND target_type=? AND target_id=?',
      [reporterId, normalizedType, normalizedTargetId],
    );
    if (existing) throw new ReportError('You already reported this target', 409, 'DUPLICATE_REPORT');

    const dayAgo = new Date(Date.now() - 86_400_000).toISOString();
    const daily = await get('SELECT COUNT(*) as c FROM reports WHERE reporter_id=? AND created_at>?', [reporterId, dayAgo]);
    if (Number(daily?.c || 0) >= DAILY_REPORT_LIMIT) {
      throw new ReportError('Daily report limit reached', 429, 'REPORT_LIMIT');
    }

    const now = new Date().toISOString();
    try {
      await run(
        'INSERT INTO reports (id,reporter_id,target_type,target_id,reason,status,created_at) VALUES (?,?,?,?,?,?,?)',
        [`rep_${uuid()}`, reporterId, normalizedType, normalizedTargetId, normalizedReason, 'pending', now],
      );
    } catch (error) {
      if (/unique|duplicate/i.test(error.message || '')) {
        throw new ReportError('You already reported this target', 409, 'DUPLICATE_REPORT');
      }
      throw error;
    }

    if (normalizedType === 'post') {
      const count = await get(
        "SELECT COUNT(DISTINCT reporter_id) as c FROM reports WHERE target_type='post' AND target_id=? AND status='pending'",
        [normalizedTargetId],
      );
      if (Number(count?.c || 0) >= AUTO_HIDE_REPORTERS) {
        const hidden = await run("UPDATE posts SET status='hidden', updated_at=? WHERE id=? AND status='active'", [now, normalizedTargetId]);
        if (hidden.changes > 0) {
          await logModerationAction({
            action: 'auto_hide',
            targetType: 'post',
            targetId: normalizedTargetId,
            reason: 'unique_reports_threshold',
            previousState: 'active',
            newState: 'hidden',
            metadata: { unique_reporters: Number(count.c) },
          });
        }
      }
    }

    return { success: true };
  });
}

export function sendReportError(res, error) {
  if (!(error instanceof ReportError)) throw error;
  return res.status(error.statusCode).json({ error: error.message, code: error.code });
}
