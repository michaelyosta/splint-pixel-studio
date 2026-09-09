import { get, run } from '../db.js';

/**
 * Telegram is the account identity authority for both Mini App initData and
 * browser OIDC.  The numeric Telegram user id is the only linking key.
 */
export async function ensureTelegramUser(telegramUser) {
  const telegramId = String(telegramUser?.id ?? '').trim();
  if (!/^\d+$/.test(telegramId)) throw new Error('Verified Telegram user id is required');

  const userId = `tg_${telegramId}`;
  const now = new Date().toISOString();
  const nickname = String(
    telegramUser.username || telegramUser.preferred_username || telegramUser.first_name || telegramUser.name || `User ${telegramId}`,
  ).slice(0, 80);
  const avatarUrl = typeof (telegramUser.photo_url || telegramUser.picture) === 'string'
    ? String(telegramUser.photo_url || telegramUser.picture).slice(0, 2_000)
    : null;

  // Repair/link legacy rows by telegram_id before considering the canonical id.
  // Never link on username, display name, avatar, or any frontend-supplied id.
  const existing = await get('SELECT id FROM users WHERE telegram_id=?', [telegramId])
    || await get('SELECT id FROM users WHERE id=?', [userId]);

  if (!existing) {
    try {
      await run(`INSERT INTO users (id,telegram_id,nickname,avatar_url,status,karma,stars_balance,messages_disabled,followers_only,paid_open,price_in_stars,is_banned,role,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [userId, telegramId, nickname, avatarUrl, '', 0, 0, 0, 0, 0, 10, 0, 'user', now, now]);
      return userId;
    } catch (error) {
      // Two devices can complete the same Telegram login concurrently. The
      // unique telegram_id/id constraint is the arbiter; reuse the winner's
      // row instead of surfacing a transient duplicate-account error.
      const raced = await get('SELECT id FROM users WHERE telegram_id=?', [telegramId])
        || await get('SELECT id FROM users WHERE id=?', [userId]);
      if (!raced) throw error;
      return raced.id;
    }
  }

  await run('UPDATE users SET telegram_id=?, nickname=?, avatar_url=?, updated_at=? WHERE id=?', [telegramId, nickname, avatarUrl, now, existing.id]);
  return existing.id;
}
