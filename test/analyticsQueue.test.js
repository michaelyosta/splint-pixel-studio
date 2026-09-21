import test from 'node:test';
import assert from 'node:assert/strict';
import { createAnalyticsBatcher, createSerialRequestQueue } from '../src/api/analyticsQueue.js';

test('serial request queue keeps at most one analytics task in flight', async () => {
  const enqueue = createSerialRequestQueue();
  const events = [];
  let releaseFirst;
  const firstGate = new Promise((resolve) => { releaseFirst = resolve; });

  const first = enqueue(async () => {
    events.push('first:start');
    await firstGate;
    events.push('first:end');
    return 'first';
  });
  const second = enqueue(async () => {
    events.push('second:start');
    return 'second';
  });

  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(events, ['first:start']);

  releaseFirst();
  assert.equal(await first, 'first');
  assert.equal(await second, 'second');
  assert.deepEqual(events, ['first:start', 'first:end', 'second:start']);
});

test('serial request queue continues after a rejected analytics task', async () => {
  const enqueue = createSerialRequestQueue();
  const first = enqueue(async () => {
    throw new Error('analytics failed');
  });
  const second = enqueue(async () => 'next');

  await assert.rejects(first, /analytics failed/);
  assert.equal(await second, 'next');
});


test('analytics batcher coalesces events and serializes batches', async () => {
  const scheduled = [];
  const sent = [];
  let releaseFirst;
  const firstGate = new Promise((resolve) => { releaseFirst = resolve; });
  const batcher = createAnalyticsBatcher(async (events) => {
    sent.push(events);
    if (sent.length === 1) await firstGate;
    return { accepted: events.length };
  }, {
    maxBatchSize: 3,
    flushDelayMs: 1,
    setTimer: (callback) => { scheduled.push(callback); return callback; },
    clearTimer: () => {},
  });

  const first = batcher.track({ event: 'one' });
  const second = batcher.track({ event: 'two' });
  assert.equal(sent.length, 0);
  scheduled.shift()();
  await Promise.resolve();
  assert.deepEqual(sent, [[{ event: 'one' }, { event: 'two' }]]);

  const third = batcher.track({ event: 'three' });
  const fourth = batcher.track({ event: 'four' });
  scheduled.shift()();
  await Promise.resolve();
  assert.equal(sent.length, 1, 'second batch waits behind the first request');

  releaseFirst();
  assert.deepEqual(await first, { accepted: 2 });
  assert.deepEqual(await second, { accepted: 2 });
  assert.deepEqual(await third, { accepted: 2 });
  assert.deepEqual(await fourth, { accepted: 2 });
  assert.deepEqual(sent, [
    [{ event: 'one' }, { event: 'two' }],
    [{ event: 'three' }, { event: 'four' }],
  ]);
});

test('analytics batcher flushes immediately at its bounded batch size', async () => {
  const sent = [];
  const batcher = createAnalyticsBatcher(async (events) => {
    sent.push(events);
    return { accepted: events.length };
  }, {
    maxBatchSize: 2,
    flushDelayMs: 1,
    setTimer: () => 1,
    clearTimer: () => {},
  });

  const first = batcher.track({ event: 'one' });
  const second = batcher.track({ event: 'two' });
  await Promise.all([first, second]);
  assert.deepEqual(sent, [[{ event: 'one' }, { event: 'two' }]]);
});
