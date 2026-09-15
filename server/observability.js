import { createHash, randomUUID } from 'node:crypto';

const metrics = {
  httpRequests: 0,
  httpErrors: 0,
  httpDurationMs: 0,
  saveConflicts: 0,
  idempotencyReplays: 0,
  mediaFailures: 0,
  abuseRejects: 0,
  feedPayloadBytes: 0,
  feedQueryCount: 0,
  http4xx: 0,
  http5xx: 0,
  starsInvoiceCreated: 0,
  starsInvoiceFailed: 0,
  starsPrecheckoutAccepted: 0,
  starsPrecheckoutReceived: 0,
  starsPrecheckoutRejected: 0,
  starsSuccessfulPayment: 0,
  starsEntitlementCreated: 0,
  starsReplay: 0,
  starsRefundApplied: 0,
  starsReconciliationCompleted: 0,
  starsReconciliationFailed: 0,
  starsWebhookErrors: 0,
  starsRecoveryRequired: 0,
};

function safeErrorClass(error) {
  return error?.name || error?.code || 'Error';
}

export function requestObservability(req, res, next) {
  const paymentRoute = req.originalUrl?.startsWith('/payments/telegram-stars');
  // Payment traces always use a server-generated identifier. A caller-owned
  // header could otherwise smuggle arbitrary text or PII into operator logs.
  const requestId = paymentRoute
    ? randomUUID()
    : String(req.headers['x-request-id'] || randomUUID()).slice(0, 128);
  const startedAt = process.hrtime.bigint();
  req.requestId = requestId;
  res.setHeader('X-Request-Id', requestId);
  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
    metrics.httpRequests += 1;
    metrics.httpDurationMs += durationMs;
    if (res.statusCode >= 400 && res.statusCode < 500) metrics.http4xx += 1;
    if (res.statusCode >= 500) { metrics.httpErrors += 1; metrics.http5xx += 1; }
    console.log(JSON.stringify({
      type: 'http_request',
      request_id: requestId,
      route: req.route?.path || req.path,
      method: req.method,
      status: res.statusCode,
      duration_ms: Math.round(durationMs * 100) / 100,
      // Payment monitoring uses a one-way correlation emitted by
      // logPaymentEvent. Do not duplicate payer identifiers in request logs.
      user_id: paymentRoute ? undefined : req.userId || undefined,
    }));
  });
  return next();
}

export function recordMetric(name, value = 1) {
  if (Object.hasOwn(metrics, name)) metrics[name] += Number(value) || 0;
}

export function metricsSnapshot() {
  return {
    ...metrics,
    http_error_rate: metrics.httpRequests ? metrics.httpErrors / metrics.httpRequests : 0,
    http_avg_duration_ms: metrics.httpRequests ? metrics.httpDurationMs / metrics.httpRequests : 0,
  };
}

export function logSecurityEvent(event, details = {}) {
  console.log(JSON.stringify({ type: 'security_event', event, ...details }));
}

export function logBackgroundJob(jobId, event, details = {}) {
  console.log(JSON.stringify({ type: 'background_job', job_id: jobId, event, ...details }));
}

export function paymentCorrelation(value) {
  if (!value) return undefined;
  return createHash('sha256').update(String(value)).digest('hex').slice(0, 16);
}

export function logPaymentEvent(event, details = {}) {
  const metricByEvent = {
    invoice_created: 'starsInvoiceCreated',
    invoice_failed: 'starsInvoiceFailed',
    precheckout_accepted: 'starsPrecheckoutAccepted',
    precheckout_received: 'starsPrecheckoutReceived',
    precheckout_rejected: 'starsPrecheckoutRejected',
    successful_payment: 'starsSuccessfulPayment',
    entitlement_created: 'starsEntitlementCreated',
    replay: 'starsReplay',
    refund_applied: 'starsRefundApplied',
    reconciliation_completed: 'starsReconciliationCompleted',
    reconciliation_failed: 'starsReconciliationFailed',
    webhook_error: 'starsWebhookErrors',
    recovery_required: 'starsRecoveryRequired',
  };
  const metric = metricByEvent[event];
  if (metric) recordMetric(metric);
  const safe = {
    type: 'telegram_stars_event',
    event,
    outcome: details.outcome,
    code: details.code,
    status: details.status,
    mode: details.mode,
    product_id: details.productId,
    correlation_id: paymentCorrelation(details.correlationId),
    idempotent: details.idempotent === true || undefined,
    recovery_required: details.recoveryRequired === true || undefined,
    issue_count: Number.isInteger(details.issueCount) ? details.issueCount : undefined,
    error_class: details.error ? safeErrorClass(details.error) : undefined,
  };
  console.log(JSON.stringify(safe));
}

export { safeErrorClass };
