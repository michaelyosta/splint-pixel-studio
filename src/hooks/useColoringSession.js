import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, catalogApi, downloadColoringResult, metaApi, DEV_USER_ID, parseUnlockLockedError } from '../api/client';
import { floodFillRegion } from '../lib/floodFill';
import { findRewardingColor, getProgress, isProgressComplete, renderCompletedImage } from '../lib/pixelColoring';
import { isLargeGridTemplate } from '../lib/tileGrid';
import { createSaveQueue } from '../lib/progressSaveQueue';
import { createProgressJournal } from '../lib/progressJournal';
import { createHistoryOperation } from '../features/coloring/engine/historyOperations.js';
import { buildColoringDeepLink, shareViaTelegram } from '../lib/telegram';
import { takePrefetchedColoring } from '../lib/coloringPrefetch';

export function useColoringSession({
  view,
  feedMode,
  showNotice,
  onRewards,
  onLoadFeed,
  onNavigate,
  onUnlockRefresh,
  setLoading,
  setLatestReward,
  setServerCompletedTemplateId,
  serverCompletedTemplateId,
}) {
  const [template, setTemplate] = useState(null);
  const [progress, setProgress] = useState(null);
  const [zones, setZones] = useState([]);
  const [selectedColor, setSelectedColor] = useState(0);
  const [history, setHistory] = useState([]);
  const [future, setFuture] = useState([]);
  const [saving, setSaving] = useState(false);
  const [isOnline, setIsOnline] = useState(() => typeof navigator === 'undefined' || navigator.onLine !== false);
  const [saveState, setSaveState] = useState('saved');
  const [publishing, setPublishing] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [calmMode, setCalmMode] = useState(false);
  const [hideNumbers, setHideNumbers] = useState(false);
  const [hintMode, setHintMode] = useState(false);
  const [hintsRemaining, setHintsRemaining] = useState(5);
  const [fillMode, setFillMode] = useState(false);
  const [playMode, setPlayMode] = useState('classic');
  const [completionOpen, setCompletionOpen] = useState(false);
  const [lockedUnlock, setLockedUnlock] = useState(null);
  const [onboarding, setOnboarding] = useState(null);
  const [combo, setCombo] = useState(0);
  const [zoneReward, setZoneReward] = useState(null);
  const [tiledResultUrl, setTiledResultUrl] = useState(null);

  const sessionStartRef = useRef(0);
  const screenContentRef = useRef(null);
  const catalogScrollRef = useRef(0);
  const unlockRefreshedRef = useRef(new Set());
  const saveQueueRef = useRef(null);
  const tiledQueueRef = useRef([]);
  const tiledRevisionRef = useRef(0);
  const tiledFlushPromiseRef = useRef(null);
  const lastPaintRef = useRef(0);
  const comboRef = useRef(0);
  const milestoneRef = useRef(new Set());
  const zoneMilestoneRef = useRef(new Set());
  const paintedRef = useRef(false);
  const completedTemplateRef = useRef(null);
  const filledRef = useRef([]);
  const zoneIndicesRef = useRef({});

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
          onRewards(saved, template.id);
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
            onRewards(saved, nextTemplate.id);
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
      onNavigate('play');
      if (nextTemplate.unlock_granted || nextTemplate.unlock_state === 'owned') {
        unlockRefreshedRef.current.add(nextTemplate.id);
        onUnlockRefresh();
      }
      metaApi.track('open_level', { id });
    } catch (error) {
      const unlock = parseUnlockLockedError(error);
      if (unlock) {
        setLockedUnlock(unlock);
        onNavigate('play');
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
      onLoadFeed(feedMode);
      onNavigate('feed');
    } catch (error) {
      if (error.status === 409) {
        showNotice('Эта работа уже опубликована', 'info');
        setCompletionOpen(false);
        onNavigate('feed');
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

  const handlePlayerSetView = useCallback((nextView) => {
    if (nextView === 'catalog') saveQueueRef.current?.flush();
    setLockedUnlock(null);
    onNavigate(nextView);
  }, [onNavigate]);

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
        ? tiledResultUrl || progress?.result_preview_data_url || template.preview_url || null
        : renderCompletedImage(template, progress.filled)
      : null
  ), [artworkComplete, progress?.filled, progress?.result_preview_data_url, template, tiledResultUrl]);

  function dismissOnboarding() {
    setOnboarding(null);
    localStorage.setItem('splint_onboarding_version', '2');
  }

  useEffect(() => {
    if (!template || view !== 'play') return;
    if (artworkComplete && serverCompletedTemplateId === template.id && completedTemplateRef.current !== template.id) {
      completedTemplateRef.current = template.id;
      setCompletionOpen(true);
      metaApi.track('artwork_completed', { id: template.id }).catch(() => {});
      metaApi.track('reward_shown', { id: template.id }).catch(() => {});
      if (!unlockRefreshedRef.current.has(template.id)) {
        unlockRefreshedRef.current.add(template.id);
        onUnlockRefresh();
      }
    }
    if (!artworkComplete) completedTemplateRef.current = null;
  }, [artworkComplete, onUnlockRefresh, serverCompletedTemplateId, template, view]);

  useEffect(() => {
    if (view === 'play' && template && onboarding === null && localStorage.getItem('splint_onboarding_version') !== '2') {
      setOnboarding(0);
    }
  }, [view, template, onboarding]);

  useEffect(() => {
    if (view === 'play' && isLargeGridTemplate(template) && isOnline && tiledQueueRef.current.length) {
      flushTiledQueue().catch(() => setSaveState('pending'));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, template?.id, template?.storage_mode, template?.width, template?.height, isOnline]);

  useEffect(() => {
    const flushOnHide = () => { saveQueueRef.current?.flushAndDispose(); };
    window.addEventListener('pagehide', flushOnHide);
    return () => {
      window.removeEventListener('pagehide', flushOnHide);
      if (saveQueueRef.current) {
        saveQueueRef.current.flushAndDispose();
        saveQueueRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (view !== 'catalog') return;
    const el = screenContentRef.current;
    if (!el) return;
    requestAnimationFrame(() => { el.scrollTop = catalogScrollRef.current; });
  }, [view]);

  return {
    template,
    progress,
    zones,
    selectedColor,
    setSelectedColor,
    history,
    future,
    saving,
    isOnline,
    saveState,
    publishing,
    sharing,
    calmMode,
    setCalmMode,
    hideNumbers,
    setHideNumbers,
    hintMode,
    setHintMode,
    hintsRemaining,
    setHintsRemaining,
    fillMode,
    setFillMode,
    playMode,
    setPlayMode,
    completionOpen,
    setCompletionOpen,
    lockedUnlock,
    setLockedUnlock,
    onboarding,
    setOnboarding,
    combo,
    zoneReward,
    gameProgress,
    completedPreview,
    zoneIndicesRef,
    screenContentRef,
    openColoring,
    retryPendingSave,
    handleTiledStrokeCommitted,
    undo,
    redo,
    handleFirstPaint,
    handleWrongCell,
    handleFillAt,
    handleStrokeCommitted,
    resetProgress,
    shareResult,
    downloadResult,
    publishCompleted,
    dismissOnboarding,
    handlePlayerSetView,
  };
}
