import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, Compass, Flag, Flame, Grid3X3, Heart, ImagePlus, LoaderCircle, RotateCcw, Send, Sparkles, Star, Target, Trash2, Undo2, Redo2, UserRound, Lightbulb, Hand, BookOpen, Lock, EyeOff, ZoomIn } from 'lucide-react';
import { api, metaApi, catalogApi, DEV_USER_ID } from './api/client';
import PixelCanvas from './components/PixelCanvas';
import { floodFillRegion } from './lib/floodFill';
import { buildColoringFromImage, findRewardingColor, getProgress, renderCompletedImage } from './lib/pixelColoring';
import { createSaveQueue } from './lib/progressSaveQueue';
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

function formatCellCount(count) {
  const lastTwo = count % 100;
  if (lastTwo >= 11 && lastTwo <= 14) return `${count} клеток`;
  if (count % 10 === 1) return `${count} клетка`;
  if ([2, 3, 4].includes(count % 10)) return `${count} клетки`;
  return `${count} клеток`;
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
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState(null);
  const [feed, setFeed] = useState([]);
  const [commentsByPost, setCommentsByPost] = useState({});
  const [openCommentsPostId, setOpenCommentsPostId] = useState(null);
  const [commentDraft, setCommentDraft] = useState('');
  const [mine, setMine] = useState([]);
  const [file, setFile] = useState(null);
  const [title, setTitle] = useState('Моя пиксельная раскраска');
  const [difficulty, setDifficulty] = useState('easy');
  const [creating, setCreating] = useState(false);
  const [currentUser, setCurrentUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [profileArtworks, setProfileArtworks] = useState([]);
  const [draftColoring, setDraftColoring] = useState(null);
  const [combo, setCombo] = useState(0);
  const [reward, setReward] = useState(null);
  const [milestone, setMilestone] = useState(null);
  const [zoneReward, setZoneReward] = useState(null);
  const [filters, setFilters] = useState({ mood: '', theme: '', max_minutes: '' });
  const [today, setToday] = useState(null);
  const [streak, setStreak] = useState(null);
  const [achievements, setAchievements] = useState([]);
  const [collections, setCollections] = useState([]);
  const [calmMode, setCalmMode] = useState(false);
  const [hideNumbers, setHideNumbers] = useState(false);
  const [hintMode, setHintMode] = useState(false);
  const [fillMode, setFillMode] = useState(false);
  const sessionStartRef = useRef(0);

  const saveQueueRef = useRef(null);

  const noticeTimerRef = useRef(null);
  const rewardTimerRef = useRef(null);
  const lastPaintRef = useRef(0);
  const comboRef = useRef(0);
  const milestoneRef = useRef(new Set());
  const zoneMilestoneRef = useRef(new Set());
  const paintedRef = useRef(false);

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
    } catch (error) {
      showNotice(error.message, 'error');
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
    } catch (error) {
      showNotice(error.message, 'error');
    }
  }, [showNotice]);

  const loadFeed = useCallback(async () => {
    try {
      setFeed(await api('/feed/recommended'));
    } catch (error) {
      showNotice(error.message, 'error');
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
  useEffect(() => () => {
    if (saveQueueRef.current) saveQueueRef.current.dispose();
    window.clearTimeout(noticeTimerRef.current);
    window.clearTimeout(rewardTimerRef.current);
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
      setZones(nextZones.zones || []);
      if (saveQueueRef.current) saveQueueRef.current.dispose();
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

  const zoneIndicesRef = useRef({});
  useEffect(() => {
    if (!zones.length || !template) return;
    let active = true;
    (async () => {
      try {
        const data = await catalogApi.zones(template.id);
        if (!active) return;
        const map = {};
        data.zones.forEach((z) => { map[z.id] = z.indices; });
        zoneIndicesRef.current = map;
      } catch { /* ignore */ }
    })();
    return () => { active = false; };
  }, [zones.length, template]);

  function handlePaint(index, color) {
    if (!progress || progress.filled[index] !== -1) return;
    const now = Date.now();
    const nextCombo = now - lastPaintRef.current < 2200 ? comboRef.current + 1 : 1;
    lastPaintRef.current = now;
    comboRef.current = nextCombo;
    setCombo(nextCombo);
    const nextFilled = [...progress.filled];
    nextFilled[index] = color;
    const nextProgress = getProgress(template.cells, nextFilled);
    const xp = 10 + Math.min(40, Math.floor(nextCombo / 5) * 5);
    setReward(`+${xp} XP`);
    window.clearTimeout(rewardTimerRef.current);
    rewardTimerRef.current = window.setTimeout(() => setReward(null), 850);
    const reached = [25, 50, 75, 100].find((value) => nextProgress.percent >= value && !milestoneRef.current.has(value));
    if (reached) {
      milestoneRef.current.add(reached);
      setMilestone(reached === 100 ? 'Готово! Раскраска завершена 🎉' : `${reached}% — отличный ритм!`);
      window.setTimeout(() => setMilestone(null), 2200);
      metaApi.track(`reach_${reached}`, { id: template.id });
    }
    const remainingForColor = template.cells.reduce((total, target, cellIndex) => total + (target === color && nextFilled[cellIndex] === -1 ? 1 : 0), 0);
    if (remainingForColor === 0) {
      const nextColor = findRewardingColor(template, nextFilled, color);
      if (nextColor !== undefined) setSelectedColor(nextColor);
    }
    window.Telegram?.WebApp?.HapticFeedback?.selectionChanged?.();
    applyFilled(nextFilled, { index, from: -1, to: color });
    const nextZones = refreshZones(nextFilled);
    if (nextZones) {
      const completedZone = nextZones.find((zone) => zone.percent === 100 && !zoneMilestoneRef.current.has(zone.id));
      if (completedZone) {
        zoneMilestoneRef.current.add(completedZone.id);
        setZoneReward(`Участок «${completedZone.title}» закрыт! +50 XP`);
        window.setTimeout(() => setZoneReward(null), 2200);
        metaApi.track('zone_complete', { id: template.id, zone: completedZone.id });
        metaApi.unlockAchievement('ach_first_zone').catch(() => {});
        metaApi.touchStreak().catch(() => {});
      }
    }
  }

  function handleFillAt(index) {
    if (!fillMode || !progress || progress.filled[index] !== -1) return;
    const targetColor = template.cells[index];
    if (selectedColor !== targetColor) setSelectedColor(targetColor);
    const region = floodFillRegion(template, progress.filled, index);
    if (!region.length) return;
    const nextFilled = [...progress.filled];
    region.forEach((cell) => { nextFilled[cell] = targetColor; });
    applyFilled(nextFilled, null);
    refreshZones(nextFilled);
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
    const nextFilled = [...progress.filled];
    nextFilled[last.index] = last.from;
    setHistory((current) => current.slice(0, -1));
    setFuture((current) => [...current, last]);
    applyFilled(nextFilled);
    refreshZones(nextFilled);
  }

  function redo() {
    const next = future.at(-1);
    if (!next || !progress) return;
    const nextFilled = [...progress.filled];
    nextFilled[next.index] = next.to;
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

  async function publishCompleted() {
    if (!progress?.artwork_id) return;
    try {
      await api('/posts/create', { method: 'POST', body: { artworkId: progress.artwork_id, title: template.title, caption: `Завершил(а) раскраску «${template.title}»!`, commentsEnabled: true } });
      showNotice('Работа опубликована в ленте', 'success');
      metaApi.track('publish', { id: template.id });
      setView('feed');
    } catch (error) {
      showNotice(error.message, 'error');
    }
  }

  async function prepareFromImage() {
    if (!file) return showNotice('Сначала выберите изображение', 'error');
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 10 * 1024 * 1024) {
      return showNotice('Поддерживаются PNG, JPG и WebP размером до 10 МБ', 'error');
    }
    setCreating(true);
    try {
      const preset = DIFFICULTIES[difficulty];
      const data = await buildColoringFromImage(file, preset);
      setDraftColoring(data);
      showNotice('Проверьте превью перед сохранением', 'success');
    } catch (error) {
      showNotice(error.message || 'Не удалось обработать изображение', 'error');
    } finally {
      setCreating(false);
    }
  }

  async function saveDraftColoring() {
    if (!draftColoring) return;
    setCreating(true);
    try {
      const created = await api('/colorings/create', { method: 'POST', body: { title, description: 'Создано из пользовательского изображения', ...draftColoring } });
      setDraftColoring(null);
      setFile(null);
      await loadMine();
      showNotice('Приватная раскраска сохранена', 'success');
      metaApi.track('create_coloring', { id: created.id });
      await openColoring(created.id);
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
    try {
      await api(`/posts/${post.id}/like`, { method: post.is_liked ? 'DELETE' : 'POST' });
      loadFeed();
      metaApi.track('like', { post: post.id });
    } catch (error) {
      showNotice(error.message, 'error');
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
    if (!text) return;
    try {
      const comment = await api(`/posts/${postId}/comments`, { method: 'POST', body: { text } });
      setCommentsByPost((current) => ({ ...current, [postId]: [...(current[postId] || []), comment] }));
      setCommentDraft('');
      setFeed((current) => current.map((post) => post.id === postId ? { ...post, comment_count: post.comment_count + 1 } : post));
      metaApi.track('comment', { post: postId });
    } catch (error) {
      showNotice(error.message, 'error');
    }
  }

  async function toggleFollow(post) {
    try {
      const result = await api(`/users/${post.author_id}/follow`, { method: 'POST' });
      setFeed((current) => current.map((item) => item.id === post.id ? { ...item, is_following: result.is_following } : item));
    } catch (error) {
      showNotice(error.message, 'error');
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

  function Catalog() {
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

      {loading ? <Loading /> : <div className="coloring-grid">{templates.map((item) => <article className="coloring-card" key={item.id}>
        <div className="card-preview" style={item.preview_url ? { backgroundImage: `linear-gradient(180deg, transparent, #14222e), url(${item.preview_url})` } : undefined}><span>{item.est_minutes} мин</span></div>
        <div className="card-body"><h2>{item.title}</h2><p>{item.description}</p><small>{item.width}×{item.height} · {item.palette.length} цветов · {formatDifficulty(item.difficulty)}</small><button className="primary-button" onClick={() => openColoring(item.id)}>Начать</button></div>
      </article>)}</div>}
    </section>;
  }

  function Player() {
    if (!template || !progress || !gameProgress) return <Loading />;
    const isComplete = gameProgress.percent === 100;
    const selectedRemaining = template.cells.reduce((total, target, cellIndex) => total + (target === selectedColor && progress.filled[cellIndex] === -1 ? 1 : 0), 0);
    const totalXp = gameProgress.completed * 10;
    const level = Math.floor(totalXp / 1000) + 1;
    return <section className="page player-page">
      <button className="back-button" onClick={() => setView('catalog')}><ChevronLeft size={18} /> К каталогу</button>
      <div className="player-heading"><div><p className="eyebrow">{formatDifficulty(template.difficulty)}</p><h1>{template.title}</h1></div><div className="progress-ring"><b>{gameProgress.percent}%</b><span>{saving ? 'Сохранение…' : 'сохранено'}</span></div></div>
      <div className="progress-bar"><i style={{ width: `${gameProgress.percent}%` }} /></div>

      <div className="zone-track">
        {zones.map((zone) => <button key={zone.id} className={`zone-pill ${zone.percent === 100 ? 'done' : ''}`} disabled title={zone.title}>
          <span className="zone-fill" style={{ width: `${zone.percent}%` }} />
          <span className="zone-text">{zone.title}</span>
          <span className="zone-pct">{zone.percent}%</span>
        </button>)}
      </div>

      <div className="game-hud"><div><Target size={17} /><span>Цель<b>Цвет №{selectedColor + 1} · {formatCellCount(selectedRemaining)}</b></span></div><div className={combo >= 5 ? 'combo hot' : 'combo'}><Flame size={17} /><span>Комбо<b>×{combo}</b></span></div><div><Star size={17} /><span>Уровень {level}<b>{totalXp} XP</b></span></div>{reward && <em>{reward}</em>}</div>
      {milestone && <div className="milestone"><Sparkles size={17} /> {milestone}</div>}
      {zoneReward && <div className="milestone zone"><Target size={17} /> {zoneReward}</div>}

      <PixelCanvas
        template={template}
        filled={progress.filled}
        selectedColor={selectedColor}
        onPaint={handlePaint}
        onWrong={handleWrongCell}
        onFirstPaint={handleFirstPaint}
        calmMode={calmMode}
        hideFilledNumbers={hideNumbers}
        hintMode={hintMode}
        onTapCell={fillMode ? handleFillAt : undefined}
      />

      <div className="paint-tools">
        <button className={fillMode ? 'active' : ''} onClick={() => setFillMode((v) => !v)} title="Залить область"><ZoomIn size={17} /> Заливка</button>
        <button className={hintMode ? 'active' : ''} onClick={() => setHintMode((v) => !v)} title="Подсказка"><Lightbulb size={17} /> Подсказка</button>
        <button className={calmMode ? 'active' : ''} onClick={() => setCalmMode((v) => !v)} title="Спокойный режим без штрафа"><Hand size={17} /> Спокойно</button>
        <button className={hideNumbers ? 'active' : ''} onClick={() => setHideNumbers((v) => !v)} title="Скрыть номера"><EyeOff size={17} /> Номера</button>
      </div>

      <div className="palette" aria-label="Палитра цветов">{template.palette.map((color, index) => {
        const remaining = template.cells.reduce((total, target, cellIndex) => total + (target === index && progress.filled[cellIndex] === -1 ? 1 : 0), 0);
        return <button key={color} className={`color-swatch ${selectedColor === index ? 'selected' : ''}`} onClick={() => setSelectedColor(index)} title={`Цвет ${index + 1}`}><i style={{ background: color }} /><span>{index + 1}</span><small>{remaining}</small></button>;
      })}</div>
      <div className="game-actions"><button onClick={undo} disabled={!history.length}><Undo2 size={18} /> Отмена</button><button onClick={redo} disabled={!future.length}><Redo2 size={18} /> Повтор</button><button onClick={resetProgress}><RotateCcw size={18} /> Сбросить</button></div>
      {isComplete && <div className="completion-card celebration"><div className="confetti" aria-hidden="true">✦ ◆ ✦</div><img src={completedPreview} alt={`Готовая работа ${template.title}`} /><div><b>Раскраска завершена!</b><p>Работа сохранена в галерее.</p></div><button className="primary-button" onClick={publishCompleted}>Поделиться в историю</button></div>}
    </section>;
  }

  function Gallery() {
    return <section className="page"><div className="page-heading"><div><p className="eyebrow">МОИ РАБОТЫ</p><h1>Галерея</h1></div></div><div className="gallery-list">{mine.map((item) => <div className="gallery-row" key={item.id}><button className="gallery-open" onClick={() => openColoring(item.id)}><span className="mini-palette" style={item.preview_url ? { backgroundImage: `url(${item.preview_url})` } : { background: item.palette[0] }}><Grid3X3 size={18} /></span><span><b>{item.title}</b><small>{item.progress.percent}% · {item.width}×{item.height}</small></span><span className="gallery-progress">{item.progress.percent}%</span></button>{item.source_type === 'user' && <button className="delete-button" onClick={() => deleteColoring(item)} aria-label={`Удалить ${item.title}`}><Trash2 size={17} /></button>}</div>)}{!mine.length && <p className="empty-state">Здесь появятся начатые и созданные вами раскраски.</p>}</div></section>;
  }

  function Feed() {
    const viewerId = currentUser?.id || DEV_USER_ID;
    return <section className="page"><div className="page-heading"><div><p className="eyebrow">СООБЩЕСТВО</p><h1>Лента работ</h1></div></div><div className="feed-list">{feed.map((post) => <article className="feed-post" key={post.id}><div className="post-author"><button className="author-button" onClick={() => openProfile(post.author_id)}><img src={post.author?.avatar_url || '/favicon.svg'} alt="" /><span><b>{post.author?.nickname || 'Автор'}</b><small>{post.title}</small></span></button>{post.author_id !== viewerId && <button className="follow-button" onClick={() => toggleFollow(post)}>{post.is_following ? 'Вы подписаны' : 'Подписаться'}</button>}</div><ArtworkPreview src={post.artwork?.image_url} alt={post.title} /><p>{post.caption}</p><div className="post-actions"><button className={post.is_liked ? 'liked' : ''} onClick={() => toggleLike(post)}><Heart size={18} fill={post.is_liked ? 'currentColor' : 'none'} /> {post.like_count}</button>{post.comments_enabled && <button onClick={() => toggleComments(post.id)}><Send size={17} /> {post.comment_count}</button>}<button className="report-button" onClick={() => reportPost(post.id)} aria-label="Пожаловаться"><Flag size={16} /></button></div>{openCommentsPostId === post.id && <div className="comments-panel">{(commentsByPost[post.id] || []).map((comment) => <div className="comment-row" key={comment.id}><b>{comment.author?.nickname || 'Автор'}</b><span>{comment.text}</span></div>)}{!(commentsByPost[post.id] || []).length && <p className="comments-empty">Пока нет комментариев.</p>}<form onSubmit={(event) => submitComment(event, post.id)}><input value={commentDraft} maxLength="300" placeholder="Напишите комментарий" onChange={(event) => setCommentDraft(event.target.value)} /><button type="submit" aria-label="Отправить комментарий"><Send size={16} /></button></form></div>}</article>)}{!feed.length && <p className="empty-state">Завершите первую раскраску и опубликуйте её здесь.</p>}</div></section>;
  }

  function Collections() {
    return <section className="page"><div className="page-heading"><div><p className="eyebrow">АЛЬБОМЫ</p><h1>Коллекции</h1></div></div><div className="collection-list">{collections.map((col) => <button key={col.id} className="collection-card" onClick={async () => { const items = await metaApi.collectionTemplates(col.id); setTemplates(items); setView('catalog'); showNotice(`Открыта коллекция «${col.title}»`, 'info'); }}>
      <span className="collection-preview" style={col.image_url ? { backgroundImage: `url(${col.image_url})` } : undefined} />
      <span className="collection-info"><b>{col.title}</b><small>{col.completed_count}/{col.total_count} завершено · {col.rarity}</small></span>
      <BookOpen size={18} />
    </button>)}{!collections.length && <p className="empty-state">Коллекции появятся позже.</p>}</div></section>;
  }

  function Achievements() {
    return <section className="page"><div className="page-heading"><div><p className="eyebrow">ДОСТИЖЕНИЯ</p><h1>Награды</h1></div></div><div className="achievement-grid">{achievements.map((ach) => <div key={ach.id} className={`achievement ${ach.unlocked ? 'unlocked' : 'locked'}`}>
      <span className="achievement-icon">{ach.unlocked ? <Star size={20} /> : <Lock size={20} />}</span>
      <b>{ach.title}</b>
      <small>{ach.description}</small>
    </div>)}{!achievements.length && <p className="empty-state">Достижения загружаются…</p>}</div></section>;
  }

  function Profile() {
    if (!profile) return <Loading />;
    const isOwnProfile = profile.id === currentUser?.id;
    return <section className="page profile-page"><div className="page-heading"><div><p className="eyebrow">ПРОФИЛЬ</p><h1>{profile.nickname}</h1></div>{!isOwnProfile && <button className="follow-button" onClick={toggleProfileFollow}>{profile.is_following ? 'Вы подписаны' : 'Подписаться'}</button>}</div><div className="profile-card"><img src={profile.avatar_url || '/favicon.svg'} alt="" /><div><b>{profile.nickname}</b><p>{profile.status || 'Любит раскрашивать пиксели по номерам.'}</p></div><div className="profile-stats"><span><b>{profile.posts_count}</b>публикаций</span><span><b>{profile.followers_count}</b>подписчиков</span><span><b>{profile.following_count}</b>подписок</span></div></div><h2 className="section-title">Готовые работы</h2><div className="profile-artworks">{profileArtworks.map((artwork) => <img key={artwork.id} src={artwork.image_url} alt={artwork.title} title={artwork.title} />)}{!profileArtworks.length && <p className="empty-state">Готовых работ пока нет.</p>}</div>
      <h2 className="section-title">Серия и достижения</h2>
      <div className="profile-stats"><span><b>{streak?.current_streak || 0}</b>дней подряд</span><span><b>{streak?.longest_streak || 0}</b>рекорд</span><span><b>{achievements.filter((a) => a.unlocked).length}</b>наград</span></div>
    </section>;
  }

  function Creator() {
    return <section className="page creator-page"><div className="page-heading"><div><p className="eyebrow">СВОЯ РАСКРАСКА</p><h1>Из изображения</h1></div></div><div className="creator-card"><ImagePlus size={30} /><h2>Превратите фото в пиксельную раскраску</h2><p>Изображение обрабатывается локально и вписывается целиком. Перед сохранением вы увидите точный будущий результат.</p><label className="file-field"><input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => { setFile(event.target.files?.[0] || null); setDraftColoring(null); }} />{file ? file.name : 'Выбрать PNG, JPG или WebP'}</label><label>Название<input value={title} maxLength="80" onChange={(event) => setTitle(event.target.value)} /></label><div className="difficulty-options">{Object.entries(DIFFICULTIES).map(([key, item]) => <button key={key} className={difficulty === key ? 'selected' : ''} onClick={() => { setDifficulty(key); setDraftColoring(null); }}><b>{item.label}</b><small>{item.width}×{item.height} · {item.colors} цветов</small></button>)}</div>{draftColoring && <div className="creation-preview"><img src={draftColoring.previewDataUrl} alt="Точное превью будущей раскраски" /><div><b>Так будет выглядеть результат</b><p>Если силуэт читается хорошо — сохраняйте. Иначе выберите другую сложность или более контрастное фото.</p></div></div>}<button className="primary-button create-button" disabled={creating} onClick={draftColoring ? saveDraftColoring : prepareFromImage}>{creating ? <LoaderCircle className="spin" size={18} /> : draftColoring ? <Star size={18} /> : <Sparkles size={18} />} {creating ? 'Обрабатываем…' : draftColoring ? 'Сохранить и начать' : 'Создать превью'}</button>{draftColoring && <button className="secondary-button" onClick={() => setDraftColoring(null)}>Настроить заново</button>}</div></section>;
  }

  function Loading() { return <div className="loading"><LoaderCircle className="spin" /> Загружаем…</div>; }

  const content = view === 'play' ? <Player /> : view === 'gallery' ? <Gallery /> : view === 'feed' ? <Feed /> : view === 'create' ? <Creator /> : view === 'profile' ? <Profile /> : view === 'collections' ? <Collections /> : view === 'achievements' ? <Achievements /> : <Catalog />;
  return <main className="telegram-frame"><div className="app-container"><header className="app-header"><button className="brand-button" onClick={() => setView('catalog')}><span className="header-logo">SPLINT</span><small>pixel studio</small></button><button className="icon-header-button" onClick={() => { loadAchievements(); setView('achievements'); }} title="Достижения"><Star size={18} /></button><button className="icon-header-button" onClick={() => { loadStreak(); setView('profile'); }} title="Профиль"><UserRound size={18} /></button><span className="local-badge">LOCAL</span></header><div className="screen-content">{content}</div>{view !== 'play' && <nav className="app-tab-bar"><button className={view === 'catalog' ? 'active' : ''} onClick={() => setView('catalog')}><Compass size={19} />Каталог</button><button className={view === 'collections' ? 'active' : ''} onClick={() => setView('collections')}><BookOpen size={19} />Альбомы</button><button className={view === 'gallery' ? 'active' : ''} onClick={() => setView('gallery')}><Grid3X3 size={19} />Мои</button><button className={view === 'create' ? 'active' : ''} onClick={() => setView('create')}><ImagePlus size={19} />Создать</button><button className={view === 'feed' ? 'active' : ''} onClick={() => setView('feed')}><Send size={19} />Лента</button></nav>}</div>{notice && <div className={`toast ${notice.type}`}>{notice.text}</div>}</main>;
}

export default App;
