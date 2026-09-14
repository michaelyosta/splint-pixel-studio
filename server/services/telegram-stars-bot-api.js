import { TelegramStarsError } from './telegram-stars.js';

const TELEGRAM_API_BASE = 'https://api.telegram.org';
const MAX_TRANSACTIONS_PAGE = 100;
// Exhausting either bound is an unavailable scan, never a partial snapshot.
const MAX_TRANSACTION_PAGES = 100;
const TRANSACTION_SCAN_TIMEOUT_MS = 30_000;
const PRECHECKOUT_TIMEOUT_MS = 5_000;

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

function transactionUserId(source) {
  const value = source?.user?.id;
  if (value === undefined || value === null) return null;
  const raw = String(value).trim();
  return /^\d+$/.test(raw) && Number.isSafeInteger(Number(raw)) && Number(raw) > 0 ? raw : null;
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

  async function call(method, payload = {}, budgetMs = Infinity) {
    const controller = new AbortController();
    const configuredTimeout = Number(timeoutMs);
    const requestTimeout = Math.min(budgetMs, Number.isFinite(configuredTimeout) && configuredTimeout > 0 ? configuredTimeout : 10_000);
    const timer = setTimeout(() => controller.abort(), requestTimeout);
    try {
      const response = await fetchImpl(`${base}/bot${botToken}/${method}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || data?.ok !== true) throw providerFailure(`Telegram Bot API ${method} failed`);
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
    }, PRECHECKOUT_TIMEOUT_MS);
    return { ok: result === true };
  }

  async function refundStarPayment({ telegramUserId, userId, telegramPaymentChargeId, amountXtr, currency }) {
    if (currency !== 'XTR') throw providerFailure('Telegram Stars refund currency is invalid');
    const chargeId = cleanString(telegramPaymentChargeId, 'payment charge id', 256);
    const amount = Number(amountXtr);
    if (!Number.isSafeInteger(amount) || amount <= 0) throw providerFailure('Telegram Stars refund amount is invalid');
    const result = await call('refundStarPayment', {
      user_id: normalizeTelegramUserId(telegramUserId ?? userId),
      telegram_payment_charge_id: chargeId,
    });
    if (result !== true) throw providerFailure('Telegram Stars refund result is invalid');
    // refundStarPayment is a full-refund Bot API operation and returns only a
    // boolean. This local id deduplicates records, not provider requests;
    // an ambiguous response must be reconciled before a retry.
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
    // https://core.telegram.org/bots/api#startransaction
    // Refunds reuse the capture id; source/receiver establishes direction.
    const byCharge = new Map();
    const seen = new Map();
    const deadline = performance.now() + TRANSACTION_SCAN_TIMEOUT_MS;
    let offset = 0;
    for (let pageNumber = 0; pageNumber < MAX_TRANSACTION_PAGES; pageNumber += 1) {
      const remaining = deadline - performance.now();
      if (remaining <= 0) throw providerFailure('Telegram Stars transaction scan timed out');
      const result = await call('getStarTransactions', { offset, limit: MAX_TRANSACTIONS_PAGE }, remaining);
      if (performance.now() >= deadline) throw providerFailure('Telegram Stars transaction scan timed out');
      const page = result?.transactions;
      if (!Array.isArray(page) || page.length > MAX_TRANSACTIONS_PAGE) throw providerFailure('Telegram Stars transaction list is invalid');
      let added = 0;
      for (const transaction of page) {
        const charge = cleanString(transaction?.id, 'transaction id', 256);
        const incoming = transaction.source != null;
        const outgoing = transaction.receiver != null;
        const partner = incoming ? transaction.source : transaction.receiver;
        if (incoming === outgoing || !partner || typeof partner !== 'object'
          || !Number.isSafeInteger(transaction.amount) || transaction.amount <= 0
          || (transaction.nanostar_amount !== undefined && (!Number.isInteger(transaction.nanostar_amount)
            || transaction.nanostar_amount < 0 || transaction.nanostar_amount > 999_999_999))) {
          throw providerFailure('Telegram Stars transaction is invalid');
        }
        const record = { amount: transaction.amount, nano: transaction.nanostar_amount || 0,
          type: partner.type, transactionType: partner.transaction_type,
          user: transactionUserId(partner), payload: transactionPayload(partner) };
        const key = JSON.stringify([charge, incoming]);
        const fingerprint = JSON.stringify(record);
        if (seen.has(key)) {
          if (seen.get(key) !== fingerprint) throw providerFailure('Telegram Stars transaction duplicates conflict');
          continue;
        }
        seen.set(key, fingerprint);
        added += 1;
        if (partner.type !== 'user' || partner.transaction_type !== 'invoice_payment') continue;
        if (!record.user || record.nano !== 0) throw providerFailure('Telegram Stars invoice transaction is invalid');
        const current = byCharge.get(charge) || {};
        current[incoming ? 'capture' : 'refund'] = record;
        byCharge.set(charge, current);
      }
      if (page.length < MAX_TRANSACTIONS_PAGE) {
        return [...byCharge.entries()].map(([charge, { capture, refund }]) => {
          if (!capture || (refund && (refund.amount !== capture.amount || refund.user !== capture.user
            || (refund.payload && refund.payload !== capture.payload)))) {
            throw providerFailure('Telegram Stars refund transaction is ambiguous');
          }
          return { telegramPaymentChargeId: charge, amountXtr: capture.amount,
            refundedAmountXtr: refund?.amount || 0, currency: 'XTR',
            invoicePayload: capture.payload, telegramUserId: capture.user };
        });
      }
      if (!added) throw providerFailure('Telegram Stars transaction pagination made no progress');
      offset += page.length;
    }
    throw providerFailure('Telegram Stars transaction scan limit exceeded');
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
