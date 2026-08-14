import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DEV_USER_ID } from '../../api/client.js';
import {
  GOAL_STATUS,
  advanceToNextGoal,
  applyVerifiedProgress,
  buildGoalView,
  createSessionState,
  deserializeSession,
  goalLabelForId,
  markFirstPaint,
  pauseSession,
  resumeSession,
  serializeSession,
  tickSession,
} from './sessionGoals.js';

function readStored(storage, key) {
  if (!storage || !key) return null;
  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    return deserializeSession(JSON.parse(raw));
  } catch {
    return null;
  }
}

/**
 * Wires the pure session-goal state machine to first-paint, server-verified
 * progress revisions, visibility/offline pauses, and advisory local timing.
 */
export function useSessionGoals({
  template,
  progress,
  zones,
  zoneIndices,
  isOnline = true,
  storage,
  enabled: enabledOverride = true,
}) {
  const enabled = Boolean(enabledOverride && template?.id && progress && Number(template.width) > 0);
  const storageKey = useMemo(
    () => (enabled ? `splint:session-goals:${DEV_USER_ID}:${template.id}` : null),
    [enabled, template?.id],
  );

  const [session, setSession] = useState(() => {
    const input = { template, progress, zones, zoneIndices };
    return createSessionState({ input, stored: readStored(storage, storageKey), now: Date.now() });
  });
  const [celebration, setCelebration] = useState(null);
  const sessionRef = useRef(session);
  const inputRef = useRef({ template, progress, zones, zoneIndices });
  const revisionRef = useRef(Number(progress?.revision || 0));
  const celebrationTimerRef = useRef(null);
  const persistTimerRef = useRef(null);

  const commit = useCallback((next) => {
    sessionRef.current = next;
    setSession(next);
  }, []);

  const showCelebration = useCallback((goalId, type) => {
    const label = goalLabelForId(inputRef.current, goalId) ?? goalId;
    setCelebration({ type, goalId, label });
  }, []);

  // New coloring resets the deterministic goal loop; local timing is advisory.
  useEffect(() => {
    if (!enabled) return;
    revisionRef.current = Number(progress?.revision || 0);
    inputRef.current = { template, progress, zones, zoneIndices };
    const next = createSessionState({
      input: inputRef.current,
      stored: readStored(storage, storageKey),
      now: Date.now(),
    });
    sessionRef.current = next;
    setSession(next);
    setCelebration(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [template?.id]);

  // Only a server /progress/actions response (revision growth) advances goals.
  useEffect(() => {
    if (!enabled) return;
    inputRef.current = { template, progress, zones, zoneIndices };
    const nextRevision = Number(progress?.revision || 0);
    if (nextRevision <= revisionRef.current) return;
    revisionRef.current = nextRevision;
    const result = applyVerifiedProgress(sessionRef.current, inputRef.current, Date.now());
    if (!result.changed) return;
    commit(result.state);
    if (result.completedGoalId) showCelebration(result.completedGoalId, 'completed');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [progress?.revision]);

  useEffect(() => {
    if (!enabled) return;
    const timer = window.setInterval(() => {
      const current = sessionRef.current;
      if (!current?.painted || current.status !== GOAL_STATUS.RUNNING) return;
      const next = tickSession(current, Date.now(), {
        visible: !document.hidden,
        online: navigator.onLine !== false && isOnline,
      });
      if (next === current) return;
      if (next.status === GOAL_STATUS.EXPIRED) {
        const advanced = advanceToNextGoal(next, inputRef.current, Date.now(), 'expired');
        commit(advanced);
        showCelebration(next.goalId, 'expired');
      } else {
        commit(next);
      }
    }, 250);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, isOnline]);

  useEffect(() => {
    if (!enabled) return;
    const handlePause = () => commit(pauseSession(sessionRef.current, Date.now()));
    const handleResume = () => commit(resumeSession(sessionRef.current, Date.now()));
    const handleVisibility = () => {
      if (document.hidden) handlePause();
      else handleResume();
    };
    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('pagehide', handlePause);
    window.addEventListener('offline', handlePause);
    window.addEventListener('online', handleResume);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('pagehide', handlePause);
      window.removeEventListener('offline', handlePause);
      window.removeEventListener('online', handleResume);
      handlePause();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  useEffect(() => {
    if (!storage || !storageKey) return;
    window.clearTimeout(persistTimerRef.current);
    persistTimerRef.current = window.setTimeout(() => {
      try {
        storage.setItem(storageKey, JSON.stringify(serializeSession(sessionRef.current)));
      } catch {
        // Local timing is advisory only; the game loop still runs in memory.
      }
    }, 120);
    return () => window.clearTimeout(persistTimerRef.current);
  }, [session, storage, storageKey]);

  useEffect(() => {
    if (!celebration) return undefined;
    window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred?.('success');
    celebrationTimerRef.current = window.setTimeout(() => setCelebration(null), 5000);
    return () => window.clearTimeout(celebrationTimerRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [celebration]);

  const handleFirstPaint = useCallback(() => {
    const current = sessionRef.current;
    if (!current || current.painted) return;
    commit(markFirstPaint(current, Date.now()));
  }, [commit]);

  const dismissCelebration = useCallback(() => setCelebration(null), []);

  const view = useMemo(
    () => (enabled ? buildGoalView({ input: { template, progress, zones, zoneIndices }, stored: session }) : null),
    [enabled, session, template, progress, zones, zoneIndices],
  );

  return {
    view,
    celebration,
    markFirstPaint: handleFirstPaint,
    dismissCelebration,
  };
}
