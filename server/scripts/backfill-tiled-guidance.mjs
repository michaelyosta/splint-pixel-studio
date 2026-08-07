/**
 * One-time maintenance command: build the tiled guidance static index for
 * every tiled template that lacks one (pre-021 templates).
 *
 * Usage:
 *   npm --prefix server run backfill:guidance
 *
 * Env:
 *   SQLITE_DB_PATH / DATABASE_URL — which database to backfill
 *   GUIDANCE_BACKFILL_LIMIT      — templates to rebuild per run (default: all)
 *
 * Idempotent and restartable: templates with a completion marker are skipped,
 * and each template is rebuilt in its own transaction.
 */
import { initDb, closeDb, getDb } from '../db.js';
import { backfillGuidanceIndex, countTemplatesMissingGuidanceIndex } from '../services/tiled-guidance-backfill.js';

const LIMIT = Number(process.env.GUIDANCE_BACKFILL_LIMIT || 10_000);

await initDb();
const db = getDb();
console.log(`Backfilling tiled guidance index on ${db.mode}...`);

const missingBefore = await countTemplatesMissingGuidanceIndex(db);
console.log(`Templates missing the static guidance index: ${missingBefore}`);

const startedAt = Date.now();
let processedTotal = 0;
const errors = [];
while (processedTotal < LIMIT) {
  const batch = Math.min(50, LIMIT - processedTotal);
  const result = await backfillGuidanceIndex(db, {
    limit: batch,
    templateLimit: batch,
    onProgress: ({ templateId, status, message }) => {
      if (status === 'error') console.error(`  ! ${templateId}: ${message}`);
    },
  });
  processedTotal += result.processed;
  errors.push(...result.errors);
  if (result.processed === 0) break;
}

const missingAfter = await countTemplatesMissingGuidanceIndex(db);
console.log(`Done: built ${processedTotal} indexes in ${Date.now() - startedAt}ms`);
console.log(`Remaining missing: ${missingAfter}`);
if (errors.length) {
  console.error(`${errors.length} template(s) failed:`);
  for (const error of errors) console.error(`  - ${error.templateId}: ${error.message}`);
}
await closeDb();
process.exit(errors.length ? 1 : 0);
