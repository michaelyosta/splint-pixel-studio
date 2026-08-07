import test from 'node:test';
import assert from 'node:assert/strict';

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  test('PostgreSQL render outbox semantics skipped (no DATABASE_URL)', { skip: true }, () => {});
}

test('PostgreSQL render outbox claims are concurrency-safe and reclaimable', { skip: !databaseUrl }, async (t) => {
  const { default: pg } = await import('pg');
  const pool = new pg.Pool({ connectionString: databaseUrl });
  const { withTransaction } = await import('../database/transaction.js');
  const outbox = await import('../services/render-outbox.js');

  const runId = Date.now();
  const userId = `rx_user_${runId}`;
  const templateId = `rx_tpl_${runId}`;
  const artworkId = `rx_art_${runId}`;
  const now = '2026-01-01T00:00:00.000Z';
  const db = { mode: 'postgres', pool };

  t.after(async () => {
    try { await pool.query('DELETE FROM render_outbox WHERE artwork_id=$1', [artworkId]); } catch { /* cleanup */ }
    try { await pool.query('DELETE FROM artworks WHERE id=$1', [artworkId]); } catch { /* cleanup */ }
    try { await pool.query('DELETE FROM coloring_templates WHERE id=$1', [templateId]); } catch { /* cleanup */ }
    try { await pool.query('DELETE FROM users WHERE id=$1', [userId]); } catch { /* cleanup */ }
    await pool.end();
  });

  await withTransaction(db, async (tx) => {
    await tx.run(`INSERT INTO users (id,nickname,role,created_at,updated_at) VALUES (?,?,?,?,?)`,
      [userId, 'Postgres Outbox', 'user', now, now]);
    await tx.run(`INSERT INTO coloring_templates
      (id,owner_id,title,width,height,palette_json,cells_json,created_at,updated_at,storage_mode,tile_size)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    [templateId, null, 'Postgres Outbox', 8, 8, JSON.stringify(['#000000', '#ffffff']), JSON.stringify(Array(64).fill(0)), now, now, 'legacy', 32]);
    await tx.run(`INSERT INTO artworks
      (id,owner_id,source_type,image_url,title,template_id,is_completed,render_status,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [artworkId, userId, 'coloring', '', 'Postgres Outbox', templateId, 1, 'pending', now, now]);
    await outbox.enqueueRenderJob(tx, {
      artworkId,
      userId,
      templateId,
      renderMode: 'legacy',
      now,
    });
  });

  const baseNow = new Date(now);
  const [first, second] = await Promise.all([
    outbox.claimRenderJobs(db, { workerId: 'pg-worker-a', now: baseNow, leaseMs: 60_000 }),
    outbox.claimRenderJobs(db, { workerId: 'pg-worker-b', now: baseNow, leaseMs: 60_000 }),
  ]);
  assert.equal(first.length + second.length, 1, 'exactly one PostgreSQL worker claims the job');

  const duringLease = await outbox.claimRenderJobs(db, {
    workerId: 'pg-worker-c',
    now: new Date(baseNow.getTime() + 30_000),
    leaseMs: 60_000,
  });
  assert.equal(duringLease.length, 0, 'active lease is not stolen');

  const reclaimed = await outbox.claimRenderJobs(db, {
    workerId: 'pg-worker-d',
    now: new Date(baseNow.getTime() + 120_000),
    leaseMs: 60_000,
  });
  assert.equal(reclaimed.length, 1, 'expired lease is reclaimed');
  assert.equal(reclaimed[0].attempt_count, 2);

  await outbox.completeRenderJob(db, {
    jobId: reclaimed[0].id,
    artworkId,
    workerId: 'pg-worker-d',
    now: new Date(baseNow.getTime() + 120_000),
  });
  const row = (await pool.query('SELECT status FROM render_outbox WHERE artwork_id=$1', [artworkId])).rows[0];
  const artwork = (await pool.query('SELECT render_status FROM artworks WHERE id=$1', [artworkId])).rows[0];
  assert.equal(row.status, 'ready');
  assert.equal(artwork.render_status, 'ready');
});
