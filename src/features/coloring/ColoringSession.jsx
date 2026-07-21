import { useState, useCallback, useRef, useMemo, useEffect } from 'react';
import ColoringCanvas from './ColoringCanvas.jsx';
import ColoringPalette from './ColoringPalette.jsx';
import ColoringHud from './ColoringHud.jsx';
import { useSmartCamera } from './camera/useSmartCamera.js';
import { findClusters, mergeClusters } from './engine/clusterGraph.js';
import { createWorkingWindows, selectNextWindow } from './engine/workingWindows.js';
import { applyStroke, createStrokeOperation } from './engine/paintReducer.js';
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
  const prevFilledRef = useRef(progress?.filled);

  const {
    camera, setCamera, isAutoActive,
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

  /* External progress.filled sync — cancel animation, reset local state */
  useEffect(() => {
    const newFilled = progress?.filled;
    if (!newFilled) return;
    if (newFilled !== prevFilledRef.current) {
      prevFilledRef.current = newFilled;
      cancelAnimation();
      filledRef.current = newFilled;
      setLocalFilled(newFilled);
      visitedWindowsRef.current = new Set();
      activeWindowIdRef.current = -1;
      lastCameraCenterRef.current = null;
      prevCameraCenterRef.current = null;
      isFirstFocusRef.current = true;
    }
  }, [progress?.filled, cancelAnimation]);

  const workingWindows = useMemo(() => {
    if (!template || !localFilled.length) return [];
    const clusters = findClusters(template, localFilled, selectedColor);
    const merged = mergeClusters(clusters, template.width);
    if (!merged.length) return [];
    const allWindows = [];
    for (const cluster of merged) {
      const wins = createWorkingWindows(cluster, template, containerSize.width || 400, containerSize.height || 400);
      allWindows.push(...wins);
    }
    return allWindows;
  }, [template, localFilled, selectedColor, containerSize]);

  /* Sync windowsRef — do NOT reset visited unless windows actually changed */
  const prevWindowsKeyRef = useRef('');
  useEffect(() => {
    const key = workingWindows.map(w => `${w.bounds.minX},${w.bounds.minY},${w.cellCount}`).join('|');
    if (key === prevWindowsKeyRef.current) return;
    prevWindowsKeyRef.current = key;
    windowsRef.current = workingWindows;
    visitedWindowsRef.current = new Set();
    activeWindowIdRef.current = -1;
    isFirstFocusRef.current = true;
  }, [workingWindows]);

  /* Auto-focus first window on initial load or color change */
  useEffect(() => {
    if (!workingWindows.length || !isAutoActive || !isFirstFocusRef.current) return;
    if (containerSize.width === 0) return;
    isFirstFocusRef.current = false;
    const timer = setTimeout(() => {
      if (windowsRef.current.length) {
        focusOnWindow(windowsRef.current[0], true);
        visitedWindowsRef.current.add(0);
        activeWindowIdRef.current = 0;
        prevCameraCenterRef.current = null;
        lastCameraCenterRef.current = { x: windowsRef.current[0].centerX, y: windowsRef.current[0].centerY };
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [workingWindows, isAutoActive, focusOnWindow, containerSize]);

  /* Check if active window is complete after localFilled changes */
  function isWindowComplete(windowId, filled) {
    const win = windowsRef.current[windowId];
    if (!win) return false;
    return win.cells.every(idx => filled[idx] !== -1);
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
      const remaining = wins.filter((_, i) => !visitedWindowsRef.current.has(i) && i !== activeIdx);
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
          focusOnWindow(best, false);
        }
      }
    }, 300);
    return () => { if (pendingAutoRef.current) clearTimeout(pendingAutoRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localFilled]);

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
      focusOnWindow(best, false);
      if (onTrack) onTrack('camera_next_cluster', { templateId: template?.id });
    }
  }, [focusOnWindow, focusOverview, onTrack, template]);

  const handleColorSelect = useCallback((colorIndex) => {
    onSelectColor(colorIndex);
    visitedWindowsRef.current = new Set();
    activeWindowIdRef.current = -1;
    lastCameraCenterRef.current = null;
    prevCameraCenterRef.current = null;
    isFirstFocusRef.current = true;
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
          isAuto={isAutoActive}
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
