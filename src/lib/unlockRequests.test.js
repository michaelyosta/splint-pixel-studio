import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createBoundedRequestCache,
  createUnlockDataStore,
} from './unlockRequests.js';

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

test('createBoundedRequestCache dedupes in-flight reads per key', async () => {
  const cache = createBoundedRequestCache({ now: () => 0 });
  const first = deferred();
  const second = deferred();
  cache.put('key', first.promise);
  assert.equal(cache.get('key'), first.promise);
  cache.put('key', second.promise);
  assert.equal(cache.get('key'), second.promise);
  second.resolve('ok');
  await second.promise;
});

test('createBoundedRequestCache expires entries by TTL and evicts oldest', async () => {
  let current = 0;
  const cache = createBoundedRequestCache({ ttlMs: 100, maxEntries: 2, now: () => current });
  const a = deferred();
  cache.put('a', a.promise);
  current = 101;
  assert.equal(cache.get('a'), null);

  const b = deferred();
  const c = deferred();
  const d = deferred();
  cache.put('b', b.promise);
  cache.put('c', c.promise);
  cache.put('d', d.promise);
  assert.equal(cache.size(), 2);
  assert.equal(cache.get('b'), null);
  assert.equal(cache.get('d'), d.promise);
});

test('createUnlockDataStore returns one promise for concurrent snapshot reads', async () => {
  let calls = 0;
  const snapshot = deferred();
  const store = createUnlockDataStore({
    fetchSnapshot: () => {
      calls += 1;
      return snapshot.promise;
    },
    fetchRecommendations: async () => [],
  });
  const first = store.getSnapshot();
  const second = store.getSnapshot();
  snapshot.resolve({ summary: { available: 1 } });
  const [firstResult, secondResult] = await Promise.all([first, second]);
  assert.equal(calls, 1);
  assert.deepEqual(firstResult.data.summary, { available: 1 });
  assert.equal(firstResult.ok, true);
  assert.equal(secondResult, firstResult);
});

test('createUnlockDataStore caches until TTL and refetches after invalidation', async () => {
  let current = 0;
  let snapshotCalls = 0;
  let recommendationCalls = 0;
  const store = createUnlockDataStore({
    fetchSnapshot: async () => {
      snapshotCalls += 1;
      return { snapshot: snapshotCalls };
    },
    fetchRecommendations: async () => {
      recommendationCalls += 1;
      return [recommendationCalls];
    },
    ttlMs: 100,
    now: () => current,
  });

  const first = await store.getSnapshot();
  const cached = await store.getSnapshot();
  assert.equal(snapshotCalls, 1);
  assert.equal(first.data.snapshot, 1);
  assert.equal(cached.data.snapshot, 1);

  store.invalidate();
  const afterInvalidate = await store.getSnapshot();
  assert.equal(snapshotCalls, 2);
  assert.equal(afterInvalidate.data.snapshot, 2);

  current = 101;
  const afterTtl = await store.getSnapshot();
  assert.equal(snapshotCalls, 3);
  assert.equal(afterTtl.data.snapshot, 3);

  const refreshed = await store.refresh();
  assert.equal(snapshotCalls, 4);
  assert.equal(recommendationCalls, 1);
  assert.equal(refreshed.snapshot.data.snapshot, 4);
  assert.deepEqual(refreshed.recommendations.data, [1]);
});

test('createUnlockDataStore wraps failures in a stable error envelope', async () => {
  const store = createUnlockDataStore({
    fetchSnapshot: async () => {
      throw Object.assign(new Error('locked'), { status: 403, data: { code: 'PROGRESSION_REQUIRED', unlock: { state: 'progression_locked' } } });
    },
    fetchRecommendations: async () => {
      throw new Error('offline');
    },
  });
  const snapshot = await store.getSnapshot();
  const recommendations = await store.getRecommendations();
  assert.equal(snapshot.ok, false);
  assert.equal(snapshot.data, null);
  assert.equal(snapshot.error.status, 403);
  assert.equal(snapshot.error.data.code, 'PROGRESSION_REQUIRED');
  assert.equal(recommendations.ok, false);
  assert.equal(recommendations.error.message, 'offline');
});

test('createUnlockDataStore requires fetch functions', () => {
  assert.throws(() => createUnlockDataStore({}), /fetchSnapshot and fetchRecommendations/);
});
