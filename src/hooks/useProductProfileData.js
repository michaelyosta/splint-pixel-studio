import { useCallback, useState } from 'react';
import { catalogApi, metaApi } from '../api/client';

export function useProductProfileData({ showNotice }) {
  const [progression, setProgression] = useState(null);
  const [dailyChallenge, setDailyChallenge] = useState(null);
  const [weeklyChallenge, setWeeklyChallenge] = useState(null);
  const [favoriteTemplates, setFavoriteTemplates] = useState([]);
  const [recentTemplates, setRecentTemplates] = useState([]);
  const [latestReward, setLatestReward] = useState(null);
  const [serverCompletedTemplateId, setServerCompletedTemplateId] = useState(null);

  const loadProductProfile = useCallback(async () => {
    const [progressionResult, dailyResult, weeklyResult, favoritesResult, historyResult] = await Promise.allSettled([
      metaApi.progression(),
      metaApi.dailyChallenge(),
      metaApi.weeklyChallenge(),
      catalogApi.favorites(),
      catalogApi.history(20),
    ]);
    if (progressionResult.status === 'fulfilled') setProgression(progressionResult.value);
    if (dailyResult.status === 'fulfilled') setDailyChallenge(dailyResult.value);
    if (weeklyResult.status === 'fulfilled') setWeeklyChallenge(weeklyResult.value);
    if (favoritesResult.status === 'fulfilled') setFavoriteTemplates(favoritesResult.value);
    if (historyResult.status === 'fulfilled') setRecentTemplates(historyResult.value);
  }, []);

  const applyRewards = useCallback((saved, templateId) => {
    const rewards = saved?.rewards;
    if (!rewards) return;
    if (rewards.progression) setProgression(rewards.progression);
    if (rewards.daily_challenge) setDailyChallenge(rewards.daily_challenge);
    if (rewards.weekly_challenge) setWeeklyChallenge(rewards.weekly_challenge);
    if (saved.percent === 100) setServerCompletedTemplateId(templateId);
    const amount = Number(rewards.xp_awarded || 0);
    if (amount > 0) {
      setLatestReward({ amount, idempotent: Boolean(saved.idempotent) });
      if (!saved.idempotent) showNotice(`+${amount} XP`, 'success');
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
