import { timingSafeEqual } from 'node:crypto';
import { Router } from 'express';
import { asyncRoute } from '../middleware/asyncRoute.js';
import { authMiddleware } from '../middleware/auth.js';
import { TelegramStarsError } from '../services/telegram-stars.js';
import { logPaymentEvent } from '../observability.js';

/**
 * Provider webhook contract. Production mounts this only when the controlled
 * Bot API runtime has validated its secret, URL, and allowlists.
 */

export function isTelegramWebhookSecret(actual, expected) {
  if (typeof actual !== 'string' || typeof expected !== 'string' || !actual || !expected) return false;
  const left = Buffer.from(actual, 'utf8');
  const right = Buffer.from(expected, 'utf8');
  return left.length === right.length && timingSafeEqual(left, right);
}

function webhookGuard(secret) {
  return (req, res, next) => {
    if (!isTelegramWebhookSecret(req.headers['x-telegram-bot-api-secret-token'], secret)) {
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
  logPaymentEvent('webhook_error', { error, code: error?.code, outcome: 'rejected' });
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
      const supportMessage = req.body?.message;
      if (supportMessage?.chat?.type === 'private'
        && /^\/paysupport(?:@[a-zA-Z0-9_]+)?(?:\s|$)/.test(supportMessage.text || '')) {
        const telegramUserId = getTelegramId(supportMessage.from);
        if (!telegramUserId || String(supportMessage.chat.id) !== telegramUserId) return res.json({ ok: true, ignored: true });
        const details = supportMessage.text.replace(/^\/paysupport(?:@[a-zA-Z0-9_]+)?\s*/, '').trim();
        let text = 'Для помощи с оплатой или возвратом отправьте /paysupport и описание проблемы одним сообщением. Не отправляйте пароли, коды или платёжные реквизиты. Сначала откройте Mini App, если ещё не делали этого.';
        if (details && Number.isSafeInteger(req.body.update_id)) {
          try {
            const result = await service.openSupportCase({ telegramUserId, category: 'payment_question',
              contact: `telegram:${telegramUserId}`, message: details.slice(0, 2000),
              idempotencyKey: `telegram-support:${req.body.update_id}` });
            text = `Обращение ${result.case.id} зарегистрировано для проверки поддержкой. Сохраните номер обращения.`;
          } catch (error) {
            if (!(error instanceof TelegramStarsError) || error.code !== 'INVALID_INPUT') throw error;
            text = 'Откройте Mini App, затем повторите /paysupport с описанием проблемы.';
          }
        }
        // Telegram supports Bot API method responses to authenticated webhooks.
        // Duplicate delivery may repeat the acknowledgement, never the case.
        return res.json({ method: 'sendMessage', chat_id: supportMessage.chat.id, text });
      }
      if (req.body?.pre_checkout_query) {
        logPaymentEvent('precheckout_received', { outcome: 'received' });
        const query = req.body.pre_checkout_query;
        const result = await service.preCheckout({
          updateId: req.body.update_id,
          preCheckoutQueryId: query.id,
          telegramUserId: getTelegramId(query.from),
          invoicePayload: query.invoice_payload,
          currency: query.currency,
          totalAmount: query.total_amount,
        });
        logPaymentEvent(result.ok ? 'precheckout_accepted' : 'precheckout_rejected', { code: result.code, outcome: result.ok ? 'accepted' : 'rejected', correlationId: result.orderId, idempotent: result.idempotent });
        if (result.idempotent) logPaymentEvent('replay', { code: result.code, correlationId: result.orderId, idempotent: true });
        return res.json(result);
      }
      if (req.body?.message?.successful_payment) {
        const message = req.body.message;
        const payment = message.successful_payment;
        const result = await service.successfulPayment({
          updateId: req.body.update_id,
          telegramUserId: getTelegramId(message.from),
          invoicePayload: payment.invoice_payload,
          currency: payment.currency,
          totalAmount: payment.total_amount,
          telegramPaymentChargeId: payment.telegram_payment_charge_id,
          providerPaymentChargeId: payment.provider_payment_charge_id,
        });
        logPaymentEvent('successful_payment', { outcome: 'persisted', correlationId: result.orderId, idempotent: result.idempotent, recoveryRequired: result.recoveryRequired });
        if (result.entitlementId && !result.idempotent) logPaymentEvent('entitlement_created', { outcome: 'active', correlationId: result.orderId });
        if (result.recoveryRequired) logPaymentEvent('recovery_required', { code: 'CAPTURE_RECOVERY_REQUIRED', correlationId: result.orderId, recoveryRequired: true });
        if (result.idempotent) logPaymentEvent('replay', { correlationId: result.orderId, idempotent: true });
        return res.json(result);
      }
      if (req.body?.message?.refunded_payment) {
        const refund = req.body.message.refunded_payment;
        // Native service messages need not identify the payer. The immutable
        // charge resolves ownership; use the same ID as refundStarPayment.
        const result = await service.recordRefund({
          updateId: req.body.update_id,
          invoicePayload: refund.invoice_payload,
          currency: refund.currency,
          amountXtr: refund.total_amount,
          telegramPaymentChargeId: refund.telegram_payment_charge_id,
          refundId: `telegram_refund:${refund.telegram_payment_charge_id}`,
        });
        if (result.idempotent) logPaymentEvent('replay', { code: 'REFUND_REPLAY', correlationId: result.orderId, idempotent: true });
        else logPaymentEvent('refund_applied', { outcome: result.status || 'applied', correlationId: result.orderId });
        return res.json(result);
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

function telegramUser(runtime, req) {
  return Boolean(
    runtime?.enabled
      && req.authMode === 'telegram',
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

  function operatorGuard(req, res) {
    if (!runtime?.enabled || req.authMode !== 'telegram' || !runtime.isAllowlistedUser?.(req.user?.telegram_id)) {
      res.status(403).json({ error: 'Telegram Stars operator access denied', code: 'PAYMENTS_OPERATOR_FORBIDDEN' });
      return false;
    }
    return true;
  }

  // Break-glass control is deliberately limited to the pre-existing owner
  // Telegram identity in the production allowlist. It avoids requiring a
  // code deploy or an unavailable Render shell, while never accepting public
  // mode through the HTTP surface.
  router.post('/ops/gate', auth, asyncRoute(async (req, res) => {
    if (!operatorGuard(req, res)) return undefined;
    const mode = req.body?.mode;
    if (!['disabled', 'controlled', 'public'].includes(mode)) return res.status(400).json({ error: 'Unsupported operator gate transition', code: 'INVALID_GATE_MODE' });
    if (mode === 'public' && req.body?.confirm_public !== 'TELEGRAM_STARS_PUBLIC') return res.status(400).json({ error: 'Public mode requires explicit confirmation', code: 'PUBLIC_CONFIRMATION_REQUIRED' });
    try {
      const current = await runtime.purchaseGate.getState();
      if (current.failClosed) return res.status(503).json({ error: 'Purchase gate state is unavailable', code: 'PAYMENTS_GATE_UNAVAILABLE' });
      if (mode === 'public') {
        if (process.env.TELEGRAM_STARS_RECONCILIATION_ENABLED === 'false') return res.status(400).json({ error: 'Public mode requires reconciliation', code: 'RECONCILIATION_REQUIRED' });
        await runtime.assertPublicActivationReady();
      }
      const next = mode === current.mode ? current : await runtime.purchaseGate.setState({
        mode,
        expectedVersion: current.version,
        reason: typeof req.body?.reason === 'string' ? req.body.reason : `operator_${mode}`,
        actor: `telegram:${req.user.telegram_id}`,
      });
      return res.json({ mode: next.mode, version: next.version, reason: next.reason });
    } catch (error) {
      if (error?.message === 'TELEGRAM_STARS_GATE_VERSION_CONFLICT') return res.status(409).json({ error: 'Purchase gate changed concurrently; retry with fresh state', code: 'PAYMENTS_GATE_VERSION_CONFLICT' });
      throw error;
    }
  }));

  router.get('/config', auth, asyncRoute(async (req, res) => {
    if (!telegramUser(runtime, req)) return res.json({ mode: 'disabled', product_ids: [] });
    return res.json(await runtime.getPurchaseConfig(req.user?.telegram_id));
  }));

  router.post('/orders', auth, asyncRoute(async (req, res) => {
    if (!ensureRuntime(runtime, res)) return undefined;
    if (!telegramUser(runtime, req)) return res.status(403).json({ error: 'Telegram Stars requires Telegram authentication', code: 'PAYMENTS_TELEGRAM_AUTH_REQUIRED' });
    const productId = typeof req.body?.product_id === 'string' ? req.body.product_id.trim() : '';
    if (!runtime.isAllowlistedProduct(productId)) return res.status(404).json({ error: 'Telegram Stars product is not available', code: 'PRODUCT_NOT_PURCHASABLE' });
    if (!await runtime.isPurchaseAllowed(req.user?.telegram_id, productId)) return res.status(403).json({ error: 'Telegram Stars purchase gate is closed', code: 'PAYMENTS_GATE_CLOSED' });
    try {
      const result = await runtime.service.createOrder({
        userId: req.userId,
        telegramUserId: req.user.telegram_id,
        productId,
        // The service ignores client pricing for non-mock providers. These
        // fields are intentionally omitted from the public contract.
        idempotencyKey: req.headers['idempotency-key'],
      });
      if (result.idempotent) logPaymentEvent('replay', { code: 'INVOICE_REPLAY', productId, correlationId: result.order?.id, idempotent: true });
      else logPaymentEvent('invoice_created', { outcome: result.order?.status || 'issued', productId, correlationId: result.order?.id });
      return res.status(result.idempotent ? 200 : 201).json(result);
    } catch (error) {
      logPaymentEvent('invoice_failed', { productId, error, code: error?.code, outcome: 'failed' });
      return providerError(error, res);
    }
  }));

  router.get('/orders/:orderId', auth, asyncRoute(async (req, res) => {
    if (!ensureRuntime(runtime, res)) return undefined;
    if (!telegramUser(runtime, req)) return res.status(403).json({ error: 'Telegram Stars requires Telegram authentication', code: 'PAYMENTS_TELEGRAM_AUTH_REQUIRED' });
    try {
      const order = await runtime.service.getOrder({ orderId: req.params.orderId, userId: req.userId, telegramUserId: req.user.telegram_id });
      return res.json({ order });
    } catch (error) {
      return providerError(error, res);
    }
  }));

  router.post('/support', auth, asyncRoute(async (req, res) => {
    if (!ensureRuntime(runtime, res)) return undefined;
    if (!telegramUser(runtime, req)) return res.status(403).json({ error: 'Telegram Stars requires Telegram authentication', code: 'PAYMENTS_TELEGRAM_AUTH_REQUIRED' });
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
