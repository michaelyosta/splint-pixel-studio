import { api, catalogApi } from '../api/client';

/** Bounded, short-lived prefetch cache: hover/touch warms the player fetch. */
const coloringPrefetchCache = new Map();
const PREFETCH_TTL_MS = 30_000;
const PREFETCH_MAX_ENTRIES = 3;

export function prefetchColoring(id) {
  const current = coloringPrefetchCache.get(id);
  if (current && current.expiresAt > Date.now()) return current.promise;
  if (current) coloringPrefetchCache.delete(id);
  while (coloringPrefetchCache.size >= PREFETCH_MAX_ENTRIES) {
    const oldest = coloringPrefetchCache.keys().next().value;
    coloringPrefetchCache.delete(oldest);
  }
  const promise = Promise.all([
    api(`/colorings/${id}`), api(`/colorings/${id}/progress`), catalogApi.zones(id),
  ]).catch((error) => { coloringPrefetchCache.delete(id); throw error; });
  coloringPrefetchCache.set(id, { promise, expiresAt: Date.now() + PREFETCH_TTL_MS });
  return promise;
}

export function takePrefetchedColoring(id) {
  const entry = coloringPrefetchCache.get(id);
  if (!entry || entry.expiresAt <= Date.now()) {
    coloringPrefetchCache.delete(id);
    return null;
  }
  coloringPrefetchCache.delete(id);
  return entry.promise;
}
