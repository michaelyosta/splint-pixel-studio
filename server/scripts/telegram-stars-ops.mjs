import { get, initDb, closeDb, getDb } from '../db.js';
import { validateProductionConfiguration } from '../config.js';
import { createTelegramStarsRuntime } from '../services/telegram-stars-runtime.js';

function usage() {
  console.error('Usage: node scripts/telegram-stars-ops.mjs reconcile');
  console.error('   or: node scripts/telegram-stars-ops.mjs refund <order_id> [idempotency_key]');
  console.error('   or: node scripts/telegram-stars-ops.mjs webhook-info');
  console.error('   or: node scripts/telegram-stars-ops.mjs set-webhook');
}

function safeReport(report) {
  return {
    run: {
      id: report.run?.id,
      status: report.run?.status,
      provider_name: report.run?.provider_name,
      checked_count: report.run?.checked_count,
      issue_count: report.run?.issue_count,
    },
    issues: (report.issues || []).map((issue) => ({
      issue_type: issue.issue_type,
      severity: issue.severity,
      order_id: issue.order_id,
      payment_id: issue.payment_id,
    })),
  };
}

const [command, orderId, suppliedKey] = process.argv.slice(2);
if (!['reconcile', 'refund', 'webhook-info', 'set-webhook'].includes(command) || command === 'refund' && !orderId) {
  usage();
  process.exitCode = 2;
} else {
  try {
    validateProductionConfiguration(process.env);
    await initDb();
    const db = getDb();
    const runtime = createTelegramStarsRuntime({ dbMode: db.mode });
    if (!runtime.enabled) throw new Error('PAYMENTS_MODE is not telegram_stars_controlled');

    if (command === 'reconcile') {
      console.log(JSON.stringify(safeReport(await runtime.service.reconcile())));
    } else if (command === 'webhook-info') {
      const info = await runtime.adapter.getWebhookInfo();
      console.log(JSON.stringify({ url: info?.url || '', has_custom_certificate: Boolean(info?.has_custom_certificate), pending_update_count: info?.pending_update_count || 0, last_error_date: info?.last_error_date || null, last_error_message: info?.last_error_message || null }));
    } else if (command === 'set-webhook') {
      const result = await runtime.adapter.setWebhook({ url: runtime.config.webhookUrl, secretToken: runtime.config.webhookSecret });
      console.log(JSON.stringify({ ok: result.ok, webhook_url: runtime.config.webhookUrl }));
    } else {
      const payment = await get(
        `SELECT p.telegram_payment_charge_id,p.amount_xtr,p.refunded_amount_xtr,
                o.user_id,u.telegram_id
           FROM telegram_stars_payments p
           JOIN telegram_stars_orders o ON o.id=p.order_id
           JOIN users u ON u.id=o.user_id
          WHERE o.id=?`,
        [orderId],
      );
      if (!payment) throw new Error('Captured Telegram Stars payment not found for order');
      const amountXtr = Number(payment.amount_xtr) - Number(payment.refunded_amount_xtr || 0);
      if (Number(payment.refunded_amount_xtr || 0) !== 0) {
        throw new Error('The Bot API adapter supports only a full refund with no prior local refund');
      }
      const result = await runtime.service.requestRefund({
        userId: payment.user_id,
        telegramUserId: payment.telegram_id,
        telegramPaymentChargeId: payment.telegram_payment_charge_id,
        amountXtr,
        idempotencyKey: suppliedKey || `ops-refund:${orderId}:${amountXtr}`,
      });
      console.log(JSON.stringify({ ok: result.ok, status: result.status, orderId: result.orderId, paymentId: result.paymentId, refundId: result.refundId }));
    }
  } finally {
    await closeDb();
  }
}
