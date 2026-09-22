import test from 'node:test';
import assert from 'node:assert/strict';
import { createAnalyticsBatcher } from '../api/analyticsQueue.js';

test('analytics burst is collapsed into one bounded request', async () => {
  const sent = [];
  let scheduled = null;
  const batcher = createAnalyticsBatcher(
    async (events) => { sent.push(events); return { success: true }; },
    {
      flushDelayMs: 50,
      setTimer: (callback) => { scheduled = callback; return 0; },
      clearTimer: () => { scheduled = null; },
    },
  );

  const promises = [];
  for (let index = 0; index < 13; index += 1) {
    promises.push(batcher.track({ event: 'shelf_view', payload: { shelf_id: `shelf_${index}` } }));
  }

  assert.equal(sent.length, 0);
  assert.equal(typeof scheduled, 'function');
  scheduled();
  await Promise.all(promises);

  assert.equal(sent.length, 1);
  assert.equal(sent[0].length, 13);
  assert.deepEqual(sent[0][0], { event: 'shelf_view', payload: { shelf_id: 'shelf_0' } });
});

test('analytics batcher flushes immediately at the configured bound', async () => {
  const sent = [];
  const batcher = createAnalyticsBatcher(
    async (events) => { sent.push(events); return { success: true }; },
    {
      maxBatchSize: 3,
      flushDelayMs: 1000,
    },
  );

  await Promise.all([
    batcher.track({ event: 'shelf_view', payload: { shelf_id: 'a' } }),
    batcher.track({ event: 'shelf_view', payload: { shelf_id: 'b' } }),
    batcher.track({ event: 'shelf_view', payload: { shelf_id: 'c' } }),
  ]);

  assert.equal(sent.length, 1);
  assert.equal(sent[0].length, 3);
});
