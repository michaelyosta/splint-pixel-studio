import test from 'node:test';
import assert from 'node:assert/strict';
import { createSerialRequestQueue } from '../src/api/analyticsQueue.js';

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
