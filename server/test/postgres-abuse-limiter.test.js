import test from 'node:test';
import assert from 'node:assert/strict';

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  test('PostgreSQL abuse limiter semantics skipped (no DATABASE_URL)', { skip: true }, () => {});
}

test('PostgreSQL abuse budget upsert increments without ambiguous column reference', { skip: !databaseUrl }, async (t) => {
  const pg = (await import('pg')).default;
  const pool = new pg.Pool({ connectionString: databaseUrl });
  const { withTransaction } = await import('../database/transaction.js');
  const { AbuseLimitError, consumeAbuseBudget } = await import('../services/abuse-limiter.js');

  const runId = `pgabuse_${Date.now()}`;
  const actorKey = `${runId}_user`;
  let limit = 0;
  let windowMs = 60_000;

  t.after(async () => {
    try {
      await pool.query('DELETE FROM abuse_counters WHERE scope=$1 AND actor_key=$2', ['test:colorings:create', actorKey]);
    } catch { /* best-effort cleanup */ }
    await pool.end();
  });

  // The upsert must self-increment on PostgreSQL: the unqualified
  // "attempts=attempts+1" form is ambiguous there and fails every
  // create/upload route with a 500.
  await withTransaction({ mode: 'postgres', pool }, (tx) => consumeAbuseBudget(tx, {
    scope: 'test:colorings:create', actorKey, limit: 5, windowMs,
  }));
  await withTransaction({ mode: 'postgres', pool }, (tx) => consumeAbuseBudget(tx, {
    scope: 'test:colorings:create', actorKey, limit: 5, windowMs,
  }));
  await withTransaction({ mode: 'postgres', pool }, async (tx) => {
    const row = await tx.get(
      'SELECT attempts FROM abuse_counters WHERE scope=? AND actor_key=?',
      ['test:colorings:create', actorKey],
    );
    assert.equal(Number(row?.attempts), 2, 'counter must reach exactly 2 after two consumptions');
  });

  await assert.rejects(() => withTransaction({ mode: 'postgres', pool }, (tx) => consumeAbuseBudget(tx, {
    scope: 'test:colorings:create', actorKey, limit, windowMs,
  })), (error) => {
    assert.ok(error instanceof AbuseLimitError);
    return true;
  });

  const rejectedRow = await pool.query(
    'SELECT attempts FROM abuse_counters WHERE scope=$1 AND actor_key=$2',
    ['test:colorings:create', actorKey],
  );
  assert.equal(Number(rejectedRow.rows[0]?.attempts), 2, 'the rejected attempt must roll back and not inflate the durable counter');
});
