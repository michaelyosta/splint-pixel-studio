import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Flag, Flame, Globe2, Grid3X3, Heart, ImagePlus, LoaderCircle, Send, Sparkles, Star, Trash2, BookOpen, Lock } from 'lucide-react';
import { api, downloadColoringResult, metaApi, catalogApi, DEV_USER_ID, parseUnlockLockedError } from './api/client';
import PlayerView from './views/PlayerView';
import { floodFillRegion } from './lib/floodFill';
import { buildColoringFromImage, findRewardingColor, getProgress, isProgressComplete, renderCompletedImage } from './lib/pixelColoring';
import { renderImageCropPreview, renderFitPreview, renderGridPreview, renderNumberedPreview } from './lib/imageCrop';
import { assessQualityAsync } from './lib/creatorQuality';
import { createCreatorWorkerClient } from './lib/creatorWorkerClient';
import { createTiledTemplateAsync } from './lib/tiledTemplate';
import { isLargeGridTemplate } from './lib/tileGrid';
import { createSaveQueue } from './lib/progressSaveQueue';
import { createProgressJournal } from './lib/progressJournal';
import { createHistoryOperation } from './features/coloring/engine/historyOperations.js';
import { hapticImpact, hapticSelection, shareViaTelegram, buildColoringDeepLink, getRequestedColoringId } from './lib/telegram';
import BottomNavigation from './components/BottomNavigation';
import CreateHub from './components/CreateHub';
import ManualPixelEditor from './features/creator/ManualPixelEditor';
import CreatorCollectionsManager from './features/creator/CreatorCollectionsManager';
import { useUnlockData } from './features/unlocks/useUnlockData';
import UnlockJourneyCard from './features/unlocks/UnlockJourneyCard';
import RecommendationsStrip from './features/unlocks/RecommendationsStrip';
import UnlockLockedView from './features/unlocks/UnlockLockedView';
import './App.css';
import './features/unlocks/unlocks.css';

const CATALOG_PAGE_SIZE = 12;
const CREATOR_GRID_OPTIONS = [16, 24, 32, 40, 48, 64, 80, 96, 112, 128, 144, 160, 192, 256, 384, 512, 768, 1024, 1200].map((size) => ({
  label: `${size}×${size}`,
  w: size,
  h: size,
}));

function gridDetailMeta(size) {
  if (size > 160) return { title: 'Studio', load: 'Tiled', hint: 'Large maps load in bounded tiles with one Canvas and delta-only progress.' };
  if (size <= 24) return { title: 'Эскиз', load: 'Легко', hint: 'Крупные пиксели и короткая сессия.' };
  if (size <= 48) return { title: 'Баланс', load: 'Комфортно', hint: 'Хорошая детализация для большинства изображений.' };
  if (size <= 80) return { title: 'Детально', load: 'Дольше', hint: 'Сохраняет мелкие формы и текстуры.' };
  if (size <= 96) return { title: 'Очень детально', load: 'Требовательно', hint: 'Для мощных устройств и долгих сессий.' };
  return { title: 'Студийная', load: 'Экспериментально', hint: 'Максимум текущего renderer: лучше использовать на современных устройствах.' };
}

