import { useRef, useCallback, useLayoutEffect, useState, useEffect } from 'react';
import { rasterizeStroke } from './engine/strokeRasterizer.js';
import { centroid, distance, computePinchPan, isTapGesture } from './engine/gestureMath.js';

const BASE_CELL = 32;
const MAX_VIEWPORT_RENDER_SCALE = 2;

function visibleCellBounds(template, camera, viewWidth, viewHeight) {
  const zoom = Math.max(0.001, camera.zoom || 1);
  return {
    startX: Math.max(0, Math.floor((-camera.x / zoom) / BASE_CELL) - 1),
    endX: Math.min(template.width - 1, Math.ceil(((viewWidth - camera.x) / zoom) / BASE_CELL) + 1),
    startY: Math.max(0, Math.floor((-camera.y / zoom) / BASE_CELL) - 1),
    endY: Math.min(template.height - 1, Math.ceil(((viewHeight - camera.y) / zoom) / BASE_CELL) + 1),
  };
}

function applyCameraTransform(ctx, camera, renderScale) {
  const zoom = camera.zoom || 1;
  ctx.setTransform(renderScale * zoom, 0, 0, renderScale * zoom, renderScale * camera.x, renderScale * camera.y);
}

function drawGrid(ctx, template, filled, selectedColor, calmMode, hideFilledNumbers, hintMode, interactionMode, wrongCell, flash, activeWorkCells, activeTargetColor, camera, viewWidth, viewHeight, renderScale, peekColorIndex) {
  const { width, cells, palette } = template;
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
  const { startX, endX, startY, endY } = visibleCellBounds(template, camera, viewWidth, viewHeight);
  for (let gridY = startY; gridY <= endY; gridY++) {
    for (let gridX = startX; gridX <= endX; gridX++) {
    const i = gridY * width + gridX;
    const x = gridX * BASE_CELL;
    const y = gridY * BASE_CELL;
    const paint = filled[i];
    const target = cells[i];
    const isSelected = paint === -1 && selectedColor === target;
    const isHint = hintMode && paint === -1 && target === selectedColor;
    const inFlash = flashSet.has(i);
    const isActiveTarget = activeSet.has(i);
    if (paint === -1) {
      ctx.fillStyle = interactionMode === 'reveal' ? '#17232d' : isSelected ? '#24465a' : isHint ? '#2f6f5a' : '#172735';
      ctx.fillRect(x, y, BASE_CELL, BASE_CELL);
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
      if (paint === -1 && target === peekColorIndex) {
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
    if (isActiveTarget && paint === -1) {
      ctx.strokeStyle = activeTargetColor === target ? '#7fe7ff' : '#ffffff';
      ctx.lineWidth = 3;
      ctx.strokeRect(x + 2, y + 2, BASE_CELL - 4, BASE_CELL - 4);
    }
    if (paint === -1 && showNumbers && interactionMode !== 'reveal') {
      ctx.fillStyle = isSelected ? '#ffffff' : isHint ? '#bfffe0' : '#8d9fa5';
      ctx.fillText(String(target + 1), x + BASE_CELL / 2, y + BASE_CELL / 2 + 1);
    }
    if (wrongCell === i) {
      ctx.strokeStyle = '#ff4d4d';
      ctx.lineWidth = 3;
      ctx.strokeRect(x + 1, y + 1, BASE_CELL - 2, BASE_CELL - 2);
    }
    }
  }
}

function drawStrokePreviewCells(ctx, template, indices, camera, renderScale) {
  if (!ctx || !indices.length) return;
  applyCameraTransform(ctx, camera, renderScale);
  ctx.save();
  ctx.globalAlpha = 0.72;
  for (const index of indices) {
    const x = (index % template.width) * BASE_CELL;
    const y = Math.floor(index / template.width) * BASE_CELL;
    ctx.fillStyle = template.palette[template.cells[index]];
    ctx.fillRect(x + 1, y + 1, BASE_CELL - 2, BASE_CELL - 2);
    ctx.strokeStyle = '#7fe7ff';
    ctx.lineWidth = 2;
    ctx.strokeRect(x + 1, y + 1, BASE_CELL - 2, BASE_CELL - 2);
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
}) {
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const strokeRef = useRef(null);
  const lastCellRef = useRef(null);
  const [wrongCell, setWrongCell] = useState(null);
  const [flash, setFlash] = useState({ cells: [], alpha: 0 });
  const drawingRef = useRef(false);
  const flashTimerRef = useRef(null);
  const flashFadeTimerRef = useRef(null);
  const hasPaintedRef = useRef(false);
  const activePointers = useRef(new Map());
  const transformRef = useRef(null);
  const tapStartRef = useRef(null);
  const deviceScale = typeof window === 'undefined' ? 1 : (window.devicePixelRatio || 1);
  const isLargeGrid = template.width * template.height >= 4096;
  const renderScale = Math.min(MAX_VIEWPORT_RENDER_SCALE, Math.max(1, deviceScale));

  useEffect(() => {
    return () => {
      if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
      if (flashFadeTimerRef.current) clearTimeout(flashFadeTimerRef.current);
    };
  }, []);

  const redraw = useCallback(() => {
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx || !template) return;
    drawGrid(ctx, template, filled, selectedColor, calmMode, hideFilledNumbers, hintMode, interactionMode,
      wrongCell, flash, activeWorkCells, activeTargetColor, camera, viewWidth, viewHeight, renderScale, peekColor);
  }, [template, filled, selectedColor, calmMode, hideFilledNumbers, hintMode, interactionMode, wrongCell, flash, activeWorkCells, activeTargetColor, camera, viewWidth, viewHeight, renderScale, peekColor]);

  useLayoutEffect(() => { redraw(); }, [redraw]);

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
    setFlash({ cells: committedIndices, alpha: 0.3 });
    if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
    if (flashFadeTimerRef.current) clearTimeout(flashFadeTimerRef.current);
    flashFadeTimerRef.current = setTimeout(() => {
      flashFadeTimerRef.current = null;
      setFlash({ cells: committedIndices, alpha: 0.12 });
    }, 130);
    flashTimerRef.current = setTimeout(() => {
      flashTimerRef.current = null;
      setFlash({ cells: [], alpha: 0 });
    }, 300);
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
      if (filled[index] !== -1) return;
      if (interactionMode !== 'reveal' && template.cells[index] !== selectedColor) {
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
      drawStrokePreviewCells(canvasRef.current?.getContext('2d'), template, [index], camera, renderScale);
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
      if (filled[ci] !== -1) continue;
      if (interactionMode !== 'reveal' && template.cells[ci] !== stroke.color) continue;
      stroke.indexSet.add(ci);
      stroke.indices.push(ci);
      addedCells.push(ci);
    }
    drawStrokePreviewCells(canvasRef.current?.getContext('2d'), template, addedCells, camera, renderScale);
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
          data-template-width={template?.width}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerCancel}
          aria-label={`Раскраска ${template?.title}`}
          style={{
            display: 'block',
            width: viewWidth,
            height: viewHeight,
            imageRendering: 'pixelated',
            touchAction: 'none',
          }}
      />
    </div>
  );
}
