import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { catalogApi, unlocksApi } from '../../api/client';
import { createUnlockDataStore } from '../../lib/unlockRequests';
import {
  buildJourneyView,
  normalizeSnapshot,
  prepareRecommendations,
} from '../../lib/unlockState';

function applyEnvelope(setStatus, setError, setData, envelope, normalize) {
  if (!envelope?.ok) {
    setStatus('error');
    setError(envelope?.error || new Error('Unlock data request failed'));
    return;
  }
  try {
    setError(null);
    setData(normalize(envelope.data));
    setStatus('ready');
  } catch (error) {
    setStatus('error');
    setError(error);
  }
}

/**
 * Loads the bounded unlock snapshot and recommendations through a single
 * deduped cache. Each resource settles independently so one response cannot
 * strand the other resource in loading. Callers get deterministic
 * loading/ready/error states and an explicit refresh for post-completion
 * invalidation.
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
  const mountedRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      loadKeyRef.current += 1;
    };
  }, []);

  const load = useCallback(({ force = false } = {}) => {
    if (!enabled) return Promise.resolve();
    const key = ++loadKeyRef.current;
    setSnapshotStatus('loading');
    setSnapshotError(null);
    setRecommendationsStatus('loading');
    setRecommendationsError(null);
    const store = storeRef.current;
    const isCurrent = () => mountedRef.current && key === loadKeyRef.current;

    const settle = async (read, setStatus, setError, setData, normalize) => {
      try {
        const envelope = await read();
        if (!isCurrent()) return;
        applyEnvelope(setStatus, setError, setData, envelope, normalize);
      } catch (error) {
        if (!isCurrent()) return;
        setStatus('error');
        setError(error);
      }
    };

    return Promise.all([
      settle(
        () => store.getSnapshot({ force }),
        setSnapshotStatus,
        setSnapshotError,
        setSnapshot,
        normalizeSnapshot,
      ),
      settle(
        () => store.getRecommendations({ force }),
        setRecommendationsStatus,
        setRecommendationsError,
        setRecommendations,
        (data) => prepareRecommendations(data?.recommendations || [], { limit }),
      ),
    ]);
  }, [enabled, limit]);

  useEffect(() => {
    if (!enabled) {
      loadKeyRef.current += 1;
      setSnapshotStatus('ready');
      setSnapshotError(null);
      setRecommendationsStatus('ready');
      setRecommendationsError(null);
      return undefined;
    }
    load({ force: refreshKey > 0 });
    return () => {
      loadKeyRef.current += 1;
    };
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
