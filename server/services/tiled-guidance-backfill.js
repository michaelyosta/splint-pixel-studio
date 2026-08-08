/**
 * Bounded, idempotent, restartable backfill of the tiled guidance static
 * index for templates created before migration 021.
 *
 * Design:
 * - Processes one template per transaction, so an interrupted run never
 *   leaves partial rows visible (the transaction rolls back) and a crash
 *   simply resumes on the next run.
 * - Completion is tracked by `coloring_template_guidance_index_meta`; a
 *   template without a marker is rebuilt (delete + recreate) even if some
 *   count rows already exist, repairing indexes interrupted by the old
 *   "COUNT(*) > 0" guard.
 * - SQLite and PostgreSQL share this code path (both expose get/all/run and
 *   a withTransaction primitive).
 */
import { withDbTransaction } from '../db.js';
import { ensureStaticGuidanceIndex } from './tiled-guidance.js';

function parseTemplateRow(row) {
  return {
    id: row.id,
    width: Number(row.width),
    height: Number(row.height),
    palette: (() => {
      try {
        const parsed = JSON.parse(row.palette_json || '[]');
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    })(),
    tile_size: Number(row.tile_size || 32),
    updated_at: row.updated_at,
    storage_mode: row.storage_mode,
  };
}

export async function findTemplatesMissingGuidanceIndex(db, { limit = 100, offset = 0 } = {}) {
  return db.all(
    `SELECT * FROM coloring_templates t
      WHERE t.status='active' AND t.storage_mode='tiled'
        AND NOT EXISTS (
          SELECT 1 FROM coloring_template_guidance_index_meta m
          WHERE m.template_id = t.id
        )
      ORDER BY t.created_at, t.id
      LIMIT ? OFFSET ?`,
    [Number(limit) || 100, Number(offset) || 0],
  );
}

export async function countTemplatesMissingGuidanceIndex(db) {
  const row = await db.get(
    `SELECT COUNT(*) AS count FROM coloring_templates t
      WHERE t.status='active' AND t.storage_mode='tiled'
        AND NOT EXISTS (
          SELECT 1 FROM coloring_template_guidance_index_meta m
          WHERE m.template_id = t.id
        )`,
  );
  return Number(row?.count || 0);
}

/**
 * Build the static guidance index for the given templates.
 *
 * @param {object} db - database adapter ({ get, all, run })
 * @param {object} options
 * @param {number} [options.limit=100] - templates to consider this run
 * @param {number} [options.templateLimit=1] - hard cap of templates actually
 *   rebuilt in this run (default 1 keeps lock hold times short)
 * @param {Function} [options.withTransaction] - injectable transaction
 *   primitive (defaults to the server's withDbTransaction)
 * @param {Function} [options.onProgress] - per-template callback
 * @returns {Promise<{processed: number, remaining: number, errors: Array}>}
 */
export async function backfillGuidanceIndex(db, {
  limit = 100,
  templateLimit = 1,
  withTransaction = withDbTransaction,
  onProgress = null,
} = {}) {
  const templates = await findTemplatesMissingGuidanceIndex(db, { limit });
  const errors = [];
  let processed = 0;
  for (const row of templates) {
    if (templateLimit != null && processed >= templateLimit) break;
    const template = parseTemplateRow(row);
    try {
      const result = await withTransaction((tx) => ensureStaticGuidanceIndex(tx, template));
      processed += 1;
      onProgress?.({ templateId: template.id, status: result.status });
    } catch (error) {
      errors.push({ templateId: template.id, message: error.message });
      onProgress?.({ templateId: template.id, status: 'error', message: error.message });
    }
  }
  const remaining = await countTemplatesMissingGuidanceIndex(db);
  return { processed, remaining, errors };
}
