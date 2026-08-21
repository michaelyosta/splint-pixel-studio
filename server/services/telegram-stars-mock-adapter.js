/**
 * Deterministic Telegram Stars adapter for tests and local contract checks.
 *
 * This is intentionally not a Bot API client.  It records calls and lets a
 * test inject provider-shaped captures/refunds, so the state machine can be
 * exercised without sending invoices or moving real Stars.
 */

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function assertNonEmpty(value, name) {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`${name} must be a non-empty string`);
}

export function createMockTelegramStarsAdapter(_options = {}) {
  const invoices = new Map();
  const answers = [];
  const captures = new Map();
  const refunds = new Map();
  let invoiceSequence = 0;
  let refundSequence = 0;

  const adapter = {
    providerName: 'telegram_stars_mock',

    async createInvoice(input) {
      assertNonEmpty(input?.invoicePayload, 'invoicePayload');
      const existing = invoices.get(input.invoicePayload);
      if (existing) return clone(existing);

      invoiceSequence += 1;
      const invoice = {
        providerInvoiceId: `mock_invoice_${invoiceSequence}`,
        invoiceUrl: `https://t.me/$mock_invoice_${invoiceSequence}`,
        invoicePayload: input.invoicePayload,
        currency: input.currency,
        amountXtr: input.amountXtr,
      };
      invoices.set(input.invoicePayload, invoice);
      return clone(invoice);
    },

    async answerPreCheckoutQuery(input) {
      assertNonEmpty(input?.queryId, 'queryId');
      const answer = {
        queryId: input.queryId,
        ok: Boolean(input.ok),
        errorMessage: input.errorMessage || null,
      };
      answers.push(clone(answer));
      return { ok: true };
    },

    async refundStarPayment(input) {
      assertNonEmpty(input?.telegramPaymentChargeId, 'telegramPaymentChargeId');
      const amountXtr = Number(input.amountXtr);
      if (!Number.isInteger(amountXtr) || amountXtr <= 0) throw new TypeError('amountXtr must be a positive integer');
      const key = `${input.telegramPaymentChargeId}:${amountXtr}`;
      const existing = refunds.get(key);
      if (existing) return clone(existing);

      refundSequence += 1;
      const refund = {
        refundId: `mock_refund_${refundSequence}`,
        telegramPaymentChargeId: input.telegramPaymentChargeId,
        amountXtr,
        currency: input.currency || 'XTR',
      };
      refunds.set(key, refund);
      return clone(refund);
    },

    async listCapturedPayments() {
      return [...captures.values()].map(clone);
    },

    // Test controls ----------------------------------------------------
    seedCapture(capture) {
      assertNonEmpty(capture?.telegramPaymentChargeId, 'telegramPaymentChargeId');
      captures.set(capture.telegramPaymentChargeId, clone({
        currency: 'XTR',
        ...capture,
      }));
      return clone(captures.get(capture.telegramPaymentChargeId));
    },

    seedRefund(refund) {
      assertNonEmpty(refund?.refundId, 'refundId');
      refunds.set(`seed:${refund.refundId}`, clone(refund));
      return clone(refunds.get(`seed:${refund.refundId}`));
    },

    getInvoices() {
      return [...invoices.values()].map(clone);
    },

    getAnswers() {
      return answers.map(clone);
    },

    getRefunds() {
      return [...refunds.values()].map(clone);
    },
  };

  return adapter;
}

export default createMockTelegramStarsAdapter;
