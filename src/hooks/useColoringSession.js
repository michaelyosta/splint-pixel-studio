import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, catalogApi, downloadColoringResult, metaApi, DEV_USER_ID, parseUnlockLockedError } from '../api/client';
import { floodFillRegion } from '../lib/floodFill';
import { findRewardingColor, getProgress, isProgressComplete, renderCompletedImage } from '../lib/pixelColoring';
import { isLargeGridTemplate } from '../lib/tileGrid';
import { createSaveQueue, isIdempotentReplay, isTerminalSpecialError, offerFromProgress } from '../lib/progressSaveQueue';
import { createProgressJournal } from '../lib/progressJournal';
import { createHistoryOperation } from '../features/coloring/engine/historyOperations.js';
import { buildColoringDeepLink, shareViaTelegram } from '../lib/telegram';
import { takePrefetchedColoring } from '../lib/coloringPrefetch';
import { recordSpecialCellsError } from '../lib/specialCellsDiagnostics';
import {
  isResumeCompatible,
  mergeResumeSnapshot,
  readResumeSnapshot,
  writeResumeSnapshot,
} from '../lib/resumeState.js';
import { getNextCoreFeelFragment, isCoreFeelReference } from '../features/coreFeel/coreFeelExperiment.js';

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
  coreFeelExperiment,
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
  const [tiledSpecialOffer, setTiledSpecialOffer] = useState(null);
  const [tiledSpecialApplied, setTiledSpecialApplied] = useState(null);
  const [tiledSpecialDiscovered, setTiledSpecialDiscovered] = useState(null);
  const [tiledReconciledChanges, setTiledReconciledChanges] = useState([]);
  const [resumeSnapshot, setResumeSnapshot] = useState(null);

  const sessionStartRef = useRef(0);
  const sessionIdRef = useRef(null);
  const specialGroupRef = useRef(null);
  const screenContentRef = useRef(null);
  const catalogScrollRef = useRef(0);
  const unlockRefreshedRef = useRef(new Set());
  const saveQueueRef = useRef(null);
  const tiledQueueRef = useRef([]);
  const tiledSpecialOfferRef = useRef(null);
  const tiledRevisionRef = useRef(0);
  const legacyRevisionRef = useRef(0);
  const legacyAuthoritativeFilledRef = useRef([]);
  const legacyAuthoritativeProgressRef = useRef(null);
  const tiledFlushPromiseRef = useRef(null);
  const specialClaimedAtRef = useRef(null);
  const specialContinuationPendingRef = useRef(false);
  const lastPaintRef = useRef(0);
  const comboRef = useRef(0);
  const milestoneRef = useRef(new Set());
  const zoneMilestoneRef = useRef(new Set());
  const paintedRef = useRef(false);
  const coreFeelResumeRef = useRef(false);
  const completedTemplateRef = useRef(null);
  const filledRef = useRef([]);
  const zoneIndicesRef = useRef({});
  const resumeSnapshotRef = useRef(null);

  tiledSpecialOfferRef.current = tiledSpecialOffer;

  function persistResumeState(patch = {}) {
    if (!template?.id) return null;
    const completed = Number(progress?.percent) >= 100;
    const meaningful = Number(progress?.completed_cells) > 0
      || Number(progress?.percent) > 0
      || (Array.isArray(progress?.filled) && progress.filled.some((value) => value !== -1));
    const next = mergeResumeSnapshot(resumeSnapshotRef.current, {
      artworkId: template.id,
      ...patch,
      // A completed artwork is no longer a resumable Continue candidate. Keep
      // its per-artwork camera/history hint, but move the cold-start pointer
      // back to Home until the player explicitly opens another unfinished work.
      route: completed ? 'home' : view,
      progressRevision: progress?.revision ?? resumeSnapshotRef.current?.progressRevision ?? 0,
      selectedColor,
      pendingSave: saveState !== 'saved',
      lastInteractionAt: new Date().toISOString(),
    });
    if (!next) return null;
    resumeSnapshotRef.current = next;
    setResumeSnapshot(next);
    writeResumeSnapshot(next, { updateCurrent: completed || meaningful });
    return next;
  }

  function beginAnalyticsSession() {
    sessionIdRef.current = globalThis.crypto?.randomUUID?.()
      || `session-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }

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

  function createLegacySaveQueue(templateForQueue) {
    return createSaveQueue({
      putProgress: async ({ filled, revision, clientBatchId, specialAction = null }) => {
        const changes = filled.flatMap((color, index) => (
          color === legacyAuthoritativeFilledRef.current[index] ? [] : [{ index, color }]
        ));
        if (!changes.length) return legacyAuthoritativeProgressRef.current;
        let saved = legacyAuthoritativeProgressRef.current;
        let nextRevision = revision;
        for (let offset = 0; offset < changes.length; offset += 64) {
          const batch = changes.slice(offset, offset + 64);
          const batchSpecialAction = specialAction
            && (specialAction.cell_index == null
              || batch.some((change) => change.index === specialAction.cell_index))
            ? Object.fromEntries(Object.entries(specialAction).filter(([key]) => key !== 'cell_index' && key !== 'experiment_group'))
            : null;
          saved = await api(`/colorings/${templateForQueue.id}/progress/actions`, {
            method: 'POST',
            body: {
              changes: batch,
              ...(batchSpecialAction ? { special_action: batchSpecialAction } : {}),
              revision: nextRevision,
              clientBatchId: `${clientBatchId}:${Math.floor(offset / 64)}`,
            },
          });
          legacyAuthoritativeFilledRef.current = [...saved.filled];
          legacyAuthoritativeProgressRef.current = saved;
          nextRevision = saved.revision;
          legacyRevisionRef.current = saved.revision;
          if (saved.special_discovered) setTiledSpecialDiscovered(saved.special_discovered);
          if (saved.special_offer) {
            setTiledSpecialOffer(saved.special_offer);
            if (!isIdempotentReplay(saved)) specialClaimedAtRef.current = Date.now();
          }
          trackCanonicalSpecialEvents({
            saved,
            specialAction,
            templateId: templateForQueue.id,
            replay: isIdempotentReplay(saved),
          });
        }
        return saved;
      },
      getResultDataUrl: (filled) => {
        return filled.every((color, index) => color === templateForQueue.cells[index])
          ? renderCompletedImage(templateForQueue, filled)
          : null;
      },
      onProgress: (saved) => {
        setProgress(saved);
        if (!isCoreFeelReference(coreFeelExperiment, templateForQueue)) onRewards(saved, templateForQueue.id);
        if (saved.percent === 100) setServerCompletedTemplateId(templateForQueue.id);
      },
      onNotice: (message, type) => {
        if (type === 'error') setSaveState(isOnline ? 'pending' : 'offline');
        showNotice(message, type);
      },
      onSpecialRejected: (error) => {
        recordSpecialCellsError(error);
        setTiledSpecialOffer(null);
        setTiledSpecialDiscovered(null);
        showNotice(error.message || 'Spark больше недоступен', 'info');
      },
      onSaving: (value) => {
        setSaving(value);
        if (value) setSaveState(isOnline ? 'syncing' : 'offline');
        else if (isOnline) setSaveState('saved');
      },
      journal: createProgressJournal({ scope: `${DEV_USER_ID}:${templateForQueue.id}` }),
      templateId: templateForQueue.id,
      userScope: DEV_USER_ID,
    });
  }

  function trackCanonicalSpecialEvents({ saved, specialAction, templateId, replay = false } = {}) {
    if (!specialAction || replay) return;
    const actionType = String(specialAction.type || '');
    const inferredKind = actionType.replace(/^(claim_|use_|skip_|disarm_)/, '') || null;
    const kind = saved?.special_discovered?.kind || saved?.special_offer?.kind || inferredKind;
    const base = {
      template_id: templateId,
      session_id: sessionIdRef.current,
      special_id: saved?.special_discovered?.special_id
        || saved?.special_offer?.special_id
        || specialAction.special_id,
      kind,
      action: actionType,
      revision: saved?.revision ?? null,
      experiment_group: specialAction.experiment_group || null,
    };
    if (saved?.special_discovered) metaApi.track('special_cell_discovered', base).catch(() => {});
    if (saved?.special_offer) metaApi.track('powerup_received', base).catch(() => {});
    if (/^(use_|skip_|disarm_)/.test(actionType)) {
      metaApi.track('special_action_selected', base).catch(() => {});
    }
    if (Array.isArray(saved?.special_applied_changes) && saved.special_applied_changes.length) {
      metaApi.track('powerup_used', {
        ...base,
        cells: saved.special_applied_changes.length,
      }).catch(() => {});
    }
  }

  async function flushTiledQueue() {
    if (tiledFlushPromiseRef.current) return tiledFlushPromiseRef.current;
    if (!template?.id || !isLargeGridTemplate(template) || !isOnline) return undefined;
    const flush = (async () => {
      while (tiledQueueRef.current.length) {
        const activeOffer = tiledSpecialOfferRef.current;
        let entry = tiledQueueRef.current[0];
        if (activeOffer) {
          // Once an offer is visible, ordinary journal entries must not race
          // it. If the matching resolution action is already journaled behind
          // an older ordinary entry (for example after reload), move only that
          // action to the front. No new endpoint or second queue is needed.
          const actionIndex = tiledQueueRef.current.findIndex((candidate) => (
            candidate.specialAction?.special_id
            && String(candidate.specialAction.special_id) === String(activeOffer.special_id)
          ));
          if (actionIndex < 0) {
            setSaveState('pending');
            return;
          }
          if (actionIndex > 0) {
            const [action] = tiledQueueRef.current.splice(actionIndex, 1);
            tiledQueueRef.current.unshift(action);
            entry = action;
          }
        }
        try {
          const batches = entry.changes.length
            ? Array.from({ length: Math.ceil(entry.changes.length / 64) }, (_, index) => ({
              changes: entry.changes.slice(index * 64, index * 64 + 64),
              offset: index * 64,
            }))
            : [{ changes: [], offset: 0 }];
          for (const { changes: batch, offset } of batches) {
            const clientBatchId = `${entry.clientBatchId}:${Math.floor(offset / 64)}`;
            const specialAction = entry.specialAction
              && (entry.specialAction.cell_index == null
                || batch.some((change) => change.index === entry.specialAction.cell_index))
              ? Object.fromEntries(Object.entries(entry.specialAction).filter(([key]) => key !== 'cell_index'))
              : null;
            let saved;
            for (let attempt = 0; attempt < 2; attempt += 1) {
              try {
                saved = await api(`/colorings/${template.id}/progress/actions`, {
                  method: 'POST',
                  body: {
                    changes: batch,
                    ...(specialAction ? { special_action: specialAction } : {}),
                    revision: tiledRevisionRef.current,
                    clientBatchId,
                  },
                });
                break;
              } catch (error) {
                // Terminal special rejections can never succeed on retry.
                if (isTerminalSpecialError(error)) throw error;
                // Another device may have committed a batch while this queue
                // was offline. Adopt its revision and replay our idempotent
                // batch once instead of trapping the queue in a permanent 409.
                if (error.status !== 409 || !error.data?.progress || attempt > 0) throw error;
                tiledRevisionRef.current = Number(error.data.progress.revision || tiledRevisionRef.current);
              }
            }
            tiledRevisionRef.current = saved.revision;
            // A reload can fetch a tile before a fresh durable journal replay
            // finishes. Publish only a newly applied batch so the mounted
            // tiled renderer can reconcile its resident cache without
            // re-fetching (and without adding work to pointermove). An
            // idempotent replay is deliberately not written into the cache:
            // its request is not authoritative evidence that those historical
            // cell values still win over a later device update.
            if (!isIdempotentReplay(saved) && batch.length) {
              setTiledReconciledChanges([...batch]);
            }
            setProgress(saved);
            onRewards(saved, template.id);
            if (entry.specialAction && specialAction) {
              const replay = isIdempotentReplay(saved);
              const nextOffer = offerFromProgress(saved);
              tiledSpecialOfferRef.current = nextOffer;
              setTiledSpecialOffer(nextOffer);
              if (saved.special_discovered) setTiledSpecialDiscovered(saved.special_discovered);
              if (!replay && saved.special_offer) {
                specialClaimedAtRef.current = Date.now();
                metaApi.track('special_cell_claimed', {
                  template_id: template.id,
                  special_id: saved.special_offer.special_id,
                  revision: saved.revision,
                  experiment_group: entry.specialAction.experiment_group || null,
                }).catch(() => {});
                metaApi.track('special_targets_presented', {
                  template_id: template.id,
                  special_id: saved.special_offer.special_id,
                  option_count: saved.special_offer.target_options?.length || 0,
                  revision: saved.revision,
                  experiment_group: entry.specialAction.experiment_group || null,
                }).catch(() => {});
              }
              if (Array.isArray(saved.special_applied_changes) && saved.special_applied_changes.length) {
                setTiledSpecialApplied({
                  revision: saved.revision,
                  specialId: entry.specialAction.special_id,
                  kind: entry.specialAction.type === 'use_spark' ? 'spark' : null,
                  changes: saved.special_applied_changes,
                });
                if (!replay) {
                  metaApi.track('special_applied', {
                    template_id: template.id,
                    special_id: entry.specialAction.special_id,
                    cells: saved.special_applied_changes.length,
                    revision: saved.revision,
                    time_to_use_ms: specialClaimedAtRef.current
                      ? Math.max(0, Date.now() - specialClaimedAtRef.current)
                      : null,
                    experiment_group: entry.specialAction.experiment_group || null,
                  }).catch(() => {});
                  specialContinuationPendingRef.current = true;
                }
              }
              trackCanonicalSpecialEvents({
                saved,
                specialAction: entry.specialAction,
                templateId: template.id,
                replay,
              });
            }
          }
        } catch (error) {
          recordSpecialCellsError(error);
          if (!isTerminalSpecialError(error)) throw error;
          let serverProgress = error.data?.progress || null;
          // Special validation errors are raised inside the transaction and
          // the route may therefore omit the normal response payload. Do not
          // infer that the offer disappeared from an absent field: recover
          // through the existing progress endpoint, which reconstructs the
          // persisted token from the idempotent claim journal.
          if (!serverProgress || !Object.prototype.hasOwnProperty.call(serverProgress, 'special_offer')) {
            try {
              serverProgress = await api(`/colorings/${template.id}/progress`);
            } catch {
              // Keep the offer and journal entry intact; a later online retry
              // must be able to resolve the same action.
              throw error;
            }
          }
          if (serverProgress) {
            tiledRevisionRef.current = Number(serverProgress.revision || tiledRevisionRef.current);
            setProgress(serverProgress);
            onRewards(serverProgress, template.id);
          }
          const recoveredOffer = offerFromProgress(serverProgress);
          tiledSpecialOfferRef.current = recoveredOffer;
          setTiledSpecialOffer(recoveredOffer);
          const recoveredDiscovery = serverProgress?.special_discovered || null;
          setTiledSpecialDiscovered(recoveredDiscovery);
          showNotice(error.message || 'Spark больше недоступен', 'info');
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

  async function openColoring(id, { resumeSnapshot: requestedResume = null, usePersistedResume = true } = {}) {
    catalogScrollRef.current = screenContentRef.current?.scrollTop ?? 0;
    setLockedUnlock(null);
    setLoading(true);
    try {
      const persistedResume = requestedResume || (usePersistedResume ? readResumeSnapshot(id) : null);
      const prefetched = takePrefetchedColoring(id);
      const [nextTemplate, nextProgress, nextZones] = prefetched
        ? await prefetched
        : await Promise.all([api(`/colorings/${id}`), api(`/colorings/${id}/progress`), catalogApi.zones(id)]);
      setTemplate(nextTemplate);
      setProgress(nextProgress);
      const compatibleResume = isResumeCompatible(persistedResume, {
        artworkId: nextTemplate.id,
        revision: nextProgress.revision,
      })
        ? persistedResume
        : persistedResume?.artworkId === nextTemplate.id ? persistedResume : null;
      const nextResume = mergeResumeSnapshot(compatibleResume, {
        artworkId: nextTemplate.id,
        route: nextProgress.percent >= 100 && usePersistedResume ? 'home' : 'play',
        progressRevision: nextProgress.revision,
        pendingSave: Boolean(compatibleResume?.pendingSave),
        // A Smart target from a different server revision is not trusted. The
        // renderer will request a fresh target while retaining camera/color.
        smartTarget: isResumeCompatible(persistedResume, {
          artworkId: nextTemplate.id,
          revision: nextProgress.revision,
        }) ? persistedResume?.smartTarget : null,
        smartTargetRevision: isResumeCompatible(persistedResume, {
          artworkId: nextTemplate.id,
          revision: nextProgress.revision,
        }) ? persistedResume?.smartTargetRevision : null,
      });
      resumeSnapshotRef.current = nextResume;
      setResumeSnapshot(nextResume);
      beginAnalyticsSession();
      specialGroupRef.current = nextProgress.specials_experiment_group || null;
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
      setSaveState(nextResume?.pendingSave || tiledQueueRef.current.length ? 'pending' : 'saved');
      tiledRevisionRef.current = Number(nextProgress.revision || 0);
      legacyRevisionRef.current = Number(nextProgress.revision || 0);
      legacyAuthoritativeFilledRef.current = [...(nextProgress.filled || [])];
      legacyAuthoritativeProgressRef.current = nextProgress;
      tiledSpecialOfferRef.current = offerFromProgress(nextProgress);
      setTiledSpecialOffer(tiledSpecialOfferRef.current);
      setTiledSpecialApplied(null);
      setTiledSpecialDiscovered(null);
      setTiledReconciledChanges([]);
      specialClaimedAtRef.current = null;
      specialContinuationPendingRef.current = false;
      if (!isLargeGridTemplate(nextTemplate)) {
        saveQueueRef.current = createLegacySaveQueue(nextTemplate);
        saveQueueRef.current.reset(nextProgress.revision);
        saveQueueRef.current.recover({ templateId: nextTemplate.id, serverRevision: nextProgress.revision }).catch(() => {});
      }
      setPlayMode('classic');
      setFillMode(false);
      setHistory([]);
      setFuture([]);
      comboRef.current = 0;
      setCombo(0);
      milestoneRef.current = new Set([25, 50, 75, 100].filter((value) => nextProgress.percent >= value));
      zoneMilestoneRef.current = new Set((nextZones.zones || []).filter((z) => z.percent >= 100).map((z) => z.id));
      paintedRef.current = false;
      const coreFeelActive = isCoreFeelReference(coreFeelExperiment, nextTemplate);
      const firstCoreFeelFragment = coreFeelActive
        ? getNextCoreFeelFragment(nextTemplate, nextProgress.filled || [])
        : null;
      const savedColor = nextResume?.selectedColor;
      const hasSavedColor = Number.isInteger(savedColor)
        && savedColor >= 0
        && savedColor < (Array.isArray(nextTemplate.palette) ? nextTemplate.palette.length : 0);
      setSelectedColor(hasSavedColor
        ? savedColor
        : isLargeGridTemplate(nextTemplate)
          ? 0
          : firstCoreFeelFragment?.color ?? findRewardingColor(nextTemplate, nextProgress.filled) ?? 0);
      coreFeelResumeRef.current = coreFeelActive
        && (nextProgress.filled || []).some((value) => value !== -1);
      sessionStartRef.current = Date.now();
      onNavigate(nextProgress.percent >= 100 && usePersistedResume ? 'home' : 'play');
      if (nextTemplate.unlock_granted || nextTemplate.unlock_state === 'owned') {
        unlockRefreshedRef.current.add(nextTemplate.id);
        onUnlockRefresh();
      }
      if (!coreFeelActive) metaApi.track('open_level', { id });
      if (coreFeelActive) {
        metaApi.track('core_feel_experiment_open', {
          id,
          variant: coreFeelExperiment.variantId,
          resumed: coreFeelResumeRef.current,
          first_fragment: firstCoreFeelFragment?.id || null,
        }).catch(() => {});
      }
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

  function handleTiledStrokeCommitted(changes, operation, specialAction = null) {
    if (!isLargeGridTemplate(template) || !Array.isArray(changes) || !changes.length) return;
    if (tiledSpecialOfferRef.current) {
      showNotice('Сначала завершите особое событие', 'info');
      return;
    }
    const entry = {
      clientBatchId: `tiled-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      changes: changes.map((change) => ({ index: change.index, color: change.to })),
      specialAction,
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
    if (!specialAction) setTiledSpecialDiscovered(null);
    if (!specialAction && specialContinuationPendingRef.current) {
      specialContinuationPendingRef.current = false;
      metaApi.track('session_continued_after_special', {
        template_id: template.id,
        session_id: sessionIdRef.current,
        experiment_group: specialGroupRef.current || 'treatment',
      }).catch(() => {});
    }
    setSaveState(isOnline ? 'syncing' : 'offline');
    flushTiledQueue().then(() => setSaveState('saved')).catch(() => setSaveState('pending'));
  }

  async function queueTiledSpecialAction(specialAction) {
    if (!template || !specialAction) return false;
    const activeOffer = tiledSpecialOfferRef.current;
    if (activeOffer && String(activeOffer.special_id) !== String(specialAction.special_id)) {
      showNotice('Сначала завершите текущее особое событие', 'info');
      return false;
    }
    // Special actions stay on the shared server-authoritative contract.
    // Unsupported kinds remain visible with disabled buttons and stray calls
    // are rejected instead of faking an effect.
    const supportedSpecialActions = new Set([
      'use_spark',
      'skip_spark',
      'use_bomb',
      'disarm_fuse',
      'skip_fuse',
      'use_choice',
      'disarm_hazard',
      'skip_hazard',
    ]);
    if (!supportedSpecialActions.has(specialAction.type)) {
      showNotice('Этот эффект ещё недоступен', 'info');
      return false;
    }
    if (!isLargeGridTemplate(template)) {
      setSaveState(isOnline ? 'syncing' : 'offline');
      try {
        if (!isOnline) throw new Error('Special action requires connection');
        await saveQueueRef.current?.flush();
        const saved = await api(`/colorings/${template.id}/progress/actions`, {
          method: 'POST',
          body: {
            changes: [],
            special_action: Object.fromEntries(Object.entries(specialAction).filter(([key]) => key !== 'experiment_group')),
            revision: legacyRevisionRef.current,
            clientBatchId: `legacy-special-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          },
        });
        legacyRevisionRef.current = Number(saved.revision || legacyRevisionRef.current);
        legacyAuthoritativeFilledRef.current = [...(saved.filled || legacyAuthoritativeFilledRef.current)];
        legacyAuthoritativeProgressRef.current = saved;
        saveQueueRef.current?.reset(saved.revision);
        filledRef.current = saved.filled || filledRef.current;
        setProgress(saved);
        const nextOffer = offerFromProgress(saved);
        tiledSpecialOfferRef.current = nextOffer;
        setTiledSpecialOffer(nextOffer);
        if (saved.special_discovered) setTiledSpecialDiscovered(saved.special_discovered);
        else setTiledSpecialDiscovered(null);
        if (Array.isArray(saved.special_applied_changes) && saved.special_applied_changes.length) {
          setTiledSpecialApplied({ revision: saved.revision, changes: saved.special_applied_changes });
        }
        trackCanonicalSpecialEvents({
          saved,
          specialAction,
          templateId: template.id,
          replay: isIdempotentReplay(saved),
        });
        onRewards(saved, template.id);
        if (saved.percent === 100) setServerCompletedTemplateId(template.id);
        setSaveState('saved');
        return true;
      } catch (error) {
        recordSpecialCellsError(error);
        if (isTerminalSpecialError(error)) {
          tiledSpecialOfferRef.current = null;
          setTiledSpecialOffer(null);
          setTiledSpecialDiscovered(null);
          setSaveState(isOnline ? 'saved' : 'offline');
          showNotice(error.message || 'Spark больше недоступен', 'info');
          return true;
        } else {
          setSaveState(isOnline ? 'pending' : 'offline');
          showNotice(error.message || 'Не удалось применить Spark', 'error');
          return false;
        }
      }
    }
    tiledQueueRef.current.push({
      clientBatchId: `tiled-special-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      changes: [],
      specialAction,
    });
    writeTiledJournal(template.id);
    if (specialAction.type === 'use_spark'
      || specialAction.type === 'use_bomb'
      || specialAction.type === 'skip_spark'
      || specialAction.type === 'disarm_fuse'
      || specialAction.type === 'skip_fuse'
      || specialAction.type === 'use_choice'
      || specialAction.type === 'disarm_hazard'
      || specialAction.type === 'skip_hazard') {
      metaApi.track('special_target_selected', {
        template_id: template.id,
        special_id: specialAction.special_id,
        kind: String(specialAction.type).replace(/^(use_|skip_|disarm_)/, ''),
        option_id: specialAction.option_id || null,
        skipped: specialAction.type === 'skip_spark' || specialAction.type === 'skip_hazard',
        center_x: specialAction.center_x == null ? null : specialAction.center_x,
        center_y: specialAction.center_y == null ? null : specialAction.center_y,
      }).catch(() => {});
    }
    setSaveState(isOnline ? 'syncing' : 'offline');
    flushTiledQueue().then(() => setSaveState('saved')).catch(() => setSaveState('pending'));
    return true;
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

  function applyFilled(nextFilled, change, specialAction = null) {
    filledRef.current = nextFilled;
    setProgress((current) => ({ ...current, filled: nextFilled, ...getProgress(template.cells, nextFilled) }));
    if (change) {
      setHistory((current) => [...current.slice(-99), change]);
      setFuture([]);
    }
    if (saveQueueRef.current) {
      saveQueueRef.current.queueSave(nextFilled, {
        baseFilled: legacyAuthoritativeFilledRef.current,
        specialAction,
      });
      if (specialAction) saveQueueRef.current.flush().catch(() => setSaveState(isOnline ? 'pending' : 'offline'));
    }
  }

  function handleFirstPaint() {
    if (paintedRef.current) return;
    paintedRef.current = true;
    const timeToAction = Date.now() - sessionStartRef.current;
    const coreFeelActive = isCoreFeelReference(coreFeelExperiment, template);
    if (!coreFeelActive) {
      metaApi.track('first_pixel', { id: template?.id, time_to_first_action_ms: timeToAction }).catch(() => {});
    } else {
      metaApi.track(coreFeelResumeRef.current ? 'core_feel_resume_action' : 'core_feel_first_handmade_action', {
        id: template.id,
        variant: coreFeelExperiment.variantId,
        time_to_action_ms: timeToAction,
        source: 'manual',
      }).catch(() => {});
    }
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
    // The Phase 0/1 slice has one reward hierarchy: authored fragment reveal.
    // Keep server zone state intact, but do not compete with it in the test.
    if (isCoreFeelReference(coreFeelExperiment, template)) return false;
    setZoneReward(`Фрагмент «${completedZone.title}» раскрыт`);
    window.setTimeout(() => setZoneReward(null), 2200);
    window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred?.('success');
    metaApi.track('zone_complete', { id: template.id, zone: completedZone.id }).catch(() => {});
    return true;
  }

  function handleStrokeCommitted(nextFilled, operation, specialAction = null) {
    handleFirstPaint();
    const now = Date.now();
    const strokeCount = operation?.changes?.length || 1;
    const nextCombo = now - lastPaintRef.current < 2200 ? comboRef.current + strokeCount : 1;
    lastPaintRef.current = now;
    comboRef.current = nextCombo;
    setCombo(nextCombo);
    applyFilled(nextFilled, operation, specialAction);
    const nextProgress = getProgress(template.cells, nextFilled);
    if (!isCoreFeelReference(coreFeelExperiment, template)) {
      [25, 50, 75, 100].forEach((value) => {
        if (nextProgress.percent >= value && !milestoneRef.current.has(value)) {
          milestoneRef.current.add(value);
          metaApi.track(`reach_${value}`, { id: template.id }).catch(() => {});
        }
      });
    }
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
    if (isCoreFeelReference(coreFeelExperiment, template)) return;
    if (view === 'play' && template && onboarding === null && localStorage.getItem('splint_onboarding_version') !== '2') {
      setOnboarding(0);
    }
  }, [view, template, onboarding, coreFeelExperiment]);

  useEffect(() => {
    if (view === 'play' && isLargeGridTemplate(template) && isOnline && tiledQueueRef.current.length) {
      flushTiledQueue().catch(() => setSaveState('pending'));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, template?.id, template?.storage_mode, template?.width, template?.height, isOnline]);

  // Keep navigation and lightweight player preferences resumable. Progress
  // itself remains server-authoritative; this snapshot is only a hint for the
  // next boot and is validated against the freshly fetched revision.
  useEffect(() => {
    if (!template?.id || !progress) return;
    persistResumeState({
      route: view,
      progressRevision: progress.revision,
      selectedColor,
      pendingSave: saveState !== 'saved'
        || (isLargeGridTemplate(template) && tiledQueueRef.current.length > 0),
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [progress?.revision, saveState, selectedColor, template?.id, view]);

  // Ordinary SPA unmount/navigation disposes the legacy queue after flushing.
  // Pagehide itself must not dispose: mobile bfcache freezes the page and
  // then resumes it without re-running this cleanup.
  useEffect(() => {
    return () => {
      if (saveQueueRef.current) {
        saveQueueRef.current.flushAndDispose();
        saveQueueRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    const persistBeforeHide = () => {
      persistResumeState({
        route: view,
        pendingSave: saveState !== 'saved'
          || (isLargeGridTemplate(template) && tiledQueueRef.current.length > 0),
      });
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') persistBeforeHide();
    };
    const handlePageHide = () => {
      persistBeforeHide();
      const queue = saveQueueRef.current;
      if (queue && !queue.isDisposed()) {
        queue.suspend().catch(() => setSaveState('pending'));
      }
      if (isLargeGridTemplate(template) && isOnline) {
        flushTiledQueue().catch(() => setSaveState('pending'));
      }
    };
    const handlePageShow = (event) => {
      if (!event.persisted) return;
      if (isLargeGridTemplate(template)) {
        if (isOnline) flushTiledQueue().catch(() => setSaveState('pending'));
        return;
      }
      const queue = saveQueueRef.current;
      if (!queue || queue.isDisposed()) {
        if (!template?.id) return;
        saveQueueRef.current = createLegacySaveQueue(template);
        saveQueueRef.current.reset(progress?.revision || 0);
      }
      saveQueueRef.current.resume({ serverRevision: progress?.revision })
        .catch(() => setSaveState('pending'));
    };
    window.addEventListener('pagehide', handlePageHide);
    window.addEventListener('pageshow', handlePageShow);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      window.removeEventListener('pagehide', handlePageHide);
      window.removeEventListener('pageshow', handlePageShow);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOnline, progress?.revision, template?.id, view]);

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
    resumeSnapshot,
    persistResumeState,
    retryPendingSave,
    handleTiledStrokeCommitted,
    queueTiledSpecialAction,
    tiledSpecialOffer,
    tiledSpecialApplied,
    tiledSpecialDiscovered,
    tiledReconciledChanges,
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
