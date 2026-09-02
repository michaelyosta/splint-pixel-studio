import { useCallback, useState } from 'react';
import { catalogApi } from '../api/client';

export function useProductProfileData({ showNotice }) {
  const progression = null;
  const dailyChallenge = null;
  const weeklyChallenge = null;
  const [favoriteTemplates, setFavoriteTemplates] = useState([]);
  const [recentTemplates, setRecentTemplates] = useState([]);
  const [latestReward, setLatestReward] = useState(null);
  const [serverCompletedTemplateId, setServerCompletedTemplateId] = useState(null);

  const loadProductProfile = useCallback(async () => {
    const [favoritesResult, historyResult] = await Promise.allSettled([
      catalogApi.favorites(),
      catalogApi.history(20),
    ]);
    if (favoritesResult.status === 'fulfilled') setFavoriteTemplates(favoritesResult.value);
    if (historyResult.status === 'fulfilled') setRecentTemplates(historyResult.value);
  }, []);

  const applyRewards = useCallback((saved, templateId, options = {}) => {
    const rewards = saved?.rewards;
    if (!rewards) return;
    if (saved.percent === 100) setServerCompletedTemplateId(templateId);
    if (saved.percent === 100 && !saved.idempotent && !options.suppressNotice) {
      showNotice('Работа добавлена в ваш профиль', 'success');
    }
  }, [showNotice]);

  return {
    progression,
    dailyChallenge,
    weeklyChallenge,
    favoriteTemplates,
    setFavoriteTemplates,
    recentTemplates,
    latestReward,
    setLatestReward,
    serverCompletedTemplateId,
    setServerCompletedTemplateId,
    loadProductProfile,
    applyRewards,
  };
}
