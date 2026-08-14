import { useId, useRef, useCallback, useLayoutEffect, useState, useEffect, useMemo } from 'react';
import { rasterizeStroke } from './engine/strokeRasterizer.js';
import { centroid, distance, computePinchPan, isTapGesture } from './engine/gestureMath.js';
import { DEFAULT_TILE_SIZE, UNFILLED_CELL, selectVisibleTiles, toTypedCellBuffer } from '../../lib/tileGrid.js';
import { createBoundedAnnouncer, moveKeyboardCursor } from '../../lib/accessibility.js';
import { drawSpecialMarker, specialMarkerScreenRadius } from './specialMarker.js';

const BASE_CELL = 32;
const MAX_VIEWPORT_RENDER_SCALE = 2;

function applyCameraTransform(ctx, camera, renderScale) {
  const zoom = camera.zoom || 1;
  ctx.setTransform(renderScale * zoom, 0, 0, renderScale * zoom, renderScale * camera.x, renderScale * camera.y);
}

function drawGrid(ctx, template, targetCells, filled, selectedColor, calmMode, hideFilledNumbers, hintMode, interactionMode, wrongCell, flash, activeWorkCells, activeTargetColor, camera, viewWidth, viewHeight, renderScale, peekColorIndex, keyboardCursor, specialCells) {
  const { width, palette } = template;
  const bitmapW = Math.ceil(viewWidth * renderScale);
  const bitmapH = Math.ceil(viewHeight * renderScale);
  if (ctx.canvas.width !== bitmapW || ctx.canvas.height !== bitmapH) {
    ctx.canvas.width = bitmapW;
    ctx.canvas.height = bitmapH;
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, bitmapW, bitmapH);
  applyCameraTransform(ctx, camera, renderScale);
  const renderedCellSize = BASE_CELL * camera.zoom * renderScale;
  // At overview scale, thousands of tiny labels are pure work: no one can
  // read them, while they still block the main thread.
  const showNumbers = interactionMode !== 'reveal' && !hideFilledNumbers && renderedCellSize >= 12;
  const showGridLines = renderedCellSize >= 3;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `${Math.max(10, Math.floor(BASE_CELL * 0.4))}px Outfit, sans-serif`;
  const flashSet = new Set(flash?.cells || []);
  const flashAlpha = flash?.alpha || 0;
  const activeSet = new Set(activeWorkCells || []);
  const specialMap = new Map((specialCells || [])
    .filter((special) => special.state === 'unseen')
    .map((special) => [Number(special.cell_index), special]));
  const visibleTiles = selectVisibleTiles({
    width: template.width,
    height: template.height,
    tileSize: DEFAULT_TILE_SIZE,
    cellSize: BASE_CELL,
    camera,
    viewportWidth: viewWidth,
    viewportHeight: viewHeight,
    overscanCells: 1,
  });
  for (const tile of visibleTiles.tiles) {
    const { minX: startX, maxX: endX, minY: startY, maxY: endY } = tile.visibleBounds;
    for (let gridY = startY; gridY <= endY; gridY++) {
      for (let gridX = startX; gridX <= endX; gridX++) {
    const i = gridY * width + gridX;
    const x = gridX * BASE_CELL;
    const y = gridY * BASE_CELL;
    const paint = filled[i];
    const target = targetCells[i];
    const isSelected = paint === UNFILLED_CELL && selectedColor === target;
    const isHint = hintMode && paint === UNFILLED_CELL && target === selectedColor;
    const inFlash = flashSet.has(i);
    const isActiveTarget = activeSet.has(i);
    if (paint === UNFILLED_CELL) {
      ctx.fillStyle = interactionMode === 'reveal' ? '#17232d' : isSelected ? '#24465a' : isHint ? '#2f6f5a' : '#172735';
      ctx.fillRect(x, y, BASE_CELL, BASE_CELL);
      if (isSelected) {
        // Selected-color cells get a shape signal as well as a lighter fill,
        // so selection never depends on color perception alone.
        ctx.strokeStyle = 'rgba(255,255,255,0.55)';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(x + 2.5, y + 2.5, BASE_CELL - 5, BASE_CELL - 5);
      }
    } else {
      ctx.fillStyle = palette[paint];
      ctx.fillRect(x, y, BASE_CELL, BASE_CELL);
    }
    if (inFlash && flashAlpha > 0) {
      ctx.fillStyle = `rgba(255,255,255,${flashAlpha})`;
      ctx.fillRect(x, y, BASE_CELL, BASE_CELL);
    }
    // Long-press peek: гасим всё, кроме незакрашенных клеток выбранного цвета.
    if (peekColorIndex != null) {
      if (paint === UNFILLED_CELL && target === peekColorIndex) {
        ctx.strokeStyle = '#7fe7ff';
        ctx.lineWidth = 2;
        ctx.strokeRect(x + 1, y + 1, BASE_CELL - 2, BASE_CELL - 2);
      } else {
        ctx.fillStyle = 'rgba(4, 10, 16, 0.55)';
        ctx.fillRect(x, y, BASE_CELL, BASE_CELL);
      }
    }
    if (showGridLines) {
      ctx.strokeStyle = '#0b131a';
      ctx.lineWidth = 1;
      ctx.strokeRect(x, y, BASE_CELL, BASE_CELL);
    }
    if (isActiveTarget && paint === UNFILLED_CELL) {
      ctx.strokeStyle = activeTargetColor === target ? '#7fe7ff' : '#ffffff';
      ctx.lineWidth = 3;
      ctx.strokeRect(x + 2, y + 2, BASE_CELL - 4, BASE_CELL - 4);
    }
    if (paint === UNFILLED_CELL && showNumbers && interactionMode !== 'reveal') {
      ctx.fillStyle = isSelected ? '#ffffff' : isHint ? '#bfffe0' : '#8d9fa5';
      ctx.fillText(String(target + 1), x + BASE_CELL / 2, y + BASE_CELL / 2 + 1);
    }
    const special = paint === UNFILLED_CELL ? specialMap.get(i) : null;
    if (special) {
      const screenRadius = specialMarkerScreenRadius(BASE_CELL * camera.zoom);
      drawSpecialMarker(ctx, special, x + BASE_CELL / 2, y + BASE_CELL / 2, screenRadius, camera.zoom);
    }
    if (wrongCell === i) {
      ctx.strokeStyle = '#ff4d4d';
      ctx.lineWidth = 3;
      ctx.strokeRect(x + 1, y + 1, BASE_CELL - 2, BASE_CELL - 2);
      ctx.beginPath();
      ctx.moveTo(x + 8, y + 8);
      ctx.lineTo(x + BASE_CELL - 8, y + BASE_CELL - 8);
      ctx.moveTo(x + BASE_CELL - 8, y + 8);
      ctx.lineTo(x + 8, y + BASE_CELL - 8);
      ctx.stroke();
    }
    if (keyboardCursor === i) {
      ctx.strokeStyle = 'rgba(255,255,255,0.95)';
      ctx.lineWidth = 3;
      ctx.strokeRect(x + 1.5, y + 1.5, BASE_CELL - 3, BASE_CELL - 3);
      ctx.strokeStyle = '#7fe7ff';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(x + 4.5, y + 4.5, BASE_CELL - 9, BASE_CELL - 9);
    }
      }
    }
  }
}

