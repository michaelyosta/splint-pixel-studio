import { useState, useCallback, useRef, useMemo, useEffect, useLayoutEffect } from 'react';
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
  buildTargetId, computeVisibleUnfilledCount, createActiveTarget, ensureActionableViewport, isTargetConsideredDone, normalizeSafeArea,
} from './engine/routeTargeting.js';
import './coloring.css';

const BASE_CELL = 32;

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

function cellCenter(idx, templateWidth) {
  return {
    x: (idx % templateWidth) + 0.5,
    y: Math.floor(idx / templateWidth) + 0.5,
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
}) {
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  const containerRef = useRef(null);
  const filledRef = useRef(progress?.filled || []);
  const [localFilled, setLocalFilled] = useState(progress?.filled || []);
  const windowsRef = useRef([]);
  const visitedTargetsRef = useRef(new Set());
  const routeStateRef = useRef(createRouteState());
  const [routeDisplay, setRouteDisplay] = useState(createRouteState());
  const pendingAutoRef = useRef(null);
  const lastColorRef = useRef(selectedColor);
  const recoveryCountRef = useRef(0);
  const maxRecoveryAttempts = 3;
  const sessionTokenRef = useRef(0);

  const safeArea = useRef({ top: 0, right: 0, bottom: 0, left: 0 });

  const {
    camera, cameraReady, markCameraReady, setCamera, setCameraInstant, isAutoActive, autoState,
    toggleAuto, pauseAuto, resumeAuto, enableAuto, forceDisableAuto,
    focusOnWindow, focusOverview,
    cancelAnimation, beginInteraction, endInteraction, setSafeArea,
    lastCenterRef, prevCenterRef, safeAreaRef,
  } = useSmartCamera(template, containerSize.width, containerSize.height);

  const hudSizeRef = useRef({ width: 0, height: 0 });

  const handleHudResize = useCallback((w, h, left, top) => {
    hudSizeRef.current = { width: w, height: h };
    if (containerRef.current) {
      const containerRect = containerRef.current.getBoundingClientRect();
      const hudLeftRel = left - containerRect.left;
      const hudTopRel = top - containerRect.top;
      const rightInset = Math.max(0, containerRect.width - hudLeftRel + 8);
      const topInset = Math.max(0, hudTopRel + h + 8);
      const raw = { top: topInset, right: rightInset, bottom: 0, left: 0 };
      const normalized = normalizeSafeArea(raw, containerSize.width || 400, containerSize.height || 400);
      safeArea.current = normalized;
      setSafeArea(normalized);
    }
  }, [containerSize.width, containerSize.height, setSafeArea]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0) {
          setContainerSize({ width, height });
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

  const windowsGenerationRef = useRef(0);
  const [windowsGeneration, setWindowsGeneration] = useState(0);

  const routingColor = interactionMode === 'reveal' ? null : selectedColor;

  const workingWindows = useMemo(() => {
    if (!template || !filledRef.current.length) return [];
    const clusters = routingColor != null
      ? findClusters(template, filledRef.current, routingColor)
      : findUnfilledClusters(template, filledRef.current);
    const merged = mergeClusters(clusters, template.width);
    if (!merged.length) return [];
    const allWindows = [];
    const sa = safeArea.current;
    const usableW = containerSize.width || 400;
    const usableH = containerSize.height || 400;
    for (const cluster of merged) {
      const wins = createWorkingWindows(cluster, template, usableW, usableH, sa);
      allWindows.push(...wins);
    }
    return allWindows;
  }, [template, interactionMode, routingColor, containerSize, windowsGeneration]);

  useEffect(() => {
    windowsRef.current = workingWindows;
  }, [workingWindows]);

  useEffect(() => {
    if (selectedColor !== lastColorRef.current) {
      lastColorRef.current = selectedColor;
      if (interactionMode !== 'reveal') {
        cancelAnimation();
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
    cancelAnimation();
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

  function activateTarget(target, options = {}) {
    const {
      immediate = false,
      force = false,
      reason = 'unknown',
      markVisited = true,
    } = options;

    if (!target || !template) return false;
    routeStateRef.current = { ...routeStateRef.current, status: 'preparingTarget', reason };
    syncRouteDisplay();

    const filled = filledRef.current;
    const targetColor = routingColor != null ? routingColor : template.cells[target.cells?.[0]];
    const activation = createActiveTarget(template, target, targetColor, filled, {
      width: containerSize.width,
      height: containerSize.height,
      safeArea: safeArea.current,
    });
    if (!activation.ok && !force) {
      routeStateRef.current = {
        ...routeStateRef.current,
        status: 'error',
        reason: `${reason}:${activation.reason}`,
      };
      syncRouteDisplay();
      return { ok: false, reason: activation.reason };
    }
    if (!activation.ok) return { ok: false, reason: activation.reason };
    const activeTarget = activation.target;
    const unfilledCount = activeTarget.workCells.length;
    const targetId = activeTarget.id;
    const prevTargetId = routeStateRef.current.targetId;

    prevCenterRef.current = lastCenterRef.current
      ? { ...lastCenterRef.current }
      : null;
    lastCenterRef.current = { x: target.centerX, y: target.centerY };

    if (markVisited) {
      visitedTargetsRef.current.add(targetId);
    }

    if (prevTargetId && prevTargetId !== targetId) {
      visitedTargetsRef.current.add(prevTargetId);
    }

    routeStateRef.current = { ...routeStateRef.current, status: 'focusingTarget', reason };
    syncRouteDisplay();
    const camResult = focusOnWindow(target, immediate, force);
    if (!camResult) return { ok: false, reason: 'invalid_camera_plan' };

    const visRemaining = computeVisibleUnfilledCount(
      activeTarget, camResult, template, filled,
      containerSize.width, containerSize.height, safeArea.current,
    );

    routeStateRef.current = {
      status: 'focusingTarget',
      generation: routeStateRef.current.generation + 1,
      targetId,
      target: activeTarget,
      reason,
      visibleRemaining: visRemaining,
      targetRemaining: unfilledCount,
    };
    const readiness = ensureActionableViewport({
      activeTarget, progress: filled, camera: camResult,
      viewport: containerSize, safeArea: safeArea.current, template,
    });
    if (!readiness.actionable) {
      routeStateRef.current = { ...routeStateRef.current, status: 'error', reason: `${reason}:${readiness.reason}` };
      syncRouteDisplay();
      return { ok: false, reason: readiness.reason };
    }
    routeStateRef.current = {
      ...routeStateRef.current,
      status: 'ready',
      visibleRemaining: readiness.visibleUnfilledCells,
      allTargetCellsVisible: readiness.allTargetCellsVisible,
    };
    syncRouteDisplay();

    if (onTrack) onTrack('camera_activate_target', {
      templateId: template?.id,
      targetId,
      reason,
      targetCells: activeTarget.workCells.length,
      unfilledCount,
      visibleRemaining: visRemaining,
    });

    return { ok: true, target: activeTarget, camera: camResult };
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
      let score = scoreTargetQuality(win, template, filled);
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

  function findNextTarget(currentTargetId, wins) {
    if (!wins.length || !template) return null;
    const filled = filledRef.current;
    const blockedIds = new Set(visitedTargetsRef.current);
    if (currentTargetId) blockedIds.add(currentTargetId);

    const validWins = wins.filter((win, i) => {
      const tid = buildTargetId(template, win, routingColor);
      if (blockedIds.has(tid)) return false;
      return win.cells.some(idx => filled[idx] === -1);
    });

    if (!validWins.length) return null;

    const center = lastCenterRef.current
      ? { x: lastCenterRef.current.x, y: lastCenterRef.current.y }
      : { x: 0, y: 0 };

    let best = null;
    let bestScore = -Infinity;
    for (const win of validWins) {
      const dx = win.centerX - center.x;
      const dy = win.centerY - center.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const unfilled = win.cells.reduce((c, idx) => c + (filled[idx] === -1 ? 1 : 0), 0);
      const score = -dist * 0.5 + unfilled * 0.1 + win.cellCount * 0.005;
      if (score > bestScore) {
        bestScore = score;
        best = win;
      }
    }
    return best;
  }

  function focusOnUnfilledCell() {
    const filled = filledRef.current;
    let found = -1;
    let bestDist = Infinity;
    const cx = (template.width - 1) / 2;
    const cy = (template.height - 1) / 2;
    for (let i = 0; i < filled.length; i++) {
      if (filled[i] !== -1) continue;
      const dx = (i % template.width) - cx;
      const dy = Math.floor(i / template.width) - cy;
      const dist = dx * dx + dy * dy;
      if (dist < bestDist) {
        bestDist = dist;
        found = i;
      }
    }
    if (found >= 0) {
      const cp = cellCenter(found, template.width);
      const fakeTarget = {
        cells: [found],
        centerX: cp.x,
        centerY: cp.y,
        zoom: 2,
        cellCount: 1,
        bounds: { minX: found % template.width, maxX: found % template.width, minY: Math.floor(found / template.width), maxY: Math.floor(found / template.width), width: 1, height: 1 },
      };
      activateTarget(fakeTarget, { immediate: false, force: true, reason: 'fallback-cell', markVisited: false });
    }
  }

  const handleNextCluster = useCallback(() => {
    const wins = windowsRef.current;
    if (!wins.length && !hasUnfilledCells()) {
      routeStateRef.current = { ...routeStateRef.current, status: 'artworkComplete', reason: 'manual-next:no_remaining' };
      syncRouteDisplay();
      return;
    }
    const currentTargetId = routeStateRef.current.targetId;
    const next = findNextTarget(currentTargetId, wins);
    if (next && buildTargetId(template, next, routingColor) !== currentTargetId) {
      activateTarget(next, { immediate: false, force: true, reason: 'manual-next', markVisited: true });
      if (onTrack) onTrack('camera_next_cluster', { templateId: template?.id });
    } else {
      if (hasUnfilledCells()) {
        visitedTargetsRef.current = new Set();
        windowsGenerationRef.current += 1;
        setWindowsGeneration(windowsGenerationRef.current);
        const fresh = windowsRef.current;
        const nextFresh = findNextTarget(null, fresh);
        if (nextFresh) activateTarget(nextFresh, { immediate: false, force: true, reason: 'manual-next-rebuilt', markVisited: true });
        else focusOnUnfilledCell();
      } else {
        routeStateRef.current = {
          ...routeStateRef.current,
          status: 'completed',
          reason: 'manual-next:no_remaining',
        };
        syncRouteDisplay();
        if (onTrack) onTrack('auto_completed', { templateId: template?.id });
      }
    }
  }, [template, routingColor, focusOverview, enableAuto, onTrack]);

  const handleFindRemaining = useCallback(() => {
    if (!template) return;
    resumeAuto();
    focusOnUnfilledCell();
    if (onTrack) onTrack('camera_find_remaining', { templateId: template?.id });
  }, [template, resumeAuto, onTrack]);

  const handleColorSelect = useCallback((colorIndex) => {
    onSelectColor(colorIndex);
  }, [onSelectColor]);

  useEffect(() => {
    return () => {
      if (pendingAutoRef.current) clearTimeout(pendingAutoRef.current);
      sessionTokenRef.current += 1;
    };
  }, []);

  useLayoutEffect(() => {
    if (!containerSize.width || !containerSize.height) return;
    const wins = windowsRef.current;

    if (autoState !== AUTO_STATE.ACTIVE) {
      markCameraReady();
      const sa = normalizeSafeArea(safeArea.current, containerSize.width, containerSize.height);
      safeArea.current = sa;
      setSafeArea(sa);
      const usableW = containerSize.width - sa.left - sa.right;
      const usableH = containerSize.height - sa.top - sa.bottom;
      const zoomX = usableW / (template.width * BASE_CELL);
      const zoomY = usableH / (template.height * BASE_CELL);
      const zoom = Math.min(zoomX, zoomY, 1);
      const totalW = template.width * BASE_CELL * zoom;
      const totalH = template.height * BASE_CELL * zoom;
      setCameraInstant({
        x: (containerSize.width - totalW) / 2,
        y: (containerSize.height - totalH) / 2,
        zoom,
      });
      return;
    }

    if (!wins.length) {
      markCameraReady();
      if (hasUnfilledCells()) {
        if (interactionMode !== 'reveal') {
          const nextColor = findRewardingColor(template, filledRef.current, selectedColor);
          if (nextColor !== undefined && nextColor !== selectedColor) onSelectColor(nextColor);
          else routeStateRef.current = { ...routeStateRef.current, status: 'error', reason: 'initial:no_actionable_target' };
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
    if (routeStateRef.current.targetId && ['ready', 'freeExploration'].includes(routeStateRef.current.status)) return;
    visitedTargetsRef.current = new Set();
    const best = findBestInitialTarget(wins);
    if (best) {
      activateTarget(best, { immediate: true, force: false, reason: 'initial', markVisited: true });
    }
  }, [containerSize, template, workingWindows, autoState]);

  function tryAdvanceAUTO() {
    if (autoState !== AUTO_STATE.ACTIVE) return;
    if (pendingAutoRef.current) return;

    const rs = routeStateRef.current;
    if (!rs.targetId || rs.status === 'completed') return;

    const wins = windowsRef.current;
    if (!wins.length) return;

    const targetDone = isTargetConsideredDone(
      rs.target, camera, template, filledRef.current,
      containerSize.width, containerSize.height, safeArea.current,
    );

    if (!targetDone) return;

    recoveryCountRef.current = 0;
    const next = findNextTarget(rs.targetId, wins);

    if (next && buildTargetId(template, next, routingColor) !== rs.targetId) {
      activateTarget(next, { immediate: false, force: false, reason: 'auto-advance', markVisited: true });
    } else if (hasUnfilledCells()) {
      if (onTrack) onTrack('auto_route_empty', {
        templateId: template?.id,
        visitedCount: visitedTargetsRef.current.size,
        totalWindows: wins.length,
      });

      recoveryCountRef.current += 1;
      if (recoveryCountRef.current > maxRecoveryAttempts) {
        forceDisableAuto();
        if (onTrack) onTrack('auto_recovered', { templateId: template?.id, outcome: 'max_attempts_exceeded' });
        return;
      }

      visitedTargetsRef.current = new Set();
      windowsGenerationRef.current += 1;
      setWindowsGeneration(windowsGenerationRef.current);

      if (onTrack) onTrack('auto_route_rebuilt', {
        templateId: template?.id,
        attempt: recoveryCountRef.current,
      });

      enableAuto();
      const freshNext = findNextTarget(null, windowsRef.current);
      if (freshNext) activateTarget(freshNext, { immediate: false, force: false, reason: 'auto-rebuilt', markVisited: true });
      else focusOnUnfilledCell();
    }
  }

  useEffect(() => {
    if (!workingWindows.length || autoState !== AUTO_STATE.ACTIVE) return;
    const targetId = routeStateRef.current.targetId;
    if (!targetId) return;
    tryAdvanceAUTO();
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
    if (onSaveProgress) onSaveProgress(nextFilled, operation);
    if (onTrack) onTrack('coloring_stroke_commit', { templateId: template.id, color: stroke.color, cells: stroke.indices.length });
    if (interactionMode !== 'reveal') {
      const remainingForColor = template.cells.reduce((count, target, ci) =>
        count + (target === stroke.color && nextFilled[ci] === -1 ? 1 : 0), 0);
      if (remainingForColor === 0) {
        if (onTrack) onTrack('coloring_color_complete', { templateId: template.id, color: stroke.color });
        const nextColor = findRewardingColor(template, nextFilled, stroke.color);
        if (nextColor !== undefined) onSelectColor(nextColor);
      }
    }
    const rs = routeStateRef.current;
    if (rs.target && autoState === AUTO_STATE.ACTIVE) {
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
      if (visRem === 0 && tgtRem > 0) {
      }
    }
  }, [template, onSaveProgress, onSelectColor, interactionMode, onTrack, autoState, camera, containerSize]);

  const handleWrongCell = useCallback(() => {
    if (onWrongCell) onWrongCell();
  }, [onWrongCell]);

  const handleFirstPaint = useCallback(() => {
    if (onFirstPaint) onFirstPaint();
  }, [onFirstPaint]);

  const enterFreeExploration = useCallback(() => {
    const current = routeStateRef.current;
    if (!current.target) return;
    pauseAuto();
    routeStateRef.current = { ...current, status: 'freeExploration', reason: 'manual_exploration' };
    syncRouteDisplay();
  }, [pauseAuto]);

  const returnToTarget = useCallback(() => {
    const current = routeStateRef.current;
    if (!current.target) return;
    const cells = current.target.workCells;
    const minX = Math.min(...cells.map((i) => i % template.width));
    const maxX = Math.max(...cells.map((i) => i % template.width));
    const minY = Math.min(...cells.map((i) => Math.floor(i / template.width)));
    const maxY = Math.max(...cells.map((i) => Math.floor(i / template.width)));
    focusOnWindow({ cells, cellCount: cells.length, centerX: (minX + maxX + 1) / 2, centerY: (minY + maxY + 1) / 2, bounds: { minX, maxX, minY, maxY, width: maxX - minX + 1, height: maxY - minY + 1 } }, false, true);
    resumeAuto();
    routeStateRef.current = { ...current, status: 'ready', reason: 'return_to_target' };
    syncRouteDisplay();
  }, [template, focusOnWindow, resumeAuto]);

  if (!template || !progress) return null;

  const showCanvas = cameraReady && ['ready', 'freeExploration'].includes(routeDisplay.status) && containerSize.width > 0 && containerSize.height > 0;

  return (
    <div className="coloring-session">
      <div className="coloring-canvas-container" ref={containerRef}>
        {['ready', 'freeExploration'].includes(routeDisplay.status) && routeDisplay.target && (
          <div className="coloring-task-context" aria-live="polite">
            <b>Цвет {routeDisplay.target.color + 1} · Осталось {routeDisplay.targetRemaining} клеток</b>
            <span>{routeDisplay.status === 'freeExploration' ? 'Свободный просмотр' : 'Закрась выделенный участок'}</span>
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
        />
        <ColoringHud
          routeState={routeDisplay}
          onReturnToTarget={returnToTarget}
          onNextCluster={handleNextCluster}
          onOverview={focusOverview}
          combo={combo}
          isPainting={false}
          onResize={handleHudResize}
        />
      </div>
      {interactionMode !== 'reveal' && (
        <div className="coloring-dock">
          <ColoringPalette
            template={template}
            filled={localFilled}
            selectedColor={selectedColor}
            onSelectColor={handleColorSelect}
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
