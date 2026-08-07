import { useCallback, useEffect, useState } from 'react';
import { directorApi } from '../api/client';

/**
 * Loads the bounded guided-path Next Best Action. The endpoint is a thin
 * composition layer over existing server signals, so the client never re-ranks
 * progression; it only renders what the Director returns.
 */
export function useDirectorData({ enabled = true, refreshKey = 0, exclude = null } = {}) {
  const [nextAction, setNextAction] = useState(null);
  const [status, setStatus] = useState('loading');
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    if (!enabled) return;
    setStatus('loading');
    try {
      const data = await directorApi.next(exclude ? { exclude } : {});
      setNextAction(data);
      setError(null);
      setStatus('ready');
    } catch (requestError) {
      setError(requestError);
      setStatus('error');
    }
  }, [enabled, exclude]);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  return {
    nextAction,
    status,
    error,
    refresh: load,
  };
}
