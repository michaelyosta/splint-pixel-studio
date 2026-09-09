import { timingSafeEqual } from 'node:crypto';
import { Router } from 'express';
import { asyncRoute } from '../middleware/asyncRoute.js';
import { authMiddleware } from '../middleware/auth.js';
import { TelegramStarsError } from '../services/telegram-stars.js';

/**
 * Provider webhook contract. Production mounts this only when the controlled
 * Bot API runtime has validated its secret, URL, and allowlists.
 */

function sameSecret(actual, expected) {
  if (typeof actual !== 'string' || typeof expected !== 'string' || !actual || !expected) return false;
  const left = Buffer.from(actual, 'utf8');
  const right = Buffer.from(expected, 'utf8');
  return left.length === right.length && timingSafeEqual(left, right);
}

function webhookGuard(secret) {
  return (req, res, next) => {
    if (!sameSecret(req.headers['x-telegram-bot-api-secret-token'], secret)) {
      return res.status(secret ? 401 : 503).json({ error: secret ? 'Invalid Telegram payment webhook secret' : 'Telegram payment webhook is not configured', code: secret ? 'INVALID_WEBHOOK_SECRET' : 'PAYMENTS_DISABLED' });
    }
    return next();
  };
}

function providerError(error, res) {
  if (error instanceof TelegramStarsError) return res.status(error.statusCode).json({ error: error.message, code: error.code });
  throw error;
}

function webhookError(error, res) {
  if (error instanceof TelegramStarsError) {
    // Permanent provider-data errors must be acknowledged so Telegram does
    // not retry a malformed update forever. Unexpected/provider failures are
    // thrown to the app error handler and remain retryable.
    if (error.statusCode < 500) return res.status(200).json({ ok: false, error: error.message, code: error.code });
  }
  throw error;
}

function getTelegramId(value) {
  const raw = value?.id ?? value;
  if (raw === undefined || raw === null) return undefined;
  const normalized = String(raw).trim().replace(/^tg_/, '');
  return /^\d{1,30}$/.test(normalized) ? normalized : undefined;
}

export function createTelegramStarsWebhookRouter({ service, webhookSecret } = {}) {
  if (!service) throw new TypeError('service is required');
  const router = Router();
  router.use(webhookGuard(webhookSecret));

  router.post('/', asyncRoute(async (req, res) => {
    try {
      if (req.body?.pre_checkout_query) {
        const query = req.body.pre_checkout_query;
        return res.json(await service.preCheckout({
          updateId: req.body.update_id,
          preCheckoutQueryId: query.id,
          telegramUserId: getTelegramId(query.from),
          invoicePayload: query.invoice_payload,
          currency: query.currency,
          totalAmount: query.total_amount,
        }));
      }
      if (req.body?.message?.successful_payment) {
        const message = req.body.message;
        const payment = message.successful_payment;
        return res.json(await service.successfulPayment({
          updateId: req.body.update_id,
          telegramUserId: getTelegramId(message.from),
          invoicePayload: payment.invoice_payload,
          currency: payment.currency,
          totalAmount: payment.total_amount,
          telegramPaymentChargeId: payment.telegram_payment_charge_id,
          providerPaymentChargeId: payment.provider_payment_charge_id,
        }));
      }
      return res.json({ ok: true, ignored: true });
    } catch (error) {
      return webhookError(error, res);
    }
  }));

  router.post('/pre-checkout', asyncRoute(async (req, res) => {
    const query = req.body?.pre_checkout_query || req.body || {};
    try {
      const result = await service.preCheckout({
        updateId: req.body?.update_id,
        preCheckoutQueryId: query.id,
        telegramUserId: getTelegramId(query.from),
        invoicePayload: query.invoice_payload,
        currency: query.currency,
        totalAmount: query.total_amount,
      });
      return res.json(result);
    } catch (error) {
      return providerError(error, res);
    }
  }));

  router.post('/successful-payment', asyncRoute(async (req, res) => {
    const message = req.body?.message || req.body || {};
    const payment = message.successful_payment || req.body?.successful_payment || {};
    try {
      const result = await service.successfulPayment({
        updateId: req.body?.update_id,
        telegramUserId: getTelegramId(message.from || req.body?.from),
        invoicePayload: payment.invoice_payload,
        currency: payment.currency,
        totalAmount: payment.total_amount,
        telegramPaymentChargeId: payment.telegram_payment_charge_id,
        providerPaymentChargeId: payment.provider_payment_charge_id,
      });
      return res.json(result);
    } catch (error) {
      return providerError(error, res);
    }
  }));

  router.post('/refund', asyncRoute(async (req, res) => {
    const refund = req.body?.refund || req.body || {};
    try {
      const result = await service.recordRefund({
        updateId: req.body?.update_id,
        telegramUserId: getTelegramId(refund.user_id),
        invoicePayload: refund.invoice_payload,
        currency: refund.currency,
        amountXtr: refund.amount_xtr,
        telegramPaymentChargeId: refund.telegram_payment_charge_id,
        refundId: refund.refund_id,
      });
      return res.json(result);
    } catch (error) {
      return providerError(error, res);
    }
  }));

  return router;
}

