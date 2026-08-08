import { randomUUID } from 'node:crypto';
import { withTransaction } from '../database/transaction.js';
import {
  renderCanonicalPng,
  renderCanonicalThumbnail,
  renderCanonicalTiledPng,
  renderCanonicalTiledThumbnail,
} from './canonical-renderer.js';
import { readTiledTemplateTiles } from './tiled-coloring.js';
import { storeMediaObject } from './media-storage.js';

export const RENDER_OUTBOX_STATUSES = Object.freeze(['pending', 'processing', 'retry', 'ready', 'dead']);
export const DEFAULT_MAX_ATTEMPTS = 6;
export const DEFAULT_LEASE_MS = 5 * 60 * 1000;
export const DEFAULT_BATCH_SIZE = 16;
export const DEFAULT_RETRY_DELAYS_MS = Object.freeze([1_000, 5_000, 30_000, 120_000, 600_000]);

function iso(value = new Date()) {
  return value instanceof Date ? value.toISOString() : String(value);
}

function parseJsonArray(value) {
  if (Array.isArray(value)) return value;
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
  return null;
}

function runInDbTransaction(db, callback) {
  if (typeof db?.withTransaction === 'function') return db.withTransaction(callback);
  return withTransaction(db, callback);
}

export function renderJobId(artworkId) {
  return `render:${String(artworkId)}`;
}

/**
 * Enqueue inside the same DB transaction that creates or marks the artwork
 * complete. artwork_id is deterministic and unique, so idempotent replay and
 * concurrent completion can never create a second job.
 */
export async function enqueueRenderJob(tx, {
  artworkId,
  userId,
  templateId,
  renderMode,
  now = new Date(),
  maxAttempts = DEFAULT_MAX_ATTEMPTS,
}) {
  if (!artworkId || !userId || !templateId || !['legacy', 'tiled'].includes(renderMode)) {
    throw new Error('Invalid render outbox enqueue payload');
  }
  const timestamp = iso(now);
  const id = renderJobId(artworkId);
  await tx.run(`INSERT INTO render_outbox
    (id, artwork_id, user_id, template_id, render_mode, status, attempt_count, max_attempts, next_attempt_at, lease_owner, lease_expires_at, last_error, created_at, updated_at)
    VALUES (?,?,?,?,?, 'pending', 0, ?, ?, NULL, NULL, NULL, ?, ?)
    ON CONFLICT(artwork_id) DO NOTHING`,
  [id, artworkId, userId, templateId, renderMode, maxAttempts, timestamp, timestamp, timestamp]);
  return tx.get('SELECT * FROM render_outbox WHERE artwork_id=?', [artworkId]);
}

/**
 * Claim a bounded batch. The conditional UPDATE is safe for PostgreSQL
 * multi-instance workers: two transactions may select the same candidates,
 * but only the first UPDATE matches. SQLite serializes through BEGIN IMMEDIATE.
 * Expired processing leases are reclaimed so a crashed worker never strands
 * a job.
 */
export async function claimRenderJobs(db, {
  workerId = `worker-${randomUUID().slice(0, 8)}`,
  batchSize = DEFAULT_BATCH_SIZE,
  now = new Date(),
  leaseMs = DEFAULT_LEASE_MS,
} = {}) {
  if (!workerId) throw new Error('workerId is required to claim render jobs');
  const timestamp = iso(now);
  const leaseExpiresAt = iso(new Date(now.getTime() + leaseMs));
  return runInDbTransaction(db, async (tx) => {
    const candidates = await tx.all(`SELECT * FROM render_outbox
      WHERE status IN ('pending', 'retry', 'processing')
        AND next_attempt_at <= ?
        AND (lease_expires_at IS NULL OR lease_expires_at < ?)
      ORDER BY next_attempt_at ASC, created_at ASC
      LIMIT ?`, [timestamp, timestamp, batchSize]);
    const claimed = [];
    for (const candidate of candidates) {
      const updated = await tx.run(`UPDATE render_outbox
        SET status='processing', lease_owner=?, lease_expires_at=?, attempt_count=attempt_count+1,
            next_attempt_at=?, last_error=NULL, updated_at=?
        WHERE id=? AND status IN ('pending', 'retry', 'processing')
          AND next_attempt_at <= ?
          AND (lease_expires_at IS NULL OR lease_expires_at < ?)`,
      [workerId, leaseExpiresAt, timestamp, timestamp, candidate.id, timestamp, timestamp]);
      if (updated.changes > 0) {
        claimed.push({
          ...candidate,
          status: 'processing',
          lease_owner: workerId,
          lease_expires_at: leaseExpiresAt,
          attempt_count: Number(candidate.attempt_count || 0) + 1,
          next_attempt_at: timestamp,
          updated_at: timestamp,
        });
      }
    }
    return claimed;
  });
}

