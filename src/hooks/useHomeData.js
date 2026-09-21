import { useCallback, useState } from 'react';
import { catalogApi, metaApi } from '../api/client';

export function useHomeData() {
  const [today, setToday] = useState(null);
  const [streak, setStreak] = useState(null);
  const [achievements, setAchievements] = useState([]);
  const [collections, setCollections] = useState([]);
  const [collectionsLoading, setCollectionsLoading] = useState(true);
  const [collectionsError, setCollectionsError] = useState(false);

  const loadToday = useCallback(async () => {
    try { setToday(await catalogApi.today()); } catch { /* non-critical */ }
  }, []);

  const loadStreak = useCallback(async () => {
    try { setStreak(await metaApi.streak()); } catch { /* non-critical */ }
  }, []);

  const loadAchievements = useCallback(async () => {
    try { setAchievements(await metaApi.achievements()); } catch { /* non-critical */ }
  }, []);

  const loadCollections = useCallback(async () => {
    setCollectionsLoading(true);
    setCollectionsError(false);
    try {
      setCollections(await metaApi.collections());
      setCollectionsError(false);
    } catch {
      setCollectionsError(true);
    } finally {
      setCollectionsLoading(false);
    }
  }, []);

  return {
    today,
    streak,
    achievements,
    collections,
    collectionsLoading,
    collectionsError,
    loadToday,
    loadStreak,
    loadAchievements,
    loadCollections,
  };
}