function controlledUser(runtime, req) {
  return Boolean(
    runtime?.enabled
      && req.authMode === 'telegram'
      && runtime.isAllowlistedUser(req.user?.telegram_id),
  );
}

function ensureRuntime(runtime, res) {
  if (!runtime?.enabled) {
    res.status(503).json({ error: 'Telegram Stars payments are disabled', code: 'PAYMENTS_DISABLED' });
    return false;
  }
  return true;
}

/**
 * Authenticated Mini App surface. It never accepts a price, invoice URL, or
 * client payment callback as authority; it only creates server-priced orders
 * and reads the durable order state after Telegram's webhook has arrived.
 */
export function createTelegramStarsCommerceRouter({ runtime, auth = authMiddleware } = {}) {
  const router = Router();

  router.get('/config', auth, asyncRoute(async (req, res) => {
    if (!controlledUser(runtime, req)) return res.json({ mode: 'disabled', product_ids: [] });
    return res.json({ mode: runtime.mode, product_ids: runtime.config.allowlistedProductIds });
  }));

  router.post('/orders', auth, asyncRoute(async (req, res) => {
    if (!ensureRuntime(runtime, res)) return undefined;
    if (!controlledUser(runtime, req)) return res.status(403).json({ error: 'Telegram Stars is restricted to the controlled allowlist', code: 'PAYMENTS_ALLOWLIST_REQUIRED' });
    const productId = typeof req.body?.product_id === 'string' ? req.body.product_id.trim() : '';
    if (!runtime.isAllowlistedProduct(productId)) return res.status(404).json({ error: 'Telegram Stars product is not available', code: 'PRODUCT_NOT_PURCHASABLE' });
    try {
      const result = await runtime.service.createOrder({
        userId: req.userId,
        telegramUserId: req.user.telegram_id,
        productId,
        // The service ignores client pricing for non-mock providers. These
        // fields are intentionally omitted from the public contract.
        idempotencyKey: req.headers['idempotency-key'],
      });
      return res.status(result.idempotent ? 200 : 201).json(result);
    } catch (error) {
      return providerError(error, res);
    }
  }));

  router.get('/orders/:orderId', auth, asyncRoute(async (req, res) => {
    if (!ensureRuntime(runtime, res)) return undefined;
    if (!controlledUser(runtime, req)) return res.status(403).json({ error: 'Telegram Stars is restricted to the controlled allowlist', code: 'PAYMENTS_ALLOWLIST_REQUIRED' });
    try {
      const order = await runtime.service.getOrder({ orderId: req.params.orderId, userId: req.userId, telegramUserId: req.user.telegram_id });
      return res.json({ order });
    } catch (error) {
      return providerError(error, res);
    }
  }));

  router.post('/support', auth, asyncRoute(async (req, res) => {
    if (!ensureRuntime(runtime, res)) return undefined;
    if (!controlledUser(runtime, req)) return res.status(403).json({ error: 'Telegram Stars is restricted to the controlled allowlist', code: 'PAYMENTS_ALLOWLIST_REQUIRED' });
    try {
      const result = await runtime.service.openSupportCase({
        ...req.body,
        orderId: req.body?.order_id,
        telegramPaymentChargeId: req.body?.telegram_payment_charge_id,
        userId: req.userId,
        idempotencyKey: req.headers['idempotency-key'],
      });
      return res.status(result.idempotent ? 200 : 201).json(result);
    } catch (error) {
      return providerError(error, res);
    }
  }));

  return router;
}

export default createTelegramStarsWebhookRouter;