function drawStrokePreviewCells(ctx, template, targetCells, indices, camera, renderScale, strokeStyle = 'current') {
  if (!ctx || !indices.length) return;
  applyCameraTransform(ctx, camera, renderScale);
  ctx.save();
  ctx.globalAlpha = strokeStyle === 'soft' ? 0.82 : strokeStyle === 'current' ? 0.72 : 0.94;
  for (const index of indices) {
    const x = (index % template.width) * BASE_CELL;
    const y = Math.floor(index / template.width) * BASE_CELL;
    ctx.fillStyle = template.palette[targetCells[index]];
    if (strokeStyle === 'current') {
      ctx.fillRect(x + 1, y + 1, BASE_CELL - 2, BASE_CELL - 2);
      ctx.strokeStyle = '#7fe7ff';
      ctx.lineWidth = 2;
      ctx.strokeRect(x + 1, y + 1, BASE_CELL - 2, BASE_CELL - 2);
    } else {
      // Full-cell preview joins adjacent pixels into one authored gesture.
      // It performs O(new cells) work only and adds no React state to pointermove.
      ctx.fillRect(x, y, BASE_CELL, BASE_CELL);
      if (strokeStyle === 'luminous') {
        // Keep the expressive option allocation-free in pointermove: two
        // restrained highlights are enough to suggest a luminous material.
        ctx.fillStyle = 'rgba(255,255,255,0.30)';
        ctx.fillRect(x, y, BASE_CELL, 2);
        ctx.fillStyle = 'rgba(255,255,255,0.12)';
        ctx.fillRect(x, y + 2, 2, BASE_CELL - 2);
      } else if (strokeStyle === 'crisp') {
        ctx.fillStyle = 'rgba(255,255,255,0.18)';
        ctx.fillRect(x + 2, y + 2, BASE_CELL - 4, 2);
      } else {
        ctx.fillStyle = 'rgba(255,255,255,0.10)';
        ctx.fillRect(x + 3, y + 3, BASE_CELL - 6, BASE_CELL - 6);
      }
    }
  }
  ctx.restore();
}

