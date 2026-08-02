import { run } from '../db.js';

export async function cleanupExpiredPaymentRequests({ now = new Date(), ttlMs = 24 * 60 * 60 * 1000 } = {}) {
  const cutoff = new Date(now.getTime() - ttlMs).toISOString();
  const result = await run("UPDATE message_requests SET status='cancelled', updated_at=? WHERE status='payment_pending' AND updated_at<?", [now.toISOString(), cutoff]);
  return { cancelled: Number(result.changes || 0), cutoff };
}
