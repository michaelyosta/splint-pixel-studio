import { useState, useCallback, useRef, useMemo, useEffect } from 'react';
import ColoringCanvas from './ColoringCanvas.jsx';
import ColoringPalette from './ColoringPalette.jsx';
import ColoringHud from './ColoringHud.jsx';
import { useSmartCamera } from './camera/useSmartCamera.js';
import { findClusters, mergeClusters, findUnfilledClusters } from './engine/clusterGraph.js';
import { createWorkingWindows, selectNextWindow } from './engine/workingWindows.js';
import { applyStroke, createStrokeOperation } from './engine/paintReducer.js';
import { arraysEqual } from './engine/coloringUtils.js';
import { findRewardingColor } from '../../lib/pixelColoring.js';
import './coloring.css';

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
  const activeWindowIdRef = useRef(-1);
  const visitedWindowsRef = useRef(new Set());
  const lastCameraCenterRef = useRef(null);
  const prevCameraCenterRef = useRef(null);
  const pendingAutoRef = useRef(null);
  const isFirstFocusRef = useRef(true);
  const lastColorRef = useRef(selectedColor);

  const {
    camera, setCamera, isAutoActive, isTemporarilyPaused,
    toggleAuto, pauseAuto,
    focusOnWindow, focusOverview,
    cancelAnimation, beginInteraction, endInteraction,
  } = useSmartCamera(template, containerSize.width, containerSize.height);

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

  const resetRoute = useCallback(() => {
    visitedWindowsRef.current = new Set();
    activeWindowIdRef.current = -1;
    lastCameraCenterRef.current = null;
    prevCameraCenterRef.current = null;
    isFirstFocusRef.current = true;
  }, []);

  /* Build windows — color-specific in classic, color-agnostic in reveal */
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
    for (const cluster of merged) {
      const wins = createWorkingWindows(cluster, template, containerSize.width || 400, containerSize.height || 400);
      allWindows.push(...wins);
    }
    return allWindows;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [template, interactionMode, routingColor, containerSize, windowsGeneration]);

  useEffect(() => {
    windowsRef.current = workingWindows;
    if (workingWindows.length) {
      resetRoute();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workingWindows]);

  /* Bump windows generation on color change or external reset — color-agnostic in reveal */
  useEffect(() => {
    if (selectedColor !== lastColorRef.current) {
      lastColorRef.current = selectedColor;
      if (interactionMode !== 'reveal') {
        windowsGenerationRef.current += 1;
        setWindowsGeneration(windowsGenerationRef.current);
      }
    }
  }, [selectedColor, interactionMode]);

  /* External progress.filled sync — deep compare to avoid false positives from autosave */
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

  /* Auto-focus initial window — prefer center, not top-left */
  useEffect(() => {
    if (!workingWindows.length || !isAutoActive || !isFirstFocusRef.current) return;
    if (containerSize.width === 0) return;
    isFirstFocusRef.current = false;
    const timer = setTimeout(() => {
      const wins = windowsRef.current;
      if (!wins.length) return;
      const center = { x: (template.width - 1) / 2, y: (template.height - 1) / 2 };
      const best = selectNextWindow(wins, center, null, new Set());
      if (best) {
        const idx = wins.indexOf(best);
        if (idx >= 0) tryFocusWindow(best, idx, true, false);
      }
    }, 400);
    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workingWindows, isAutoActive, containerSize]);

  /* Window completion check — uses correct target color */
  function isWindowComplete(windowId, filled) {
    if (!template) return false;
    const win = windowsRef.current[windowId];
    if (!win) return false;
    return win.cells.every(idx => filled[idx] === template.cells[idx]);
  }

  function getBlockedSet() {
    const blocked = new Set(visitedWindowsRef.current);
    const activeIdx = activeWindowIdRef.current;
    if (activeIdx >= 0) blocked.add(activeIdx);
    if (!template) return blocked;
    const filled = filledRef.current;
    windowsRef.current.forEach((win, idx) => {
      if (win.cells.every(ci => filled[ci] === template.cells[ci])) {
        blocked.add(idx);
      }
    });
    return blocked;
  }

  function tryFocusWindow(win, idx, immediate, force) {
    const focused = focusOnWindow(win, immediate, force);
    if (focused) {
      visitedWindowsRef.current.add(idx);
      activeWindowIdRef.current = idx;
      prevCameraCenterRef.current = lastCameraCenterRef.current;
      lastCameraCenterRef.current = { x: win.centerX, y: win.centerY };
    }
    return focused;
  }

  /* Navigate to next window only after current window is complete */
  useEffect(() => {
    if (!workingWindows.length || !isAutoActive) return;
    const activeId = activeWindowIdRef.current;
    if (activeId < 0) return;
    if (!isWindowComplete(activeId, localFilled)) return;
    if (pendingAutoRef.current) return;
    pendingAutoRef.current = setTimeout(() => {
      pendingAutoRef.current = null;
      const wins = windowsRef.current;
      if (!wins.length) return;
      const blocked = getBlockedSet();
      const best = selectNextWindow(
        wins,
        lastCameraCenterRef.current ? { x: lastCameraCenterRef.current.x, y: lastCameraCenterRef.current.y } : { x: 0, y: 0 },
        prevCameraCenterRef.current,
        blocked,
      );
      if (best) {
        tryFocusWindow(best, wins.indexOf(best), false, false);
      }
    }, 300);
    return () => { if (pendingAutoRef.current) clearTimeout(pendingAutoRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localFilled, isAutoActive]);

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
        if (nextColor !== undefined) {
          setTimeout(() => onSelectColor(nextColor), 100);
        }
      }
    }
  }, [template, progress, onSaveProgress, onSelectColor, interactionMode, onTrack]);

  const handleWrongCell = useCallback(() => {
    if (onWrongCell) onWrongCell();
  }, [onWrongCell]);

  const handleFirstPaint = useCallback(() => {
    if (onFirstPaint) onFirstPaint();
  }, [onFirstPaint]);

  const handleNextCluster = useCallback(() => {
    if (!windowsRef.current.length) {
      focusOverview();
      if (onTrack) onTrack('camera_overview', { templateId: template?.id });
      return;
    }
    const blocked = getBlockedSet();
    const best = selectNextWindow(
      windowsRef.current,
      lastCameraCenterRef.current ? { x: lastCameraCenterRef.current.x, y: lastCameraCenterRef.current.y } : { x: 0, y: 0 },
      prevCameraCenterRef.current,
      blocked,
    );
    if (best) {
      const idx = windowsRef.current.indexOf(best);
      if (idx >= 0) {
        tryFocusWindow(best, idx, false, true);
      }
      if (onTrack) onTrack('camera_next_cluster', { templateId: template?.id });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusOverview, onTrack, template]);

  const handleColorSelect = useCallback((colorIndex) => {
    onSelectColor(colorIndex);
  }, [onSelectColor]);

  const [layoutError, setLayoutError] = useState(false);
  const layoutTimerRef = useRef(null);

  useEffect(() => {
    return () => { if (layoutTimerRef.current) clearTimeout(layoutTimerRef.current); };
  }, []);

  useEffect(() => {
    if (containerSize.width > 0 && containerSize.height > 0) {
      if (layoutTimerRef.current) clearTimeout(layoutTimerRef.current);
      setLayoutError(false);
    }
  }, [containerSize]);

  useEffect(() => {
    if (!template || !progress) return;
    if (containerSize.width === 0 && containerSize.height === 0 && import.meta.env.DEV) {
      layoutTimerRef.current = setTimeout(() => setLayoutError(true), 1400);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!template || !progress) return null;

  return (
    <div className="coloring-session">
      <div className="coloring-canvas-container" ref={containerRef}>
        {containerSize.width > 0 && containerSize.height > 0 && (
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
          />
        )}
        {layoutError && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#ff6b6b', fontSize: '13px', flexDirection: 'column', gap: '4px', background: '#081218', zIndex: 5 }}>
            <b>Smart Canvas layout error</b>
            <span>width: 0</span>
            <span>height: 0</span>
            <span style={{ fontSize: '10px', color: '#8d9fa5' }}>Container has not received size from ResizeObserver</span>
          </div>
        )}
        <ColoringHud
          isAutoActive={isAutoActive}
          isTemporarilyPaused={isTemporarilyPaused}
          onToggleAuto={toggleAuto}
          onNextCluster={handleNextCluster}
          onOverview={focusOverview}
          combo={combo}
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
