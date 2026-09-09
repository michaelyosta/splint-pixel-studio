import { TelegramStarsError } from './telegram-stars.js';

const TELEGRAM_API_BASE = 'https://api.telegram.org';
const MAX_TRANSACTIONS_PAGE = 100;

function providerFailure(message, details = undefined) {
  const error = new TelegramStarsError('PROVIDER_UNAVAILABLE', message, details);
  error.statusCode = 503;
  return error;
}

function cleanString(value, name, max = 2_000) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) {
    throw providerFailure(`Telegram Stars ${name} is invalid`);
  }
  return value.trim();
}

function normalizeTelegramUserId(value) {
  const raw = String(value ?? '').trim().replace(/^tg_/, '');
  if (!/^\d{1,30}$/.test(raw)) throw providerFailure('Telegram Stars payer id is invalid');
  const numeric = Number(raw);
  if (!Number.isSafeInteger(numeric)) throw providerFailure('Telegram Stars payer id is outside the supported range');
  return numeric;
}

function transactionSource(transaction) {
  return transaction?.source && typeof transaction.source === 'object'
    ? transaction.source
    : transaction?.receiver && typeof transaction.receiver === 'object'
      ? transaction.receiver
      : null;
}

function transactionUserId(source) {
  const value = source?.user?.id ?? source?.user_id;
  if (value === undefined || value === null) return null;
  const raw = String(value).trim();
  return /^\d{1,30}$/.test(raw) ? raw : null;
}

function transactionPayload(source) {
  return typeof source?.invoice_payload === 'string' && source.invoice_payload.trim()
    ? source.invoice_payload.trim()
    : null;
}

/**
 * Thin Telegram Bot API adapter for the XTR commerce state machine.
 *
 * The service owns all business invariants and local idempotency. Telegram's
 * Bot API does not expose a provider-side idempotency key for invoice links or
 * refunds, so the service's durable lease/request key is the retry boundary.
 */
