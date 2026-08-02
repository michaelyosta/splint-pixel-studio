import { withDbTransaction } from '../db.js';

export class AbuseLimitError extends Error {
  constructor(retryAfterSeconds) {
    super('Abuse budget exceeded');
    this.name = 'AbuseLimitError';
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

/**
 * Consume a durable counter inside a caller-owned transaction. The counter
 * is deliberately keyed by logical actor rather than IP so multiple API
 * instances share the same budget without logging request bodies.
 */
export async function consumeAbuseBudget(tx, { scope, actorKey, limit, windowMs = 60_000 }) {
  const bucketStart = Math.floor(Date.now() / windowMs) * windowMs;
  // Do the increment as one database operation. A SELECT followed by INSERT
  // races when two instances consume a previously unseen bucket concurrently.
  // The caller-owned transaction rolls this increment back when the limit is
  // exceeded, so rejected requests do not grow the counter indefinitely.
  const counter = await tx.get(`
    INSERT INTO abuse_counters (scope,actor_key,bucket_start,attempts)
    VALUES (?,?,?,1)
    ON CONFLICT (scope,actor_key,bucket_start)
    DO UPDATE SET attempts=attempts+1
    RETURNING attempts
  `, [scope, actorKey, bucketStart]);
  const attempts = Number(counter?.attempts || 0);
  if (attempts > limit) {
    throw new AbuseLimitError(Math.max(1, Math.ceil((bucketStart + windowMs - Date.now()) / 1000)));
  }
  return { allowed: true, remaining: Math.max(0, limit - attempts), retryAfterSeconds: Math.ceil((bucketStart + windowMs - Date.now()) / 1000) };
}

export async function enforceAbuseBudget(options) {
  return withDbTransaction((tx) => consumeAbuseBudget(tx, options));
}

export function abuseLimitResponse(res, error) {
  if (!(error instanceof AbuseLimitError)) return false;
  res.set('Retry-After', String(error.retryAfterSeconds));
  res.status(429).json({ error: 'Лимит защитного бюджета исчерпан', code: 'ABUSE_LIMITED', retry_after_seconds: error.retryAfterSeconds });
  return true;
}
