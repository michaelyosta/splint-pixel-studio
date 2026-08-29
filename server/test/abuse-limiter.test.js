import test from 'node:test';
import assert from 'node:assert/strict';
import { AbuseLimitError, abuseLimitResponse, consumeAbuseBudget } from '../services/abuse-limiter.js';
import { createFreshSqliteDbAsync } from './helpers/database.js';
import { withTransaction } from '../database/transaction.js';

function fakeTransaction() {
  const counters = new Map();
  return {
    counters,
    async get(_sql, params) {
      const [scope, actorKey, bucketStart] = params;
      const attempts = counters.get(`${scope}:${actorKey}:${bucketStart}`);
      if (_sql.includes('RETURNING attempts')) {
        const next = (attempts || 0) + 1;
        counters.set(`${scope}:${actorKey}:${bucketStart}`, next);
        return { attempts: next };
      }
      return attempts == null ? null : { attempts };
    },
    async run(sql, params) {
      const [scope, actorKey, bucketStart] = params;
      const key = `${scope}:${actorKey}:${bucketStart}`;
      if (sql.startsWith('INSERT')) counters.set(key, 1);
      else counters.set(key, counters.get(key) + 1);
      return { changes: 1 };
    },
  };
}

test('abuse budget is durable within the caller transaction and rejects after the limit', async () => {
  const tx = fakeTransaction();
  const options = { scope: 'comment:create', actorKey: 'user-1', limit: 2, windowMs: 60_000 };

  const first = await consumeAbuseBudget(tx, options);
  const second = await consumeAbuseBudget(tx, options);
  assert.equal(first.remaining, 1);
  assert.equal(second.remaining, 0);
  await assert.rejects(() => consumeAbuseBudget(tx, options), (error) => {
    assert.ok(error instanceof AbuseLimitError);
    assert.ok(error.retryAfterSeconds >= 1);
    return true;
  });
});

test('abuse budget increment is atomic for concurrent first requests', async () => {
  const sqlite = await createFreshSqliteDbAsync();
  sqlite.run(`CREATE TABLE abuse_counters (
    scope TEXT NOT NULL,
    actor_key TEXT NOT NULL,
    bucket_start INTEGER NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (scope, actor_key, bucket_start)
  )`);
  const db = { mode: 'sqlite', sqlite, persistFn: null };
  const consume = () => withTransaction(db, (tx) => consumeAbuseBudget(tx, {
    scope: 'comment:create', actorKey: 'same-user', limit: 1, windowMs: 60_000,
  }));

  const results = await Promise.allSettled([consume(), consume(), consume()]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(results.filter((result) => result.status === 'rejected' && result.reason instanceof AbuseLimitError).length, 2);
  const row = sqlite.exec('SELECT attempts FROM abuse_counters')[0].values[0];
  assert.equal(Number(row[0]), 1, 'rejected transactions must not inflate the durable counter');
  sqlite.close();
});

test('abuse limit response is a retryable 429 contract', () => {
  const response = {
    headers: {},
    statusCode: 200,
    body: null,
    set(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
  const handled = abuseLimitResponse(response, new AbuseLimitError(7));
  assert.equal(handled, true);
  assert.equal(response.statusCode, 429);
  assert.equal(response.headers['Retry-After'], '7');
  assert.equal(response.body.code, 'ABUSE_LIMITED');
});