export function createTelegramStarsBotApiAdapter({
  token,
  fetchImpl = globalThis.fetch,
  apiBase = TELEGRAM_API_BASE,
  timeoutMs = 10_000,
} = {}) {
  const botToken = cleanString(token, 'bot token', 512);
  if (typeof fetchImpl !== 'function') throw new TypeError('fetchImpl is required');
  const base = String(apiBase || TELEGRAM_API_BASE).replace(/\/$/, '');

  async function call(method, payload = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.max(1_000, Number(timeoutMs) || 10_000));
    try {
      const response = await fetchImpl(`${base}/bot${botToken}/${method}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.ok) throw providerFailure(`Telegram Bot API ${method} failed`);
      return data.result;
    } catch (error) {
      if (error instanceof TelegramStarsError) throw error;
      throw providerFailure(`Telegram Bot API ${method} unavailable`);
    } finally {
      clearTimeout(timer);
    }
  }

  async function createInvoice({ invoicePayload, productId, currency, amountXtr, title, description }) {
    if (currency !== 'XTR') throw providerFailure('Telegram Stars invoice currency is invalid');
    const payload = cleanString(invoicePayload, 'invoice payload', 128);
    const label = cleanString(title || productId, 'invoice title', 32);
    const detail = cleanString(description || `Access to ${productId}`, 'invoice description', 255);
    const amount = Number(amountXtr);
    if (!Number.isSafeInteger(amount) || amount <= 0) throw providerFailure('Telegram Stars invoice amount is invalid');
    const invoiceUrl = await call('createInvoiceLink', {
      title: label,
      description: detail,
      payload,
      provider_token: '',
      currency: 'XTR',
      prices: [{ label, amount }],
    });
    return { invoiceUrl: cleanString(invoiceUrl, 'invoice link', 2_000), providerInvoiceId: null };
  }

  async function answerPreCheckoutQuery({ queryId, ok, errorMessage }) {
    const result = await call('answerPreCheckoutQuery', {
      pre_checkout_query_id: cleanString(queryId, 'pre-checkout query id', 256),
      ok: Boolean(ok),
      ...(ok ? {} : { error_message: cleanString(errorMessage || 'Payment cannot be completed', 'pre-checkout error', 200) }),
    });
    return { ok: result === true };
  }

  async function refundStarPayment({ telegramUserId, userId, telegramPaymentChargeId, amountXtr, currency }) {
    if (currency !== 'XTR') throw providerFailure('Telegram Stars refund currency is invalid');
    const chargeId = cleanString(telegramPaymentChargeId, 'payment charge id', 256);
    const amount = Number(amountXtr);
    if (!Number.isSafeInteger(amount) || amount <= 0) throw providerFailure('Telegram Stars refund amount is invalid');
    await call('refundStarPayment', {
      user_id: normalizeTelegramUserId(telegramUserId ?? userId),
      telegram_payment_charge_id: chargeId,
    });
    // refundStarPayment is a full-refund Bot API operation and returns only a
    // boolean. A deterministic local id makes a crash/retry safe to replay.
    return {
      refundId: refundIdForCharge({ telegramPaymentChargeId: chargeId }),
      telegramPaymentChargeId: chargeId,
      amountXtr: amount,
    };
  }

  function refundIdForCharge({ telegramPaymentChargeId }) {
    const chargeId = cleanString(telegramPaymentChargeId, 'payment charge id', 256);
    return `telegram_refund:${chargeId}`;
  }

  async function listCapturedPayments() {
    const byCharge = new Map();
    let offset = 0;
    while (true) {
      const page = await call('getStarTransactions', { offset, limit: MAX_TRANSACTIONS_PAGE });
      if (!Array.isArray(page)) throw providerFailure('Telegram Stars transaction list is invalid');
      for (const transaction of page) {
        const charge = typeof transaction?.id === 'string' && transaction.id.trim() ? transaction.id.trim() : null;
        if (!charge) continue;
        const source = transactionSource(transaction);
        const payload = transactionPayload(source);
        const transactionType = String(source?.transaction_type || transaction?.transaction_type || '').trim();
        const amount = Number(transaction?.amount);
        if (!Number.isSafeInteger(amount) || amount === 0) continue;

        const current = byCharge.get(charge) || {
          telegramPaymentChargeId: charge,
          amountXtr: 0,
          refundedAmountXtr: 0,
          currency: 'XTR',
          invoicePayload: payload,
          telegramUserId: transactionUserId(source),
        };
        if (amount > 0 && (payload || transactionType === 'invoice_payment')) {
          current.amountXtr += amount;
          current.invoicePayload ||= payload;
          current.telegramUserId ||= transactionUserId(source);
        } else if (amount < 0 || transactionType === 'refund') {
          current.refundedAmountXtr += Math.abs(amount);
        }
        byCharge.set(charge, current);
      }
      if (page.length < MAX_TRANSACTIONS_PAGE) break;
      offset += page.length;
    }
    return [...byCharge.values()].filter((capture) => capture.amountXtr > 0);
  }

  async function setWebhook({ url, secretToken }) {
    const webhookUrl = cleanString(url, 'webhook URL', 2_000);
    const secret = cleanString(secretToken, 'webhook secret', 256);
    const result = await call('setWebhook', {
      url: webhookUrl,
      secret_token: secret,
      allowed_updates: ['pre_checkout_query', 'message'],
    });
    return { ok: result === true };
  }

  async function getWebhookInfo() {
    return call('getWebhookInfo');
  }

  return Object.freeze({
    providerName: 'telegram_stars_bot_api',
    supportsPartialRefund: false,
    createInvoice,
    answerPreCheckoutQuery,
    refundStarPayment,
    refundIdForCharge,
    listCapturedPayments,
    setWebhook,
    getWebhookInfo,
  });
}

export default createTelegramStarsBotApiAdapter;
