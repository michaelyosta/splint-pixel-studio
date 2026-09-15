import { get, withDbTransaction } from '../db.js';
import { getPaymentsMode, getTelegramStarsControlledConfiguration, TELEGRAM_STARS_CONTROLLED_MODE } from '../config.js';
import { createTelegramStarsService } from './telegram-stars.js';
import { createTelegramStarsBotApiAdapter } from './telegram-stars-bot-api.js';
import { createTelegramStarsPurchaseGate } from './telegram-stars-purchase-gate.js';
import { logPaymentEvent } from '../observability.js';

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
  const isProduction = String(env.NODE_ENV || '').trim().toLowerCase() === 'production';
  if (mode !== TELEGRAM_STARS_CONTROLLED_MODE || !isProduction) {
    return Object.freeze({
      enabled: false,
      mode,
      config: Object.freeze({ allowlistedUserIds: Object.freeze([]), allowlistedProductIds: Object.freeze([]) }),
      service: null,
      isAllowlistedUser: () => false,
      isAllowlistedProduct: () => false,
    });
  }

  const config = getTelegramStarsControlledConfiguration(env);
  const allowlistedUsers = new Set(config.allowlistedUserIds);
  const allowlistedProducts = new Set(config.allowlistedProductIds);
  const adapter = createTelegramStarsBotApiAdapter({ token: env.TELEGRAM_BOT_TOKEN, fetchImpl });
  const purchaseGate = createTelegramStarsPurchaseGate({
    dbGet,
    withTransaction: dbWithTransaction,
    dbMode,
    allowlistedUserIds: config.allowlistedUserIds,
    allowlistedProductIds: config.allowlistedProductIds,
  });

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
    purchaseGuard: async ({ userId, productId }) => (await purchaseGate.getAccess({ telegramUserId: userId, productId })).allowed,
    onCritical: async (event) => {
      const normalizedEvent = String(event || 'PAYMENT_CRITICAL');
      try {
        await purchaseGate.stop(`automatic_${normalizedEvent.toLowerCase()}`);
        logPaymentEvent('recovery_required', { outcome: 'purchase_gate_disabled', code: normalizedEvent, recoveryRequired: true });
      } catch (error) {
        logPaymentEvent('recovery_required', { outcome: 'purchase_gate_disable_failed', code: normalizedEvent, error, recoveryRequired: true });
        throw error;
      }
    },
  });

  async function reconcileAndProtect() {
    try {
      const report = await service.reconcile();
      const criticalIssues = report.issues.filter((issue) => issue.severity === 'critical');
      if (criticalIssues.length > 0) {
        await purchaseGate.stop('automatic_reconciliation_critical');
        logPaymentEvent('reconciliation_failed', {
          outcome: 'purchase_gate_disabled',
          code: 'CRITICAL_RECONCILIATION_ISSUE',
          issueCount: criticalIssues.length,
          recoveryRequired: true,
        });
      } else {
        logPaymentEvent('reconciliation_completed', { outcome: 'completed', issueCount: report.issues.length });
      }
      return report;
    } catch (error) {
      let outcome = 'purchase_gate_disabled';
      try { await purchaseGate.stop('automatic_reconciliation_failure'); } catch { outcome = 'purchase_gate_disable_failed'; }
      logPaymentEvent('reconciliation_failed', { outcome, error, recoveryRequired: true });
      throw error;
    }
  }

  return Object.freeze({
    enabled: true,
    mode,
    config,
    adapter,
    service,
    reconcileAndProtect,
    purchaseGate,
    isAllowlistedUser(value) {
      const id = normalizeTelegramId(value);
      return Boolean(id && allowlistedUsers.has(id));
    },
    isAllowlistedProduct(value) {
      return allowlistedProducts.has(String(value ?? '').trim());
    },
    async getPurchaseConfig(value) {
      const state = await purchaseGate.getState();
      const id = normalizeTelegramId(value);
      const controlledAllowed = Boolean(id && allowlistedUsers.has(id));
      const clientMode = state.mode === 'public' && id
        ? 'telegram_stars'
        : state.mode === 'controlled' && controlledAllowed ? TELEGRAM_STARS_CONTROLLED_MODE : 'disabled';
      return { mode: clientMode, product_ids: clientMode === 'disabled' ? [] : config.allowlistedProductIds, gate_version: state.version };
    },
    async isPurchaseAllowed(value, productId) {
      return (await purchaseGate.getAccess({ telegramUserId: value, productId })).allowed;
    },
    async findTelegramUserId(userId) {
      const row = await dbGet('SELECT telegram_id FROM users WHERE id=?', [userId]);
      return normalizeTelegramId(row?.telegram_id);
    },
  });
}

export { normalizeTelegramId };

export default createTelegramStarsRuntime;
