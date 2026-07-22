import { createHmac, timingSafeEqual } from 'node:crypto';
import { get, run } from '../db.js';
import { asyncRoute } from './asyncRoute.js';

function validateTelegramInitData(initData, token) {
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  const authDate = Number(params.get('auth_date'));
  if (!hash || !authDate || Date.now() / 1000 - authDate > 86_400) return null;
  params.delete('hash');
  const dataCheckString = [...params.entries()].sort(([first], [second]) => first.localeCompare(second)).map(([key, value]) => `${key}=${value}`).join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(token).digest();
  const expected = createHmac('sha256', secret).update(dataCheckString).digest('hex');
  if (expected.length !== hash.length || !timingSafeEqual(Buffer.from(expected), Buffer.from(hash))) return null;
  try { return JSON.parse(params.get('user') || ''); } catch { return null; }
}

async function ensureTelegramUser(telegramUser) {
  const userId = `tg_${telegramUser.id}`;
  if (!await get('SELECT id FROM users WHERE id=?', [userId])) {
    const now = new Date().toISOString();
    const nickname = String(telegramUser.username || telegramUser.first_name || `User ${telegramUser.id}`).slice(0, 80);
    await run(`INSERT INTO users (id,telegram_id,nickname,avatar_url,status,karma,stars_balance,messages_disabled,followers_only,paid_open,price_in_stars,is_banned,role,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [userId, telegramUser.id, nickname, telegramUser.photo_url || null, '', 0, 0, 0, 0, 0, 10, 0, 'user', now, now]);
  }
  return userId;
}

// Telegram initData is mandatory in production. X-User-Id is intentionally development-only.
export const authMiddleware = asyncRoute(
  async function authMiddleware(req, res, next) {
    const initData = req.headers['x-telegram-init-data'];
    if (initData && process.env.TELEGRAM_BOT_TOKEN) {
      const telegramUser = validateTelegramInitData(initData, process.env.TELEGRAM_BOT_TOKEN);
      if (!telegramUser?.id) return res.status(401).json({ error: 'Invalid Telegram authorization data' });
      req.userId = await ensureTelegramUser(telegramUser);
      req.authMode = 'telegram';
      return next();
    }

    const devUserId = req.headers['x-user-id'];
    const allowDevelopmentAuth = process.env.ALLOW_DEV_AUTH === 'true';
    if (devUserId && allowDevelopmentAuth) {
      req.userId = String(devUserId);
      req.authMode = 'development';
      return next();
    }
    return res.status(401).json({ error: 'Telegram Mini Apps authorization required' });
  },
);

export const PROFANITY = ['спам', 'оскорбление', 'cheat', 'sex', 'drugs', 'buy stars', 'дурак', 'лох', 'хер'];
export const URL_RE = /https?:\/\/[^\s]+/i;
export function hasProfanity(text) { return PROFANITY.some((word) => text.toLowerCase().includes(word)); }
export function hasUrl(text) { return URL_RE.test(text); }
