// server/routes/messages.js — internal credits now; Telegram Stars is a gated future mode.
import { createHash } from 'node:crypto';
import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import { all, get, withDbTransaction } from '../db.js';
import { getPaymentsMode } from '../config.js';
import { authMiddleware, hasUrl } from '../middleware/auth.js';
import { asyncRoute } from '../middleware/asyncRoute.js';
import { payMessageRequest, StarsTransactionError } from '../services/stars-transactions.js';
import { AbuseLimitError, consumeAbuseBudget, abuseLimitResponse } from '../services/abuse-limiter.js';

const router = Router();
const MAX_PAGE_SIZE = 30;

function normalizeKey(value) {
  if (value === undefined) return `server-${uuid()}`;
  if (typeof value !== 'string' || !/^[\x21-\x7e]{8,128}$/.test(value.trim())) return null;
  return value.trim();
}

function fingerprint(payload) {
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

function decodeCursor(value) {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(String(value), 'base64url').toString('utf8'));
    return parsed && typeof parsed.id === 'string' && typeof parsed.created_at === 'string' ? parsed : null;
  } catch {
    return null;
  }
}

function encodeCursor(value) {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

async function enrichRequests(rows) {
  if (!rows.length) return [];
  const ids = [...new Set(rows.flatMap((row) => [row.sender_id, row.receiver_id]))];
  const placeholders = ids.map(() => '?').join(',');
  const users = await all(`SELECT id,nickname,avatar_url FROM users WHERE id IN (${placeholders})`, ids);
  const byId = new Map(users.map((user) => [user.id, user]));
  return rows.map((row) => ({ ...row, sender: byId.get(row.sender_id) || null, receiver: byId.get(row.receiver_id) || null }));
}

async function readRequests({ userId, field, cursor, limit }) {
  const pageSize = Math.min(Math.max(Number(limit) || 20, 1), MAX_PAGE_SIZE);
  const decoded = decodeCursor(cursor);
  if (cursor && !decoded) return { error: 'Некорректный cursor' };
  const params = [userId];
  let where = `${field}=?`;
  if (decoded) {
    where += ' AND (created_at < ? OR (created_at = ? AND id < ?))';
    params.push(decoded.created_at, decoded.created_at, decoded.id);
  }
  params.push(pageSize + 1);
  const rows = await all(`SELECT * FROM message_requests WHERE ${where} ORDER BY created_at DESC, id DESC LIMIT ?`, params);
  const hasMore = rows.length > pageSize;
  const items = await enrichRequests(rows.slice(0, pageSize));
  const last = rows[pageSize - 1];
  return {
    items,
    next_cursor: hasMore && last ? encodeCursor({ created_at: last.created_at, id: last.id }) : null,
    has_more: hasMore,
  };
}

router.post('/request/create', authMiddleware, asyncRoute(async (req, res) => {
  const { receiverId, relatedPostId, text } = req.body;
  const senderId = req.userId;
  if (senderId === receiverId) return res.status(400).json({ error: 'Нельзя написать самому себе' });

  const clean = String(text || '').trim();
  if (clean.length < 1 || clean.length > 500) return res.status(400).json({ error: 'Сообщение от 1 до 500 символов' });
  if (hasUrl(clean)) return res.status(400).json({ error: 'В сообщениях запрещены ссылки' });
  const idempotencyKey = normalizeKey(req.headers['idempotency-key']);
  if (!idempotencyKey) return res.status(400).json({ error: 'Некорректный Idempotency-Key' });
  const requestFingerprint = fingerprint({ senderId, receiverId, relatedPostId: relatedPostId || null, text: clean });

  let result;
  try {
    result = await withDbTransaction(async (tx) => {
      const previous = await tx.get('SELECT * FROM message_request_dedup WHERE sender_id=? AND idempotency_key=?', [senderId, idempotencyKey]);
      if (previous) {
        if (previous.request_fingerprint !== requestFingerprint) return { keyConflict: true };
        return { id: previous.request_id, idempotent: true };
      }
      const sender = await tx.get('SELECT * FROM users WHERE id=?', [senderId]);
      const receiver = await tx.get('SELECT * FROM users WHERE id=?', [receiverId]);
      if (!sender || !receiver) return { missing: true };
      if (receiver.messages_disabled) return { disabled: true };
      if (receiver.followers_only && !await tx.get('SELECT 1 FROM follows WHERE follower_id=? AND following_id=?', [senderId, receiverId])) return { followersOnly: true };
      await consumeAbuseBudget(tx, { scope: 'message:create', actorKey: senderId, limit: 60, windowMs: 60_000 });
      const senderDaily = await tx.get("SELECT COUNT(*) AS c FROM message_requests WHERE sender_id=? AND created_at>?", [senderId, new Date(Date.now() - 86_400_000).toISOString()]);
      const receiverDaily = await tx.get("SELECT COUNT(*) AS c FROM message_requests WHERE receiver_id=? AND created_at>?", [receiverId, new Date(Date.now() - 86_400_000).toISOString()]);
      const pending = await tx.get("SELECT COUNT(*) AS c FROM message_requests WHERE sender_id=? AND status='payment_pending'", [senderId]);
      if (Number(senderDaily.c) >= 20 || Number(receiverDaily.c) >= 100 || Number(pending.c) >= 10) return { quota: true };
      const price = receiver.paid_open ? (receiver.price_in_stars || 10) : 0;
      if (price > 0 && getPaymentsMode() === 'disabled') return { paymentsDisabled: true };
      const now = new Date().toISOString();
      const id = `msg_${uuid()}`;
      await tx.run(`INSERT INTO message_requests (id,sender_id,receiver_id,related_post_id,price_in_stars,text,reply_text,status,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?)`, [id, senderId, receiverId, relatedPostId || null, price, clean, null, price > 0 ? 'payment_pending' : 'delivered', now, now]);
      await tx.run('INSERT INTO message_request_dedup (sender_id,idempotency_key,request_fingerprint,request_id,created_at) VALUES (?,?,?,?,?)', [senderId, idempotencyKey, requestFingerprint, id, now]);
      return { id, idempotent: false };
    });
  } catch (error) {
    if (error instanceof AbuseLimitError) return abuseLimitResponse(res, error);
    throw error;
  }

  if (result.keyConflict) return res.status(409).json({ error: 'Idempotency-Key уже использован для другого сообщения' });
  if (result.missing) return res.status(404).json({ error: 'Пользователь не найден' });
  if (result.disabled) return res.status(403).json({ error: 'Пользователь отключил входящие сообщения' });
  if (result.followersOnly) return res.status(403).json({ error: 'Автор принимает сообщения только от подписчиков' });
  if (result.quota) return res.status(429).json({ error: 'Лимит сообщений исчерпан' });
  if (result.paymentsDisabled) return res.status(503).json({ error: 'Платные сообщения отключены до подключения Telegram Payments', code: 'PAYMENTS_DISABLED' });
  const request = (await get('SELECT * FROM message_requests WHERE id=?', [result.id]));
  return res.status(result.idempotent ? 200 : 201).json({ ...(await enrichRequests([request]))[0], idempotent: Boolean(result.idempotent) });
}));

router.post('/request/pay', authMiddleware, asyncRoute(async (req, res) => {
  if (getPaymentsMode() === 'disabled') return res.status(503).json({ error: 'Telegram Payments отключены', code: 'PAYMENTS_DISABLED' });
  const { requestId } = req.body;
  const idempotencyKey = req.headers['idempotency-key'];
  if (!requestId || typeof requestId !== 'string') return res.status(400).json({ error: 'requestId обязателен' });
  try {
    const result = await payMessageRequest({ requestId, authenticatedUserId: req.userId, idempotencyKey });
    const request = (await enrichRequests([result.request]))[0];
    return res.json({ success: true, idempotent: result.idempotent || false, stars_balance: result.stars_balance, request });
  } catch (error) {
    if (error instanceof StarsTransactionError) return res.status(error.statusCode).json({ error: error.message, code: error.code });
    throw error;
  }
}));

router.post('/request/reply', authMiddleware, asyncRoute(async (req, res) => {
  const { requestId, replyText } = req.body;
  const clean = String(replyText || '').trim();
  if (clean.length < 1 || clean.length > 500) return res.status(400).json({ error: 'Ответ от 1 до 500 символов' });
  if (hasUrl(clean)) return res.status(400).json({ error: 'В ответах запрещены ссылки' });
  const result = await withDbTransaction(async (tx) => {
    const mr = await tx.get('SELECT * FROM message_requests WHERE id=?', [requestId]);
    if (!mr) return { missing: true };
    if (mr.receiver_id !== req.userId) return { forbidden: true };
    const updated = await tx.run("UPDATE message_requests SET reply_text=?, status='answered', updated_at=? WHERE id=? AND status='delivered'", [clean, new Date().toISOString(), requestId]);
    return updated.changes === 1 ? { ok: true } : { conflict: true };
  });
  if (result.missing) return res.status(404).json({ error: 'Запрос не найден' });
  if (result.forbidden) return res.status(403).json({ error: 'Нет прав' });
  if (result.conflict) return res.status(409).json({ error: 'Запрос уже обработан' });
  return res.json({ success: true, request: (await enrichRequests([await get('SELECT * FROM message_requests WHERE id=?', [requestId])]))[0] });
}));

router.post('/request/reject', authMiddleware, asyncRoute(async (req, res) => {
  const { requestId } = req.body;
  const result = await withDbTransaction(async (tx) => {
    const mr = await tx.get('SELECT * FROM message_requests WHERE id=?', [requestId]);
    if (!mr) return { missing: true };
    if (mr.receiver_id !== req.userId) return { forbidden: true };
    const updated = await tx.run("UPDATE message_requests SET status='rejected', updated_at=? WHERE id=? AND status='delivered'", [new Date().toISOString(), requestId]);
    return updated.changes === 1 ? { ok: true } : { conflict: true };
  });
  if (result.missing) return res.status(404).json({ error: 'Запрос не найден' });
  if (result.forbidden) return res.status(403).json({ error: 'Нет прав' });
  if (result.conflict) return res.status(409).json({ error: 'Запрос уже обработан' });
  return res.json({ success: true, request: (await enrichRequests([await get('SELECT * FROM message_requests WHERE id=?', [requestId])]))[0] });
}));

router.get('/requests/inbox', authMiddleware, asyncRoute(async (req, res) => {
  const page = await readRequests({ userId: req.userId, field: 'receiver_id', cursor: req.query.cursor, limit: req.query.limit });
  if (page.error) return res.status(400).json({ error: page.error });
  return res.json(page);
}));

router.get('/requests/outbox', authMiddleware, asyncRoute(async (req, res) => {
  const page = await readRequests({ userId: req.userId, field: 'sender_id', cursor: req.query.cursor, limit: req.query.limit });
  if (page.error) return res.status(400).json({ error: page.error });
  return res.json(page);
}));

export { decodeCursor, encodeCursor, MAX_PAGE_SIZE };
export default router;
