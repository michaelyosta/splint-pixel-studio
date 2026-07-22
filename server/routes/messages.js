// server/routes/messages.js — paid message requests via Stars
import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import { get, all, run } from '../db.js';
import { authMiddleware, hasUrl } from '../middleware/auth.js';
import { asyncRoute } from '../middleware/asyncRoute.js';
import { payMessageRequest, StarsTransactionError } from '../services/stars-transactions.js';

const router = Router();

async function enrichReq(mr) {
  const sender   = await get('SELECT id,nickname,avatar_url FROM users WHERE id=?', [mr.sender_id]);
  const receiver = await get('SELECT id,nickname,avatar_url FROM users WHERE id=?', [mr.receiver_id]);
  return { ...mr, sender, receiver };
}

// POST /messages/request/create
router.post('/request/create', authMiddleware, asyncRoute(async (req, res) => {
  const { receiverId, relatedPostId, text } = req.body;
  const senderId = req.userId;

  if (senderId === receiverId) return res.status(400).json({ error: 'Нельзя написать самому себе' });

  const sender   = await get('SELECT * FROM users WHERE id=?', [senderId]);
  const receiver = await get('SELECT * FROM users WHERE id=?', [receiverId]);
  if (!sender || !receiver) return res.status(404).json({ error: 'Пользователь не найден' });

  if (receiver.messages_disabled) return res.status(403).json({ error: 'Пользователь отключил входящие сообщения' });

  if (receiver.followers_only) {
    const isFollowing = await get('SELECT 1 FROM follows WHERE follower_id=? AND following_id=?', [senderId, receiverId]);
    if (!isFollowing) return res.status(403).json({ error: 'Автор принимает сообщения только от подписчиков' });
  }

  const clean = (text || '').trim();
  if (clean.length < 1 || clean.length > 500) return res.status(400).json({ error: 'Сообщение от 1 до 500 символов' });
  if (hasUrl(clean)) return res.status(400).json({ error: 'В сообщениях запрещены ссылки' });

  const price = receiver.paid_open ? (receiver.price_in_stars || 10) : 0;
  if (price > 0 && sender.stars_balance < price) return res.status(402).json({ error: 'Недостаточно Telegram Stars' });

  const now = new Date().toISOString();
  const id  = `msg_${uuid()}`;
  const status = price > 0 ? 'payment_pending' : 'delivered';

  await run(`INSERT INTO message_requests (id,sender_id,receiver_id,related_post_id,price_in_stars,text,reply_text,status,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [id, senderId, receiverId, relatedPostId || null, price, clean, null, status, now, now]);

  const mr = await get('SELECT * FROM message_requests WHERE id=?', [id]);
  res.status(201).json(await enrichReq(mr));
}));

// POST /messages/request/pay
router.post('/request/pay', authMiddleware, asyncRoute(async (req, res) => {
  const { requestId } = req.body;
  const idempotencyKey = req.headers['idempotency-key'];

  if (!requestId || typeof requestId !== 'string') {
    return res.status(400).json({ error: 'requestId обязателен' });
  }

  try {
    const result = await payMessageRequest({
      requestId,
      authenticatedUserId: req.userId,
      idempotencyKey,
    });

    const enrichedRequest = await enrichReq(result.request);

    return res.json({
      success: true,
      idempotent: result.idempotent || false,
      stars_balance: result.stars_balance,
      request: enrichedRequest,
    });
  } catch (error) {
    if (error instanceof StarsTransactionError) {
      return res.status(error.statusCode).json({ error: error.message, code: error.code });
    }
    throw error;
  }
}));

// POST /messages/request/reply
router.post('/request/reply', authMiddleware, asyncRoute(async (req, res) => {
  const { requestId, replyText } = req.body;
  const mr = await get('SELECT * FROM message_requests WHERE id=?', [requestId]);
  if (!mr) return res.status(404).json({ error: 'Запрос не найден' });
  if (mr.receiver_id !== req.userId) return res.status(403).json({ error: 'Нет прав' });
  if (mr.status !== 'delivered') return res.status(400).json({ error: 'Запрос не в статусе delivered' });

  const clean = (replyText || '').trim();
  if (clean.length < 1 || clean.length > 500) return res.status(400).json({ error: 'Ответ от 1 до 500 символов' });
  if (hasUrl(clean)) return res.status(400).json({ error: 'В ответах запрещены ссылки' });

  const now = new Date().toISOString();
  await run("UPDATE message_requests SET reply_text=?, status='answered', updated_at=? WHERE id=?", [clean, now, requestId]);
  const updated = await get('SELECT * FROM message_requests WHERE id=?', [requestId]);
  res.json({ success: true, request: await enrichReq(updated) });
}));

// POST /messages/request/reject
router.post('/request/reject', authMiddleware, asyncRoute(async (req, res) => {
  const { requestId } = req.body;
  const mr = await get('SELECT * FROM message_requests WHERE id=?', [requestId]);
  if (!mr) return res.status(404).json({ error: 'Запрос не найден' });
  if (mr.receiver_id !== req.userId) return res.status(403).json({ error: 'Нет прав' });
  if (mr.status !== 'delivered') return res.status(400).json({ error: 'Запрос уже обработан' });

  await run("UPDATE message_requests SET status='rejected', updated_at=? WHERE id=?", [new Date().toISOString(), requestId]);
  const updated = await get('SELECT * FROM message_requests WHERE id=?', [requestId]);
  res.json({ success: true, request: await enrichReq(updated) });
}));

// GET /messages/requests/inbox
router.get('/requests/inbox', authMiddleware, asyncRoute(async (req, res) => {
  const rows = await all('SELECT * FROM message_requests WHERE receiver_id=? ORDER BY created_at DESC', [req.userId]);
  res.json(await Promise.all(rows.map(enrichReq)));
}));

// GET /messages/requests/outbox
router.get('/requests/outbox', authMiddleware, asyncRoute(async (req, res) => {
  const rows = await all('SELECT * FROM message_requests WHERE sender_id=? ORDER BY created_at DESC', [req.userId]);
  res.json(await Promise.all(rows.map(enrichReq)));
}));

export default router;
