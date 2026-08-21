import { timingSafeEqual } from 'node:crypto';
import { Router } from 'express';
import { asyncRoute } from '../middleware/asyncRoute.js';
import { TelegramStarsError } from '../services/telegram-stars.js';

/**
 * Provider webhook contract. This factory is intentionally not mounted by
 * server/index.js: a production Bot API adapter, webhook secret, and release
 * gate must be supplied by a future activation change.
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

function getTelegramId(value) {
  const raw = value?.id ?? value;
  if (raw === undefined || raw === null) return undefined;
  return String(raw).replace(/^tg_/, '');
}

export function createTelegramStarsWebhookRouter({ service, webhookSecret } = {}) {
  if (!service) throw new TypeError('service is required');
  const router = Router();
  router.use(webhookGuard(webhookSecret));

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

export default createTelegramStarsWebhookRouter;
