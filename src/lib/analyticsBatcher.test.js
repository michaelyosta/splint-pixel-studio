import test from 'node:test';
import assert from 'node:assert/strict';
import { createAnalyticsBatcher } from './analyticsBatcher.js';

test('analytics burst is collapsed into one network batch', async () => {
  const sent = [];
  let scheduled = null;
  const batcher = createAnalyticsBatcher({
    send: async (events) => { sent.push(events); },
    delayMs: 50,
    setTimer: (callback) => { scheduled = callback; return 1; },
    clearTimer: () => { scheduled = null; },
  });

  for (let index = 0; index < 13; index += 1) {
    batcher.track('shelf_view', { shelf_id: `shelf_${index}` });
  }

  assert.equal(sent.length, 0);
  assert.equal(batcher.pendingCount(), 13);
  assert.equal(typeof scheduled, 'function');

  scheduled();
  await Promise.resolve();

  assert.equal(sent.length, 1);
  assert.equal(sent[0].length, 13);
  assert.deepEqual(sent[0][0], { event: 'shelf_view', payload: { shelf_id: 'shelf_0' } });
});

test('analytics batcher flushes at its bounded batch size', async () => {
  const sent = [];
  const batcher = createAnalyticsBatcher({
    send: async (events) => { sent.push(events); },
    maxBatchSize: 3,
    setTimer: () => 1,
    clearTimer: () => {},
  });

  batcher.track('shelf_view', { shelf_id: 'a' });
  batcher.track('shelf_view', { shelf_id: 'b' });
  batcher.track('shelf_view', { shelf_id: 'c' });
  await Promise.resolve();

  assert.equal(sent.length, 1);
  assert.equal(sent[0].length, 3);
  assert.equal(batcher.pendingCount(), 0);
});
