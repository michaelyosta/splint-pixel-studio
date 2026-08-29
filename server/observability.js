import { randomUUID } from 'node:crypto';

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
};

function safeErrorClass(error) {
  return error?.name || error?.code || 'Error';
}

export function requestObservability(req, res, next) {
  const requestId = String(req.headers['x-request-id'] || randomUUID()).slice(0, 128);
  const startedAt = process.hrtime.bigint();
  req.requestId = requestId;
  res.setHeader('X-Request-Id', requestId);
  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
    metrics.httpRequests += 1;
    metrics.httpDurationMs += durationMs;
    if (res.statusCode >= 500) metrics.httpErrors += 1;
    console.log(JSON.stringify({
      type: 'http_request',
      request_id: requestId,
      route: req.route?.path || req.path,
      method: req.method,
      status: res.statusCode,
      duration_ms: Math.round(durationMs * 100) / 100,
      user_id: req.userId || undefined,
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

export { safeErrorClass };
