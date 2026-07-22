import { useRef, useCallback, useLayoutEffect, useState, useEffect } from 'react';
import { rasterizeStroke } from './engine/strokeRasterizer.js';
import { centroid, distance, computePinchPan, isTapGesture } from './engine/gestureMath.js';

const BASE_CELL = 32;

function drawGrid(ctx, template, filled, selectedColor, calmMode, hideFilledNumbers, hintMode, interactionMode, strokeCells, wrongCell, flashCells) {
  const { width, height, cells, palette } = template;
  const canvasW = width * BASE_CELL;
  const canvasH = height * BASE_CELL;
  if (ctx.canvas.width !== canvasW || ctx.canvas.height !== canvasH) {
    ctx.canvas.width = canvasW;
    ctx.canvas.height = canvasH;
  }
  ctx.clearRect(0, 0, canvasW, canvasH);
  const showNumbers = interactionMode !== 'reveal' && !hideFilledNumbers && BASE_CELL >= 14;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `${Math.max(10, Math.floor(BASE_CELL * 0.4))}px Outfit, sans-serif`;
  const strokeSet = new Set(strokeCells || []);
  const flashSet = new Set(flashCells || []);
  for (let i = 0; i < cells.length; i++) {
    const x = (i % width) * BASE_CELL;
    const y = Math.floor(i / width) * BASE_CELL;
    const paint = filled[i];
    const target = cells[i];
    const isSelected = paint === -1 && selectedColor === target;
    const isHint = hintMode && paint === -1 && target === selectedColor;
    const inStroke = strokeSet.has(i);
    const inFlash = flashSet.has(i);
    if (inStroke) {
      ctx.fillStyle = palette[target];
      ctx.globalAlpha = 0.55;
      ctx.fillRect(x, y, BASE_CELL, BASE_CELL);
      ctx.globalAlpha = 1;
    } else if (paint === -1) {
      ctx.fillStyle = interactionMode === 'reveal' ? '#17232d' : isSelected ? '#24465a' : isHint ? '#2f6f5a' : '#172735';
      ctx.fillRect(x, y, BASE_CELL, BASE_CELL);
    } else {
      ctx.fillStyle = palette[paint];
      ctx.fillRect(x, y, BASE_CELL, BASE_CELL);
    }
    if (inFlash) {
      ctx.fillStyle = 'rgba(255,255,255,0.25)';
      ctx.fillRect(x, y, BASE_CELL, BASE_CELL);
    }
    ctx.strokeStyle = '#0b131a';
    ctx.lineWidth = 1;
    ctx.strokeRect(x, y, BASE_CELL, BASE_CELL);
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
}) {
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const strokeRef = useRef(null);
  const lastCellRef = useRef(null);
  const [wrongCell, setWrongCell] = useState(null);
  const [strokePreview, setStrokePreview] = useState([]);
  const [flashCells, setFlashCells] = useState([]);
  const drawingRef = useRef(false);
  const flashTimerRef = useRef(null);
  const hasPaintedRef = useRef(false);
  const activePointers = useRef(new Map());
  const transformRef = useRef(null);
  const tapStartRef = useRef(null);

  useEffect(() => {
    return () => { if (flashTimerRef.current) clearTimeout(flashTimerRef.current); };
  }, []);

  const redraw = useCallback(() => {
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx || !template) return;
    drawGrid(ctx, template, filled, selectedColor, calmMode, hideFilledNumbers, hintMode, interactionMode,
      strokePreview, wrongCell, flashCells);
  }, [template, filled, selectedColor, calmMode, hideFilledNumbers, hintMode, interactionMode, strokePreview, wrongCell, flashCells]);

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
    strokeRef.current = null;
    setStrokePreview([]);
    drawingRef.current = false;
    lastCellRef.current = null;
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
    setStrokePreview([]);
    setFlashCells(committedIndices);
    if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
    flashTimerRef.current = setTimeout(() => {
      flashTimerRef.current = null;
      setFlashCells([]);
    }, 300);
  }

  function handlePointerDown(event) {
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
      setStrokePreview([index]);
    } else if (activePointers.current.size === 2 && !transformRef.current) {
      cancelStroke();
      drawingRef.current = false;
      tapStartRef.current = null;
      pauseAuto();
      const ptrs = [...activePointers.current.values()].slice(0, 2);
      transformRef.current = {
        startDistance: distance(ptrs[0], ptrs[1]),
        startCentroid: centroid(ptrs[0], ptrs[1]),
        startCamera: { ...camera },
      };
    }
  }

  function handlePointerMove(event) {
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
    let added = false;
    for (const ci of cells) {
      if (stroke.indexSet.has(ci)) continue;
      if (filled[ci] !== -1) continue;
      if (interactionMode !== 'reveal' && template.cells[ci] !== stroke.color) continue;
      stroke.indexSet.add(ci);
      stroke.indices.push(ci);
      added = true;
    }
    if (added) {
      setStrokePreview([...stroke.indices]);
    }
  }

  function handlePointerUp(event) {
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
    activePointers.current.delete(event.pointerId);
    cancelStroke();
    drawingRef.current = false;
    transformRef.current = null;
    tapStartRef.current = null;
    lastCellRef.current = null;
    if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
    flashTimerRef.current = null;
    if (activePointers.current.size === 0) {
      endInteraction();
    }
  }

  function handleWheel(event) {
    event.preventDefault();
    cancelAnimation();
    pauseAuto();
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

  const camStyle = {
    transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.zoom})`,
    transformOrigin: '0 0',
  };

  return (
    <div className="coloring-canvas-viewport" ref={containerRef} style={{ width: viewWidth, height: viewHeight, overflow: 'hidden', position: 'relative', background: '#081218' }}>
      <div className="coloring-canvas-layer" style={camStyle}>
        <canvas
          ref={canvasRef}
          className="coloring-canvas"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerCancel}
          onWheel={handleWheel}
          aria-label={`Раскраска ${template?.title}`}
          style={{ display: 'block', imageRendering: 'pixelated', touchAction: 'none' }}
        />
      </div>
    </div>
  );
}
