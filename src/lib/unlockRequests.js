/*
 * Bounded request dedupe and cache for unlock/recommendation reads.
 *
 * The UI may mount several surfaces that need the same snapshot or
 * recommendation list. This module guarantees one in-flight request per key
 * and a bounded TTL cache, and exposes explicit invalidation so the app can
 * refresh after a server-verified completion or lazy unlock grant without
 * creating request loops.
 */

export function createBoundedRequestCache({
  ttlMs = 30_000,
  maxEntries = 12,
  now = () => Date.now(),
} = {}) {
  const entries = new Map();

  function get(key) {
    const entry = entries.get(key);
    if (!entry) return null;
    if (now() >= entry.expiresAt) {
      entries.delete(key);
      return null;
    }
    return entry.promise;
  }

  function put(key, promise, { ttlMs: entryTtl } = {}) {
    while (entries.size >= maxEntries) {
      const oldest = entries.keys().next().value;
      if (oldest === undefined) break;
      entries.delete(oldest);
    }
    entries.set(key, {
      promise,
      expiresAt: now() + (entryTtl == null ? ttlMs : entryTtl),
    });
    return promise;
  }

  return {
    get,
    put,
    invalidate(key) {
      entries.delete(key);
    },
    invalidateAll() {
      entries.clear();
    },
    size() {
      return entries.size;
    },
  };
}

/**
 * A small store that resolves the unlock snapshot and recommendations to a
 * stable result envelope ({ ok, data, error }). Callers never throw for a
 * failed read; they render deterministic loading/error/retry states instead.
 */
export function createUnlockDataStore({
  fetchSnapshot,
  fetchRecommendations,
  ttlMs = 30_000,
  maxEntries = 8,
  now = () => Date.now(),
} = {}) {
  if (typeof fetchSnapshot !== 'function' || typeof fetchRecommendations !== 'function') {
    throw new TypeError('createUnlockDataStore requires fetchSnapshot and fetchRecommendations');
  }
  const cache = createBoundedRequestCache({ ttlMs, maxEntries, now });

  async function read(key, fetcher, { force = false } = {}) {
    if (!force) {
      const cached = cache.get(key);
      if (cached) return cached;
    }
    const promise = Promise.resolve()
      .then(fetcher)
      .then((data) => ({ ok: true, data, error: null }))
      .catch((error) => ({ ok: false, data: null, error }));
    cache.put(key, promise);
    return promise;
  }

  return {
    getSnapshot(options) {
      return read('snapshot', fetchSnapshot, options);
    },
    getRecommendations(options) {
      return read('recommendations', fetchRecommendations, options);
    },
    async refresh() {
      const [snapshot, recommendations] = await Promise.all([
        read('snapshot', fetchSnapshot, { force: true }),
        read('recommendations', fetchRecommendations, { force: true }),
      ]);
      return { snapshot, recommendations };
    },
    invalidate() {
      cache.invalidateAll();
    },
    size: cache.size,
  };
}
