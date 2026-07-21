import { useState, useCallback, useRef, useMemo, useEffect } from 'react';
import ColoringCanvas from './ColoringCanvas.jsx';
import ColoringPalette from './ColoringPalette.jsx';
import ColoringHud from './ColoringHud.jsx';
import { useSmartCamera } from './camera/useSmartCamera.js';
import { findClusters, mergeClusters } from './engine/clusterGraph.js';
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
  onRevealAt,
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

  /* Build windows for current color — frozen until color/external change */
  const windowsGenerationRef = useRef(0);
  const [windowsGeneration, setWindowsGeneration] = useState(0);

  const workingWindows = useMemo(() => {
    if (!template || !filledRef.current.length) return [];
    const clusters = findClusters(template, filledRef.current, selectedColor);
    const merged = mergeClusters(clusters, template.width);
    if (!merged.length) return [];
    const allWindows = [];
    for (const cluster of merged) {
      const wins = createWorkingWindows(cluster, template, containerSize.width || 400, containerSize.height || 400);
      allWindows.push(...wins);
    }
    return allWindows;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [template, selectedColor, containerSize, windowsGeneration]);

  useEffect(() => {
    windowsRef.current = workingWindows;
    if (workingWindows.length) {
      resetRoute();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workingWindows]);

  /* Bump windows generation on color change or external reset */
  useEffect(() => {
    if (selectedColor !== lastColorRef.current) {
      lastColorRef.current = selectedColor;
      windowsGenerationRef.current += 1;
      setWindowsGeneration(windowsGenerationRef.current);
    }
  }, [selectedColor]);

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

  /* Auto-focus first window on initial load or color change */
  useEffect(() => {
    if (!workingWindows.length || !isAutoActive || !isFirstFocusRef.current) return;
    if (containerSize.width === 0) return;
    isFirstFocusRef.current = false;
    const timer = setTimeout(() => {
      if (windowsRef.current.length) {
        focusOnWindow(windowsRef.current[0], true, false);
        visitedWindowsRef.current.add(0);
        activeWindowIdRef.current = 0;
        prevCameraCenterRef.current = null;
        lastCameraCenterRef.current = { x: windowsRef.current[0].centerX, y: windowsRef.current[0].centerY };
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [workingWindows, isAutoActive, focusOnWindow, containerSize]);

  /* Window completion check — uses correct target color */
  function isWindowComplete(windowId, filled) {
    if (!template) return false;
    const win = windowsRef.current[windowId];
    if (!win) return false;
    return win.cells.every(idx => filled[idx] === template.cells[idx]);
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
      const activeIdx = activeWindowIdRef.current;
      const remaining = wins.filter((win, i) =>
        i !== activeIdx &&
        !visitedWindowsRef.current.has(i) &&
        !win.cells.every(idx => localFilled[idx] === template.cells[idx])
      );
      if (!remaining.length) return;
      const best = selectNextWindow(
        wins,
        lastCameraCenterRef.current ? { x: lastCameraCenterRef.current.x, y: lastCameraCenterRef.current.y } : { x: 0, y: 0 },
        prevCameraCenterRef.current,
        visitedWindowsRef.current,
      );
      if (best) {
        const idx = wins.indexOf(best);
        if (idx >= 0) {
          visitedWindowsRef.current.add(idx);
          activeWindowIdRef.current = idx;
          prevCameraCenterRef.current = lastCameraCenterRef.current;
          lastCameraCenterRef.current = { x: best.centerX, y: best.centerY };
          focusOnWindow(best, false, false);
        }
      }
    }, 300);
    return () => { if (pendingAutoRef.current) clearTimeout(pendingAutoRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localFilled, isAutoActive]);

  const handleStrokeComplete = useCallback((stroke) => {
    if (!template || !filledRef.current.length) return;
    if (!stroke.indices.length) return;
    const nextFilled = applyStroke(filledRef.current, stroke);
    filledRef.current = nextFilled;
    setLocalFilled(nextFilled);
    const operation = createStrokeOperation(stroke, progress?.filled || filledRef.current);
    if (onSaveProgress) onSaveProgress(nextFilled, { stroke: operation });
    if (onTrack) onTrack('coloring_stroke_commit', { templateId: template.id, color: stroke.color, cells: stroke.indices.length });
    const remainingForColor = template.cells.reduce((count, target, ci) =>
      count + (target === stroke.color && nextFilled[ci] === -1 ? 1 : 0), 0);
    if (remainingForColor === 0 && interactionMode !== 'reveal') {
      if (onTrack) onTrack('coloring_color_complete', { templateId: template.id, color: stroke.color });
      const nextColor = findRewardingColor(template, nextFilled, stroke.color);
      if (nextColor !== undefined) {
        setTimeout(() => onSelectColor(nextColor), 100);
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
    const best = selectNextWindow(
      windowsRef.current,
      lastCameraCenterRef.current ? { x: lastCameraCenterRef.current.x, y: lastCameraCenterRef.current.y } : { x: 0, y: 0 },
      prevCameraCenterRef.current,
      visitedWindowsRef.current,
    );
    if (best) {
      const idx = windowsRef.current.indexOf(best);
      if (idx >= 0) {
        visitedWindowsRef.current.add(idx);
        activeWindowIdRef.current = idx;
        prevCameraCenterRef.current = lastCameraCenterRef.current;
        lastCameraCenterRef.current = { x: best.centerX, y: best.centerY };
      }
      focusOnWindow(best, false, true);
      if (onTrack) onTrack('camera_next_cluster', { templateId: template?.id });
    }
  }, [focusOnWindow, focusOverview, onTrack, template]);

  const handleColorSelect = useCallback((colorIndex) => {
    onSelectColor(colorIndex);
  }, [onSelectColor]);

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
            onTapCell={interactionMode === 'reveal' ? onRevealAt : fillMode ? onFillAt : undefined}
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
