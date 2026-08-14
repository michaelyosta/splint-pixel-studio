import { useId, useState, useCallback, useRef, useMemo, useEffect, useEffectEvent, useLayoutEffect } from 'react';
import ColoringCanvas from './ColoringCanvas.jsx';
import ColoringPalette from './ColoringPalette.jsx';
import ColoringHud from './ColoringHud.jsx';
import DevDiagnostics from './DevDiagnostics.jsx';
import { useSmartCamera, AUTO_STATE } from './camera/useSmartCamera.js';
import { findClusters, mergeClusters, findUnfilledClusters } from './engine/clusterGraph.js';
import { createWorkingWindows, scoreTargetQuality } from './engine/workingWindows.js';
import { applyStroke, createStrokeOperation } from './engine/paintReducer.js';
import { arraysEqual } from './engine/coloringUtils.js';
import { findRewardingColor } from '../../lib/pixelColoring.js';
import {
  computeVisibleUnfilledCount, createActiveTarget, ensureActionableViewport,
  isTargetConsideredDone, normalizeSafeArea, resolveColorTransition, resolveNextOutcome,
} from './engine/routeTargeting.js';
import { createBoundedAnnouncer } from '../../lib/accessibility.js';
import {
  getCoreFeelFragmentForColor,
  getNextCoreFeelFragment,
  isCoreFeelReference,
} from '../coreFeel/coreFeelExperiment.js';
import { playCoreFeelFeedback } from '../coreFeel/coreFeelFeedback.js';
import './coloring.css';

const LARGE_ROUTE_DIMENSION = 160;
const ROUTE_TILE_SIZE = 32;

function createRouteState() {
  return {
    status: 'idle',
    generation: 0,
    targetId: null,
    target: null,
    reason: null,
    visibleRemaining: 0,
    targetRemaining: 0,
  };
}

function safeAreasEqual(first, second) {
  return first.top === second.top
    && first.right === second.right
    && first.bottom === second.bottom
    && first.left === second.left;
}

function candidateForCells(cells, templateWidth, zoom = 1) {
  const minX = Math.min(...cells.map((index) => index % templateWidth));
  const maxX = Math.max(...cells.map((index) => index % templateWidth));
  const minY = Math.min(...cells.map((index) => Math.floor(index / templateWidth)));
  const maxY = Math.max(...cells.map((index) => Math.floor(index / templateWidth)));
  return {
    cells,
    centerX: (minX + maxX + 1) / 2,
    centerY: (minY + maxY + 1) / 2,
    zoom,
    cellCount: cells.length,
    bounds: { minX, maxX, minY, maxY, width: maxX - minX + 1, height: maxY - minY + 1 },
  };
}