export default function ColoringCanvas({
  template,
  filled,
  selectedColor,
  onStrokeComplete,
  onWrongCell,
  onFirstPaint,
  calmMode = false,
  hideFilledNumbers = false,
  hintMode = false,
  interactionMode = 'classic',
  onTapCell,
  viewWidth,
  viewHeight,
  camera,
  setCamera,
  pauseAuto,
  cancelAnimation,
  beginInteraction,
  endInteraction,
  activeWorkCells = [],
  activeTargetColor = null,
  onManualExplore,
  interactionDisabled = false,
  peekColor = null,
  onResetView,
  specialCells = [],
  onVisibleSpecialKinds,
  coreFeelVariant = null,
  revealBeat = null,
}) {
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const strokeRef = useRef(null);
  const lastCellRef = useRef(null);
  const [wrongCell, setWrongCell] = useState(null);
  const [flash, setFlash] = useState({ cells: [], alpha: 0 });
  const [keyboardCell, setKeyboardCell] = useState(null);
  const [liveText, setLiveText] = useState('');
  const [revealPhase, setRevealPhase] = useState(null);
  const keyboardCellRef = useRef(null);
  const instructionsId = useId();
  const liveId = useId();
  const announcerRef = useRef(null);
  if (announcerRef.current === null) {
    announcerRef.current = createBoundedAnnouncer({ onAnnounce: setLiveText });
  }
  const drawingRef = useRef(false);
  const flashTimerRef = useRef(null);
  const flashFadeTimerRef = useRef(null);
  const hasPaintedRef = useRef(false);
  const activePointers = useRef(new Map());
  const transformRef = useRef(null);
  const tapStartRef = useRef(null);
  const deviceScale = typeof window === 'undefined' ? 1 : (window.devicePixelRatio || 1);
  const cellCount = template.width * template.height;
  const isLargeGrid = cellCount >= 4096;
  const renderScale = Math.min(MAX_VIEWPORT_RENDER_SCALE, Math.max(1, deviceScale));
  const targetCells = useMemo(
    () => toTypedCellBuffer(template.cells, { type: 'uint16', length: cellCount, fillValue: 0 }),
    [template.cells, cellCount],
  );
  const filledCells = useMemo(
    () => toTypedCellBuffer(filled, { type: 'int16', length: cellCount, fillValue: UNFILLED_CELL }),
    [filled, cellCount],
  );

  useEffect(() => {
    return () => {
      if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
      if (flashFadeTimerRef.current) clearTimeout(flashFadeTimerRef.current);
      announcerRef.current?.destroy();
    };
  }, []);

  useEffect(() => {
    if (!revealBeat?.id || !coreFeelVariant?.enhanced) {
      setRevealPhase(null);
      return undefined;
    }
    const reduceMotion = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
    setRevealPhase(reduceMotion ? 'resolved' : 'settling');
    if (reduceMotion) return undefined;
    const settleTimer = window.setTimeout(() => setRevealPhase('resolved'), 420);
    const clearTimer = window.setTimeout(() => setRevealPhase(null), 1500);
    return () => {
      window.clearTimeout(settleTimer);
      window.clearTimeout(clearTimer);
    };
  }, [coreFeelVariant, revealBeat?.id, revealBeat?.token]);

  const redraw = useCallback(() => {
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx || !template) return;
    drawGrid(ctx, template, targetCells, filledCells, selectedColor, calmMode, hideFilledNumbers, hintMode, interactionMode,
      wrongCell, flash, activeWorkCells, activeTargetColor, camera, viewWidth, viewHeight, renderScale, peekColor, keyboardCell, specialCells);
  }, [template, targetCells, filledCells, selectedColor, calmMode, hideFilledNumbers, hintMode, interactionMode, wrongCell, flash, activeWorkCells, activeTargetColor, camera, viewWidth, viewHeight, renderScale, peekColor, keyboardCell, specialCells]);

  useLayoutEffect(() => { redraw(); }, [redraw]);

  useEffect(() => {
    if (!onVisibleSpecialKinds) return;
    const tiles = selectVisibleTiles({
      width: template.width,
      height: template.height,
      tileSize: DEFAULT_TILE_SIZE,
      cellSize: BASE_CELL,
      camera,
      viewportWidth: viewWidth,
      viewportHeight: viewHeight,
      overscanCells: 1,
    });
    const kinds = [];
    for (const special of specialCells || []) {
      if (special.state !== 'unseen') continue;
      const index = Number(special.cell_index);
      if (!Number.isInteger(index) || index < 0 || index >= cellCount) continue;
      if (filledCells[index] !== UNFILLED_CELL) continue;
      const x = index % template.width;
      const y = Math.floor(index / template.width);
      const visible = tiles.tiles.some((tile) => (
        x >= tile.visibleBounds.minX && x <= tile.visibleBounds.maxX
        && y >= tile.visibleBounds.minY && y <= tile.visibleBounds.maxY
      ));
      if (visible && special.kind && !kinds.includes(special.kind)) kinds.push(special.kind);
    }
    onVisibleSpecialKinds(kinds);
  }, [camera, cellCount, filledCells, onVisibleSpecialKinds, specialCells, template.height, template.width, viewHeight, viewWidth]);

  function cellFromPoint(clientX, clientY) {
    const container = containerRef.current;
    if (!container) return null;
    const rect = container.getBoundingClientRect();
    const vx = clientX - rect.left;
    const vy = clientY - rect.top;
    const cx = (vx - camera.x) / camera.zoom;
    const cy = (vy - camera.y) / camera.zoom;
    const gx = Math.floor(cx / BASE_CELL);
    const gy = Math.floor(cy / BASE_CELL);
    if (gx < 0 || gx >= template.width || gy < 0 || gy >= template.height) return null;
    return gy * template.width + gx;
  }

  function cellFromEvent(event) {
    return cellFromPoint(event.clientX, event.clientY);
  }

  function cancelStroke() {
    const hadPreview = Boolean(strokeRef.current?.indices.length);
    strokeRef.current = null;
    drawingRef.current = false;
    lastCellRef.current = null;
    if (hadPreview) redraw();
  }

  function commitStroke() {
    const stroke = strokeRef.current;
    if (!stroke || !stroke.indices.length) {
      cancelStroke();
      return;
    }
    const committedIndices = stroke.indices.slice();
    if (!hasPaintedRef.current) {
      hasPaintedRef.current = true;
      onFirstPaint?.();
    }
    onStrokeComplete({
      strokeId: stroke.strokeId,
      color: stroke.color,
      source: 'manual',
      indices: committedIndices,
      startedAt: stroke.startedAt,
      completedAt: Date.now(),
    });
    strokeRef.current = null;
    // On large grids the committed fill itself is the feedback. Avoid three
    // additional full-canvas redraws for a decorative flash.
    if (isLargeGrid) return;
    const settle = coreFeelVariant?.enhanced
      ? coreFeelVariant.strokeStyle === 'crisp'
        ? { alpha: 0.16, fadeAlpha: 0.05, fadeAt: 90, clearAt: 190 }
        : coreFeelVariant.strokeStyle === 'luminous'
          ? { alpha: 0.28, fadeAlpha: 0.08, fadeAt: 150, clearAt: 380 }
          : { alpha: 0.21, fadeAlpha: 0.07, fadeAt: 170, clearAt: 430 }
      : { alpha: 0.3, fadeAlpha: 0.12, fadeAt: 130, clearAt: 300 };
    setFlash({ cells: committedIndices, alpha: settle.alpha });
    if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
    if (flashFadeTimerRef.current) clearTimeout(flashFadeTimerRef.current);
    flashFadeTimerRef.current = setTimeout(() => {
      flashFadeTimerRef.current = null;
      setFlash({ cells: committedIndices, alpha: settle.fadeAlpha });
    }, settle.fadeAt);
    flashTimerRef.current = setTimeout(() => {
      flashTimerRef.current = null;
      setFlash({ cells: [], alpha: 0 });
    }, settle.clearAt);
  }

  function handlePointerDown(event) {
    if (interactionDisabled) return;
    if (event.button !== 0 && event.pointerType !== 'touch') return;
    event.currentTarget.setPointerCapture(event.pointerId);
    activePointers.current.set(event.pointerId, event);

    if (activePointers.current.size === 1) {
      beginInteraction();
      cancelAnimation();

      if (onTapCell) {
        tapStartRef.current = { clientX: event.clientX, clientY: event.clientY };
        return;
      }

      const index = cellFromEvent(event);
      if (index == null) return;
      if (filledCells[index] !== UNFILLED_CELL) return;
      if (interactionMode !== 'reveal' && targetCells[index] !== selectedColor) {
        if (calmMode) return;
        setWrongCell(index);
        if (onWrongCell) onWrongCell();
        setTimeout(() => setWrongCell(null), 260);
        return;
      }

      drawingRef.current = true;
      const now = Date.now();
      strokeRef.current = {
        strokeId: `stroke_${now}_${Math.random().toString(36).slice(2, 6)}`,
        color: interactionMode === 'reveal' ? -1 : selectedColor,
        startedAt: now,
        indices: [index],
        indexSet: new Set([index]),
        lastCell: index,
      };
      lastCellRef.current = index;
      drawStrokePreviewCells(canvasRef.current?.getContext('2d'), template, targetCells, [index], camera, renderScale, coreFeelVariant?.strokeStyle);
    } else if (activePointers.current.size === 2 && !transformRef.current) {
      cancelStroke();
      drawingRef.current = false;
      tapStartRef.current = null;
      pauseAuto();
      onManualExplore?.();
      const ptrs = [...activePointers.current.values()].slice(0, 2);
      transformRef.current = {
        startDistance: distance(ptrs[0], ptrs[1]),
        startCentroid: centroid(ptrs[0], ptrs[1]),
        startCamera: { ...camera },
      };
    }
  }

  function handlePointerMove(event) {
    if (interactionDisabled) return;
    if (!activePointers.current.has(event.pointerId)) return;
    activePointers.current.set(event.pointerId, event);

    if (transformRef.current && activePointers.current.size >= 2) {
      event.preventDefault();
      const ptrs = [...activePointers.current.values()].slice(0, 2);
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const newCamera = computePinchPan({
        a: ptrs[0], b: ptrs[1],
        startDistance: transformRef.current.startDistance,
        startCentroid: transformRef.current.startCentroid,
        startCamera: transformRef.current.startCamera,
        rect,
      });
      cancelAnimation();
      setCamera({ x: newCamera.x, y: newCamera.y, zoom: newCamera.zoom });
      return;
    }

    if (!drawingRef.current || onTapCell) return;
    event.preventDefault();
    const index = cellFromEvent(event);
    if (index == null) return;
    const stroke = strokeRef.current;
    if (!stroke) return;
    if (lastCellRef.current === index) return;
    const cells = rasterizeStroke(lastCellRef.current, index, template.width, template.height);
    if (!cells.length) return;
    lastCellRef.current = index;
    const addedCells = [];
    for (const ci of cells) {
      if (stroke.indexSet.has(ci)) continue;
      if (filledCells[ci] !== UNFILLED_CELL) continue;
      if (interactionMode !== 'reveal' && targetCells[ci] !== stroke.color) continue;
      stroke.indexSet.add(ci);
      stroke.indices.push(ci);
      addedCells.push(ci);
    }
    drawStrokePreviewCells(canvasRef.current?.getContext('2d'), template, targetCells, addedCells, camera, renderScale, coreFeelVariant?.strokeStyle);
  }

  function handlePointerUp(event) {
    if (interactionDisabled) return;
    activePointers.current.delete(event.pointerId);

    if (drawingRef.current && !transformRef.current) {
      drawingRef.current = false;
      commitStroke();
    }

    if (transformRef.current && activePointers.current.size < 2) {
      transformRef.current = null;
    }

    if (tapStartRef.current && onTapCell && !transformRef.current) {
      if (isTapGesture(tapStartRef.current, event)) {
        const index = cellFromPoint(tapStartRef.current.clientX, tapStartRef.current.clientY);
        if (index != null) onTapCell(index);
      }
      tapStartRef.current = null;
    }

    lastCellRef.current = null;

    if (activePointers.current.size === 0) {
      endInteraction();
    }
  }

  function handlePointerCancel(event) {
    if (interactionDisabled) return;
    activePointers.current.delete(event.pointerId);
    cancelStroke();
    drawingRef.current = false;
    transformRef.current = null;
    tapStartRef.current = null;
    lastCellRef.current = null;
    if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
    flashTimerRef.current = null;
    if (flashFadeTimerRef.current) clearTimeout(flashFadeTimerRef.current);
    flashFadeTimerRef.current = null;
    if (activePointers.current.size === 0) {
      endInteraction();
    }
  }

  function handleWheel(event) {
    if (interactionDisabled) return;
    event.preventDefault();
    cancelAnimation();
    pauseAuto();
    onManualExplore?.();
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const mx = event.clientX - rect.left;
    const my = event.clientY - rect.top;
    const factor = event.deltaY < 0 ? 1.1 : 0.91;
    const newZoom = Math.min(4, Math.max(0.25, camera.zoom * factor));
    setCamera({
      x: mx - (mx - camera.x) * (newZoom / camera.zoom),
      y: my - (my - camera.y) * (newZoom / camera.zoom),
      zoom: newZoom,
    });
  }

  function paintKeyboardCell() {
    const index = keyboardCellRef.current;
    if (index == null || index < 0 || index >= cellCount) return;
    if (onTapCell) {
      onTapCell(index);
      return;
    }
    if (filledCells[index] !== UNFILLED_CELL) return;
    if (interactionMode !== 'reveal' && targetCells[index] !== selectedColor) {
      setWrongCell(index);
      onWrongCell?.();
      announcerRef.current?.announce('Неправильный цвет для этой клетки');
      window.setTimeout(() => setWrongCell(null), 260);
      return;
    }
    if (!hasPaintedRef.current) {
      hasPaintedRef.current = true;
      onFirstPaint?.();
    }
    const now = Date.now();
    onStrokeComplete({
      strokeId: `keyboard_${now}_${Math.random().toString(36).slice(2, 6)}`,
      color: interactionMode === 'reveal' ? -1 : selectedColor,
      source: 'keyboard',
      indices: [index],
      startedAt: now,
      completedAt: Date.now(),
    });
    announcerRef.current?.announce('Закрашена клетка');
  }

  function panBy(deltaX, deltaY) {
    cancelAnimation();
    pauseAuto();
    onManualExplore?.();
    setCamera({ x: camera.x + deltaX, y: camera.y + deltaY, zoom: camera.zoom });
  }

  function zoomBy(factor) {
    if (interactionDisabled) return;
    cancelAnimation();
    pauseAuto();
    onManualExplore?.();
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const mx = rect.width / 2;
    const my = rect.height / 2;
    const nextZoom = Math.min(4, Math.max(0.25, camera.zoom * factor));
    setCamera({
      x: mx - (mx - camera.x) * (nextZoom / camera.zoom),
      y: my - (my - camera.y) * (nextZoom / camera.zoom),
      zoom: nextZoom,
    });
  }

  function handleCanvasFocus() {
    if (keyboardCellRef.current == null) {
      const firstActive = activeWorkCells?.[0];
      const center = Math.floor(template.height / 2) * template.width + Math.floor(template.width / 2);
      const initial = firstActive != null ? firstActive : center;
      keyboardCellRef.current = initial;
      setKeyboardCell(initial);
    }
    announcerRef.current?.announce(
      `Поле раскраски ${template.width} на ${template.height}. Стрелки перемещают курсор, Enter закрашивает, плюс и минус меняют масштаб, 0 показывает обзор.`,
    );
  }

  function handleCanvasKeyDown(event) {
    const key = event.key;
    if (interactionDisabled) {
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' ', 'Enter', '+', '-', '='].includes(key)) {
        event.preventDefault();
      }
      return;
    }
    if (key === 'ArrowUp' || key === 'ArrowDown' || key === 'ArrowLeft' || key === 'ArrowRight') {
      event.preventDefault();
      if (event.shiftKey) {
        const delta = 96;
        const x = key === 'ArrowLeft' ? -delta : key === 'ArrowRight' ? delta : 0;
        const y = key === 'ArrowUp' ? -delta : key === 'ArrowDown' ? delta : 0;
        panBy(x, y);
        return;
      }
      const next = moveKeyboardCursor(keyboardCellRef.current ?? 0, key, {
        width: template.width,
        height: template.height,
      });
      keyboardCellRef.current = next;
      setKeyboardCell(next);
      return;
    }
    if (key === 'Home' || key === 'End' || key === 'PageUp' || key === 'PageDown') {
      event.preventDefault();
      const next = moveKeyboardCursor(keyboardCellRef.current ?? 0, key, {
        width: template.width,
        height: template.height,
      });
      keyboardCellRef.current = next;
      setKeyboardCell(next);
      return;
    }
    if (key === 'Enter' || key === ' ') {
      event.preventDefault();
      paintKeyboardCell();
      return;
    }
    if (key === '+' || key === '=') {
      event.preventDefault();
      zoomBy(1.2);
      return;
    }
    if (key === '-' || key === '_') {
      event.preventDefault();
      zoomBy(0.83);
      return;
    }
    if (key === '0') {
      event.preventDefault();
      onResetView?.();
    }
  }

  return (
    <div
      className="coloring-canvas-viewport"
      ref={containerRef}
      data-camera-x={camera.x}
      data-camera-y={camera.y}
      data-camera-zoom={camera.zoom}
      data-interaction-disabled={interactionDisabled ? 'true' : 'false'}
      onWheel={handleWheel}
      style={{ width: viewWidth, height: viewHeight, overflow: 'hidden', position: 'relative', background: '#081218' }}
    >
      <canvas
          ref={canvasRef}
          className="coloring-canvas"
          data-active-work-cells={activeWorkCells.join(',')}
          data-active-target-color={activeTargetColor ?? ''}
          data-keyboard-cell={keyboardCell == null ? '' : keyboardCell}
          data-template-width={template?.width}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerCancel}
          onFocus={handleCanvasFocus}
          onKeyDown={handleCanvasKeyDown}
          role="application"
          aria-roledescription="поле раскраски"
          aria-label={`Поле раскраски «${template?.title}», ${template?.width} на ${template?.height}`}
          aria-describedby={instructionsId}
          aria-keyshortcuts="ArrowLeft ArrowRight ArrowUp ArrowDown Enter Space + - 0"
          tabIndex={interactionDisabled ? -1 : 0}
          style={{
            display: 'block',
            width: viewWidth,
            height: viewHeight,
            imageRendering: 'pixelated',
          }}
      />
      <span id={instructionsId} className="sr-only">
        Стрелки перемещают курсор, Enter или пробел закрашивают клетку, плюс и минус меняют масштаб, 0 показывает обзор.
      </span>
      {revealPhase && revealBeat?.bounds && (
        <div
          className={`core-feel-reveal-mark core-feel-reveal-mark--${coreFeelVariant.revealStyle} is-${revealPhase}`}
          data-core-feel-reveal={revealBeat.id}
          aria-hidden="true"
          style={{
            left: camera.x + revealBeat.bounds.minX * BASE_CELL * camera.zoom,
            top: camera.y + revealBeat.bounds.minY * BASE_CELL * camera.zoom,
            width: revealBeat.bounds.width * BASE_CELL * camera.zoom,
            height: revealBeat.bounds.height * BASE_CELL * camera.zoom,
            '--reveal-color': revealBeat.color || '#7fe7ff',
          }}
        />
      )}
      <span id={liveId} role="status" aria-live="polite" className="sr-only">{liveText}</span>
    </div>
  );
}
