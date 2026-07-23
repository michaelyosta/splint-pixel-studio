import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Compass, Flag, Flame, Grid3X3, Heart, ImagePlus, LoaderCircle, Send, Sparkles, Star, Trash2, UserRound, BookOpen, Lock } from 'lucide-react';
import { api, metaApi, catalogApi, DEV_USER_ID } from './api/client';
import PlayerView from './views/PlayerView';
import { floodFillRegion } from './lib/floodFill';
import { buildColoringFromImage, findRewardingColor, getProgress, renderCompletedImage } from './lib/pixelColoring';
import { renderImageCropPreview, renderFitPreview, renderGridPreview, renderNumberedPreview } from './lib/imageCrop';
import { assessQuality } from './lib/creatorQuality';
import { createSaveQueue } from './lib/progressSaveQueue';
import { createHistoryOperation } from './features/coloring/engine/historyOperations.js';
import './App.css';

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
  return <img className="post-image" src={src} alt={alt} onError={() => setFailed(true)} />;
}

function App() {
  const [view, setView] = useState('catalog');
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
  const [creatorGrid, setCreatorGrid] = useState({ width: 24, height: 24 });
  const [creatorColors, setCreatorColors] = useState(8);
  const [creatorCrop, setCreatorCrop] = useState({ scale: 1, offsetX: 0, offsetY: 0 });
  const [creatorCropMode, setCreatorCropMode] = useState('fit');
  const [creatorImageUrl, setCreatorImageUrl] = useState(null);
  const [creatorResult, setCreatorResult] = useState(null);
  const [creatorQuality, setCreatorQuality] = useState(null);
  const [creatorPreviews, setCreatorPreviews] = useState({ original: null, pixel: null, numbered: null });
  const [creatorComputing, setCreatorComputing] = useState(false);
  const [createdColoring, setCreatedColoring] = useState(null);
  const creatorComputeRef = useRef(0);
  const [combo, setCombo] = useState(0);
  const [zoneReward, setZoneReward] = useState(null);
  const [filters, setFilters] = useState({ mood: '', theme: '', max_minutes: '' });
  const [today, setToday] = useState(null);
  const [streak, setStreak] = useState(null);
  const [achievements, setAchievements] = useState([]);
  const [collections, setCollections] = useState([]);
  const [calmMode, setCalmMode] = useState(false);
  const [hideNumbers, setHideNumbers] = useState(false);
  const [hintMode, setHintMode] = useState(false);
  const [hintsRemaining, setHintsRemaining] = useState(5);
  const [fillMode, setFillMode] = useState(false);
  const [playMode, setPlayMode] = useState('classic');
  const [completionOpen, setCompletionOpen] = useState(false);
  const [onboarding, setOnboarding] = useState(null);
  const [sharing, setSharing] = useState(false);
  const [likingPostId, setLikingPostId] = useState(null);
  const [submittingComment, setSubmittingComment] = useState(false);
  const [followingAuthorId, setFollowingAuthorId] = useState(null);
  const sessionStartRef = useRef(0);

  const saveQueueRef = useRef(null);

  const noticeTimerRef = useRef(null);
  const lastPaintRef = useRef(0);
  const comboRef = useRef(0);
  const milestoneRef = useRef(new Set());
  const zoneMilestoneRef = useRef(new Set());
  const paintedRef = useRef(false);
  const completedTemplateRef = useRef(null);
  const filledRef = useRef([]);

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

  const loadMine = useCallback(async () => {
    try {
      setMine(await api('/colorings/mine'));
      setMineError(false);
    } catch (error) {
      showNotice(error.message, 'error');
      setMineError(true);
    }
  }, [showNotice]);

  const loadFeed = useCallback(async () => {
    try {
      setFeed(await api('/feed/recommended'));
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

  useEffect(() => { loadCatalog(); loadToday(); loadStreak(); loadAchievements(); loadCollections(); loadProfile(); }, [loadCatalog, loadToday, loadStreak, loadAchievements, loadCollections, loadProfile]);
  const creatorTimerRef = useRef(null);
  const computeRef = useRef(null);
  computeRef.current = computeCreatorPreview;
  useEffect(() => {
    if (!creatorImageUrl) return;
    window.clearTimeout(creatorTimerRef.current);
    creatorTimerRef.current = window.setTimeout(() => computeRef.current(), 400);
    return () => window.clearTimeout(creatorTimerRef.current);
  }, [creatorGrid, creatorColors, creatorCrop, creatorCropMode, creatorImageUrl]);
  useEffect(() => () => {
    if (saveQueueRef.current) saveQueueRef.current.dispose();
    window.clearTimeout(noticeTimerRef.current);
  }, []);
  useEffect(() => { if (view === 'gallery') loadMine(); }, [view, loadMine]);
  useEffect(() => { if (view === 'feed') loadFeed(); }, [view, loadFeed]);
  useEffect(() => { if (view === 'profile') loadProfile(); }, [view, loadProfile]);
  useEffect(() => { if (view === 'collections') loadCollections(); }, [view, loadCollections]);

  async function openColoring(id) {
    setLoading(true);
    try {
      const [nextTemplate, nextProgress, nextZones] = await Promise.all([api(`/colorings/${id}`), api(`/colorings/${id}/progress`), catalogApi.zones(id)]);
      setTemplate(nextTemplate);
      setProgress(nextProgress);
      filledRef.current = nextProgress.filled;
      setZones(nextZones.zones || []);
      zoneIndicesRef.current = Object.fromEntries((nextZones.zones || []).map((zone) => [zone.id, zone.indices || []]));
      if (saveQueueRef.current) {
        saveQueueRef.current.dispose();
        setSaving(false);
      }
      saveQueueRef.current = createSaveQueue({
        putProgress: async ({ filled, revision, resultDataUrl }) => {
          return api(`/colorings/${nextTemplate.id}/progress`, {
            method: 'PUT',
            body: { filled, revision, resultDataUrl },
          });
        },
        getResultDataUrl: (filled) => {
          return filled.every((color, index) => color === nextTemplate.cells[index])
            ? renderCompletedImage(nextTemplate, filled)
            : null;
        },
        onProgress: (saved) => setProgress(saved),
        onNotice: showNotice,
        onSaving: setSaving,
      });
      saveQueueRef.current.reset(nextProgress.revision);
      setSelectedColor(findRewardingColor(nextTemplate, nextProgress.filled) ?? 0);
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
      metaApi.track('open_level', { id });
    } catch (error) {
      showNotice(error.message, 'error');
    } finally {
      setLoading(false);
    }
  }

  function queueSave(nextFilled) {
    if (saveQueueRef.current) saveQueueRef.current.queueSave(nextFilled);
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
    metaApi.unlockAchievement('ach_first_zone').catch(() => {});
    metaApi.touchStreak().catch(() => {});
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
    celebrateCompletedZone(nextZones);
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
    applyFilled(nextFilled, createHistoryOperation({ type: 'fill', changes, color: targetColor }));
    const nextZones = refreshZones(nextFilled);
    if (!celebrateCompletedZone(nextZones)) window.Telegram?.WebApp?.HapticFeedback?.impactOccurred?.('medium');
    handleFirstPaint();
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
      loadFeed();
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
    if (!completedPreview || typeof navigator.share !== 'function') return downloadResult();
    setSharing(true);
    try {
      await navigator.share({ title: template.title, text: `Я завершил(а) раскраску «${template.title}» в SPLINT Pixel Studio!`, url: window.location.href });
      metaApi.track('share_native', { id: template.id });
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
    if (!file) return;
    setCreatorComputing(true);
    const id = ++creatorComputeRef.current;
    let imgUrl;
    try {
      imgUrl = URL.createObjectURL(file);
      const img = new window.Image();
      img.src = imgUrl;
      await img.decode();
      const preset = { width: creatorGrid.width, height: creatorGrid.height, colors: creatorColors };
      const crop = creatorCropMode === 'crop' ? creatorCrop : null;
      const data = await buildColoringFromImage(file, { ...preset, crop });
      if (id !== creatorComputeRef.current) return;
      const { width, height, palette, cells } = data;
      const originalPreview = crop ? renderImageCropPreview(img, { ...creatorCrop, size: 512 }) : renderFitPreview(img, 512);
      if (id !== creatorComputeRef.current) return;
      const pixelPreview = renderGridPreview(width, height, palette, cells);
      if (id !== creatorComputeRef.current) return;
      const numberedPreview = renderNumberedPreview(width, height, palette, cells);
      if (id !== creatorComputeRef.current) return;
      const quality = assessQuality(width, height, palette, cells);
      if (id !== creatorComputeRef.current) return;
      setCreatorPreviews({ original: originalPreview, pixel: pixelPreview, numbered: numberedPreview });
      setCreatorResult(data);
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

  async function toggleLike(post) {
    if (likingPostId) return;
    setLikingPostId(post.id);
    try {
      await api(`/posts/${post.id}/like`, { method: post.is_liked ? 'DELETE' : 'POST' });
      loadFeed();
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

  const gameProgress = useMemo(() => (template && progress ? getProgress(template.cells, progress.filled) : null), [progress, template]);
  const completedPreview = useMemo(() => (template && gameProgress?.percent === 100 ? renderCompletedImage(template, progress.filled) : null), [gameProgress?.percent, progress?.filled, template]);

  useEffect(() => {
    if (!template || view !== 'play') return;
    if (gameProgress?.percent === 100 && completedTemplateRef.current !== template.id) {
      completedTemplateRef.current = template.id;
      setCompletionOpen(true);
    }
    if (gameProgress?.percent !== 100) completedTemplateRef.current = null;
  }, [gameProgress?.percent, template, view]);

  useEffect(() => {
    if (view === 'play' && template && !onboarding && !localStorage.getItem('splint_onboarding_done')) {
      setOnboarding(0);
    }
  }, [view, template, onboarding]);

  function dismissOnboarding() {
    setOnboarding(null);
    localStorage.setItem('splint_onboarding_done', '1');
  }

  const renderCatalog = () => {
    const progressMap = {};
    mine.forEach((item) => { if (item.progress?.percent > 0) progressMap[item.id] = item.progress.percent; });
    return <section className="page catalog-page">
      <div className="page-heading"><div><p className="eyebrow">PIXEL BY NUMBERS</p><h1>Раскраски</h1></div></div>
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
        <select value={filters.mood} onChange={(e) => setFilters((f) => ({ ...f, mood: e.target.value }))}>
          {MOODS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
        </select>
        <select value={filters.theme} onChange={(e) => setFilters((f) => ({ ...f, theme: e.target.value }))}>
          {THEMES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
        </select>
        <select value={filters.max_minutes} onChange={(e) => setFilters((f) => ({ ...f, max_minutes: e.target.value }))}>
          <option value="">Любая длит.</option>
          <option value="3">≤ 3 мин</option>
          <option value="5">≤ 5 мин</option>
        </select>
      </div>
      {loading ? <div className="loading"><LoaderCircle className="spin" /> Загружаем…</div> : catalogError && !templates.length ? <div className="error-retry"><p>Не удалось загрузить каталог</p><button className="secondary-button" onClick={loadCatalog}>Повторить</button></div> : <div className="coloring-grid">{templates.map((item) => <article className="coloring-card" key={item.id}>
        <div className="card-preview" style={item.preview_url ? { backgroundImage: `linear-gradient(180deg, transparent, #14222e), url(${item.preview_url})` } : undefined}>{progressMap[item.id] > 0 ? <span className="progress-badge">{progressMap[item.id]}%</span> : <span>{item.est_minutes} мин</span>}</div>
        <div className="card-body"><h2 style={{ overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>{item.title}</h2><p style={{ overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', minHeight: '2.6em' }}>{item.description}</p><small style={{ minHeight: '1.4em', display: 'block' }}>{item.width}×{item.height} · {item.palette.length} цветов · {formatDifficulty(item.difficulty)}</small><button className="primary-button" onClick={() => openColoring(item.id)}>Начать</button></div>
      </article>)}</div>}
    </section>;
  };

  const renderGallery = () => {
    return <section className="page"><div className="page-heading"><div><p className="eyebrow">МОИ РАБОТЫ</p><h1>Галерея</h1></div></div><div className="gallery-list">{mine.map((item) => <div className="gallery-row" key={item.id}><button className="gallery-open" onClick={() => openColoring(item.id)}><span className="mini-palette" style={item.preview_url ? { backgroundImage: `url(${item.preview_url})` } : { background: item.palette[0] }}><Grid3X3 size={18} /></span><span><b>{item.title}</b><small>{item.progress.percent}% · {item.width}×{item.height}</small></span><span className="gallery-progress">{item.progress.percent}%</span></button>{item.source_type === 'user' && <button className="delete-button" onClick={() => deleteColoring(item)} aria-label={`Удалить ${item.title}`}><Trash2 size={17} /></button>}</div>)}{!mine.length ? mineError ? <div className="error-retry"><p>Не удалось загрузить галерею</p><button className="secondary-button" onClick={loadMine}>Повторить</button></div> : <p className="empty-state">Здесь появятся начатые и созданные вами раскраски.</p> : null}</div></section>;
  };

  const renderFeed = () => {
    const viewerId = currentUser?.id || DEV_USER_ID;
    return <section className="page"><div className="page-heading"><div><p className="eyebrow">СООБЩЕСТВО</p><h1>Лента работ</h1></div></div><div className="feed-list">{feed.map((post) => <article className="feed-post" key={post.id}><div className="post-author"><button className="author-button" onClick={() => openProfile(post.author_id)}><img src={post.author?.avatar_url || '/favicon.svg'} alt="" /><span><b>{post.author?.nickname || 'Автор'}</b><small>{post.title}</small></span></button>{post.author_id !== viewerId && <button className="follow-button" style={{ minWidth: 120 }} disabled={followingAuthorId === post.author_id} aria-busy={followingAuthorId === post.author_id} onClick={() => toggleFollow(post)}>{followingAuthorId === post.author_id ? <LoaderCircle className="spin" size={14} /> : post.is_following ? 'Вы подписаны' : 'Подписаться'}</button>}</div><ArtworkPreview src={post.artwork?.image_url} alt={post.title} /><p>{post.caption}</p><div className="post-actions"><button className={`${post.is_liked ? 'liked' : ''} ${likingPostId === post.id ? 'loading' : ''}`} disabled={likingPostId === post.id} onClick={() => toggleLike(post)} aria-label={post.is_liked ? 'Убрать лайк' : 'Поставить лайк'}><Heart size={18} fill={post.is_liked ? 'currentColor' : 'none'} /> {post.like_count}</button>{post.comments_enabled && <button onClick={() => toggleComments(post.id)} aria-label="Комментарии"><Send size={17} /> {post.comment_count}</button>}<button className="report-button" onClick={() => reportPost(post.id)} aria-label="Пожаловаться"><Flag size={16} /></button></div>{openCommentsPostId === post.id && <div className="comments-panel">{(commentsByPost[post.id] || []).map((comment) => <div className="comment-row" key={comment.id}><b>{comment.author?.nickname || 'Автор'}</b><span>{comment.text}</span></div>)}{!(commentsByPost[post.id] || []).length && <p className="comments-empty">Пока нет комментариев.</p>}<form onSubmit={(event) => submitComment(event, post.id)}><input value={commentDraft} maxLength="300" placeholder="Напишите комментарий" onChange={(event) => setCommentDraft(event.target.value)} /><button type="submit" disabled={submittingComment}>{submittingComment ? <LoaderCircle className="spin" size={14} /> : '→'}</button></form></div>}</article>)}{!feed.length ? feedError ? <div className="error-retry"><p>Не удалось загрузить ленту</p><button className="secondary-button" onClick={loadFeed}>Повторить</button></div> : <p className="empty-state">Лента загружается…</p> : null}</div></section>;
  };

  const renderCollections = () => {
    return <section className="page"><div className="page-heading"><div><p className="eyebrow">АЛЬБОМЫ</p><h1>Коллекции</h1></div></div><div className="collection-list">{collections.map((col) => <button key={col.id} className="collection-card" onClick={async () => { const items = await metaApi.collectionTemplates(col.id); setTemplates(items); setView('catalog'); showNotice(`Открыта коллекция «${col.title}»`, 'info'); }}>
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

  const renderProfile = () => {
    if (!profile) return <div className="loading"><LoaderCircle className="spin" /> Загружаем…</div>;
    const isOwnProfile = profile.id === currentUser?.id;
    return <section className="page profile-page"><div className="page-heading"><div><p className="eyebrow">ПРОФИЛЬ</p><h1>{profile.nickname}</h1></div>{!isOwnProfile && <button className="follow-button" onClick={toggleProfileFollow}>{profile.is_following ? 'Вы подписаны' : 'Подписаться'}</button>}</div><div className="profile-card"><img src={profile.avatar_url || '/favicon.svg'} alt="" /><div><b>{profile.nickname}</b><p>{profile.status || 'Любит раскрашивать пиксели по номерам.'}</p></div><div className="profile-stats"><span><b>{profile.posts_count}</b>публикаций</span><span><b>{profile.followers_count}</b>подписчиков</span><span><b>{profile.following_count}</b>подписок</span></div></div><h2 className="section-title">Готовые работы</h2><div className="profile-artworks">{profileArtworks.map((artwork) => <img key={artwork.id} src={artwork.image_url} alt={artwork.title} title={artwork.title} />)}{!profileArtworks.length && <p className="empty-state">Готовых работ пока нет.</p>}</div>
      <h2 className="section-title">Серия и достижения</h2>
      <div className="profile-stats"><span><b>{streak?.current_streak || 0}</b>дней подряд</span><span><b>{streak?.longest_streak || 0}</b>рекорд</span><span><b>{achievements.filter((a) => a.unlocked).length}</b>наград</span></div>
    </section>;
  };

  const renderCreator = () => {
    const gridOptions = [
      { label: '16×16', w: 16, h: 16 },
      { label: '24×24', w: 24, h: 24 },
      { label: '32×32', w: 32, h: 32 },
    ];
    return <section className="page creator-page"><div className="page-heading"><div><p className="eyebrow">СВОЯ РАСКРАСКА</p><h1>Из изображения</h1></div></div><div className="creator-card">
      <label className="file-field"><input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => { const selected = event.target.files?.[0] || null; setFile(selected); setTitle('Моя пиксельная раскраска'); if (selected) prepareFromImage(selected); }} />{file ? file.name : 'Выбрать PNG, JPG или WebP'}</label>
      {file && <><label>Название<input value={title} maxLength="80" onChange={(event) => setTitle(event.target.value)} /></label>
        <div className="creator-crop-section"><h3>Кадрирование</h3>
          <div className="creator-crop-toggle"><button className={creatorCropMode === 'fit' ? 'selected' : ''} onClick={() => { setCreatorCropMode('fit'); setCreatorCrop({ scale: 1, offsetX: 0, offsetY: 0 }); }}>Вписать целиком</button><button className={creatorCropMode === 'crop' ? 'selected' : ''} onClick={() => setCreatorCropMode('crop')}>Кадрировать</button></div>
          {creatorCropMode === 'crop' && <><div className="creator-slider-row"><label>Масштаб <b>{creatorCrop.scale.toFixed(1)}×</b></label><input type="range" min="0.5" max="3" step="0.1" value={creatorCrop.scale} onChange={(event) => setCreatorCrop((prev) => ({ ...prev, scale: +event.target.value }))} /></div>
            <div className="creator-slider-row"><label>Смещение по X</label><input type="range" min="-200" max="200" step="1" value={creatorCrop.offsetX} onChange={(event) => setCreatorCrop((prev) => ({ ...prev, offsetX: +event.target.value }))} /><b>{creatorCrop.offsetX}</b></div>
            <div className="creator-slider-row"><label>Смещение по Y</label><input type="range" min="-200" max="200" step="1" value={creatorCrop.offsetY} onChange={(event) => setCreatorCrop((prev) => ({ ...prev, offsetY: +event.target.value }))} /><b>{creatorCrop.offsetY}</b></div>
            <button className="secondary-button" onClick={() => setCreatorCrop({ scale: 1, offsetX: 0, offsetY: 0 })}>Сбросить кадрирование</button></>}
        </div>
        <div className="creator-grid-section"><h3>Размер сетки</h3>
          <div className="creator-grid-options">{gridOptions.map((g) => <button key={g.label} className={creatorGrid.width === g.w ? 'selected' : ''} onClick={() => setCreatorGrid({ width: g.w, height: g.h })}>{g.label}</button>)}</div>
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
      <button className="secondary-button" onClick={() => { setCreatedColoring(null); setView('gallery'); }}>К моим работам</button>
    </section>;
  };

  let content;
  if (view === 'play') {
    content = (
      <PlayerView
        template={template}
        progress={progress}
        gameProgress={gameProgress}
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
        publishing={publishing}
        setView={setView}
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
  } else if (view === 'gallery') {
    content = renderGallery();
  } else if (view === 'feed') {
    content = renderFeed();
  } else if (view === 'create') {
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

  return <main className="telegram-frame"><div className="app-container"><header className="app-header"><button className="brand-button" onClick={() => setView('catalog')}><span className="header-logo">SPLINT</span><small>pixel studio</small></button><button className="icon-header-button" onClick={() => { loadAchievements(); setView('achievements'); }} title="Достижения"><Star size={18} /></button><button className="icon-header-button" onClick={() => { loadStreak(); setView('profile'); }} title="Профиль"><UserRound size={18} /></button><span className="local-badge">LOCAL</span></header><div className={`screen-content${view === 'play' ? ' screen-content--play' : ''}`}>{content}</div>{view !== 'play' && <nav className="app-tab-bar"><button className={view === 'catalog' ? 'active' : ''} onClick={() => setView('catalog')}><Compass size={19} />Каталог</button><button className={view === 'collections' ? 'active' : ''} onClick={() => setView('collections')}><BookOpen size={19} />Альбомы</button><button className={view === 'gallery' ? 'active' : ''} onClick={() => setView('gallery')}><Grid3X3 size={19} />Мои</button><button className={view === 'create' ? 'active' : ''} onClick={() => setView('create')}><ImagePlus size={19} />Создать</button><button className={view === 'feed' ? 'active' : ''} onClick={() => setView('feed')}><Send size={19} />Лента</button></nav>}</div>{notice && <div className={`toast ${notice.type}`}>{notice.text}</div>}</main>;
}

export default App;
