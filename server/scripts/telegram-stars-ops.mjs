import { get, initDb, closeDb, getDb } from '../db.js';
import { validateProductionConfiguration } from '../config.js';
import { createTelegramStarsRuntime } from '../services/telegram-stars-runtime.js';

function usage() {
  console.error('Usage: node scripts/telegram-stars-ops.mjs reconcile');
  console.error('   or: node scripts/telegram-stars-ops.mjs refund <order_id> [idempotency_key]');
  console.error('   or: node scripts/telegram-stars-ops.mjs refund-recovery <telegram_charge_id> --confirm-recovery=TELEGRAM_STARS_RECOVERY_REFUND');
  console.error('   or: node scripts/telegram-stars-ops.mjs webhook-info');
  console.error('   or: node scripts/telegram-stars-ops.mjs monitor');
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

const [command, targetId, suppliedKey] = process.argv.slice(2);
const recoveryConfirmed = process.argv.slice(2).includes('--confirm-recovery=TELEGRAM_STARS_RECOVERY_REFUND');
if (!['reconcile', 'refund', 'refund-recovery', 'webhook-info', 'set-webhook', 'monitor'].includes(command)
  || ['refund', 'refund-recovery'].includes(command) && !targetId
  || command === 'refund-recovery' && !recoveryConfirmed) {
  usage();
  process.exitCode = 2;
} else {
  try {
    validateProductionConfiguration(process.env);
    await initDb();
    const db = getDb();
    const runtime = createTelegramStarsRuntime({ dbMode: db.mode });
    if (!runtime.enabled) throw new Error('PAYMENTS_MODE is not telegram_stars_controlled');

    if (command === 'monitor') {
      const counts = await get(`SELECT
        (SELECT COUNT(*) FROM telegram_stars_payments) AS payments,
        (SELECT COUNT(*) FROM telegram_stars_entitlements WHERE status='active') AS active_entitlements,
        (SELECT COUNT(*) FROM telegram_stars_capture_inbox WHERE status IN ('received','recovery_required','refund_submitted')) AS recovery_captures,
        (SELECT COUNT(*) FROM telegram_stars_support_cases WHERE status='open') AS open_support_cases`);
      const latest = await get(`SELECT p.id AS payment_id,p.order_id,p.status,p.amount_xtr,p.refunded_amount_xtr,p.captured_at,
        CASE WHEN p.telegram_payment_charge_id IS NOT NULL AND LENGTH(p.telegram_payment_charge_id)>0 THEN 1 ELSE 0 END AS charge_id_present,
        (SELECT COUNT(*) FROM telegram_stars_entitlements e WHERE e.order_id=p.order_id) AS entitlement_count,
        (SELECT status FROM telegram_stars_entitlements e WHERE e.order_id=p.order_id) AS entitlement_status
        FROM telegram_stars_payments p ORDER BY p.captured_at DESC LIMIT 1`);
      console.log(JSON.stringify({ gate: await runtime.purchaseGate.getState(), counts, latest_payment: latest || null }));
    } else if (command === 'reconcile') {
      console.log(JSON.stringify(safeReport(await runtime.reconcileAndProtect())));
    } else if (command === 'webhook-info') {
      const info = await runtime.adapter.getWebhookInfo();
      console.log(JSON.stringify({ url: info?.url || '', has_custom_certificate: Boolean(info?.has_custom_certificate), pending_update_count: info?.pending_update_count || 0, last_error_date: info?.last_error_date || null, last_error_message: info?.last_error_message || null }));
    } else if (command === 'set-webhook') {
      const result = await runtime.adapter.setWebhook({ url: runtime.config.webhookUrl, secretToken: runtime.config.webhookSecret });
      console.log(JSON.stringify({ ok: result.ok, webhook_url: runtime.config.webhookUrl }));
    } else if (command === 'refund') {
      const payment = await get(
        `SELECT p.telegram_payment_charge_id,p.amount_xtr,p.refunded_amount_xtr,
                o.user_id,u.telegram_id
           FROM telegram_stars_payments p
           JOIN telegram_stars_orders o ON o.id=p.order_id
           JOIN users u ON u.id=o.user_id
          WHERE o.id=?`,
        [targetId],
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
        idempotencyKey: suppliedKey || `ops-refund:${targetId}:${amountXtr}`,
      });
      console.log(JSON.stringify({ ok: result.ok, status: result.status, orderId: result.orderId, paymentId: result.paymentId, refundRecorded: Boolean(result.refundId) }));
    } else {
      const result = await runtime.service.refundRecoveryCapture({
        telegramPaymentChargeId: targetId,
        reason: 'operator_capture_recovery',
      });
      console.log(JSON.stringify({ ok: result.ok, status: result.status, idempotent: result.idempotent === true, recovered: result.recovered === true }));
    }
  } finally {
    await closeDb();
  }
}