/**
 * Only after both canonical objects are durably written may the artwork and
 * the job both become ready. The lease_owner guard prevents a stale worker
 * from completing a job that was already reclaimed.
 */
export async function completeRenderJob(db, {
  jobId,
  artworkId,
  workerId,
  now = new Date(),
}) {
  const timestamp = iso(now);
  return runInDbTransaction(db, async (tx) => {
    const jobUpdated = await tx.run(`UPDATE render_outbox
      SET status='ready', lease_owner=NULL, lease_expires_at=NULL, last_error=NULL,
          next_attempt_at=?, updated_at=?
      WHERE id=? AND status='processing' AND lease_owner=?`,
    [timestamp, timestamp, jobId, workerId]);
    if (!jobUpdated.changes) return { updated: false };
    await tx.run(`UPDATE artworks SET render_status='ready', updated_at=? WHERE id=?`, [timestamp, artworkId]);
    return { updated: true };
  });
}

/**
 * Mark a transient failure as retry with bounded exponential backoff, or as
 * dead after the final attempt. The artwork is never left as ready after a
 * failed write.
 */
export async function failRenderJob(db, {
  jobId,
  artworkId,
  workerId,
  error,
  retryDelaysMs = DEFAULT_RETRY_DELAYS_MS,
  now = new Date(),
}) {
  const timestamp = iso(now);
  return runInDbTransaction(db, async (tx) => {
    const job = await tx.get(`SELECT * FROM render_outbox WHERE id=? AND status='processing' AND lease_owner=?`, [jobId, workerId]);
    if (!job) return { updated: false, dead: false };
    const attempts = Number(job.attempt_count || 0);
    const maxAttempts = Number(job.max_attempts || DEFAULT_MAX_ATTEMPTS);
    const exhausted = attempts >= maxAttempts;
    const message = String(error?.message || error || 'Render job failed').slice(0, 2_000);
    await tx.run(`UPDATE artworks
      SET render_status='failed', updated_at=?
      WHERE id=? AND (render_status IS NULL OR render_status <> 'ready')`, [timestamp, artworkId]);
    if (exhausted) {
      await tx.run(`UPDATE render_outbox
        SET status='dead', lease_owner=NULL, lease_expires_at=NULL, last_error=?, next_attempt_at=?, updated_at=?
        WHERE id=? AND status='processing' AND lease_owner=?`,
      [message, timestamp, timestamp, jobId, workerId]);
    } else {
      const delayIndex = Math.min(Math.max(0, attempts - 1), retryDelaysMs.length - 1);
      const delayMs = Number(retryDelaysMs[delayIndex]) || 0;
      const nextAttemptAt = iso(new Date(now.getTime() + delayMs));
      await tx.run(`UPDATE render_outbox
        SET status='retry', lease_owner=NULL, lease_expires_at=NULL, last_error=?, next_attempt_at=?, updated_at=?
        WHERE id=? AND status='processing' AND lease_owner=?`,
      [message, nextAttemptAt, timestamp, jobId, workerId]);
      return { updated: true, dead: false, next_attempt_at: nextAttemptAt };
    }
    return { updated: true, dead: true };
  });
}

/**
 * Manual recovery for permanently exhausted jobs. Resets the bounded attempt
 * budget and lets the worker pick the job up on the next poll.
 */
export async function retryRenderJob(db, {
  artworkId,
  now = new Date(),
}) {
  const timestamp = iso(now);
  return runInDbTransaction(db, async (tx) => {
    const jobId = renderJobId(artworkId);
    const updated = await tx.run(`UPDATE render_outbox
      SET status='pending', attempt_count=0, lease_owner=NULL, lease_expires_at=NULL,
          last_error=NULL, next_attempt_at=?, updated_at=?
      WHERE id=? AND status='dead'`, [timestamp, timestamp, jobId]);
    if (updated.changes) {
      await tx.run(`UPDATE artworks
        SET render_status='pending', updated_at=?
        WHERE id=? AND render_status <> 'ready'`, [timestamp, artworkId]);
    }
    return Boolean(updated.changes);
  });
}

/**
 * Best-effort synchronous completion may mark the job ready too. This is
 * still safe because media writes are deterministic/idempotent and the worker
 * will simply re-verify the same bytes on a concurrent claim.
 */
export async function markArtworkAndJobReady(db, {
  artworkId,
  now = new Date(),
}) {
  const timestamp = iso(now);
  return runInDbTransaction(db, async (tx) => {
    const jobId = renderJobId(artworkId);
    await tx.run(`UPDATE render_outbox
      SET status='ready', lease_owner=NULL, lease_expires_at=NULL, last_error=NULL,
          next_attempt_at=?, updated_at=?
      WHERE id=? AND status IN ('pending', 'processing', 'retry', 'dead')`,
    [timestamp, timestamp, jobId]);
    await tx.run(`UPDATE artworks SET render_status='ready', updated_at=? WHERE id=?`, [timestamp, artworkId]);
  });
}

