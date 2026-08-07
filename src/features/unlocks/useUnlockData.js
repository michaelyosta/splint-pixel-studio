import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { catalogApi, unlocksApi } from '../../api/client';
import { createUnlockDataStore } from '../../lib/unlockRequests';
import {
  buildJourneyView,
  normalizeSnapshot,
  prepareRecommendations,
} from '../../lib/unlockState';

function applyEnvelope(setStatus, setError, setData, envelope, normalize) {
  if (!envelope.ok) {
    setStatus('error');
    setError(envelope.error);
    return;
  }
  setError(null);
  setData(normalize(envelope.data));
  setStatus('ready');
}

/**
 * Loads the bounded unlock snapshot and recommendations through a single
 * deduped cache. Callers get deterministic loading/ready/error states and an
 * explicit refresh for post-completion invalidation.
 */
export function useUnlockData({
  enabled = true,
  limit = 8,
  refreshKey = 0,
  ttlMs = 30_000,
} = {}) {
  const storeRef = useRef(null);
  if (!storeRef.current) {
    storeRef.current = createUnlockDataStore({
      fetchSnapshot: () => unlocksApi.me(),
      fetchRecommendations: () => catalogApi.recommendations(limit),
      ttlMs,
    });
  }

  const [snapshot, setSnapshot] = useState(null);
  const [snapshotStatus, setSnapshotStatus] = useState('loading');
  const [snapshotError, setSnapshotError] = useState(null);
  const [recommendations, setRecommendations] = useState([]);
  const [recommendationsStatus, setRecommendationsStatus] = useState('loading');
  const [recommendationsError, setRecommendationsError] = useState(null);
  const loadKeyRef = useRef(0);

  const load = useCallback(async ({ force = false } = {}) => {
    if (!enabled) return;
    const key = ++loadKeyRef.current;
    setSnapshotStatus('loading');
    setRecommendationsStatus('loading');
    const store = storeRef.current;
    const [snapshotEnvelope, recommendationsEnvelope] = await Promise.all([
      store.getSnapshot({ force }),
      store.getRecommendations({ force }),
    ]);
    if (key !== loadKeyRef.current) return;
    applyEnvelope(setSnapshotStatus, setSnapshotError, setSnapshot, snapshotEnvelope, normalizeSnapshot);
    applyEnvelope(setRecommendationsStatus, setRecommendationsError, setRecommendations, recommendationsEnvelope, (data) => (
      prepareRecommendations(data?.recommendations || [], { limit })
    ));
  }, [enabled, limit]);

  useEffect(() => {
    if (!enabled) return;
    load({ force: refreshKey > 0 });
  }, [enabled, refreshKey, load]);

  const journey = useMemo(() => buildJourneyView(snapshot), [snapshot]);

  return {
    snapshot,
    snapshotStatus,
    snapshotError,
    recommendations,
    recommendationsStatus,
    recommendationsError,
    journey,
    refresh: useCallback(() => load({ force: true }), [load]),
  };
}
