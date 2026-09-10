import { get, withDbTransaction } from '../db.js';
import { getPaymentsMode, getTelegramBotApiEnvironment, getTelegramStarsControlledConfiguration, TELEGRAM_STARS_CONTROLLED_MODE } from '../config.js';
import { createTelegramStarsService } from './telegram-stars.js';
import { createTelegramStarsBotApiAdapter } from './telegram-stars-bot-api.js';

function normalizeTelegramId(value) {
  const raw = String(value ?? '').trim().replace(/^tg_/, '');
  return /^\d{1,30}$/.test(raw) ? raw : null;
}

/**
 * Builds the only production-capable Stars runtime. The catalog resolver is
 * intentionally local to the runtime so every invoice uses current,
 * server-owned, public premium catalog data and the controlled product gate.
 */
export function createTelegramStarsRuntime({ env = process.env, dbMode = 'postgres', dbGet = get, dbWithTransaction = withDbTransaction, fetchImpl } = {}) {
  const mode = getPaymentsMode(env);
  const nodeEnv = String(env.NODE_ENV || '').trim().toLowerCase();
  const isProduction = nodeEnv === 'production';
  const botApiEnvironment = getTelegramBotApiEnvironment(env);
  const isExplicitTestRuntime = !isProduction
    && ['staging', 'test'].includes(nodeEnv)
    && botApiEnvironment === 'test';
  if (isProduction && botApiEnvironment !== 'production') {
    throw new Error('Production Telegram Stars must use TELEGRAM_BOT_API_ENVIRONMENT=production');
  }
  if (mode !== TELEGRAM_STARS_CONTROLLED_MODE || (!isProduction && !isExplicitTestRuntime)) {
    return Object.freeze({
      enabled: false,
      mode,
      config: Object.freeze({ botApiEnvironment, allowlistedUserIds: Object.freeze([]), allowlistedProductIds: Object.freeze([]) }),
      service: null,
      isAllowlistedUser: () => false,
      isAllowlistedProduct: () => false,
    });
  }

  const config = getTelegramStarsControlledConfiguration(env);
  const allowlistedUsers = new Set(config.allowlistedUserIds);
  const allowlistedProducts = new Set(config.allowlistedProductIds);
  const adapter = createTelegramStarsBotApiAdapter({ token: env.TELEGRAM_BOT_TOKEN, fetchImpl, apiEnvironment: config.botApiEnvironment });

  const productResolver = async ({ productId }) => {
    if (!allowlistedProducts.has(productId)) return null;
    return dbGet(
      `SELECT id,title,description,pack_type,price_in_stars,status,visibility,owner_id
         FROM collections
        WHERE id=? AND owner_id IS NULL AND pack_type='premium'
          AND price_in_stars>0 AND status='published' AND visibility='public'`,
      [productId],
    ).then((product) => product ? {
      ...product,
      packType: product.pack_type,
      amountXtr: Number(product.price_in_stars),
      published: product.status === 'published',
      purchasable: true,
    } : null);
  };

  const service = createTelegramStarsService({
    enabled: true,
    adapter,
    mode: dbMode,
    withTransaction: dbWithTransaction,
    productResolver,
    supportContact: config.supportContact,
    refundContact: config.refundContact,
  });

  return Object.freeze({
    enabled: true,
    mode,
    config,
    adapter,
    service,
    isAllowlistedUser(value) {
      const id = normalizeTelegramId(value);
      return Boolean(id && allowlistedUsers.has(id));
    },
    isAllowlistedProduct(value) {
      return allowlistedProducts.has(String(value ?? '').trim());
    },
    async findTelegramUserId(userId) {
      const row = await dbGet('SELECT telegram_id FROM users WHERE id=?', [userId]);
      return normalizeTelegramId(row?.telegram_id);
    },
  });
}

export { normalizeTelegramId };

export default createTelegramStarsRuntime;