/** Bounded, short-lived prefetch cache: hover/touch warms the player fetch. */
const coloringPrefetchCache = new Map();
const PREFETCH_TTL_MS = 30_000;
const PREFETCH_MAX_ENTRIES = 3;
function prefetchColoring(id) {
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
function takePrefetchedColoring(id) {
  const entry = coloringPrefetchCache.get(id);
  if (!entry || entry.expiresAt <= Date.now()) {
    coloringPrefetchCache.delete(id);
    return null;
  }
  coloringPrefetchCache.delete(id);
  return entry.promise;
}

function formatTimeAgo(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const seconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
  if (seconds < 60) return 'только что';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} мин назад`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ч назад`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} дн назад`;
  return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
}

const DIFFICULTIES = {
  easy: { label: 'Легко', width: 24, height: 24, colors: 8 },
  medium: { label: 'Средне', width: 32, height: 32, colors: 10 },
  hard: { label: 'Сложно', width: 40, height: 40, colors: 12 },
};

const MOODS = [
  { id: '', label: 'Все' },
  { id: 'calm', label: 'Спокойно' },
  { id: 'cozy', label: 'Уютно' },
  { id: 'focus', label: 'Фокус' },
];

const THEMES = [
  { id: '', label: 'Все' },
  { id: 'night-city', label: 'Ночной город' },
  { id: 'forest', label: 'Лес' },
  { id: 'space', label: 'Космос' },
  { id: 'cozy', label: 'Уют' },
  { id: 'travel', label: 'Путешествия' },
  { id: 'sea', label: 'Море' },
];

function formatDifficulty(value) {
  return DIFFICULTIES[value]?.label || value || 'Своя';
}

function ArtworkPreview({ src, alt }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  if (!src || failed) return <div className="post-image post-image-fallback"><ImagePlus size={28} /><span>Превью восстанавливается</span></div>;
  return <img className="post-image" loading="lazy" src={src} alt={alt} onError={() => setFailed(true)} />;
}

function App() {
  const [view, setView] = useState('home');
  const [templates, setTemplates] = useState([]);
  const [template, setTemplate] = useState(null);
  const [progress, setProgress] = useState(null);
  const [zones, setZones] = useState([]);
  const [selectedColor, setSelectedColor] = useState(0);
  const [history, setHistory] = useState([]);
  const [future, setFuture] = useState([]);
  const [loading, setLoading] = useState(true);
  const [catalogError, setCatalogError] = useState(false);
  const [mineError, setMineError] = useState(false);
  const [feedError, setFeedError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [isOnline, setIsOnline] = useState(() => typeof navigator === 'undefined' || navigator.onLine !== false);
  const [saveState, setSaveState] = useState('saved');
  const [publishing, setPublishing] = useState(false);
  const [notice, setNotice] = useState(null);
  const [feed, setFeed] = useState([]);
  const [commentsByPost, setCommentsByPost] = useState({});
  const [openCommentsPostId, setOpenCommentsPostId] = useState(null);
  const [commentDraft, setCommentDraft] = useState('');
  const [mine, setMine] = useState([]);
  const [file, setFile] = useState(null);
  const [title, setTitle] = useState('Моя пиксельная раскраска');
  const [creating, setCreating] = useState(false);
  const [currentUser, setCurrentUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [profileArtworks, setProfileArtworks] = useState([]);
  // 24×24 with eight colours is quick, but it flattens most user photos and
  // illustrations before the converter has a chance to preserve their forms.
  const [creatorGrid, setCreatorGrid] = useState({ width: 32, height: 32 });
  const [creatorColors, setCreatorColors] = useState(10);
  const [creatorCrop, setCreatorCrop] = useState({ scale: 1, offsetX: 0, offsetY: 0 });
  const [creatorCropMode, setCreatorCropMode] = useState('fit');
  const [creatorImageUrl, setCreatorImageUrl] = useState(null);
  const [creatorResult, setCreatorResult] = useState(null);
  const [creatorQuality, setCreatorQuality] = useState(null);
  const [creatorPreviews, setCreatorPreviews] = useState({ original: null, pixel: null, numbered: null });
  const [creatorComputing, setCreatorComputing] = useState(false);
  const [createdColoring, setCreatedColoring] = useState(null);
  const creatorComputeRef = useRef(0);
  const creatorFileRef = useRef(null);
  const [combo, setCombo] = useState(0);
  const [zoneReward, setZoneReward] = useState(null);
  const [filters, setFilters] = useState({ mood: '', theme: '', max_minutes: '' });
  const [catalogQuery, setCatalogQuery] = useState('');
  const [catalogChip, setCatalogChip] = useState('all');
  const [catalogCollection, setCatalogCollection] = useState(null);
  const [feedMode, setFeedMode] = useState('recommended');
  const [today, setToday] = useState(null);
  const [streak, setStreak] = useState(null);
  const [achievements, setAchievements] = useState([]);
  const [collections, setCollections] = useState([]);
  const [progression, setProgression] = useState(null);
  const [dailyChallenge, setDailyChallenge] = useState(null);
  const [weeklyChallenge, setWeeklyChallenge] = useState(null);
  const [latestReward, setLatestReward] = useState(null);
  const [serverCompletedTemplateId, setServerCompletedTemplateId] = useState(null);
  const [tiledResultUrl, setTiledResultUrl] = useState(null);
  const [favoriteTemplates, setFavoriteTemplates] = useState([]);
  const [recentTemplates, setRecentTemplates] = useState([]);
  const [profileShelf, setProfileShelf] = useState('works');
  const [favoriteSavingId, setFavoriteSavingId] = useState(null);
  const [calmMode, setCalmMode] = useState(false);
  const [hideNumbers, setHideNumbers] = useState(false);
  const [hintMode, setHintMode] = useState(false);
  const [hintsRemaining, setHintsRemaining] = useState(5);
  const [fillMode, setFillMode] = useState(false);
  const [playMode, setPlayMode] = useState('classic');
  const [completionOpen, setCompletionOpen] = useState(false);
  const [lockedUnlock, setLockedUnlock] = useState(null);
  const [unlockRefreshKey, setUnlockRefreshKey] = useState(0);
  const unlockData = useUnlockData({ enabled: true, refreshKey: unlockRefreshKey });
  const [onboarding, setOnboarding] = useState(null);
  const [sharing, setSharing] = useState(false);
  const [likingPostId, setLikingPostId] = useState(null);
  const [submittingComment, setSubmittingComment] = useState(false);
  const [followingAuthorId, setFollowingAuthorId] = useState(null);
  const [publishingTemplateId, setPublishingTemplateId] = useState(null);
  const [ratingTemplateId, setRatingTemplateId] = useState(null);
  const [visibleCount, setVisibleCount] = useState(CATALOG_PAGE_SIZE);
  const sessionStartRef = useRef(0);
  const screenContentRef = useRef(null);
  const catalogScrollRef = useRef(0);
  const deepLinkHandledRef = useRef(false);
  const unlockRefreshedRef = useRef(new Set());

  const saveQueueRef = useRef(null);
  const tiledQueueRef = useRef([]);
  const tiledRevisionRef = useRef(0);
  const tiledFlushPromiseRef = useRef(null);

  const noticeTimerRef = useRef(null);
  const lastPaintRef = useRef(0);
  const comboRef = useRef(0);
  const milestoneRef = useRef(new Set());
  const zoneMilestoneRef = useRef(new Set());
  const paintedRef = useRef(false);
  const completedTemplateRef = useRef(null);
  const filledRef = useRef([]);

  useEffect(() => {
    const handleOffline = () => {
      setIsOnline(false);
      setSaveState('offline');
    };
    const handleOnline = async () => {
      setIsOnline(true);
      if (isLargeGridTemplate(template)) {
        setSaveState('syncing');
        try {
          await flushTiledQueue();
          setSaveState('saved');
        } catch {
          setSaveState('pending');
        }
        return;
      }
      if (!saveQueueRef.current || !template?.id) {
        setSaveState('saved');
        return;
      }
      setSaveState('syncing');
      try {
        await saveQueueRef.current.recover({ templateId: template.id, serverRevision: progress?.revision });
        await saveQueueRef.current.flush();
        setSaveState('saved');
      } catch {
        setSaveState('pending');
      }
    };
    window.addEventListener('offline', handleOffline);
    window.addEventListener('online', handleOnline);
    return () => {
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('online', handleOnline);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [progress?.revision, template?.id]);

  function tiledJournalKey(templateId) {
    return `splint:tiled-progress:${DEV_USER_ID}:${templateId}`;
  }

  function readTiledJournal(templateId) {
    try {
      const parsed = JSON.parse(window.localStorage.getItem(tiledJournalKey(templateId)) || '[]');
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  function writeTiledJournal(templateId) {
    try {
      if (tiledQueueRef.current.length) window.localStorage.setItem(tiledJournalKey(templateId), JSON.stringify(tiledQueueRef.current));
      else window.localStorage.removeItem(tiledJournalKey(templateId));
    } catch {
      // The in-memory queue remains usable when storage is unavailable.
    }
  }

  async function flushTiledQueue() {
    if (tiledFlushPromiseRef.current) return tiledFlushPromiseRef.current;
    if (!template?.id || !isLargeGridTemplate(template) || !isOnline) return undefined;
    const flush = (async () => {
      while (tiledQueueRef.current.length) {
        const entry = tiledQueueRef.current[0];
        for (let offset = 0; offset < entry.changes.length; offset += 64) {
          const batch = entry.changes.slice(offset, offset + 64);
          const clientBatchId = `${entry.clientBatchId}:${Math.floor(offset / 64)}`;
          let saved;
          for (let attempt = 0; attempt < 2; attempt += 1) {
            try {
              saved = await api(`/colorings/${template.id}/progress/actions`, {
                method: 'POST',
                body: {
                  changes: batch,
                  revision: tiledRevisionRef.current,
                  clientBatchId,
                },
              });
              break;
            } catch (error) {
              // Another device may have committed a batch while this queue
              // was offline. Adopt its revision and replay our idempotent
              // batch once instead of trapping the queue in a permanent 409.
              if (error.status !== 409 || !error.data?.progress || attempt > 0) throw error;
              tiledRevisionRef.current = Number(error.data.progress.revision || tiledRevisionRef.current);
            }
          }
          tiledRevisionRef.current = saved.revision;
          setProgress(saved);
          applyAuthoritativeRewards(saved, template.id);
        }
        tiledQueueRef.current.shift();
        writeTiledJournal(template.id);
      }
    })();
    tiledFlushPromiseRef.current = flush;
    try {
      return await flush;
    } finally {
      if (tiledFlushPromiseRef.current === flush) tiledFlushPromiseRef.current = null;
    }
  }

  const showNotice = useCallback((text, type = 'info') => {
    window.clearTimeout(noticeTimerRef.current);
    setNotice({ text, type });
    noticeTimerRef.current = window.setTimeout(() => setNotice(null), 3500);
  }, []);

  const loadCatalog = useCallback(async () => {
    setLoading(true);
    try {
      const data = await catalogApi.list(filters);
      setTemplates(data);
      setCatalogError(false);
    } catch (error) {
      showNotice(error.message, 'error');
      setCatalogError(true);
    } finally {
      setLoading(false);
    }
  }, [filters, showNotice]);

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
    try { setCollections(await metaApi.collections()); } catch { /* non-critical */ }
  }, []);

  function applyAuthoritativeRewards(saved, templateId) {
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
  }

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

  const loadMine = useCallback(async () => {
    try {
      setMine(await api('/colorings/mine'));
      setMineError(false);
    } catch (error) {
      showNotice(error.message, 'error');
      setMineError(true);
    }
  }, [showNotice]);

  const loadFeed = useCallback(async (mode = 'recommended') => {
    try {
      const page = await api(`/feed/${mode}?limit=20`);
      setFeed(Array.isArray(page) ? page : (page.items || []));
      setFeedError(false);
    } catch (error) {
      showNotice(error.message, 'error');
      setFeedError(true);
    }
  }, [showNotice]);

  const loadProfile = useCallback(async (userId = null) => {
    try {
      const nextProfile = await api(userId ? `/users/${userId}/profile` : '/users/me');
      const artworks = await api(`/users/${nextProfile.id}/artworks`);
      setProfile(nextProfile);
      setProfileArtworks(artworks.filter((artwork) => artwork.is_completed));
      if (!userId) setCurrentUser(nextProfile);
    } catch (error) {
      showNotice(error.message, 'error');
    }
  }, [showNotice]);

  const openCatalogCollection = useCallback(async (collection) => {
    try {
      const items = await metaApi.collectionTemplates(collection.id);
      setTemplates(items);
      setCatalogCollection(collection);
      setCatalogChip('collections');
      setCatalogQuery('');
      setView('catalog');
      showNotice(`Открыта коллекция «${collection.title}»`, 'info');
    } catch (error) {
      showNotice(error.message, 'error');
    }
  }, [showNotice]);

  const resetCatalogScope = useCallback(() => {
    setCatalogCollection(null);
    setCatalogChip('all');
    setCatalogQuery('');
    loadCatalog();
  }, [loadCatalog]);

  useEffect(() => { loadCatalog(); loadToday(); loadStreak(); loadAchievements(); loadCollections(); loadProfile(); loadMine(); loadProductProfile(); }, [loadCatalog, loadToday, loadStreak, loadAchievements, loadCollections, loadProfile, loadMine, loadProductProfile]);
  // Deep link (?coloring=<id> или Telegram start_param) — открыть раскраску сразу.
  useEffect(() => {
    if (deepLinkHandledRef.current || loading) return;
    const requestedId = getRequestedColoringId();
    if (!requestedId) return;
    deepLinkHandledRef.current = true;
    openColoring(requestedId);
  }, [loading]);
  const creatorTimerRef = useRef(null);
  const computeRef = useRef(null);
  const creatorWorkerRef = useRef(null);
  if (!creatorWorkerRef.current) creatorWorkerRef.current = createCreatorWorkerClient();
  computeRef.current = computeCreatorPreview;
  useEffect(() => {
    if (!creatorImageUrl) return;
    window.clearTimeout(creatorTimerRef.current);
    creatorTimerRef.current = window.setTimeout(() => computeRef.current(), 400);
    return () => window.clearTimeout(creatorTimerRef.current);
  }, [creatorGrid, creatorColors, creatorCrop, creatorCropMode, creatorImageUrl]);
  useEffect(() => {
    const flushOnHide = () => { saveQueueRef.current?.flushAndDispose(); };
    window.addEventListener('pagehide', flushOnHide);
    return () => {
      window.removeEventListener('pagehide', flushOnHide);
      if (saveQueueRef.current) {
        saveQueueRef.current.flushAndDispose();
        saveQueueRef.current = null;
      }
      window.clearTimeout(noticeTimerRef.current);
    };
  }, []);
  useEffect(() => { if (view === 'gallery' || view === 'home') loadMine(); }, [view, loadMine]);
  // Каталог показывает свежие проценты и баннер «Продолжить» после возврата из плеера.
  useEffect(() => { if (view === 'catalog') loadMine(); }, [view, loadMine]);
  useEffect(() => { if (view === 'feed') loadFeed(feedMode); }, [view, feedMode, loadFeed]);
  useEffect(() => { if (view === 'profile') loadProfile(); }, [view, loadProfile]);
  useEffect(() => { if (view === 'profile' || view === 'home') loadProductProfile(); }, [view, loadProductProfile]);
  useEffect(() => { if (view === 'collections') loadCollections(); }, [view, loadCollections]);
  // Новый набор карточек — начинаем с первой страницы.
  useEffect(() => { setVisibleCount(CATALOG_PAGE_SIZE); }, [templates]);
  useEffect(() => { setVisibleCount(CATALOG_PAGE_SIZE); }, [catalogChip, catalogQuery, catalogCollection]);
  // Возвращаем пользователя на то место каталога, откуда он ушёл в плеер.
  useEffect(() => {
    if (view !== 'catalog') return;
    const el = screenContentRef.current;
    if (!el) return;
    requestAnimationFrame(() => { el.scrollTop = catalogScrollRef.current; });
  }, [view]);
  useEffect(() => {
    if (view === 'play' && isLargeGridTemplate(template) && isOnline && tiledQueueRef.current.length) {
      flushTiledQueue().catch(() => setSaveState('pending'));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, template?.id, template?.storage_mode, template?.width, template?.height, isOnline]);

  async function openColoring(id) {
    catalogScrollRef.current = screenContentRef.current?.scrollTop ?? 0;
    setLockedUnlock(null);
    setLoading(true);
    try {
      const prefetched = takePrefetchedColoring(id);
      const [nextTemplate, nextProgress, nextZones] = prefetched
        ? await prefetched
        : await Promise.all([api(`/colorings/${id}`), api(`/colorings/${id}/progress`), catalogApi.zones(id)]);
      setTemplate(nextTemplate);
      setProgress(nextProgress);
      setSaveState('saved');
      setLatestReward(Number(nextProgress.completion_reward_xp || 0) > 0
        ? { amount: Number(nextProgress.completion_reward_xp), idempotent: true }
        : null);
      completedTemplateRef.current = null;
      setServerCompletedTemplateId(nextProgress.percent === 100 ? nextTemplate.id : null);
      filledRef.current = nextProgress.filled || [];
      setZones(nextZones.zones || []);
      zoneIndicesRef.current = Object.fromEntries((nextZones.zones || []).map((zone) => [zone.id, zone.indices || []]));
      if (saveQueueRef.current) {
        // Дожимаем неотправленные штрихи предыдущей раскраски до dispose.
        await saveQueueRef.current.flushAndDispose();
        saveQueueRef.current = null;
        setSaving(false);
      }
      tiledQueueRef.current = isLargeGridTemplate(nextTemplate) ? readTiledJournal(nextTemplate.id) : [];
      tiledRevisionRef.current = Number(nextProgress.revision || 0);
      if (!isLargeGridTemplate(nextTemplate)) {
        let lastAuthoritativeFilled = [...nextProgress.filled];
        let lastAuthoritativeProgress = nextProgress;
        saveQueueRef.current = createSaveQueue({
        putProgress: async ({ filled, revision, clientBatchId }) => {
          const changes = filled.flatMap((color, index) => (
            color === lastAuthoritativeFilled[index] ? [] : [{ index, color }]
          ));
          if (!changes.length) return lastAuthoritativeProgress;
          let saved = lastAuthoritativeProgress;
          let nextRevision = revision;
          for (let offset = 0; offset < changes.length; offset += 64) {
            const batch = changes.slice(offset, offset + 64);
            saved = await api(`/colorings/${nextTemplate.id}/progress/actions`, {
              method: 'POST',
              body: {
                changes: batch,
                revision: nextRevision,
                clientBatchId: `${clientBatchId}:${Math.floor(offset / 64)}`,
              },
            });
            lastAuthoritativeFilled = [...saved.filled];
            lastAuthoritativeProgress = saved;
            nextRevision = saved.revision;
          }
          return saved;
        },
        getResultDataUrl: (filled) => {
          return filled.every((color, index) => color === nextTemplate.cells[index])
            ? renderCompletedImage(nextTemplate, filled)
            : null;
        },
         onProgress: (saved) => {
           setProgress(saved);
           applyAuthoritativeRewards(saved, nextTemplate.id);
         },
        onNotice: (message, type) => {
          if (type === 'error') setSaveState(isOnline ? 'pending' : 'offline');
          showNotice(message, type);
        },
        onSaving: (value) => {
          setSaving(value);
          if (value) setSaveState(isOnline ? 'syncing' : 'offline');
          else if (isOnline) setSaveState('saved');
        },
        journal: createProgressJournal({ scope: `${DEV_USER_ID}:${nextTemplate.id}` }),
        templateId: nextTemplate.id,
        userScope: DEV_USER_ID,
        });
        saveQueueRef.current.reset(nextProgress.revision);
        saveQueueRef.current.recover({ templateId: nextTemplate.id, serverRevision: nextProgress.revision }).catch(() => {});
      }
      setSelectedColor(isLargeGridTemplate(nextTemplate) ? 0 : findRewardingColor(nextTemplate, nextProgress.filled) ?? 0);
      setPlayMode('classic');
      setFillMode(false);
      setHistory([]);
      setFuture([]);
      comboRef.current = 0;
      setCombo(0);
      milestoneRef.current = new Set([25, 50, 75, 100].filter((value) => nextProgress.percent >= value));
      zoneMilestoneRef.current = new Set((nextZones.zones || []).filter((z) => z.percent >= 100).map((z) => z.id));
      paintedRef.current = false;
      sessionStartRef.current = Date.now();
      setView('play');
      if (nextTemplate.unlock_granted || nextTemplate.unlock_state === 'owned') {
        unlockRefreshedRef.current.add(nextTemplate.id);
        setUnlockRefreshKey((key) => key + 1);
      }
      metaApi.track('open_level', { id });
    } catch (error) {
      const unlock = parseUnlockLockedError(error);
      if (unlock) {
        setLockedUnlock(unlock);
        setView('play');
        metaApi.track('unlock_locked_view', { id, code: unlock.reason_code }).catch(() => {});
      } else {
        showNotice(error.message, 'error');
      }
    } finally {
      setLoading(false);
    }
  }

  function queueSave(nextFilled) {
    if (saveQueueRef.current) saveQueueRef.current.queueSave(nextFilled);
  }

  function handleTiledStrokeCommitted(changes, operation) {
    if (!isLargeGridTemplate(template) || !Array.isArray(changes) || !changes.length) return;
    const entry = {
      clientBatchId: `tiled-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      changes: changes.map((change) => ({ index: change.index, color: change.to })),
    };
    tiledQueueRef.current.push(entry);
    writeTiledJournal(template.id);
    const correctDelta = changes.reduce((total, change) => total + (change.to === -1 ? -1 : 1), 0);
    setProgress((current) => {
      if (!current) return current;
      const completedCells = Math.max(0, Math.min(current.total_cells, current.completed_cells + correctDelta));
      return { ...current, completed_cells: completedCells, percent: Math.round((completedCells / current.total_cells) * 100) };
    });
    if (operation) {
      setHistory((current) => [...current.slice(-99), operation]);
      setFuture([]);
    }
    handleFirstPaint();
    setSaveState(isOnline ? 'syncing' : 'offline');
    flushTiledQueue().then(() => setSaveState('saved')).catch(() => setSaveState('pending'));
  }

  async function retryPendingSave() {
    if (isLargeGridTemplate(template)) {
      if (!isOnline) {
        showNotice('Соединение ещё не восстановилось', 'info');
        return;
      }
      setSaveState('syncing');
      try {
        await flushTiledQueue();
        setSaveState('saved');
        showNotice('Прогресс отправлен', 'success');
      } catch (error) {
        setSaveState('pending');
        showNotice(error.message || 'Не удалось отправить прогресс', 'error');
      }
      return;
    }
    if (!saveQueueRef.current || !template?.id || !isOnline) {
      if (!isOnline) showNotice('Соединение ещё не восстановилось', 'info');
      return;
    }
    setSaveState('syncing');
    try {
      await saveQueueRef.current.recover({ templateId: template.id, serverRevision: progress?.revision });
      await saveQueueRef.current.flush();
      setSaveState('saved');
      showNotice('Прогресс отправлен', 'success');
    } catch (error) {
      setSaveState('pending');
      showNotice(error.message || 'Не удалось отправить прогресс', 'error');
    }
  }

  function applyFilled(nextFilled, change) {
    filledRef.current = nextFilled;
    setProgress((current) => ({ ...current, filled: nextFilled, ...getProgress(template.cells, nextFilled) }));
    if (change) {
      setHistory((current) => [...current.slice(-99), change]);
      setFuture([]);
    }
    queueSave(nextFilled);
  }

  function handleFirstPaint() {
    if (paintedRef.current) return;
    paintedRef.current = true;
    const timeToAction = Date.now() - sessionStartRef.current;
    metaApi.track('first_pixel', { id: template?.id, time_to_first_action_ms: timeToAction });
  }

  function refreshZones(nextFilled) {
    if (!zones.length) return;
    const nextZones = zones.map((zone) => {
      const indices = zoneIndicesRef.current[zone.id] || [];
      const done = indices.reduce((count, index) => count + (nextFilled[index] === template.cells[index] ? 1 : 0), 0);
      const percent = indices.length ? Math.round((done / indices.length) * 100) : 100;
      return { ...zone, done, percent };
    });
    setZones(nextZones);
    return nextZones;
  }

  function celebrateCompletedZone(nextZones) {
    const completedZone = nextZones?.find((zone) => zone.percent === 100 && !zoneMilestoneRef.current.has(zone.id));
    if (!completedZone) return false;
    zoneMilestoneRef.current.add(completedZone.id);
    setZoneReward(`Фрагмент «${completedZone.title}» раскрыт`);
    window.setTimeout(() => setZoneReward(null), 2200);
    window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred?.('success');
    metaApi.track('zone_complete', { id: template.id, zone: completedZone.id });
    return true;
  }

  const zoneIndicesRef = useRef({});

  function handleStrokeCommitted(nextFilled, operation) {
    handleFirstPaint();
    const now = Date.now();
    const strokeCount = operation?.changes?.length || 1;
    const nextCombo = now - lastPaintRef.current < 2200 ? comboRef.current + strokeCount : 1;
    lastPaintRef.current = now;
    comboRef.current = nextCombo;
    setCombo(nextCombo);
    applyFilled(nextFilled, operation);
    const nextProgress = getProgress(template.cells, nextFilled);
    [25, 50, 75, 100].forEach((value) => {
      if (nextProgress.percent >= value && !milestoneRef.current.has(value)) {
        milestoneRef.current.add(value);
        metaApi.track(`reach_${value}`, { id: template.id }).catch(() => {});
      }
    });
    const nextZones = refreshZones(nextFilled);
    return celebrateCompletedZone(nextZones);
  }

  function handleFillAt(index) {
    if (onboarding !== null) dismissOnboarding();
    if (!fillMode || !progress || filledRef.current[index] !== -1) return;
    const targetColor = template.cells[index];
    if (selectedColor !== targetColor) setSelectedColor(targetColor);
    const region = floodFillRegion(template, filledRef.current, index);
    if (!region.length) return;
    const nextFilled = [...filledRef.current];
    region.forEach((cell) => { nextFilled[cell] = targetColor; });
    const changes = region.map((idx) => ({ index: idx, from: -1, to: targetColor }));
    const completedZone = handleStrokeCommitted(
      nextFilled,
      createHistoryOperation({ type: 'fill', changes, color: targetColor }),
    );
    if (!completedZone) window.Telegram?.WebApp?.HapticFeedback?.impactOccurred?.('medium');
  }

  function handleWrongCell() {
    comboRef.current = 0;
    setCombo(0);
    window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred?.('error');
  }

  function undo() {
    const last = history.at(-1);
    if (!last || !progress) return;
    const nextFilled = [...filledRef.current];
    for (const change of last.changes) {
      nextFilled[change.index] = change.from;
    }
    setHistory((current) => current.slice(0, -1));
    setFuture((current) => [...current, last]);
    applyFilled(nextFilled);
    refreshZones(nextFilled);
  }

  function redo() {
    const next = future.at(-1);
    if (!next || !progress) return;
    const nextFilled = [...filledRef.current];
    for (const change of next.changes) {
      nextFilled[change.index] = change.to;
    }
    setFuture((current) => current.slice(0, -1));
    setHistory((current) => [...current, next]);
    applyFilled(nextFilled);
    refreshZones(nextFilled);
  }

  function resetProgress() {
    if (!progress || !window.confirm('Очистить весь прогресс этой раскраски?')) return;
    applyFilled(Array(template.cells.length).fill(-1));
    setHistory([]);
    setFuture([]);
    zoneMilestoneRef.current = new Set();
  }

  function resultFilename() {
    return `${template.title || 'splint-result'}`.replace(/[\\/:*?"<>|]/g, '-').trim().slice(0, 80) || 'splint-result';
  }

  async function publishCompleted() {
    if (saving || !progress?.artwork_id) {
      if (!progress?.artwork_id) showNotice('Работа ещё сохраняется. Подождите несколько секунд.', 'info');
      return;
    }
    setPublishing(true);
    try {
      await api('/posts/create', { method: 'POST', body: { artworkId: progress.artwork_id, title: template.title, caption: `Завершил(а) раскраску «${template.title}»!`, commentsEnabled: true } });
      showNotice('Работа опубликована в ленте', 'success');
      metaApi.track('publish', { id: template.id });
      setCompletionOpen(false);
      loadFeed(feedMode);
      setView('feed');
    } catch (error) {
      if (error.status === 409) {
        showNotice('Эта работа уже опубликована', 'info');
        setCompletionOpen(false);
        setView('feed');
      } else {
        showNotice(error.message, 'error');
      }
    } finally {
      setPublishing(false);
    }
  }

  async function shareResult() {
    if (!completedPreview) return;
    setSharing(true);
    try {
      const url = buildColoringDeepLink(template.id);
      const text = `Я завершил(а) раскраску «${template.title}» в SPLINT Pixel Studio!`;
      const channel = await shareViaTelegram({ url, text });
      if (channel === 'telegram') metaApi.track('share_telegram', { id: template.id });
      else if (channel === 'native') metaApi.track('share_native', { id: template.id });
      else downloadResult();
    } catch (error) {
      if (error.name !== 'AbortError') showNotice('Не удалось открыть меню отправки', 'error');
    } finally {
      setSharing(false);
    }
  }

  function downloadResult() {
    if (!completedPreview) return;
    const link = document.createElement('a');
    link.href = completedPreview;
    link.download = `${resultFilename()}.png`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    metaApi.track('download_result', { id: template.id });
  }

  async function computeCreatorPreview() {
    const sourceFile = creatorFileRef.current || file;
    if (!sourceFile) return;
    setCreatorComputing(true);
    const id = ++creatorComputeRef.current;
    let imgUrl;
    try {
      imgUrl = URL.createObjectURL(sourceFile);
      const img = new window.Image();
      img.src = imgUrl;
      await img.decode();
      const preset = { width: creatorGrid.width, height: creatorGrid.height, colors: creatorColors };
      const crop = creatorCropMode === 'crop' ? creatorCrop : null;
      let data;
      if (creatorWorkerRef.current) {
        try {
          data = await creatorWorkerRef.current.run(sourceFile, { ...preset, crop });
        } catch (workerError) {
          if (workerError?.name === 'AbortError') throw workerError;
          // Older WebViews may expose Worker but not the full canvas/File API
          // used by the pipeline. Retire the failed worker and keep the
          // user-facing flow available on the main thread.
          creatorWorkerRef.current.dispose();
          creatorWorkerRef.current = null;
          data = await buildColoringFromImage(sourceFile, { ...preset, crop, yieldEvery: 96 });
        }
      } else {
        data = await buildColoringFromImage(sourceFile, { ...preset, crop, yieldEvery: 96 });
      }
      if (id !== creatorComputeRef.current) return;
      const { width, height, palette, cells } = data;
      const originalPreview = crop ? renderImageCropPreview(img, { ...creatorCrop, size: 512 }) : renderFitPreview(img, 512);
      if (id !== creatorComputeRef.current) return;
      // The creator pipeline already produces the bounded 512px preview in
      // the worker. Re-rendering all 1.44M cells here would put the exact
      // large-grid bottleneck back on the UI thread.
      const pixelPreview = data.previewDataUrl || renderGridPreview(width, height, palette, cells);
      if (id !== creatorComputeRef.current) return;
      // A numbered 1200x1200 canvas would allocate hundreds of megabytes and
      // spend most of the preview time painting text that cannot be read at
      // the card's size. Large creator maps use the bounded pixel preview;
      // numbered previews remain useful for the legacy-sized maps.
      const numberedPreview = width > 160 || height > 160 ? null : renderNumberedPreview(width, height, palette, cells);
      if (id !== creatorComputeRef.current) return;
      const quality = data.quality || await assessQualityAsync(width, height, palette, cells, { yieldEvery: 96 });
      if (id !== creatorComputeRef.current) return;
      setCreatorPreviews({ original: originalPreview, pixel: pixelPreview, numbered: numberedPreview });
      const creatorPayload = width > 160 || height > 160
        ? await (async () => {
          const metadata = { ...data };
          delete metadata.cells;
          delete metadata.originalDataUrl;
          delete metadata.quality;
          // The worker already performs the 1.44M-cell -> tile conversion.
          // Keep the synchronous fallback for older WebViews without Worker.
          const tiled = data.tiles
            ? data
            : await createTiledTemplateAsync({ width, height, palette, cells: data.cells }, { yieldEvery: 24 });
          return { ...metadata, tiles: tiled.tiles, tileSize: tiled.tileSize || 32, originalDataUrl: null };
        })()
        : data;
      setCreatorResult(creatorPayload);
      setCreatorQuality(quality);
    } catch (error) {
      showNotice(error.message || 'Не удалось обработать изображение', 'error');
    } finally {
      if (imgUrl) URL.revokeObjectURL(imgUrl);
      if (id === creatorComputeRef.current) setCreatorComputing(false);
    }
  }

  async function prepareFromImage(f) {
    const img = f || file;
    if (!img) return;
    creatorFileRef.current = img;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(img.type) || img.size > 10 * 1024 * 1024) {
      return showNotice('Поддерживаются PNG, JPG и WebP размером до 10 МБ', 'error');
    }
    const url = URL.createObjectURL(img);
    setCreatorImageUrl(url);
    setCreatorResult(null);
    setCreatorQuality(null);
    setCreatorPreviews({ original: null, pixel: null, numbered: null });
    setCreatorCrop({ scale: 1, offsetX: 0, offsetY: 0 });
    setCreatorCropMode('fit');
  }

  async function saveDraftColoring() {
    if (!creatorResult) return;
    setCreating(true);
    try {
      const created = await api('/colorings/create', { method: 'POST', body: { title, description: 'Создано из пользовательского изображения', ...creatorResult } });
      const successPreview = created.preview_url || creatorPreviews.pixel || creatorPreviews.numbered || null;
      setCreatorResult(null);
      setFile(null);
      creatorFileRef.current = null;
      setCreatorImageUrl(null);
      setCreatorPreviews({ original: null, pixel: null, numbered: null });
      setCreatorQuality(null);
      await loadMine();
      metaApi.track('create_coloring', { id: created.id });
      setCreatedColoring({ id: created.id, title: created.title || title, previewUrl: successPreview });
      setView('created');
    } catch (error) {
      showNotice(error.message, 'error');
    } finally {
      setCreating(false);
    }
  }

  async function saveManualColoring(payload) {
    setCreating(true);
    try {
      const created = await api('/colorings/create', {
        method: 'POST',
        body: { description: 'Нарисовано вручную в Splint Pixel Studio', ...payload },
      });
      await Promise.all([loadMine(), loadCatalog()]);
      metaApi.track('create_manual_coloring', { id: created.id });
      setCreatedColoring({ id: created.id, title: created.title || payload.title, previewUrl: created.preview_url || payload.previewDataUrl || null });
      setView('created');
    } catch (error) {
      showNotice(error.message, 'error');
      throw error;
    } finally {
      setCreating(false);
    }
  }

  async function deleteColoring(item) {
    if (!window.confirm(`Удалить раскраску «${item.title}» и связанный прогресс?`)) return;
    try {
      await api(`/colorings/${item.id}`, { method: 'DELETE' });
      await Promise.all([loadMine(), loadCatalog()]);
      showNotice('Раскраска удалена', 'success');
    } catch (error) {
      showNotice(error.message, 'error');
    }
  }

  async function setColoringVisibility(item) {
    if (publishingTemplateId) return;
    const visibility = item.visibility === 'public' ? 'private' : 'public';
    if (visibility === 'public' && !window.confirm('Опубликовать раскраску в общем каталоге? Убедитесь, что у вас есть право делиться исходным изображением.')) return;
    setPublishingTemplateId(item.id);
    try {
      const updated = await api(`/colorings/${item.id}/visibility`, { method: 'PATCH', body: { visibility } });
      setMine((current) => current.map((entry) => entry.id === item.id ? { ...entry, ...updated } : entry));
      await loadCatalog();
      showNotice(visibility === 'public' ? 'Раскраска опубликована в каталоге' : 'Раскраска снята с публикации', 'success');
    } catch (error) {
      showNotice(error.message, 'error');
    } finally {
      setPublishingTemplateId(null);
    }
  }

  async function rateColoring(item, rating) {
    if (ratingTemplateId) return;
    hapticSelection();
    setRatingTemplateId(item.id);
    try {
      const clearRating = item.viewer_rating === rating;
      const updated = await api(`/colorings/${item.id}/rating`, {
        method: clearRating ? 'DELETE' : 'PUT',
        body: clearRating ? undefined : { rating },
      });
      setTemplates((current) => current.map((entry) => entry.id === item.id ? { ...entry, ...updated } : entry));
    } catch (error) {
      showNotice(error.message, 'error');
    } finally {
      setRatingTemplateId(null);
    }
  }

  async function toggleTemplateFavorite(item) {
    if (favoriteSavingId) return;
    const nextFavorite = !item.is_favorite;
    hapticSelection();
    setFavoriteSavingId(item.id);
    try {
      await catalogApi.setFavorite(item.id, nextFavorite);
      setTemplates((current) => current.map((entry) => entry.id === item.id ? { ...entry, is_favorite: nextFavorite } : entry));
      setFavoriteTemplates((current) => nextFavorite
        ? [{ ...item, is_favorite: true }, ...current.filter((entry) => entry.id !== item.id)]
        : current.filter((entry) => entry.id !== item.id));
      showNotice(nextFavorite ? 'Добавлено в избранное' : 'Удалено из избранного', 'success');
    } catch (error) {
      showNotice(error.message, 'error');
    } finally {
      setFavoriteSavingId(null);
    }
  }

  async function toggleLike(post) {
    if (likingPostId) return;
    hapticImpact('light');
    setLikingPostId(post.id);
    try {
      await api(`/posts/${post.id}/like`, { method: post.is_liked ? 'DELETE' : 'POST' });
      loadFeed(feedMode);
      metaApi.track('like', { post: post.id });
    } catch (error) {
      showNotice(error.message, 'error');
    } finally {
      setLikingPostId(null);
    }
  }

  async function toggleComments(postId) {
    if (openCommentsPostId === postId) {
      setOpenCommentsPostId(null);
      return;
    }
    try {
      const comments = await api(`/posts/${postId}/comments`);
      setCommentsByPost((current) => ({ ...current, [postId]: comments }));
      setOpenCommentsPostId(postId);
      setCommentDraft('');
    } catch (error) {
      showNotice(error.message, 'error');
    }
  }

  async function submitComment(event, postId) {
    event.preventDefault();
    const text = commentDraft.trim();
    if (!text || submittingComment) return;
    setSubmittingComment(true);
    try {
      const comment = await api(`/posts/${postId}/comments`, { method: 'POST', body: { text } });
      setCommentsByPost((current) => ({ ...current, [postId]: [...(current[postId] || []), comment] }));
      setCommentDraft('');
      setFeed((current) => current.map((post) => post.id === postId ? { ...post, comment_count: post.comment_count + 1 } : post));
      metaApi.track('comment', { post: postId });
    } catch (error) {
      showNotice(error.message, 'error');
    } finally {
      setSubmittingComment(false);
    }
  }

  async function toggleFollow(post) {
    if (followingAuthorId) return;
    hapticImpact('light');
    setFollowingAuthorId(post.author_id);
    try {
      const result = await api(`/users/${post.author_id}/follow`, { method: 'POST' });
      const isFollowing = result.is_following;
      setFeed((current) => current.map((item) => item.author_id === post.author_id ? { ...item, is_following: isFollowing } : item));
    } catch (error) {
      showNotice(error.message, 'error');
    } finally {
      setFollowingAuthorId(null);
    }
  }

  async function reportPost(postId) {
    try {
      await api(`/posts/${postId}/report`, { method: 'POST', body: { reason: 'other' } });
      showNotice('Жалоба отправлена на проверку', 'success');
    } catch (error) {
      showNotice(error.message, 'error');
    }
  }

  async function openProfile(userId) {
    await loadProfile(userId);
    setView('profile');
  }

  async function toggleProfileFollow() {
    if (!profile || profile.id === currentUser?.id) return;
    try {
      const result = await api(`/users/${profile.id}/follow`, { method: 'POST' });
      setProfile((current) => ({ ...current, is_following: result.is_following, followers_count: Math.max(0, current.followers_count + (result.is_following ? 1 : -1)) }));
    } catch (error) {
      showNotice(error.message, 'error');
    }
  }

  // Выход из плеера в каталог дожимает очередь сохранения.
  const handlePlayerSetView = useCallback((nextView) => {
    if (nextView === 'catalog') saveQueueRef.current?.flush();
    setLockedUnlock(null);
    setView(nextView);
  }, []);

  const navigatePrimary = useCallback((nextView) => {
    hapticSelection();
    setLockedUnlock(null);
    if (nextView === 'catalog') resetCatalogScope();
    setView(nextView);
  }, [resetCatalogScope]);

  const gameProgress = useMemo(() => {
    if (!template || !progress) return null;
    if (isLargeGridTemplate(template)) {
      return {
        completed: progress.completed_cells || 0,
        total: progress.total_cells || template.width * template.height,
        percent: progress.percent || 0,
      };
    }
    return getProgress(template.cells, progress.filled);
  }, [progress, template]);
  const artworkComplete = isLargeGridTemplate(template)
    ? gameProgress?.percent === 100 && gameProgress?.completed === gameProgress?.total
    : isProgressComplete(gameProgress);
  useEffect(() => {
    let cancelled = false;
    let objectUrl = null;
    setTiledResultUrl(null);
    if (!template || !isLargeGridTemplate(template) || !artworkComplete || !progress?.artwork_id) return undefined;
    downloadColoringResult(template.id)
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setTiledResultUrl(objectUrl);
      })
      .catch(() => {
        // The bounded thumbnail remains available while a transient media read
        // or offline retry prevents the private full-size result from loading.
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [artworkComplete, progress?.artwork_id, template]);
  const completedPreview = useMemo(() => (
    template && artworkComplete
      ? isLargeGridTemplate(template)
        ? tiledResultUrl || progress?.result_preview_data_url || null
        : renderCompletedImage(template, progress.filled)
      : null
  ), [artworkComplete, progress?.filled, progress?.result_preview_data_url, template, tiledResultUrl]);
  const nextRecommendation = useMemo(() => {
    const serverNext = unlockData.recommendations.find((item) => item.id !== template?.id);
    if (serverNext) return serverNext;
    const unfinished = templates.find((item) => item.id !== template?.id && item.progress?.percent < 100);
    return unfinished || templates.find((item) => item.id !== template?.id) || null;
  }, [template?.id, templates, unlockData.recommendations]);

  function continueToRecommendation() {
    setLockedUnlock(null);
    setCompletionOpen(false);
    if (nextRecommendation) openColoring(nextRecommendation.id);
    else setView('catalog');
  }

  function handleUnlockSubject(subject, mode = 'journey') {
    if (mode === 'premium' || subject?.state === 'premium_locked') {
      setCatalogChip('premium');
      setCatalogCollection(null);
      setView('catalog');
      return;
    }
    if (!subject) return;
    if (subject.subject_type === 'template' && (subject.state === 'available' || subject.unlockable_now)) {
      openColoring(subject.subject_id);
      return;
    }
    if (subject.subject_type === 'collection' && (subject.state === 'available' || subject.unlockable_now)) {
      openCatalogCollection({ id: subject.subject_id, title: subject.title });
      return;
    }
    setView('home');
  }

  useEffect(() => {
    if (!template || view !== 'play') return;
    if (artworkComplete && serverCompletedTemplateId === template.id && completedTemplateRef.current !== template.id) {
      completedTemplateRef.current = template.id;
      setCompletionOpen(true);
      if (!unlockRefreshedRef.current.has(template.id)) {
        unlockRefreshedRef.current.add(template.id);
        setUnlockRefreshKey((key) => key + 1);
      }
    }
    if (!artworkComplete) completedTemplateRef.current = null;
  }, [artworkComplete, serverCompletedTemplateId, template, view]);

  useEffect(() => {
    if (view === 'play' && template && onboarding === null && localStorage.getItem('splint_onboarding_version') !== '2') {
      setOnboarding(0);
    }
  }, [view, template, onboarding]);

  function dismissOnboarding() {
    setOnboarding(null);
    localStorage.setItem('splint_onboarding_version', '2');
  }

  const renderHome = () => {
    const continueItem = mine
      .filter((item) => item.progress?.percent > 0 && item.progress.percent < 100)
      .sort((first, second) => second.progress.percent - first.progress.percent)[0];
    const featured = today?.for_you || templates[0];
    const popular = [...templates]
      .sort((first, second) => ((second.rating_count || 0) * 10 + (second.rating_average || 0)) - ((first.rating_count || 0) * 10 + (first.rating_average || 0)))
      .slice(0, 4);
    const dailyTemplate = templates.find((item) => item.id === dailyChallenge?.template_id);
    const dailyProgress = dailyChallenge?.target_cells
      ? Math.min(100, Math.round((dailyChallenge.progress_cells / dailyChallenge.target_cells) * 100))
      : 0;
    const weeklyProgress = weeklyChallenge?.target_cells
      ? Math.min(100, Math.round((weeklyChallenge.progress_cells / weeklyChallenge.target_cells) * 100))
      : 0;

    return <section className="page home-page">
      <div className="home-greeting">
        <div>
          <p className="eyebrow">SPLINT PIXEL STUDIO</p>
          <h1>Привет{profile?.nickname ? `, ${profile.nickname}` : ''}!</h1>
          <p>Выберите короткую сессию или продолжите картину.</p>
        </div>
        <button className="home-avatar" type="button" onClick={() => navigatePrimary('profile')} aria-label="Открыть профиль">
          <img src={profile?.avatar_url || '/favicon.svg'} alt="" />
        </button>
      </div>

      <section className="home-goal-strip" aria-label="Текущая игровая цель">
        <span className="home-goal-icon"><Flame size={18} /></span>
        <div><b>{streak?.done_today ? `Серия ${streak.current_streak} дн. продолжается` : `Серия ${streak?.current_streak || 0} дн. — сыграйте сегодня`}</b><small>{progression ? `${progression.xp_to_next_level} XP до уровня ${progression.level + 1}` : 'Загружаем следующую награду…'}</small></div>
        <strong>{progression?.xp_total ?? 0}<small>XP</small></strong>
      </section>

      <RecommendationsStrip
        items={unlockData.recommendations}
        status={unlockData.recommendationsStatus}
        error={unlockData.recommendationsError}
        onRetry={() => unlockData.refresh()}
        onOpen={(item) => openColoring(item.id)}
      />

      <UnlockJourneyCard
        journey={unlockData.journey}
        status={unlockData.snapshotStatus}
        error={unlockData.snapshotError}
        onRetry={() => unlockData.refresh()}
        onOpen={handleUnlockSubject}
      />

      {continueItem ? <section className="home-block home-continue-block">
        <div className="section-heading"><div><p className="eyebrow">ПРОДОЛЖИТЬ РАСКРАШИВАТЬ</p><h2>{continueItem.title}</h2></div><button type="button" onClick={() => openColoring(continueItem.id)}>Продолжить</button></div>
        <button className="home-continue-card" type="button" onClick={() => openColoring(continueItem.id)}>
          <span className="home-continue-preview" style={continueItem.preview_url ? { backgroundImage: `url(${continueItem.preview_url})` } : undefined} />
          <span className="home-continue-copy"><b>{continueItem.width}×{continueItem.height} · {continueItem.est_minutes || 3} мин</b><span className="home-progress-track"><i style={{ width: `${continueItem.progress.percent}%` }} /></span><small>{continueItem.progress.percent}% готово</small></span>
        </button>
      </section> : featured ? <section className="home-block home-featured-block">
        <p className="eyebrow">СЕГОДНЯ ДЛЯ ВАС</p>
        <button className="home-featured-card" type="button" onClick={() => openColoring(featured.id)}>
          <span className="home-featured-preview" style={featured.preview_url ? { backgroundImage: `url(${featured.preview_url})` } : undefined} />
          <span><b>{featured.title}</b><small>{featured.est_minutes || 3} мин · {featured.width}×{featured.height}</small><em>Начать</em></span>
        </button>
      </section> : null}

      <button className="home-daily-card" type="button" disabled={!dailyChallenge?.template_id} onClick={() => dailyChallenge?.template_id && openColoring(dailyChallenge.template_id)}>
        <span className="home-daily-icon"><Flame size={21} /></span>
        <span><b>{dailyChallenge?.completed ? 'Ежедневное задание выполнено' : 'Ежедневное задание'}</b><small>{dailyChallenge ? `${dailyTemplate?.title || dailyChallenge.template_title}: ${dailyChallenge.progress_cells}/${dailyChallenge.target_cells} клеток · +${dailyChallenge.xp_reward} XP` : 'Задание загружается…'}</small><i className="home-daily-progress"><i style={{ width: `${dailyProgress}%` }} /></i></span>
        <strong>{progression?.level || 1}<small>ур.</small></strong>
      </button>

      <button className="home-weekly-card" type="button" onClick={() => navigatePrimary('catalog')}>
        <span className="home-weekly-icon"><Star size={20} /></span>
        <span><b>{weeklyChallenge?.completed ? 'Недельная цель выполнена' : 'Недельная цель'}</b><small>{weeklyChallenge ? `${weeklyChallenge.progress_cells}/${weeklyChallenge.target_cells} новых клеток · +${weeklyChallenge.xp_reward} XP` : 'Задание загружается…'}</small><i className="home-weekly-progress"><i style={{ width: `${weeklyProgress}%` }} /></i></span>
        <strong>Выбрать</strong>
      </button>

      <section className="home-block">
        <div className="section-heading"><div><p className="eyebrow">ПОПУЛЯРНОЕ</p><h2>Выбор сообщества</h2></div><button type="button" onClick={() => { setCatalogChip('popular'); setView('catalog'); }}>Смотреть всё</button></div>
        <div className="home-art-grid">{popular.map((item) => <button className="home-art-card" type="button" key={item.id} onClick={() => openColoring(item.id)}>
          <span className="home-art-preview" style={item.preview_url ? { backgroundImage: `url(${item.preview_url})` } : undefined} />
          <b>{item.title}</b><small>{item.est_minutes || 3} мин</small>
        </button>)}</div>
        {!popular.length && !loading && <p className="home-empty">Каталог пока наполняется. Загляните чуть позже.</p>}
      </section>

      <section className="home-community-card">
        <span><Sparkles size={20} /></span>
        <div><b>Работы сообщества</b><small>Смотрите готовые картины, ставьте лайки и находите вдохновение.</small></div>
        <button type="button" onClick={() => navigatePrimary('feed')}>Открыть</button>
      </section>
    </section>;
  };

  const renderCatalogLegacy = () => {
    const progressMap = {};
    mine.forEach((item) => { if (item.progress?.percent > 0) progressMap[item.id] = item.progress.percent; });
    const continueItem = mine
      .filter((item) => item.progress?.percent > 0 && item.progress.percent < 100)
      .sort((first, second) => second.progress.percent - first.progress.percent)[0];
    const visibleTemplates = templates.slice(0, visibleCount);
    return <section className="page catalog-page">
      <div className="page-heading"><div><p className="eyebrow">PIXEL BY NUMBERS</p><h1>Раскраски</h1></div></div>
      {continueItem && <div className="continue-banner">
        <p className="eyebrow">Продолжить</p>
        <button className="continue-card" onClick={() => openColoring(continueItem.id)}>
          <span className="continue-preview" style={continueItem.preview_url ? { backgroundImage: `url(${continueItem.preview_url})` } : undefined} />
          <span className="continue-info">
            <b>{continueItem.title}</b>
            <span className="continue-track"><span className="continue-fill" style={{ width: `${continueItem.progress.percent}%` }} /></span>
          </span>
          <span className="continue-pct">{continueItem.progress.percent}%</span>
        </button>
      </div>}
      {today?.for_you && <div className="editorial-banner">
        <p className="eyebrow">СЕГОДНЯ ДЛЯ ВАС</p>
        <button className="editorial-card" onClick={() => openColoring(today.for_you.id)}>
          <span className="editorial-preview" style={today.for_you.preview_url ? { backgroundImage: `url(${today.for_you.preview_url})` } : undefined} />
          <span className="editorial-info"><b>{today.for_you.title}</b><small>{today.for_you.est_minutes} мин · {today.for_you.width}×{today.for_you.height}</small></span>
          <Sparkles size={18} />
        </button>
      </div>}
      {streak && <div className="streak-banner">
        <Flame size={18} className={streak.done_today ? 'lit' : ''} />
        <span>{streak.done_today ? `Серия ${streak.current_streak} дн. — сегодня готово!` : `Серия ${streak.current_streak} дн. — раскрасьте сегодня!`}</span>
      </div>}
      {today?.quick?.length > 0 && <div className="quick-row">
        <span className="quick-label">Быстрая до 3 мин</span>
        <div className="quick-scroll">{today.quick.map((item) => <button key={item.id} className="quick-chip" onClick={() => openColoring(item.id)}>
          <span className="quick-chip-preview" style={item.preview_url ? { backgroundImage: `url(${item.preview_url})` } : undefined} />
          <small>{item.est_minutes}м</small>
        </button>)}</div>
      </div>}
      <div className="filter-bar">
        <select value={filters.mood} onChange={(e) => { hapticSelection(); setFilters((f) => ({ ...f, mood: e.target.value })) }}>
          {MOODS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
        </select>
        <select value={filters.theme} onChange={(e) => { hapticSelection(); setFilters((f) => ({ ...f, theme: e.target.value })) }}>
          {THEMES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
        </select>
        <select value={filters.max_minutes} onChange={(e) => { hapticSelection(); setFilters((f) => ({ ...f, max_minutes: e.target.value })) }}>
          <option value="">Любая длит.</option>
          <option value="3">≤ 3 мин</option>
          <option value="5">≤ 5 мин</option>
        </select>
      </div>
      {loading && !templates.length ? <div className="skeleton-grid" aria-label="Загружаем каталог">{[0, 1, 2, 3].map((i) => <div className="skeleton-card" key={i}><div className="skeleton-block skeleton-preview" /><div className="skeleton-block skeleton-line" /><div className="skeleton-block skeleton-line short" /><div className="skeleton-block skeleton-line" /></div>)}</div> : catalogError && !templates.length ? <div className="error-retry"><p>Не удалось загрузить каталог</p><button className="secondary-button" onClick={loadCatalog}>Повторить</button></div> : <>
        <div className="coloring-grid">{visibleTemplates.map((item) => <article className="coloring-card" key={item.id} onMouseEnter={() => prefetchColoring(item.id)} onTouchStart={() => prefetchColoring(item.id)}>
        <div className="card-preview" style={item.preview_url ? { backgroundImage: `linear-gradient(180deg, transparent, #14222e), url(${item.preview_url})` } : undefined}>{progressMap[item.id] > 0 ? <span className="progress-badge">{progressMap[item.id]}%</span> : <span>{item.est_minutes} мин</span>}</div>
        <div className="card-body"><h2 style={{ overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>{item.title}</h2><p style={{ overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', minHeight: '2.6em' }}>{item.description}</p><small style={{ minHeight: '1.4em', display: 'block' }}>{item.width}×{item.height} · {item.palette.length} цветов · {formatDifficulty(item.difficulty)}</small>
          <div className="template-rating" aria-label={`Рейтинг ${item.rating_average ? item.rating_average.toFixed(1) : 'без оценок'}`}>
            <div className="rating-stars">{[1, 2, 3, 4, 5].map((value) => <button key={value} type="button" disabled={ratingTemplateId === item.id || item.owner_id === currentUser?.id} className={value <= (item.viewer_rating || 0) ? 'selected' : ''} onClick={() => rateColoring(item, value)} aria-label={`Оценить на ${value}`}><Star size={15} fill={value <= (item.viewer_rating || 0) ? 'currentColor' : 'none'} /></button>)}</div>
            <span>{item.rating_count ? `${item.rating_average.toFixed(1)} · ${item.rating_count}` : 'Нет оценок'}</span>
          </div>
          <button className="primary-button" onClick={() => { hapticImpact('light'); openColoring(item.id); }}>Начать</button></div>
      </article>)}</div>
        {templates.length > visibleCount && <div className="show-more-wrap"><button className="secondary-button" onClick={() => setVisibleCount((count) => count + CATALOG_PAGE_SIZE)}>Показать ещё ({templates.length - visibleCount})</button></div>}
      </>}
    </section>;
  };

  const renderCatalog = () => {
    if (import.meta.env.VITE_USE_LEGACY_CATALOG === 'true') return renderCatalogLegacy();

    const normalize = (value) => String(value || '').toLocaleLowerCase('ru-RU');
    const query = normalize(catalogQuery.trim());
    const matchesSearch = (item) => !query || [item.title, item.description, item.category, item.theme, item.mood]
      .some((value) => normalize(value).includes(query));
    const searchedTemplates = templates.filter(matchesSearch);
    const popularTemplates = [...searchedTemplates]
      .sort((first, second) => ((second.rating_count || 0) * 10 + (second.rating_average || 0)) - ((first.rating_count || 0) * 10 + (first.rating_average || 0)));
    const todayNewest = Array.isArray(today?.newest) ? today.newest : [];
    const newestTemplates = (todayNewest.length ? todayNewest : searchedTemplates)
      .filter(matchesSearch)
      .sort((first, second) => new Date(second.added_at || second.created_at || 0) - new Date(first.added_at || first.created_at || 0));
    const freeCollections = collections.filter((collection) => collection.pack_type !== 'premium');
    const premiumCollections = collections.filter((collection) => collection.pack_type === 'premium');
    const currentTemplates = catalogChip === 'popular' ? popularTemplates
      : catalogChip === 'new' ? newestTemplates
      : catalogChip === 'free' ? searchedTemplates
      : catalogChip === 'premium' ? []
      : searchedTemplates;
    const visibleTemplates = currentTemplates.slice(0, visibleCount);
    const chipItems = [
      { id: 'all', label: 'Все' },
      { id: 'popular', label: 'Популярное' },
      { id: 'new', label: 'Новинки' },
      { id: 'free', label: 'Бесплатно' },
      { id: 'premium', label: 'Premium' },
    ];
    const progressById = new Map(mine.map((item) => [item.id, item.progress?.percent || 0]));

    const renderArtworkGrid = (items, label) => <div className="catalog-art-grid" aria-label={label}>{items.map((item) => {
      const progressPercent = progressById.get(item.id) || 0;
      return <article className="catalog-art-card" key={item.id} onMouseEnter={() => prefetchColoring(item.id)} onTouchStart={() => prefetchColoring(item.id)}>
        <button className="catalog-art-open" type="button" onClick={() => { hapticImpact('light'); openColoring(item.id); }} aria-label={`Открыть раскраску ${item.title}`}>
          <span className="catalog-art-preview" style={item.preview_url ? { backgroundImage: `url(${item.preview_url})` } : undefined}>
            {progressPercent > 0 ? <em className="catalog-art-progress">{progressPercent}%</em> : <em>{item.est_minutes || 3} мин</em>}
          </span>
          <span className="catalog-art-copy"><b>{item.title}</b><small>{item.width}×{item.height} · {formatDifficulty(item.difficulty)}</small></span>
        </button>
        <div className="catalog-art-footer"><span>{item.rating_count ? `★ ${item.rating_average?.toFixed?.(1) || item.rating_average} · ${item.rating_count}` : 'Новая работа'}</span><button className={item.is_favorite ? 'is-favorite' : ''} type="button" onClick={() => toggleTemplateFavorite(item)} disabled={favoriteSavingId === item.id} aria-label={item.is_favorite ? `Удалить ${item.title} из избранного` : `Добавить ${item.title} в избранное`}><Heart size={16} fill={item.is_favorite ? 'currentColor' : 'none'} /></button></div>
      </article>;
    })}</div>;

    const renderCollectionGrid = (items, label) => <div className="catalog-collection-grid" aria-label={label}>{items.map((collection) => <button className="catalog-collection-card" type="button" key={collection.id} onClick={() => openCatalogCollection(collection)}>
      <span className="catalog-collection-preview" style={collection.image_url ? { backgroundImage: `url(${collection.image_url})` } : undefined}><BookOpen size={20} /></span>
      <span><b>{collection.title}</b><small>{collection.completed_count || 0}/{collection.total_count || collection.total_artworks || 0} завершено</small></span>
    </button>)}</div>;

    return <section className="page catalog-page catalog-page--redesigned">
      <div className="page-heading catalog-heading"><div><p className="eyebrow">КАТАЛОГ</p><h1>{catalogCollection ? catalogCollection.title : 'Найдите свою картину'}</h1></div>{catalogCollection && <button className="catalog-reset" type="button" onClick={resetCatalogScope}>Все работы</button>}</div>
      <label className="catalog-search"><span aria-hidden="true">⌕</span><input value={catalogQuery} onChange={(event) => setCatalogQuery(event.target.value)} placeholder="Поиск картин и тем" type="search" /><button type="button" onClick={() => setCatalogQuery('')} aria-label="Очистить поиск" hidden={!catalogQuery}>×</button></label>
      <div className="catalog-chips" role="tablist" aria-label="Раздел каталога">{chipItems.map((chip) => <button key={chip.id} type="button" className={catalogChip === chip.id ? 'active' : ''} role="tab" aria-selected={catalogChip === chip.id} onClick={() => { hapticSelection(); setCatalogChip(chip.id); }}>{chip.label}</button>)}</div>

      {loading && !templates.length ? <div className="skeleton-grid" aria-label="Загружаем каталог">{[0, 1, 2, 3].map((item) => <div className="skeleton-card" key={item}><div className="skeleton-block skeleton-preview" /><div className="skeleton-block skeleton-line" /><div className="skeleton-block skeleton-line short" /></div>)}</div> : catalogError && !templates.length ? <div className="error-retry"><p>Не удалось загрузить каталог</p><button className="secondary-button" type="button" onClick={loadCatalog}>Повторить</button></div> : <>
        {catalogChip === 'all' && !catalogCollection && <>
          <div className="catalog-section-heading"><div><p className="eyebrow">ПОПУЛЯРНОЕ</p><h2>Сейчас выбирают</h2></div><button type="button" onClick={() => setCatalogChip('popular')}>Смотреть все</button></div>
          {renderArtworkGrid(popularTemplates.slice(0, 4), 'Популярные работы')}
          <div className="catalog-section-heading"><div><p className="eyebrow">НОВИНКИ</p><h2>Свежие картины</h2></div><button type="button" onClick={() => setCatalogChip('new')}>Смотреть все</button></div>
          {renderArtworkGrid(newestTemplates.slice(0, 4), 'Новые работы')}
          {collections.length > 0 && <><div className="catalog-section-heading"><div><p className="eyebrow">КОЛЛЕКЦИИ</p><h2>Соберите свою полку</h2></div></div>{renderCollectionGrid(collections.slice(0, 4), 'Коллекции')}</>}
        </>}

        {catalogChip === 'premium' ? <section className="catalog-empty catalog-premium"><p className="eyebrow">PREMIUM</p><h2>Премиум-наборы</h2><p>{premiumCollections.length ? 'Выберите набор, чтобы посмотреть доступные картины.' : 'Премиум-наборы появятся здесь после подключения витрины.'}</p>{premiumCollections.length ? renderCollectionGrid(premiumCollections, 'Премиум-наборы') : <button className="secondary-button" type="button" onClick={() => setCatalogChip('all')}>К бесплатным работам</button>}</section> : catalogChip !== 'all' || catalogCollection ? <>
          <div className="catalog-section-heading catalog-section-heading--single"><div><p className="eyebrow">{catalogChip === 'popular' ? 'ПОПУЛЯРНОЕ' : catalogChip === 'new' ? 'НОВИНКИ' : catalogChip === 'free' ? 'БЕСПЛАТНО' : 'КОЛЛЕКЦИЯ'}</p><h2>{catalogCollection ? catalogCollection.title : `${currentTemplates.length} работ`}</h2></div></div>
          {renderArtworkGrid(visibleTemplates, 'Картины каталога')}
          {!visibleTemplates.length && <p className="catalog-empty">По этому запросу ничего не найдено.</p>}
          {currentTemplates.length > visibleCount && <div className="show-more-wrap"><button className="secondary-button" type="button" onClick={() => setVisibleCount((count) => count + CATALOG_PAGE_SIZE)}>Показать ещё ({currentTemplates.length - visibleCount})</button></div>}
          {catalogChip === 'free' && freeCollections.length > 0 && <><div className="catalog-section-heading"><div><p className="eyebrow">БЕСПЛАТНЫЕ НАБОРЫ</p><h2>Коллекции</h2></div></div>{renderCollectionGrid(freeCollections, 'Бесплатные наборы')}</>}
        </> : null}
      </>}
    </section>;
  };

  const renderGallery = () => {
    return <section className="page"><div className="page-heading"><div><p className="eyebrow">МОИ РАБОТЫ</p><h1>Галерея</h1></div></div><div className="gallery-list">{mine.map((item) => <div className="gallery-row" key={item.id}><button className="gallery-open" onClick={() => openColoring(item.id)}><span className="mini-palette" style={item.preview_url ? { backgroundImage: `url(${item.preview_url})` } : { background: item.palette[0] }}><Grid3X3 size={18} /></span><span><b>{item.title}</b><small>{item.progress.percent}% · {item.width}×{item.height}{item.source_type === 'user' ? ` · ${item.visibility === 'public' ? 'в каталоге' : 'личная'}` : ''}</small></span><span className="gallery-progress">{item.progress.percent}%</span></button>{item.source_type === 'user' && <div className="gallery-actions"><button className={`visibility-button ${item.visibility === 'public' ? 'published' : ''}`} disabled={publishingTemplateId === item.id} onClick={() => setColoringVisibility(item)} aria-label={item.visibility === 'public' ? `Снять с публикации ${item.title}` : `Опубликовать ${item.title}`}>{publishingTemplateId === item.id ? <LoaderCircle className="spin" size={16} /> : item.visibility === 'public' ? <Globe2 size={17} /> : <Lock size={17} />}</button><button className="delete-button" onClick={() => deleteColoring(item)} aria-label={`Удалить ${item.title}`}><Trash2 size={17} /></button></div>}</div>)}{!mine.length ? mineError ? <div className="error-retry"><p>Не удалось загрузить галерею</p><button className="secondary-button" onClick={loadMine}>Повторить</button></div> : <p className="empty-state">Здесь появятся начатые и созданные вами раскраски.<button className="secondary-button" onClick={() => setView('catalog')}>Выбрать раскраску</button></p> : null}</div></section>;
  };

  const renderFeedLegacy = () => {
    const viewerId = currentUser?.id || DEV_USER_ID;
    return <section className="page"><div className="page-heading"><div><p className="eyebrow">СООБЩЕСТВО</p><h1>Лента работ</h1></div></div><div className="feed-list">{feed.map((post) => <article className="feed-post" key={post.id}><div className="post-author"><button className="author-button" onClick={() => openProfile(post.author_id)}><img loading="lazy" src={post.author?.avatar_url || '/favicon.svg'} alt="" /><span><b>{post.author?.nickname || 'Автор'}</b><small>{post.title}</small></span></button>{post.author_id !== viewerId && <button className="follow-button" style={{ minWidth: 120 }} disabled={followingAuthorId === post.author_id} aria-busy={followingAuthorId === post.author_id} onClick={() => toggleFollow(post)}>{followingAuthorId === post.author_id ? <LoaderCircle className="spin" size={14} /> : post.is_following ? 'Вы подписаны' : 'Подписаться'}</button>}</div><ArtworkPreview src={post.artwork?.image_url} alt={post.title} /><p>{post.caption}</p><div className="post-actions"><button className={`${post.is_liked ? 'liked' : ''} ${likingPostId === post.id ? 'loading' : ''}`} disabled={likingPostId === post.id} onClick={() => toggleLike(post)} aria-label={post.is_liked ? 'Убрать лайк' : 'Поставить лайк'}><Heart size={18} fill={post.is_liked ? 'currentColor' : 'none'} /> {post.like_count}</button>{post.comments_enabled && <button onClick={() => toggleComments(post.id)} aria-label="Комментарии"><Send size={17} /> {post.comment_count}</button>}<button className="report-button" onClick={() => reportPost(post.id)} aria-label="Пожаловаться"><Flag size={16} /></button></div>{openCommentsPostId === post.id && <div className="comments-panel">{(commentsByPost[post.id] || []).map((comment) => <div className="comment-row" key={comment.id}><img loading="lazy" src={comment.author?.avatar_url || '/favicon.svg'} alt="" /><div className="comment-body"><div className="comment-meta"><b>{comment.author?.nickname || 'Автор'}</b>{comment.created_at && <span className="comment-time">{formatTimeAgo(comment.created_at)}</span>}</div><span>{comment.text}</span></div></div>)}{!(commentsByPost[post.id] || []).length && <p className="comments-empty">Пока нет комментариев.</p>}<form onSubmit={(event) => submitComment(event, post.id)}><input value={commentDraft} maxLength="300" placeholder="Напишите комментарий" onChange={(event) => setCommentDraft(event.target.value)} /><button type="submit" disabled={submittingComment}>{submittingComment ? <LoaderCircle className="spin" size={14} /> : '→'}</button></form></div>}</article>)}{!feed.length ? feedError ? <div className="error-retry"><p>Не удалось загрузить ленту</p><button className="secondary-button" onClick={loadFeed}>Повторить</button></div> : <p className="empty-state">Лента загружается…<button className="secondary-button" onClick={() => setView('catalog')}>Перейти в каталог</button></p> : null}</div></section>;
  };

  const renderFeed = () => {
    if (import.meta.env.VITE_USE_LEGACY_FEED === 'true') return renderFeedLegacy();
    const viewerId = currentUser?.id || DEV_USER_ID;
    const feedTabs = [
      { id: 'recommended', label: 'Для вас' },
      { id: 'following', label: 'Подписки' },
    ];
    return <section className="page feed-page feed-page--redesigned">
      <div className="page-heading"><div><p className="eyebrow">СООБЩЕСТВО</p><h1>Работы людей</h1></div></div>
      <div className="feed-tabs" role="tablist" aria-label="Лента сообщества">{feedTabs.map((tab) => <button key={tab.id} type="button" role="tab" aria-selected={feedMode === tab.id} className={feedMode === tab.id ? 'active' : ''} onClick={() => { hapticSelection(); setFeedMode(tab.id); setOpenCommentsPostId(null); }}>{tab.label}</button>)}</div>
      <div className="feed-list">{feed.map((post) => <article className="feed-post" key={post.id}>
        <div className="post-author"><button className="author-button" type="button" onClick={() => openProfile(post.author_id)}><img loading="lazy" src={post.author?.avatar_url || '/favicon.svg'} alt="" /><span><b>{post.author?.nickname || 'Автор'}</b><small>{formatTimeAgo(post.published_at || post.created_at) || post.title}</small></span></button>{post.author_id !== viewerId && <button className="follow-button" type="button" disabled={followingAuthorId === post.author_id} aria-busy={followingAuthorId === post.author_id} onClick={() => toggleFollow(post)}>{followingAuthorId === post.author_id ? <LoaderCircle className="spin" size={14} /> : post.is_following ? 'Вы подписаны' : 'Подписаться'}</button>}</div>
        <ArtworkPreview src={post.artwork?.image_url} alt={post.title} />
        {post.caption && <p>{post.caption}</p>}
        <div className="post-actions"><button className={`${post.is_liked ? 'liked' : ''} ${likingPostId === post.id ? 'loading' : ''}`} type="button" disabled={likingPostId === post.id} onClick={() => toggleLike(post)} aria-label={post.is_liked ? 'Убрать лайк' : 'Поставить лайк'}><Heart size={18} fill={post.is_liked ? 'currentColor' : 'none'} /> {post.like_count}</button>{post.comments_enabled && <button type="button" onClick={() => toggleComments(post.id)} aria-label="Комментарии"><Send size={17} /> {post.comment_count}</button>}<button className="report-button" type="button" onClick={() => reportPost(post.id)} aria-label="Пожаловаться"><Flag size={16} /></button></div>
        {openCommentsPostId === post.id && <div className="comments-panel">{(commentsByPost[post.id] || []).map((comment) => <div className="comment-row" key={comment.id}><img loading="lazy" src={comment.author?.avatar_url || '/favicon.svg'} alt="" /><div className="comment-body"><div className="comment-meta"><b>{comment.author?.nickname || 'Автор'}</b>{comment.created_at && <span className="comment-time">{formatTimeAgo(comment.created_at)}</span>}</div><span>{comment.text}</span></div></div>)}{!(commentsByPost[post.id] || []).length && <p className="comments-empty">Пока нет комментариев.</p>}<form onSubmit={(event) => submitComment(event, post.id)}><input value={commentDraft} maxLength="300" placeholder="Напишите комментарий" onChange={(event) => setCommentDraft(event.target.value)} /><button type="submit" disabled={submittingComment} aria-label="Отправить комментарий">{submittingComment ? <LoaderCircle className="spin" size={14} /> : '→'}</button></form></div>}
      </article>)}{!feed.length ? feedError ? <div className="error-retry"><p>Не удалось загрузить ленту</p><button className="secondary-button" type="button" onClick={() => loadFeed(feedMode)}>Повторить</button></div> : <div className="feed-empty"><span>✦</span><h2>{feedMode === 'following' ? 'Пока нет работ от подписок' : 'Лента готовится'}</h2><p>{feedMode === 'following' ? 'Подпишитесь на авторов, чтобы их новые работы появились здесь.' : 'Завершите картину и поделитесь ею с сообществом.'}</p><button className="secondary-button" type="button" onClick={() => navigatePrimary(feedMode === 'following' ? 'catalog' : 'create')}>{feedMode === 'following' ? 'Открыть каталог' : 'Создать работу'}</button></div> : null}</div>
    </section>;
  };

  const renderCollections = () => {
    return <section className="page"><div className="page-heading"><div><p className="eyebrow">АЛЬБОМЫ</p><h1>Коллекции</h1></div></div><div className="collection-list">{collections.map((col) => <button key={col.id} className="collection-card" onClick={() => openCatalogCollection(col)}>
      <span className="collection-preview" style={col.image_url ? { backgroundImage: `url(${col.image_url})` } : undefined} />
      <span className="collection-info"><b>{col.title}</b><small>{col.completed_count}/{col.total_count} завершено · {col.rarity}</small></span>
      <BookOpen size={18} />
    </button>)}{!collections.length && <p className="empty-state">Коллекции появятся позже.</p>}</div></section>;
  };

  const renderAchievements = () => {
    return <section className="page"><div className="page-heading"><div><p className="eyebrow">ДОСТИЖЕНИЯ</p><h1>Награды</h1></div></div><div className="achievement-grid">{achievements.map((ach) => <div key={ach.id} className={`achievement ${ach.unlocked ? 'unlocked' : 'locked'}`}>
      <span className="achievement-icon">{ach.unlocked ? <Star size={20} /> : <Lock size={20} />}</span>
      <b>{ach.title}</b>
      <small>{ach.description}</small>
    </div>)}{!achievements.length && <p className="empty-state">Достижения загружаются…</p>}</div></section>;
  };

  const renderProfileLegacy = () => {
    if (!profile) return <section className="page profile-page"><div className="skeleton-block skeleton-profile" /><div className="skeleton-block skeleton-line" /><div className="skeleton-block skeleton-line short" /></section>;
    const isOwnProfile = profile.id === currentUser?.id;
    return <section className="page profile-page"><div className="page-heading"><div><p className="eyebrow">ПРОФИЛЬ</p><h1>{profile.nickname}</h1></div>{!isOwnProfile && <button className="follow-button" onClick={toggleProfileFollow}>{profile.is_following ? 'Вы подписаны' : 'Подписаться'}</button>}</div><div className="profile-card"><img loading="lazy" src={profile.avatar_url || '/favicon.svg'} alt="" /><div><b>{profile.nickname}</b><p>{profile.status || 'Любит раскрашивать пиксели по номерам.'}</p></div><div className="profile-stats"><span><b>{profile.posts_count}</b>публикаций</span><span><b>{profile.followers_count}</b>подписчиков</span><span><b>{profile.following_count}</b>подписок</span></div></div><h2 className="section-title">Готовые работы</h2><div className="profile-artworks">{profileArtworks.map((artwork) => <img loading="lazy" key={artwork.id} src={artwork.image_url} alt={artwork.title} title={artwork.title} />)}{!profileArtworks.length && <p className="empty-state">Готовых работ пока нет.{isOwnProfile && <button className="secondary-button" onClick={() => setView('catalog')}>Начать раскрашивать</button>}</p>}</div>
      <h2 className="section-title">Серия и достижения</h2>
      <div className="profile-stats"><span><b>{streak?.current_streak || 0}</b>дней подряд</span><span><b>{streak?.longest_streak || 0}</b>рекорд</span><span><b>{achievements.filter((a) => a.unlocked).length}</b>наград</span></div>
    </section>;
  };

  const renderProfile = () => {
    if (import.meta.env.VITE_USE_LEGACY_PROFILE === 'true') return renderProfileLegacy();
    if (!profile) return <section className="page profile-page"><div className="skeleton-block skeleton-profile" /><div className="skeleton-block skeleton-line" /><div className="skeleton-block skeleton-line short" /></section>;
    const isOwnProfile = profile.id === currentUser?.id;
    const completedWorks = isOwnProfile ? mine.filter((item) => item.progress?.percent === 100) : profileArtworks;
    const achievementsUnlocked = achievements.filter((achievement) => achievement.unlocked);
    const visibleCollections = collections.slice(0, 4);
    const displayShelf = isOwnProfile ? profileShelf : 'works';
    const shelfItems = displayShelf === 'favorites' ? favoriteTemplates
      : displayShelf === 'history' ? recentTemplates
      : completedWorks;
    const shelfTitle = displayShelf === 'favorites' ? 'Избранные раскраски'
      : displayShelf === 'history' ? 'Недавно открытые'
      : 'Завершённые работы';
    const shelfEmpty = displayShelf === 'favorites' ? 'Добавляйте картины сердцем в каталоге.'
      : displayShelf === 'history' ? 'Здесь появятся недавно открытые раскраски.'
      : 'Здесь появятся завершённые картины.';
    const xpProgress = progression?.xp_per_level
      ? Math.round(((progression.xp_total % progression.xp_per_level) / progression.xp_per_level) * 100)
      : 0;
    return <section className="page profile-page profile-page--redesigned">
      <section className="profile-hero">
        <img className="profile-hero-avatar" src={profile.avatar_url || '/favicon.svg'} alt="" />
        <div className="profile-hero-copy"><p className="eyebrow">{isOwnProfile ? 'ВАША СТУДИЯ' : 'ПРОФИЛЬ АВТОРА'}</p><h1>{profile.nickname}</h1><p>{profile.status || 'Любит раскрашивать пиксели по номерам.'}</p></div>
        {!isOwnProfile && <button className="follow-button" type="button" onClick={toggleProfileFollow}>{profile.is_following ? 'Вы подписаны' : 'Подписаться'}</button>}
      </section>

      <div className="profile-metric-grid" aria-label="Статистика профиля">
        <span><b>{completedWorks.length}</b><small>работы</small></span>
        <span><b>{progression?.level || profile.level || 1}</b><small>уровень</small></span>
        <span><b>{profile.followers_count || 0}</b><small>подписчики</small></span>
        <span><b>{streak?.current_streak || 0}</b><small>дней подряд</small></span>
      </div>

      {isOwnProfile && progression && <div className="profile-xp"><span><b>{progression.xp_total} XP</b><small>До следующего уровня: {progression.xp_to_next_level} XP</small></span><i><i style={{ width: `${xpProgress}%` }} /></i></div>}

      {isOwnProfile && <UnlockJourneyCard
        journey={unlockData.journey}
        status={unlockData.snapshotStatus}
        error={unlockData.snapshotError}
        onRetry={() => unlockData.refresh()}
        onOpen={handleUnlockSubject}
        compact
      />}

      {isOwnProfile && <div className="profile-quick-actions" role="tablist" aria-label="Раздел профиля"><button type="button" role="tab" aria-selected={profileShelf === 'works'} className={profileShelf === 'works' ? 'active' : ''} onClick={() => setProfileShelf('works')}>Работы</button><button type="button" role="tab" aria-selected={profileShelf === 'favorites'} className={profileShelf === 'favorites' ? 'active' : ''} onClick={() => setProfileShelf('favorites')}>Избранное</button><button type="button" role="tab" aria-selected={profileShelf === 'history'} className={profileShelf === 'history' ? 'active' : ''} onClick={() => setProfileShelf('history')}>История</button><button type="button" onClick={() => navigatePrimary('create')}>Создать</button></div>}

      <section className="profile-section">
        <div className="section-heading"><div><p className="eyebrow">МОЯ КОЛЛЕКЦИЯ</p><h2>{isOwnProfile ? shelfTitle : 'Завершённые работы'}</h2></div>{isOwnProfile && profileShelf === 'works' && <button type="button" onClick={() => setView('gallery')}>Смотреть все</button>}</div>
        <div className="profile-work-grid">{shelfItems.slice(0, 9).map((work) => {
          const source = work.preview_url || work.thumbnail_url || work.image_url;
          const canOpen = isOwnProfile && Boolean(work.id) && (displayShelf !== 'works' || mine.some((item) => item.id === work.id));
          return <button className="profile-work-card" type="button" key={work.id} onClick={() => canOpen && openColoring(work.id)} disabled={!canOpen} aria-label={canOpen ? `Открыть ${work.title}` : work.title}>
            {source ? <img loading="lazy" src={source} alt="" /> : <span className="profile-work-fallback"><Grid3X3 size={22} /></span>}<b>{work.title}</b>{isOwnProfile && work.progress && <small>{work.progress.percent}%</small>}
          </button>;
        })}{!shelfItems.length && <div className="profile-empty"><span>✦</span><p>{shelfEmpty}</p><button className="secondary-button" type="button" onClick={() => navigatePrimary('catalog')}>Открыть каталог</button></div>}</div>
      </section>

      <section className="profile-section">
        <div className="section-heading"><div><p className="eyebrow">КОЛЛЕКЦИИ</p><h2>Ваш прогресс</h2></div><button type="button" onClick={() => setView('collections')}>Все</button></div>
        <div className="profile-collection-list">{visibleCollections.map((collection) => <button type="button" key={collection.id} onClick={() => openCatalogCollection(collection)}><span style={collection.image_url ? { backgroundImage: `url(${collection.image_url})` } : undefined}><BookOpen size={18} /></span><div><b>{collection.title}</b><small>{collection.completed_count || 0}/{collection.total_count || collection.total_artworks || 0} завершено</small></div></button>)}{!visibleCollections.length && <p className="profile-inline-empty">Коллекции появятся после загрузки каталога.</p>}</div>
      </section>

      <section className="profile-section">
        <div className="section-heading"><div><p className="eyebrow">ДОСТИЖЕНИЯ</p><h2>{achievementsUnlocked.length} из {achievements.length || 0}</h2></div><button type="button" onClick={() => setView('achievements')}>Все</button></div>
        <div className="profile-achievements">{achievements.slice(0, 4).map((achievement) => <span className={achievement.unlocked ? 'unlocked' : ''} key={achievement.id}><Star size={15} fill={achievement.unlocked ? 'currentColor' : 'none'} /><b>{achievement.title}</b></span>)}{!achievements.length && <p className="profile-inline-empty">Достижения загружаются…</p>}</div>
      </section>
    </section>;
  };

  const renderCreator = () => {
    const gridOptionIndex = CREATOR_GRID_OPTIONS.findIndex((option) => option.w === creatorGrid.width);
    const gridMeta = gridDetailMeta(creatorGrid.width);
    const gridStep = Math.max(4, Math.round(576 / creatorGrid.width));
    return <section className="page creator-page"><div className="page-heading"><div><p className="eyebrow">СВОЯ РАСКРАСКА</p><h1>Из изображения</h1></div></div><div className="creator-card">
      <label className="file-field"><input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => { const selected = event.target.files?.[0] || null; creatorFileRef.current = selected; setFile(selected); setTitle('Моя пиксельная раскраска'); if (selected) prepareFromImage(selected); }} />{file ? file.name : 'Выбрать PNG, JPG или WebP'}</label>
      {file && <><label>Название<input value={title} maxLength="80" onChange={(event) => setTitle(event.target.value)} /></label>
        <div className="creator-crop-section"><h3>Кадрирование</h3>
          <div className="creator-crop-toggle"><button className={creatorCropMode === 'fit' ? 'selected' : ''} onClick={() => { setCreatorCropMode('fit'); setCreatorCrop({ scale: 1, offsetX: 0, offsetY: 0 }); }}>Вписать целиком</button><button className={creatorCropMode === 'crop' ? 'selected' : ''} onClick={() => setCreatorCropMode('crop')}>Кадрировать</button></div>
          {creatorCropMode === 'crop' && <><div className="creator-slider-row"><label>Масштаб <b>{creatorCrop.scale.toFixed(1)}×</b></label><input type="range" min="0.5" max="3" step="0.1" value={creatorCrop.scale} onChange={(event) => setCreatorCrop((prev) => ({ ...prev, scale: +event.target.value }))} /></div>
            <div className="creator-slider-row"><label>Смещение по X</label><input type="range" min="-200" max="200" step="1" value={creatorCrop.offsetX} onChange={(event) => setCreatorCrop((prev) => ({ ...prev, offsetX: +event.target.value }))} /><b>{creatorCrop.offsetX}</b></div>
            <div className="creator-slider-row"><label>Смещение по Y</label><input type="range" min="-200" max="200" step="1" value={creatorCrop.offsetY} onChange={(event) => setCreatorCrop((prev) => ({ ...prev, offsetY: +event.target.value }))} /><b>{creatorCrop.offsetY}</b></div>
            <button className="secondary-button" onClick={() => setCreatorCrop({ scale: 1, offsetX: 0, offsetY: 0 })}>Сбросить кадрирование</button></>}
        </div>
        <div className="creator-grid-section"><h3>Детализация сетки</h3>
          <div className={`grid-detail-picker grid-detail-picker-${gridMeta.load === 'Экспериментально' ? 'experimental' : 'standard'}`}>
            <div className="grid-density-preview" style={creatorImageUrl ? { backgroundImage: `url(${creatorImageUrl})` } : undefined}>
              <span className="grid-density-overlay" style={{ '--grid-step': `${gridStep}px` }} />
              <span className="grid-density-size">{creatorGrid.width}<small>× {creatorGrid.height}</small></span>
              <span className="grid-density-cells">{(creatorGrid.width * creatorGrid.height).toLocaleString('ru-RU')} клеток</span>
            </div>
            <div className="grid-detail-copy"><span><b>{gridMeta.title}</b><em>{gridMeta.load}</em></span><p className="creator-grid-hint">{gridMeta.hint}</p></div>
            <input className="grid-detail-range" type="range" min="0" max={CREATOR_GRID_OPTIONS.length - 1} step="1" value={gridOptionIndex} aria-label="Размер сетки" onChange={(event) => { const option = CREATOR_GRID_OPTIONS[Number(event.target.value)]; setCreatorGrid({ width: option.w, height: option.h }); }} />
            <div className="creator-grid-options">{CREATOR_GRID_OPTIONS.map((g) => <button key={g.label} title={g.label} aria-label={`Сетка ${g.label}`} className={creatorGrid.width === g.w ? 'selected' : ''} onClick={() => setCreatorGrid({ width: g.w, height: g.h })}><span>{g.w}</span></button>)}</div>
            <div className="grid-detail-scale" aria-hidden="true"><span>Крупнее</span><span>Точнее</span></div>
          </div>
        </div>
        <div className="creator-colors-section"><h3>Количество цветов</h3>
          <div className="creator-slider-row"><input type="range" min="4" max="16" step="1" value={creatorColors} onChange={(event) => setCreatorColors(+event.target.value)} /><span className="creator-colors-badge">{creatorColors}</span></div>
        </div>
        <button className="primary-button create-button" disabled={creatorComputing} onClick={computeCreatorPreview}>{creatorComputing ? <LoaderCircle className="spin" size={18} /> : <Sparkles size={18} />} Обновить превью</button>
        {(creatorPreviews.original || creatorPreviews.pixel || creatorPreviews.numbered) && <div className="creator-previews">
          <div className="creator-preview-item"><h4>Исходное кадрирование</h4>{creatorPreviews.original ? <img src={creatorPreviews.original} alt="Кадрированное изображение" /> : <div className="preview-placeholder" />}</div>
          <div className="creator-preview-item"><h4>Пиксельная сетка</h4>{creatorPreviews.pixel ? <img src={creatorPreviews.pixel} alt="Пиксельная сетка" /> : <div className="preview-placeholder" />}</div>
          <div className="creator-preview-item"><h4>По номерам</h4>{creatorPreviews.numbered ? <img src={creatorPreviews.numbered} alt="По номерам" /> : <div className="preview-placeholder" />}</div>
        </div>}
        {creatorQuality && <div className={`creator-quality creator-quality-${creatorQuality.level}`}><span className="creator-quality-label">{creatorQuality.label}</span>{creatorQuality.hint && <p className="creator-quality-hint">{creatorQuality.hint}</p>}</div>}
        {creatorResult && <button className="primary-button create-button" disabled={creating} onClick={saveDraftColoring}>{creating ? <LoaderCircle className="spin" size={18} /> : <Star size={18} />} Сохранить и начать</button>}
      </>}
    </div></section>;
  };

  const renderCreated = () => {
    if (!createdColoring) return renderCreator();
    return <section className="page creator-success-page">
      <div className="creator-success-art" style={createdColoring.previewUrl ? { backgroundImage: `url(${createdColoring.previewUrl})` } : undefined} aria-hidden="true"><Sparkles size={34} /></div>
      <p className="eyebrow">НОВАЯ РАБОТА</p>
      <h1>Раскраска готова</h1>
      <p>«{createdColoring.title}» сохранена в вашей галерее. Теперь можно спокойно раскрыть картину.</p>
      <button className="primary-button" onClick={() => openColoring(createdColoring.id)}><Sparkles size={18} /> Начать раскрашивать</button>
      <button className="secondary-button" onClick={() => { setCreatedColoring(null); setView('profile'); }}>К моим работам</button>
    </section>;
  };

  let content;
  if (view === 'play') {
    content = lockedUnlock ? (
      <UnlockLockedView
        unlock={lockedUnlock}
        nextRecommendation={nextRecommendation}
        onBack={() => { setLockedUnlock(null); setView('catalog'); }}
        onBrowse={() => { setLockedUnlock(null); setView('home'); }}
        onContinue={continueToRecommendation}
        onPremium={() => { setCatalogChip('premium'); setCatalogCollection(null); setLockedUnlock(null); setView('catalog'); }}
      />
    ) : (
      <PlayerView
        template={template}
        progress={progress}
         gameProgress={gameProgress}
        progression={progression}
        streak={streak}
        isOnline={isOnline}
        saveState={saveState}
        latestReward={latestReward}
         nextRecommendation={nextRecommendation}
         onContinue={continueToRecommendation}
        selectedColor={selectedColor}
        onSelectColor={setSelectedColor}
        zones={zones}
        zoneReward={zoneReward}
        combo={combo}
        calmMode={calmMode}
        hideNumbers={hideNumbers}
        hintMode={hintMode}
        hintsRemaining={hintsRemaining}
        setHintsRemaining={setHintsRemaining}
        playMode={playMode}
        fillMode={fillMode}
        history={history}
        future={future}
        onboarding={onboarding}
        setOnboarding={setOnboarding}
        completionOpen={completionOpen}
        setCompletionOpen={setCompletionOpen}
        sharing={sharing}
        saving={saving}
        onRetrySave={retryPendingSave}
        publishing={publishing}
        setView={handlePlayerSetView}
        setPlayMode={setPlayMode}
        setFillMode={setFillMode}
        setCalmMode={setCalmMode}
        setHideNumbers={setHideNumbers}
        setHintMode={setHintMode}
        onUndo={undo}
        onRedo={redo}
        onFirstPaint={handleFirstPaint}
        onWrongCell={handleWrongCell}
        onFillAt={handleFillAt}
        onStrokeCommitted={handleStrokeCommitted}
        onTiledStrokeCommitted={handleTiledStrokeCommitted}
        onResetProgress={resetProgress}
        onShareResult={shareResult}
        onDownloadResult={downloadResult}
        onPublishCompleted={publishCompleted}
        onDismissOnboarding={dismissOnboarding}
        onTrack={(event, payload) => metaApi.track(event, payload).catch(() => {})}
        formatDifficulty={formatDifficulty}
        completedPreview={completedPreview}
        zoneIndices={zoneIndicesRef.current}
      />
    );
  } else if (view === 'home') {
    content = renderHome();
  } else if (view === 'gallery') {
    content = renderGallery();
  } else if (view === 'feed') {
    content = renderFeed();
  } else if (view === 'create') {
    content = <CreateHub onImport={() => setView('creator')} onManualDraw={() => setView('manual')} onCreatePack={() => setView('packs')} />;
  } else if (view === 'manual') {
    content = <ManualPixelEditor onCreate={saveManualColoring} disabled={creating} />;
  } else if (view === 'packs') {
    content = <CreatorCollectionsManager templates={mine} onCollectionChange={() => { loadCollections(); loadProductProfile(); }} />;
  } else if (view === 'creator') {
    content = renderCreator();
  } else if (view === 'created') {
    content = renderCreated();
  } else if (view === 'profile') {
    content = renderProfile();
  } else if (view === 'collections') {
    content = renderCollections();
  } else if (view === 'achievements') {
    content = renderAchievements();
  } else {
    content = renderCatalog();
  }

  return <main className="telegram-frame"><div className="app-container">{view !== 'play' && <header className="app-header app-header--redesigned"><button className="brand-button" type="button" onClick={() => navigatePrimary('home')}><span className="brand-mark" aria-hidden="true" /><span className="brand-text"><span className="header-logo">SPLINT</span><small>pixel studio</small></span></button><button className="header-profile-button" type="button" onClick={() => navigatePrimary('profile')} aria-label="Открыть профиль"><img src={currentUser?.avatar_url || profile?.avatar_url || '/favicon.svg'} alt="" /></button></header>}<div ref={screenContentRef} className={`screen-content${view === 'play' ? ' screen-content--play' : ''}`}>{content}</div>{view !== 'play' && <BottomNavigation activeView={view} onNavigate={navigatePrimary} />}</div>{notice && <div className={`toast ${notice.type}`}>{notice.text}</div>}</main>;
}

export default App;