/**
 * Build the render plan for a claimed job. Tiled plans never construct a full
 * 1200x1200 row-major filled array: they use the bounded tile rows only.
 */
export async function loadRenderPlan(db, job) {
  return runInDbTransaction(db, async (tx) => {
    const templateRow = await tx.get('SELECT * FROM coloring_templates WHERE id=?', [job.template_id]);
    if (!templateRow) throw new Error('Render template not found');
    const artwork = await tx.get('SELECT * FROM artworks WHERE id=?', [job.artwork_id]);
    if (!artwork) throw new Error('Render artwork not found');
    const width = Number(templateRow.width);
    const height = Number(templateRow.height);
    const palette = parseJsonArray(templateRow.palette_json);
    const storageKey = artwork.storage_key || `artworks/${String(job.user_id).replace(/[^a-zA-Z0-9_-]/g, '_')}/${job.artwork_id}.png`;
    const thumbnailKey = artwork.thumbnail_key || `thumbnails/${String(job.user_id).replace(/[^a-zA-Z0-9_-]/g, '_')}/${job.artwork_id}.png`;
    const template = {
      id: templateRow.id,
      width,
      height,
      palette,
      tile_size: Number(templateRow.tile_size || 32),
      storage_mode: templateRow.storage_mode || 'legacy',
    };
    if (template.storage_mode === 'tiled') {
      const tiles = await readTiledTemplateTiles(tx, { template });
      return {
        renderMode: 'tiled',
        width,
        height,
        palette,
        tileSize: template.tile_size,
        tiles,
        storageKey,
        thumbnailKey,
      };
    }
    const progress = await tx.get('SELECT * FROM coloring_progress WHERE user_id=? AND template_id=?', [job.user_id, job.template_id]);
    const cells = parseJsonArray(templateRow.cells_json);
    const filled = parseJsonArray(progress?.filled_json);
    if (!Array.isArray(cells) || !Array.isArray(filled) || cells.length !== width * height || filled.length !== cells.length) {
      throw new Error('Legacy render input is incomplete or corrupt');
    }
    return {
      renderMode: 'legacy',
      width,
      height,
      palette,
      cells,
      filled,
      storageKey,
      thumbnailKey,
    };
  });
}

export function buildRenderArtifacts(plan) {
  if (plan.renderMode === 'tiled') {
    const options = {
      width: plan.width,
      height: plan.height,
      palette: plan.palette,
      tiles: plan.tiles,
      tileSize: plan.tileSize,
    };
    return {
      full: renderCanonicalTiledPng(options),
      thumbnail: renderCanonicalTiledThumbnail(options),
    };
  }
  const options = {
    width: plan.width,
    height: plan.height,
    palette: plan.palette,
    cells: plan.cells,
    filled: plan.filled,
  };
  return {
    full: renderCanonicalPng(options),
    thumbnail: renderCanonicalThumbnail(options),
  };
}

/**
 * Render both canonical objects. Throws on the first failed write; the caller
 * converts that into a retry/dead transition. Re-writing the same key is
 * idempotent for both local and S3 drivers.
 */
export async function processRenderJob(db, job) {
  const plan = await loadRenderPlan(db, job);
  const artifacts = buildRenderArtifacts(plan);
  await storeMediaObject({ key: plan.storageKey, body: artifacts.full.buffer, contentType: artifacts.full.mimeType });
  await storeMediaObject({ key: plan.thumbnailKey, body: artifacts.thumbnail.buffer, contentType: artifacts.thumbnail.mimeType });
  return { plan, artifacts };
}

export async function drainRenderJobs(db, {
  workerId,
  batchSize,
  now,
  leaseMs,
  renderJob = processRenderJob,
} = {}) {
  const claimed = await claimRenderJobs(db, { workerId, batchSize, now, leaseMs });
  const results = [];
  for (const job of claimed) {
    const owner = job.lease_owner;
    try {
      await renderJob(db, job);
      const completed = await completeRenderJob(db, {
        jobId: job.id,
        artworkId: job.artwork_id,
        workerId: owner,
        now: new Date(),
      });
      results.push({
        jobId: job.id,
        artworkId: job.artwork_id,
        ok: completed.updated,
        status: completed.updated ? 'ready' : 'skipped',
      });
    } catch (error) {
      const failed = await failRenderJob(db, {
        jobId: job.id,
        artworkId: job.artwork_id,
        workerId: owner,
        error,
        now: new Date(),
      });
      results.push({
        jobId: job.id,
        artworkId: job.artwork_id,
        ok: false,
        error: String(error?.message || error).slice(0, 2_000),
        status: failed.dead ? 'dead' : 'retry',
      });
    }
  }
  return results;
}