export default function ColoringSession({
  template,
  progress,
  selectedColor,
  onSelectColor,
  onSaveProgress,
  onFirstPaint,
  onWrongCell,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  calmMode,
  hideNumbers,
  hintMode,
  interactionMode,
  fillMode,
  combo,
  onFillAt,
  onOpenMenu,
  onTrack,
  specialCells = [],
  specialCohort = 'control',
  specialOffer = null,
  specialDiscovered = null,
  onSpecialAction,
  onVisibleSpecialKinds,
  coreFeelExperiment = null,
  onCoreFeelStop,
}) {
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  const containerRef = useRef(null);
  const filledRef = useRef(progress?.filled || []);
  const [localFilled, setLocalFilled] = useState(progress?.filled || []);
  const [peekColor, setPeekColor] = useState(null);
  const [coreFeelBeat, setCoreFeelBeat] = useState(null);
  const [coreFeelHintVisible, setCoreFeelHintVisible] = useState(true);
  const firstCoreFeelStrokeAtRef = useRef(null);
  const activeCoreFeelFragmentRef = useRef(null);
  const windowsRef = useRef([]);
  const visitedTargetsRef = useRef(new Set());
  const routeStateRef = useRef(createRouteState());
  const [routeDisplay, setRouteDisplay] = useState(createRouteState());
  const lastColorRef = useRef(selectedColor);
  const transitionTokenRef = useRef(0);
  const focusWatchdogRef = useRef(null);
  const largeRouteIndexRef = useRef(null);
  const liveStatusId = useId();
  const [liveStatus, setLiveStatus] = useState('');
  const liveStatusRef = useRef(null);
  if (liveStatusRef.current === null) {
    liveStatusRef.current = createBoundedAnnouncer({ onAnnounce: setLiveStatus });
  }
  const announcedTargetKeyRef = useRef('');
  const claimedSpecialsRef = useRef(new Set());
  const specialTreatment = specialCohort === 'treatment';
  const coreFeelActive = isCoreFeelReference(coreFeelExperiment, template);
  const enhancedCoreFeel = coreFeelActive && coreFeelExperiment.variant?.enhanced;
  const artifactProgress = progress?.artifact_progress || null;
  const activeSpecial = specialOffer
    ? specialCells.find((special) => special.id === specialOffer.special_id)
    : null;

  const safeArea = useRef({ top: 0, right: 0, bottom: 0, left: 0 });
  const [safeAreaState, setSafeAreaState] = useState(safeArea.current);
  const viewportGeometry = useMemo(() => ({
    width: containerSize.width,
    height: containerSize.height,
    safeArea: safeAreaState,
  }), [containerSize.width, containerSize.height, safeAreaState]);

  const {
    camera, cameraReady, markCameraReady, setCamera, autoState,
    pauseAuto, resumeAuto, focusOverview, prepareFocusOnWindow, commitFocusOnWindow,
    cancelAnimation, beginInteraction, endInteraction, setSafeArea,
    lastCenterRef, prevCenterRef,
  } = useSmartCamera(template, containerSize.width, containerSize.height);

  const hudSizeRef = useRef({ width: 0, height: 0 });

  const handleHudResize = useCallback((w, h, left, _top) => {
    hudSizeRef.current = { width: w, height: h };
    if (containerRef.current) {
      const containerRect = containerRef.current.getBoundingClientRect();
      const hudLeftRel = left - containerRect.left;
      const rightInset = Math.max(0, containerRect.width - hudLeftRel + 8);
      const raw = { top: 0, right: rightInset, bottom: 0, left: 0 };
      const normalized = normalizeSafeArea(raw, containerSize.width || 400, containerSize.height || 400);
      if (!safeAreasEqual(safeArea.current, normalized)) {
        safeArea.current = normalized;
        setSafeArea(normalized);
        setSafeAreaState(normalized);
      }
    }
  }, [containerSize.width, containerSize.height, setSafeArea]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0) {
          setContainerSize((current) => (
            current.width === width && current.height === height ? current : { width, height }
          ));
        }
      }
    });
    observer.observe(el);
    const rect = el.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      setContainerSize({ width: rect.width, height: rect.height });
    }
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    claimedSpecialsRef.current = new Set();
    setCoreFeelBeat(null);
    setCoreFeelHintVisible(true);
    firstCoreFeelStrokeAtRef.current = null;
    activeCoreFeelFragmentRef.current = null;
  }, [template?.id]);

  const windowsGenerationRef = useRef(0);
  const [windowsGeneration, setWindowsGeneration] = useState(0);

  const routingColor = interactionMode === 'reveal' ? null : selectedColor;

  const computeWorkingWindows = useCallback((filled, color) => {
    if (!template || !filled?.length) return [];
    if (enhancedCoreFeel && color != null) {
      const authored = getCoreFeelFragmentForColor(template, filled, color);
      if (authored?.cells.length) {
        activeCoreFeelFragmentRef.current = authored;
        return [candidateForCells(authored.cells, template.width, 1)];
      }
    }
    // Large maps must not enter the whole-image BFS route. Route by bounded
    // 32×32 windows and let the renderer load only the actionable region.
    if (template.width > LARGE_ROUTE_DIMENSION || template.height > LARGE_ROUTE_DIMENSION) {
      const key = `${template.id}:${template.width}:${template.height}:${template.cells.length}`;
      let index = largeRouteIndexRef.current;
      if (index?.key !== key || index.cellsRef !== template.cells) {
        const allByTile = new Map();
        for (let cellIndex = 0; cellIndex < template.cells.length; cellIndex += 1) {
          const x = cellIndex % template.width;
          const y = Math.floor(cellIndex / template.width);
          const tileX = Math.floor(x / ROUTE_TILE_SIZE);
          const tileY = Math.floor(y / ROUTE_TILE_SIZE);
          const tileKey = `${tileX}:${tileY}`;
          let bucket = allByTile.get(tileKey);
          if (!bucket) {
            bucket = { tileX, tileY, cells: [] };
            allByTile.set(tileKey, bucket);
          }
          bucket.cells.push(cellIndex);
        }
        index = { key, cellsRef: template.cells, all: [...allByTile.values()] };
        largeRouteIndexRef.current = index;
      }
      return index.all.map((source) => {
        const cells = source.cells.filter((cellIndex) => (
          filled[cellIndex] === -1 && (color == null || template.cells[cellIndex] === color)
        ));
        if (!cells.length) return null;
        const minX = source.tileX * ROUTE_TILE_SIZE;
        const minY = source.tileY * ROUTE_TILE_SIZE;
        const maxX = Math.min(template.width - 1, minX + ROUTE_TILE_SIZE - 1);
        const maxY = Math.min(template.height - 1, minY + ROUTE_TILE_SIZE - 1);
        return {
          cells,
          centerX: (minX + maxX + 1) / 2,
          centerY: (minY + maxY + 1) / 2,
          zoom: 1,
          cellCount: cells.length,
          bounds: { minX, maxX, minY, maxY, width: maxX - minX + 1, height: maxY - minY + 1 },
        };
      }).filter(Boolean);
    }
    const clusters = color != null
      ? findClusters(template, filled, color)
      : findUnfilledClusters(template, filled);
    const merged = mergeClusters(clusters, template.width);
    if (!merged.length) return [];
    const allWindows = [];
    const sa = safeAreaState;
    const usableW = containerSize.width || 400;
    const usableH = containerSize.height || 400;
    for (const cluster of merged) {
      const wins = createWorkingWindows(cluster, template, usableW, usableH, sa);
      allWindows.push(...wins);
    }
    return allWindows;
  }, [template, containerSize.width, containerSize.height, safeAreaState, enhancedCoreFeel]);

  const workingWindows = useMemo(
    () => {
      void windowsGeneration;
      return computeWorkingWindows(filledRef.current, routingColor);
    },
    [computeWorkingWindows, routingColor, windowsGeneration],
  );

  useEffect(() => {
    windowsRef.current = workingWindows;
  }, [workingWindows]);

  useEffect(() => {
    if (selectedColor !== lastColorRef.current) {
      lastColorRef.current = selectedColor;
      if (interactionMode !== 'reveal') {
        if (routeStateRef.current.status !== 'focusingTarget') cancelAnimation();
        windowsGenerationRef.current += 1;
        setWindowsGeneration(windowsGenerationRef.current);
      }
    }
  }, [selectedColor, interactionMode, cancelAnimation]);

  useEffect(() => {
    const newFilled = progress?.filled;
    if (!newFilled) return;
    if (arraysEqual(newFilled, filledRef.current)) {
      return;
    }
    if (routeStateRef.current.status !== 'focusingTarget') cancelAnimation();
    filledRef.current = newFilled;
    setLocalFilled(newFilled);
    windowsGenerationRef.current += 1;
    setWindowsGeneration(windowsGenerationRef.current);
  }, [progress?.filled, cancelAnimation]);

  function hasUnfilledCells() {
    if (!template) return false;
    return filledRef.current.some((color) => color === -1);
  }

  function syncRouteDisplay() {
    setRouteDisplay({ ...routeStateRef.current });
  }

  function clearFocusWatchdog() {
    if (focusWatchdogRef.current != null) {
      clearTimeout(focusWatchdogRef.current);
      focusWatchdogRef.current = null;
    }
  }

  function armFocusWatchdog(token, reason) {
    clearFocusWatchdog();
    focusWatchdogRef.current = setTimeout(() => {
      if (transitionTokenRef.current !== token || routeStateRef.current.status !== 'focusingTarget') return;
      transitionTokenRef.current += 1;
      routeStateRef.current = {
        ...routeStateRef.current,
        status: 'freeExploration',
        reason: `${reason}:focus_timeout`,
      };
      syncRouteDisplay();
      focusOverview();
    }, 1500);
  }

  function prepareTarget(candidate, options = {}) {
    const {
      immediate = false,
      targetColor = routingColor != null ? routingColor : template?.cells[candidate?.cells?.[0]],
    } = options;

    if (!candidate || !template) return { ok: false, reason: 'invalid_candidate' };
    const filled = filledRef.current;
    let focusCandidate = candidate;
    let activation = createActiveTarget(template, focusCandidate, targetColor, filled, {
      width: containerSize.width,
      height: containerSize.height,
      safeArea: safeArea.current,
    });
    if (!activation.ok) return { ok: false, reason: activation.reason };
    let cameraTransition = prepareFocusOnWindow(focusCandidate, immediate);
    if (!cameraTransition) return { ok: false, reason: 'invalid_camera_plan' };
    let readiness = ensureActionableViewport({
      activeTarget: activation.target,
      progress: filled,
      camera: cameraTransition.camera,
      viewport: containerSize,
      safeArea: safeArea.current,
      template,
    });

    if (!readiness.actionable && readiness.reason === 'partial_target_visibility') {
      const smaller = activation.target.workCells
        .map((cell) => candidateForCells([cell], template.width, focusCandidate.zoom))
        .find((single) => {
          const singleActivation = createActiveTarget(template, single, targetColor, filled, {
            width: containerSize.width,
            height: containerSize.height,
            safeArea: safeArea.current,
          });
          const singleTransition = prepareFocusOnWindow(single, immediate);
          if (!singleActivation.ok || !singleTransition) return false;
          const singleReadiness = ensureActionableViewport({
            activeTarget: singleActivation.target,
            progress: filled,
            camera: singleTransition.camera,
            viewport: containerSize,
            safeArea: safeArea.current,
            template,
          });
          if (!singleReadiness.actionable) return false;
          activation = singleActivation;
          cameraTransition = singleTransition;
          readiness = singleReadiness;
          return true;
        });
      if (!smaller) return { ok: false, reason: readiness.reason };
      focusCandidate = smaller;
    } else if (!readiness.actionable) {
      return { ok: false, reason: readiness.reason };
    }

    return {
      ok: true,
      candidate: focusCandidate,
      activeTarget: activation.target,
      cameraTransition,
      readiness,
    };
  }

  function commitTarget(prepared, options = {}) {
    const {
      force = false,
      reason = 'unknown',
      markVisited = true,
    } = options;
    if (!prepared?.ok) return prepared || { ok: false, reason: 'target_not_prepared' };

    const previous = {
      route: routeStateRef.current,
      visited: new Set(visitedTargetsRef.current),
      lastCenter: lastCenterRef.current ? { ...lastCenterRef.current } : null,
      prevCenter: prevCenterRef.current ? { ...prevCenterRef.current } : null,
    };
    const { activeTarget, candidate, cameraTransition, readiness } = prepared;
    const targetId = activeTarget.id;
    const prevTargetId = previous.route.targetId;
    const token = ++transitionTokenRef.current;

    prevCenterRef.current = previous.lastCenter;
    lastCenterRef.current = { x: candidate.centerX, y: candidate.centerY };
    if (markVisited) visitedTargetsRef.current.add(targetId);
    if (prevTargetId && prevTargetId !== targetId) visitedTargetsRef.current.add(prevTargetId);

    routeStateRef.current = {
      status: 'focusingTarget',
      generation: previous.route.generation + 1,
      targetId,
      target: activeTarget,
      reason,
      visibleRemaining: readiness.visibleUnfilledCells,
      targetRemaining: activeTarget.workCells.length,
      allTargetCellsVisible: true,
    };
    syncRouteDisplay();
    armFocusWatchdog(token, reason);

    const committed = commitFocusOnWindow(cameraTransition, force, (actualCamera) => {
      if (transitionTokenRef.current !== token) return;
      clearFocusWatchdog();
      const actualReadiness = ensureActionableViewport({
        activeTarget,
        progress: filledRef.current,
        camera: actualCamera,
        viewport: containerSize,
        safeArea: safeArea.current,
        template,
      });
      routeStateRef.current = actualReadiness.actionable
        ? {
            ...routeStateRef.current,
            status: 'ready',
            visibleRemaining: actualReadiness.visibleUnfilledCells,
            allTargetCellsVisible: true,
          }
        : {
            ...routeStateRef.current,
            status: 'error',
            reason: `${reason}:${actualReadiness.reason}`,
          };
      syncRouteDisplay();
      if (actualReadiness.actionable && onTrack && !coreFeelActive) onTrack('camera_activate_target', {
        templateId: template?.id,
        targetId,
        reason,
        targetCells: activeTarget.workCells.length,
        unfilledCount: activeTarget.workCells.length,
        visibleRemaining: actualReadiness.visibleUnfilledCells,
      });
    });

    if (!committed) {
      clearFocusWatchdog();
      transitionTokenRef.current += 1;
      routeStateRef.current = previous.route;
      visitedTargetsRef.current = previous.visited;
      lastCenterRef.current = previous.lastCenter;
      prevCenterRef.current = previous.prevCenter;
      syncRouteDisplay();
      return { ok: false, reason: 'camera_commit_rejected' };
    }
    return { ok: true, target: activeTarget, camera: cameraTransition.camera };
  }

  function activateTarget(candidate, options = {}) {
    const prepared = prepareTarget(candidate, options);
    if (!prepared.ok) return prepared;
    return commitTarget(prepared, options);
  }

  function refocusExistingTarget(current, reason) {
    const target = current?.target;
    if (!target?.workCells?.length) return { ok: false, reason: 'no_active_target' };
    const candidate = candidateForCells(target.workCells, template.width);
    const cameraTransition = prepareFocusOnWindow(candidate, false);
    if (!cameraTransition) return { ok: false, reason: 'invalid_camera_plan' };
    const plannedReadiness = ensureActionableViewport({
      activeTarget: target,
      progress: filledRef.current,
      camera: cameraTransition.camera,
      viewport: containerSize,
      safeArea: safeArea.current,
      template,
    });
    if (!plannedReadiness.actionable) return { ok: false, reason: plannedReadiness.reason };

    const token = ++transitionTokenRef.current;
    cancelAnimation();
    routeStateRef.current = {
      ...current,
      status: 'focusingTarget',
      generation: current.generation + 1,
      reason,
      visibleRemaining: plannedReadiness.visibleUnfilledCells,
      targetRemaining: target.workCells.reduce(
        (count, index) => count + (filledRef.current[index] === -1 ? 1 : 0),
        0,
      ),
      allTargetCellsVisible: true,
    };
    syncRouteDisplay();
    armFocusWatchdog(token, reason);

    const committed = commitFocusOnWindow(cameraTransition, true, (actualCamera) => {
      if (transitionTokenRef.current !== token) return;
      clearFocusWatchdog();
      const actualReadiness = ensureActionableViewport({
        activeTarget: target,
        progress: filledRef.current,
        camera: actualCamera,
        viewport: {
          width: containerRef.current?.clientWidth || containerSize.width,
          height: containerRef.current?.clientHeight || containerSize.height,
        },
        safeArea: safeArea.current,
        template,
      });
      routeStateRef.current = actualReadiness.actionable
        ? {
            ...routeStateRef.current,
            status: 'ready',
            visibleRemaining: actualReadiness.visibleUnfilledCells,
            allTargetCellsVisible: true,
          }
        : {
            ...routeStateRef.current,
            status: 'error',
            reason: `${reason}:${actualReadiness.reason}`,
          };
      syncRouteDisplay();
    });
    if (!committed) {
      clearFocusWatchdog();
      transitionTokenRef.current += 1;
      routeStateRef.current = current;
      syncRouteDisplay();
      return { ok: false, reason: 'camera_commit_rejected' };
    }
    return { ok: true, target, camera: cameraTransition.camera };
  }

  function findBestInitialTarget(wins) {
    if (!wins.length || !template) return null;
    const filled = filledRef.current;
    let best = null;
    let bestScore = -Infinity;
    const viewCenterX = (template.width - 1) / 2;
    const viewCenterY = (template.height - 1) / 2;
    for (const win of wins) {
      const unfilled = win.cells.reduce((c, idx) => c + (filled[idx] === -1 ? 1 : 0), 0);
      if (unfilled === 0) continue;
      let score = template.width > LARGE_ROUTE_DIMENSION || template.height > LARGE_ROUTE_DIMENSION
        ? unfilled * 10
        : scoreTargetQuality(win, template, filled);
      const dx = win.centerX - viewCenterX;
      const dy = win.centerY - viewCenterY;
      score -= Math.sqrt(dx * dx + dy * dy) * 0.05;
      if (score > bestScore) {
        bestScore = score;
        best = win;
      }
    }
    return best;
  }

  function buildNextOutcome(currentTargetId = routeStateRef.current.targetId) {
    const filled = filledRef.current;
    const candidates = computeWorkingWindows(filled, routingColor);
    const nextColor = routingColor != null
      ? findRewardingColor(template, filled, routingColor)
      : null;
    const nextColorCandidates = nextColor != null && nextColor !== routingColor
      ? computeWorkingWindows(filled, nextColor)
      : [];
    return resolveNextOutcome({
      template,
      filled,
      routingColor,
      candidates,
      currentTargetId,
      visitedTargetIds: visitedTargetsRef.current,
      currentCenter: lastCenterRef.current,
      nextColor,
      nextColorCandidates,
    });
  }

  function applyNextOutcome(outcome, reason, force = false) {
    if (outcome.type === 'target_changed') {
      if (outcome.resetVisited) visitedTargetsRef.current = new Set();
      return activateTarget(outcome.target, { immediate: false, force, reason, markVisited: true });
    }
    if (outcome.type === 'color_changed') {
      const prepared = prepareTarget(outcome.target, {
        immediate: false,
        targetColor: outcome.color,
      });
      if (!prepared.ok) return prepared;
      const committed = commitTarget(prepared, {
        force,
        reason: `${reason}:color_changed`,
        markVisited: true,
      });
      if (!committed.ok) return committed;
      visitedTargetsRef.current = new Set([committed.target.id]);
      lastColorRef.current = outcome.color;
      onSelectColor(outcome.color);
      return committed;
    }
    if (outcome.type === 'last_cell') {
      const targetColor = routingColor != null
        ? routingColor
        : template.cells[outcome.target.cells[0]];
      return activateTarget(outcome.target, {
        immediate: false,
        force,
        reason: `${reason}:last_cell`,
        markVisited: true,
        targetColor,
      });
    }
    if (outcome.type === 'artwork_complete') {
      routeStateRef.current = { ...routeStateRef.current, status: 'artworkComplete', reason: `${reason}:complete` };
      syncRouteDisplay();
      liveStatusRef.current?.announce('Картина готова');
      return { ok: true, complete: true };
    }
    routeStateRef.current = { ...routeStateRef.current, status: 'error', reason: `${reason}:${outcome.reason}` };
    syncRouteDisplay();
    return { ok: false, reason: outcome.reason };
  }

  function handleNextCluster() {
    if (enhancedCoreFeel && coreFeelBeat?.status === 'revealed') {
      const next = getNextCoreFeelFragment(template, filledRef.current, coreFeelBeat.fragment.id);
      if (!next) {
        setCoreFeelBeat({ ...coreFeelBeat, status: 'complete' });
        return;
      }
      onSelectColor(next.color);
      visitedTargetsRef.current = new Set();
      windowsGenerationRef.current += 1;
      setWindowsGeneration(windowsGenerationRef.current);
      const result = activateTarget(candidateForCells(next.cells, template.width, 1), {
        immediate: false,
        force: true,
        reason: 'core-feel:player-next',
        markVisited: true,
        targetColor: next.color,
      });
      if (result.ok) {
        activeCoreFeelFragmentRef.current = next;
        setCoreFeelBeat(null);
        onTrack?.('core_feel_next_beat_selected', {
          id: template.id,
          variant: coreFeelExperiment.variantId,
          fragment: next.id,
        });
      }
      return;
    }
    resumeAuto();
    const result = applyNextOutcome(buildNextOutcome(), 'manual-next', true);
    if (result.ok && onTrack) onTrack('camera_next_cluster', { templateId: template?.id });
  }

  function transitionToColor(requestedColor, reason = 'manual-color') {
    if (requestedColor === routingColor) return { ok: true, unchanged: true };

    const requestedCandidates = computeWorkingWindows(filledRef.current, requestedColor);
    const fallbackColor = findRewardingColor(template, filledRef.current, requestedColor);
    const fallbackCandidates = fallbackColor != null
      ? computeWorkingWindows(filledRef.current, fallbackColor)
      : [];
    const outcome = resolveColorTransition({
      template,
      filled: filledRef.current,
      currentColor: routingColor,
      requestedColor,
      requestedCandidates,
      fallbackColor,
      fallbackCandidates,
      currentCenter: lastCenterRef.current,
    });

    if (outcome.type === 'artwork_complete') {
      routeStateRef.current = {
        ...routeStateRef.current,
        status: 'artworkComplete',
        reason: `${reason}:artwork_complete`,
      };
      syncRouteDisplay();
      return { ok: true, complete: true };
    }
    if (outcome.type === 'color_complete') {
      routeStateRef.current = {
        ...routeStateRef.current,
        reason: `${reason}:color_complete:${requestedColor}`,
      };
      syncRouteDisplay();
      return { ok: false, reason: 'color_complete' };
    }
    if (outcome.type !== 'color_changed') {
      return { ok: false, reason: outcome.reason || outcome.type };
    }

    transitionTokenRef.current += 1;
    cancelAnimation();
    const prepared = prepareTarget(outcome.target, {
      immediate: false,
      targetColor: outcome.color,
    });
    if (!prepared.ok) return prepared;

    const committed = commitTarget(prepared, {
      force: true,
      reason: outcome.requestedColorComplete
        ? `${reason}:requested_color_complete`
        : reason,
      markVisited: true,
    });
    if (!committed.ok) return committed;

    lastColorRef.current = outcome.color;
    resumeAuto();
    onSelectColor(outcome.color);
    if (onTrack) onTrack('coloring_manual_color_change', {
      templateId: template?.id,
      requestedColor,
      color: outcome.color,
      requestedColorComplete: Boolean(outcome.requestedColorComplete),
    });
    return committed;
  }

  function handleColorSelect(colorIndex) {
    const result = transitionToColor(colorIndex);
    if (result?.ok && !result.unchanged) {
      liveStatusRef.current?.announce(`Выбран цвет ${colorIndex + 1}`);
    }
  }

  useEffect(() => {
    return () => {
      if (focusWatchdogRef.current != null) clearTimeout(focusWatchdogRef.current);
      liveStatusRef.current?.destroy();
      transitionTokenRef.current += 1;
    };
  }, []);

  useEffect(() => {
    if (routeDisplay.status !== 'ready' || !routeDisplay.target) return;
    const key = `${routeDisplay.targetId}:${routeDisplay.generation}`;
    if (key === announcedTargetKeyRef.current) return;
    announcedTargetKeyRef.current = key;
    liveStatusRef.current?.announce(
      `Участок: цвет ${routeDisplay.target.color + 1}, осталось ${routeDisplay.targetRemaining} клеток`,
    );
  }, [routeDisplay]);

  const initializeRoute = useEffectEvent(() => {
    if (!containerSize.width || !containerSize.height) return;
    const wins = windowsRef.current;

    if (autoState !== AUTO_STATE.ACTIVE) {
      markCameraReady();
      return;
    }

    if (
      routeStateRef.current.targetId
      && ['ready', 'freeExploration', 'focusingTarget'].includes(routeStateRef.current.status)
    ) return;

    if (!wins.length) {
      markCameraReady();
      if (hasUnfilledCells()) {
        if (interactionMode !== 'reveal') {
          const nextColor = findRewardingColor(template, filledRef.current, selectedColor);
          if (nextColor !== undefined && nextColor !== selectedColor) onSelectColor(nextColor);
          else routeStateRef.current = { ...routeStateRef.current, status: 'freeExploration', reason: 'initial:no_actionable_target' };
          syncRouteDisplay();
        }
      } else {
        routeStateRef.current = { ...routeStateRef.current, status: 'artworkComplete', reason: 'initial:no_remaining_cells' };
        syncRouteDisplay();
      }
      return;
    }

    markCameraReady();
    const sa = normalizeSafeArea(safeArea.current, containerSize.width, containerSize.height);
    safeArea.current = sa;
    setSafeArea(sa);
    visitedTargetsRef.current = new Set();
    const best = findBestInitialTarget(wins);
    if (best) {
      const result = activateTarget(best, { immediate: true, force: false, reason: 'initial', markVisited: true });
      if (!result.ok) {
        routeStateRef.current = { ...routeStateRef.current, status: 'error', reason: `initial:${result.reason}` };
        syncRouteDisplay();
      }
    }
  });

  useLayoutEffect(() => {
    initializeRoute();
  }, [containerSize, workingWindows, autoState]);

  const revalidateViewportGeometry = useEffectEvent(() => {
    if (!containerSize.width || !containerSize.height) return;
    const current = routeStateRef.current;
    if (!current.target) return;

    const readiness = ensureActionableViewport({
      activeTarget: current.target,
      progress: filledRef.current,
      camera,
      viewport: containerSize,
      safeArea: safeArea.current,
      template,
    });

    if (current.status === 'freeExploration') {
      routeStateRef.current = {
        ...current,
        visibleRemaining: readiness.visibleUnfilledCells || 0,
        allTargetCellsVisible: Boolean(readiness.allTargetCellsVisible),
      };
      syncRouteDisplay();
      return;
    }

    if (current.status === 'ready' && readiness.actionable) {
      routeStateRef.current = {
        ...current,
        visibleRemaining: readiness.visibleUnfilledCells,
        allTargetCellsVisible: true,
      };
      syncRouteDisplay();
      return;
    }

    if (['ready', 'focusingTarget'].includes(current.status)) {
      refocusExistingTarget(current, 'geometry_changed');
    }
  });

  useLayoutEffect(() => {
    revalidateViewportGeometry();
  }, [viewportGeometry]);

  function tryAdvanceAUTO() {
    if (autoState !== AUTO_STATE.ACTIVE) return;

    const rs = routeStateRef.current;
    if (!rs.targetId || rs.status !== 'ready') return;

    const targetDone = isTargetConsideredDone(
      rs.target, camera, template, filledRef.current,
      containerSize.width, containerSize.height, safeArea.current,
    );

    if (!targetDone) return;
    if (enhancedCoreFeel) return;
    applyNextOutcome(buildNextOutcome(rs.targetId), 'auto-advance', false);
  }

  const advanceRoute = useEffectEvent(() => {
    tryAdvanceAUTO();
  });

  useEffect(() => {
    if (autoState !== AUTO_STATE.ACTIVE) return;
    const targetId = routeStateRef.current.targetId;
    if (!targetId) return;
    advanceRoute();
  }, [localFilled, autoState, workingWindows]);

  const handleStrokeComplete = useCallback((stroke) => {
    if (!template || !filledRef.current.length) return;
    if (!stroke.indices.length) return;
    let nextFilled;
    let operation;
    if (interactionMode === 'reveal') {
      nextFilled = [...filledRef.current];
      const changes = [];
      for (const idx of stroke.indices) {
        const targetColor = template.cells[idx];
        nextFilled[idx] = targetColor;
        changes.push({ index: idx, from: filledRef.current[idx], to: targetColor });
      }
      operation = { type: 'stroke', color: -1, timestamp: Date.now(), changes };
    } else {
      nextFilled = applyStroke(filledRef.current, stroke);
      operation = createStrokeOperation(stroke, filledRef.current);
    }
    filledRef.current = nextFilled;
    setLocalFilled(nextFilled);
    const special = specialTreatment
      ? specialCells.find((special) => ['spark', 'bomb', 'fuse', 'choice', 'artifact', 'hazard'].includes(special.kind)
        && special.state === 'unseen'
        && !claimedSpecialsRef.current.has(special.id)
        && operation.changes.some((change) => change.index === Number(special.cell_index)
          && change.to === template.cells[change.index]))
      : null;
    const specialAction = special ? {
      type: `claim_${special.kind}`,
      special_id: special.id,
      cell_index: Number(special.cell_index),
      experiment_group: 'treatment',
    } : null;
    if (special) claimedSpecialsRef.current.add(special.id);
    if (onSaveProgress) onSaveProgress(nextFilled, operation, specialAction);
    // The PARB experiment intentionally measures authored outcomes instead of
    // emitting one generic analytics event for every tap/stroke.
    if (onTrack && !coreFeelActive) {
      onTrack('coloring_stroke_commit', { templateId: template.id, color: stroke.color, cells: stroke.indices.length });
    }
    // A single-cell tap already has direct visual feedback. Reserve the calm
    // stroke cue for a continuous gesture so tap-heavy play does not buzz.
    if (enhancedCoreFeel) {
      if (stroke.indices.length >= 2) playCoreFeelFeedback('stroke', coreFeelExperiment);
    } else {
      try {
        window.Telegram?.WebApp?.HapticFeedback?.impactOccurred?.('light');
      } catch {
        // Haptics are optional.
      }
    }
    if (interactionMode !== 'reveal') {
      const remainingForColor = template.cells.reduce((count, target, ci) =>
        count + (target === stroke.color && nextFilled[ci] === -1 ? 1 : 0), 0);
      if (remainingForColor === 0) {
        if (onTrack) onTrack('coloring_color_complete', { templateId: template.id, color: stroke.color });
        try {
          window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred?.('success');
        } catch {
          // Haptics are optional.
        }
        const nextColor = findRewardingColor(template, nextFilled, stroke.color);
        if (nextColor !== undefined) onSelectColor(nextColor);
      }
    }
    const rs = routeStateRef.current;
    // Manual camera exploration must not make the authored fragment lose its
    // reveal. Outside the experiment, preserve the existing AUTO-only route.
    if (rs.target && (autoState === AUTO_STATE.ACTIVE || enhancedCoreFeel)) {
      const visRem = computeVisibleUnfilledCount(
        rs.target, camera, template, nextFilled,
        containerSize.width, containerSize.height, safeArea.current,
      );
      const tgtRem = rs.target.workCells.reduce((c, idx) => c + (nextFilled[idx] === -1 ? 1 : 0), 0);
      routeStateRef.current = {
        ...rs,
        visibleRemaining: visRem,
        targetRemaining: tgtRem,
      };
      syncRouteDisplay();
      if (enhancedCoreFeel && tgtRem === 0 && coreFeelBeat?.targetId !== rs.targetId) {
        const fragment = activeCoreFeelFragmentRef.current;
        const finishedFragment = fragment || {
              id: `target-${rs.targetId}`,
              label: 'Фрагмент',
              prompt: 'Продолжить раскрытие',
              color: rs.target.color,
              cells: rs.target.workCells,
            };
        const nextFragment = getNextCoreFeelFragment(template, nextFilled, finishedFragment.id);
        setCoreFeelHintVisible(false);
        setCoreFeelBeat({
          id: `${finishedFragment.id}:${Date.now()}`,
          status: 'revealed',
          targetId: rs.targetId,
          fragment: finishedFragment,
          nextFragment,
          revealedAt: Date.now(),
        });
        playCoreFeelFeedback('fragment', coreFeelExperiment);
        onTrack?.('core_feel_manual_fragment_reveal', {
          id: template.id,
          variant: coreFeelExperiment.variantId,
          fragment: finishedFragment.id,
          cells: rs.target.workCells.length,
          time_to_reveal_ms: firstCoreFeelStrokeAtRef.current
            ? Date.now() - firstCoreFeelStrokeAtRef.current
            : Date.now() - stroke.startedAt,
          assisted_cells: 0,
        });
        liveStatusRef.current?.announce(`${finishedFragment.label} раскрыт. Можно продолжить к следующему фрагменту или остановиться.`);
      }
      if (visRem === 0 && tgtRem > 0) {
      }
    }
  }, [template, onSaveProgress, onSelectColor, interactionMode, onTrack, autoState, camera, containerSize, specialCells, specialTreatment, coreFeelActive, enhancedCoreFeel, coreFeelExperiment, coreFeelBeat]);

  const handleWrongCell = useCallback(() => {
    liveStatusRef.current?.announce('Неправильный цвет для этой клетки');
    if (onWrongCell) onWrongCell();
  }, [onWrongCell]);

  const handleFirstPaint = useCallback(() => {
    if (coreFeelActive) {
      setCoreFeelHintVisible(false);
      firstCoreFeelStrokeAtRef.current ||= Date.now();
    }
    if (onFirstPaint) onFirstPaint();
  }, [onFirstPaint, coreFeelActive]);

  function enterFreeExploration() {
    const current = routeStateRef.current;
    if (!current.target) return;
    pauseAuto();
    routeStateRef.current = { ...current, status: 'freeExploration', reason: 'manual_exploration' };
    syncRouteDisplay();
    liveStatusRef.current?.announce('Свободный просмотр. Shift со стрелками двигает поле, 0 показывает обзор.');
  }

  function handleOverview() {
    const current = routeStateRef.current;
    if (!current.target) return;
    pauseAuto();
    routeStateRef.current = { ...current, status: 'freeExploration', reason: 'overview' };
    syncRouteDisplay();
    focusOverview();
    liveStatusRef.current?.announce('Показан обзор всей картины.');
  }

  function handleCanvasResetView() {
    const current = routeStateRef.current;
    if (current?.target) handleOverview();
    else {
      pauseAuto();
      focusOverview();
    }
  }

  function returnToTarget() {
    const current = routeStateRef.current;
    if (!current.target) return;
    const cells = current.target.workCells;
    resumeAuto();
    const candidate = candidateForCells(cells, template.width);
    const result = activateTarget(candidate, {
      immediate: false,
      force: true,
      reason: 'return_to_target',
      markVisited: false,
      targetColor: current.target.color,
    });
    if (!result.ok) {
      routeStateRef.current = current;
      syncRouteDisplay();
    }
  }

  if (!template || !progress) return null;

  const showCanvas = cameraReady && ['ready', 'freeExploration', 'focusingTarget', 'artworkComplete'].includes(routeDisplay.status) && containerSize.width > 0 && containerSize.height > 0;
  const showTaskSummary = ['ready', 'freeExploration'].includes(routeDisplay.status) && routeDisplay.target;

  // Ambilight: мягкое свечение доминирующего цвета картины за канвасом.
  let ambilight;
  {
    const counts = new Map();
    for (const target of template.cells) counts.set(target, (counts.get(target) || 0) + 1);
    let topColor = null;
    let topCount = -1;
    for (const [color, count] of counts) {
      if (count > topCount) { topCount = count; topColor = color; }
    }
    const hex = template.palette[topColor];
    if (typeof hex === 'string' && hex.startsWith('#') && hex.length >= 7) {
      const r = parseInt(hex.slice(1, 3), 16);
      const g = parseInt(hex.slice(3, 5), 16);
      const b = parseInt(hex.slice(5, 7), 16);
      ambilight = `rgba(${r}, ${g}, ${b}, 0.17)`;
    }
  }

  return (
    <div
      className={`coloring-session${coreFeelBeat?.status === 'revealed' ? ' core-feel-reveal-active' : ''}`}
      data-route-status={routeDisplay.status}
      data-target-id={routeDisplay.targetId || ''}
      data-target-color={routeDisplay.target?.color ?? ''}
      data-target-generation={routeDisplay.generation}
      data-safe-top={safeAreaState.top}
      data-safe-right={safeAreaState.right}
      data-safe-bottom={safeAreaState.bottom}
      data-safe-left={safeAreaState.left}
      data-special-cohort={specialCohort}
      data-core-feel-variant={coreFeelActive ? coreFeelExperiment.variantId : ''}
      data-core-feel-camera={coreFeelActive ? coreFeelExperiment.variant.cameraStyle : ''}
    >
      <div className="coloring-canvas-container" ref={containerRef} style={ambilight ? { '--ambilight': ambilight } : undefined}>
        {['ready', 'freeExploration'].includes(routeDisplay.status) && routeDisplay.target && (
          <div className="coloring-task-context">
            <b>Цвет {routeDisplay.target.color + 1} · Осталось {routeDisplay.targetRemaining} клеток</b>
            <span>{
              routeDisplay.reason?.includes(':color_complete:')
                ? `Выбранный цвет ${Number(routeDisplay.reason.split(':').at(-1)) + 1} уже завершён`
                : routeDisplay.status === 'freeExploration'
                  ? 'Свободный просмотр'
                  : 'Закрась выделенный участок'
            }</span>
          </div>
        )}
        {showCanvas && (
          <ColoringCanvas
            template={template}
            filled={localFilled}
            selectedColor={selectedColor}
            onStrokeComplete={handleStrokeComplete}
            onWrongCell={handleWrongCell}
            onFirstPaint={handleFirstPaint}
            calmMode={calmMode}
            hideFilledNumbers={hideNumbers}
            hintMode={hintMode}
            interactionMode={interactionMode}
            onTapCell={fillMode ? onFillAt : undefined}
            viewWidth={containerSize.width}
            viewHeight={containerSize.height}
            camera={camera}
            setCamera={setCamera}
            pauseAuto={pauseAuto}
            cancelAnimation={cancelAnimation}
            beginInteraction={beginInteraction}
            endInteraction={endInteraction}
            activeWorkCells={routeDisplay.target?.workCells || []}
            activeTargetColor={routeDisplay.target?.color ?? null}
            onManualExplore={enterFreeExploration}
            interactionDisabled={routeDisplay.status === 'focusingTarget' || coreFeelBeat?.status === 'revealed'}
            peekColor={peekColor}
            onResetView={handleCanvasResetView}
            specialCells={specialTreatment ? specialCells : []}
            onVisibleSpecialKinds={onVisibleSpecialKinds}
            coreFeelVariant={enhancedCoreFeel ? coreFeelExperiment.variant : null}
            revealBeat={coreFeelBeat?.status === 'revealed' ? {
              id: coreFeelBeat.fragment.id,
              token: coreFeelBeat.id,
              bounds: candidateForCells(coreFeelBeat.fragment.cells, template.width).bounds,
              color: template.palette[coreFeelBeat.fragment.color],
            } : null}
          />
        )}
        {!showCanvas && (
          <div style={{ position: 'absolute', inset: 0, background: '#081218', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div role="status" aria-live="polite" className="coloring-preparing">Готовим участок…</div>
          </div>
        )}
        <DevDiagnostics
          autoState={autoState}
          routeState={routeDisplay}
          routingColor={routingColor}
          template={template}
          windowsCount={workingWindows.length}
          workingWindows={workingWindows}
          filled={localFilled}
          safeArea={safeArea.current}
          camera={camera}
          containerSize={containerSize}
          onTrack={onTrack}
          specialCohort={specialCohort}
          specialProgress={progress}
          specialCells={specialCells}
          specialOffer={specialOffer}
          specialDiscovered={specialDiscovered}
          specialTarget={routeDisplay.target}
          specialPlan={routeDisplay}
          specialRecentTargets={[...visitedTargetsRef.current]}
          specialTargetActive={routeDisplay.status !== 'freeExploration'}
        />
        {!enhancedCoreFeel && <ColoringHud
          routeState={routeDisplay}
          onReturnToTarget={returnToTarget}
          onNextCluster={handleNextCluster}
          onOverview={handleOverview}
          combo={combo}
          isPainting={false}
          onResize={handleHudResize}
        />}
        {enhancedCoreFeel && coreFeelHintVisible && routeDisplay.status === 'ready' && !coreFeelBeat && (
          <div className="core-feel-context-hint" role="status" data-core-feel-hint>
            {getCoreFeelFragmentForColor(template, localFilled, routeDisplay.target?.color)?.prompt || 'Проведи по подсвеченному фрагменту'}
          </div>
        )}
        {enhancedCoreFeel && coreFeelBeat?.status === 'revealed' && (
          <div className="core-feel-ownership-pause" data-core-feel-ownership-pause data-reveal-variant={coreFeelExperiment.variant.revealStyle}>
            <span className="core-feel-beat-kicker">Ты раскрыл</span>
            <b>{coreFeelBeat.fragment.label}</b>
            {coreFeelBeat.nextFragment ? (
              <>
                <button type="button" onClick={handleNextCluster} data-core-feel-next>
                  <span>Следующий фрагмент</span>
                  <small>{coreFeelBeat.nextFragment.label}</small>
                </button>
                <button type="button" className="core-feel-stop-button" onClick={onCoreFeelStop} data-core-feel-stop>
                  Остановиться здесь
                </button>
              </>
            ) : (
              <button type="button" className="core-feel-stop-button" onClick={onCoreFeelStop} data-core-feel-stop>
                Остановиться здесь
              </button>
            )}
          </div>
        )}
        {specialTreatment && specialOffer?.kind === 'bomb' && (
          <div className="progressive-grid-special-offer legacy-grid-special-offer" role="group" data-special-kind="bomb">
            <span className="progressive-grid-special-title">Бомба: применить вокруг клетки</span>
            <button
              type="button"
              data-special-action="use"
              onClick={() => onSpecialAction?.({
                type: 'use_bomb',
                special_id: specialOffer.special_id,
                offer_token: specialOffer.offer_token,
                center_x: activeSpecial ? Number(activeSpecial.cell_index) % template.width : 0,
                center_y: activeSpecial ? Math.floor(Number(activeSpecial.cell_index) / template.width) : 0,
                experiment_group: 'treatment',
              })}
            >Использовать</button>
          </div>
        )}
        {specialTreatment && specialOffer?.kind === 'fuse' && (
          <div
            className="progressive-grid-special-offer legacy-grid-special-offer"
            role="group"
            data-special-kind="fuse"
            data-fuse-steps-remaining={Array.isArray(specialOffer.steps) ? specialOffer.steps.length : 0}
          >
            <button
              type="button"
              className="progressive-grid-special-skip"
              data-special-action="skip"
              onClick={() => onSpecialAction?.({
                type: 'skip_fuse',
                special_id: specialOffer.special_id,
                offer_token: specialOffer.offer_token,
                experiment_group: 'treatment',
              })}
            >Leave it and continue</button>
            <span className="progressive-grid-special-title">Фитиль: обезвредить цепочку</span>
            <button
              type="button"
              data-special-action="disarm"
              data-fuse-step-distance={Array.isArray(specialOffer.steps) ? specialOffer.steps[0]?.distance : undefined}
              data-fuse-steps-remaining={Array.isArray(specialOffer.steps) ? specialOffer.steps.length : 0}
              onClick={() => onSpecialAction?.({
                type: 'disarm_fuse',
                special_id: specialOffer.special_id,
                offer_token: specialOffer.offer_token,
                experiment_group: 'treatment',
              })}
            >
              {Array.isArray(specialOffer.steps) && specialOffer.steps.length > 1
                ? `Обезвредить звено ${specialOffer.steps[0]?.distance}`
                : 'Обезвредить и продолжить'}
            </button>
          </div>
        )}
        {specialTreatment && specialOffer?.kind === 'hazard' && (
          <div className="progressive-grid-special-offer legacy-grid-special-offer" role="group" data-special-kind="hazard">
            <button
              type="button"
              className="progressive-grid-special-skip"
              data-special-action="skip"
              onClick={() => onSpecialAction?.({
                type: 'skip_hazard',
                special_id: specialOffer.special_id,
                offer_token: specialOffer.offer_token,
                experiment_group: 'treatment',
              })}
            >Пропустить (маленькая пауза)</button>
            <span className="progressive-grid-special-title">Опасность: обезвредьте маркер</span>
            <button
              type="button"
              data-special-action="disarm"
              data-hazard-disarm
              onClick={() => onSpecialAction?.({
                type: 'disarm_hazard',
                special_id: specialOffer.special_id,
                offer_token: specialOffer.offer_token,
                experiment_group: 'treatment',
              })}
            >Обезвредить и продолжить</button>
          </div>
        )}
        {specialTreatment && specialOffer?.kind === 'choice' && Array.isArray(specialOffer.choice_options) && (
          <div className="progressive-grid-special-offer legacy-grid-special-offer" role="group" data-special-kind="choice">
            <span className="progressive-grid-special-title">Выберите способ продолжить</span>
            {specialOffer.choice_options.slice(0, 2).map((option) => (
              <button
                key={option.option_id}
                type="button"
                data-special-option={option.option_id}
                onClick={() => onSpecialAction?.({
                  type: 'use_choice',
                  special_id: specialOffer.special_id,
                  offer_token: specialOffer.offer_token,
                  option_id: option.option_id,
                  experiment_group: 'treatment',
                })}
              >{option.label}</button>
            ))}
          </div>
        )}
        {specialTreatment && specialOffer && !specialOffer.kind && Array.isArray(specialOffer.target_options) && (
          <div className="progressive-grid-special-offer legacy-grid-special-offer" role="group" aria-label="Выберите участок для Spark">
            <span className="progressive-grid-special-title">Искра: выбрать участок</span>
            {specialOffer.target_options.slice(0, 2).map((option, index) => (
              <button
                key={option.option_id || index}
                type="button"
                data-special-option={option.option_id || (index === 0 ? 'a' : 'b')}
                onClick={() => onSpecialAction?.({
                  type: 'use_spark',
                  special_id: specialOffer.special_id,
                  offer_token: specialOffer.offer_token,
                  option_id: option.option_id || (index === 0 ? 'a' : 'b'),
                  experiment_group: 'treatment',
                })}
              >
                Участок {index === 0 ? 'A' : 'B'} · {option.estimated_cells} клеток
              </button>
            ))}
            <button
              type="button"
              className="progressive-grid-special-skip"
              onClick={() => onSpecialAction?.({
                type: 'skip_spark',
                special_id: specialOffer.special_id,
                offer_token: specialOffer.offer_token,
                experiment_group: 'treatment',
              })}
            >Пропустить</button>
          </div>
        )}
        {specialTreatment && specialDiscovered && !specialOffer && (
          <div className="progressive-grid-special-offer legacy-grid-special-offer" role="status" data-special-discovered>
            <span className="progressive-grid-special-title">
              {specialDiscovered.kind === 'artifact'
                ? `Артефакт: фрагмент ${specialDiscovered.artifact_fragments || 1}/3`
                : specialDiscovered.kind === 'hazard' && specialDiscovered.missed
                  ? 'Опасность пропущена: небольшая локальная пауза'
                  : `${specialDiscovered.kind || 'Spark'} найден`}
            </span>
          </div>
        )}
        {specialTreatment && artifactProgress && artifactProgress.fragments > 0
          && !specialOffer && !specialDiscovered && (
          <div
            className="progressive-grid-special-offer legacy-grid-special-offer"
            role="status"
            data-artifact-progress
            data-artifact-fragments={String(artifactProgress.fragments)}
            data-artifact-total={String(artifactProgress.total || 3)}
          >
            <span className="progressive-grid-special-title">
              {`Артефакт: ${artifactProgress.complete ? 'собран' : `фрагмент ${artifactProgress.fragments}/${artifactProgress.total || 3}`}`}
            </span>
          </div>
        )}
      </div>
      <div className={`coloring-task-summary${showTaskSummary ? '' : ' coloring-task-summary--empty'}${enhancedCoreFeel ? ' coloring-task-summary--core-feel' : ''}`}>
        {showTaskSummary && (
          <>
          <span className="task-color-dot" style={{ background: template.palette[routeDisplay.target.color] }} aria-hidden="true" />
          {enhancedCoreFeel
            ? routeDisplay.targetRemaining > 0
              ? `${getCoreFeelFragmentForColor(template, localFilled, routeDisplay.target.color)?.label || 'Фрагмент'} · Осталось ${routeDisplay.targetRemaining}`
              : 'Фрагмент раскрыт'
            : `Цвет ${routeDisplay.target.color + 1} · Осталось ${routeDisplay.targetRemaining} клеток`}
          </>
        )}
      </div>
      <span id={liveStatusId} role="status" aria-live="polite" className="sr-only">{liveStatus}</span>
      {interactionMode !== 'reveal' && !enhancedCoreFeel && (
        <div className="coloring-dock">
          <ColoringPalette
            template={template}
            filled={localFilled}
            selectedColor={selectedColor}
            onSelectColor={handleColorSelect}
            disabled={routeDisplay.status === 'focusingTarget'}
            onPeekColor={setPeekColor}
          />
          <div className="coloring-dock-actions">
            <button onClick={onUndo} disabled={!canUndo}>Отмена</button>
            <button onClick={onRedo} disabled={!canRedo}>Повтор</button>
            <button onClick={onOpenMenu}>Меню</button>
          </div>
        </div>
      )}
    </div>
  );
}
