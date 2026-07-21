import { useRef, useCallback, useLayoutEffect, useState } from 'react';
import { rasterizeStroke } from './engine/strokeRasterizer.js';

const BASE_CELL = 32;

function drawGrid(ctx, template, filled, selectedColor, calmMode, hideFilledNumbers, hintMode, interactionMode, strokeCells, strokeColor, wrongCell) {
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
  for (let i = 0; i < cells.length; i++) {
    const x = (i % width) * BASE_CELL;
    const y = Math.floor(i / width) * BASE_CELL;
    const paint = filled[i];
    const target = cells[i];
    const isSelected = paint === -1 && selectedColor === target;
    const isHint = hintMode && paint === -1 && target === selectedColor;
    const inStroke = strokeSet.has(i);
    if (inStroke) {
      ctx.fillStyle = palette[strokeColor != null ? strokeColor : target];
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
  const drawingRef = useRef(false);
  const pinchRef = useRef(null);
  const twoFingerRef = useRef(false);
  const hasPaintedRef = useRef(false);

  const redraw = useCallback(() => {
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx || !template) return;
    drawGrid(ctx, template, filled, selectedColor, calmMode, hideFilledNumbers, hintMode, interactionMode,
      strokePreview, strokeRef.current?.color, wrongCell);
  }, [template, filled, selectedColor, calmMode, hideFilledNumbers, hintMode, interactionMode, strokePreview, wrongCell]);

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
    onStrokeComplete({
      strokeId: stroke.strokeId,
      color: stroke.color,
      source: 'manual',
      indices: stroke.indices,
      startedAt: stroke.startedAt,
      completedAt: Date.now(),
    });
    strokeRef.current = null;
    setStrokePreview([]);
  }

  function handlePointerDown(event) {
    if (event.pointerType === 'touch' && !event.isPrimary) return;
    twoFingerRef.current = false;
    beginInteraction();
    cancelAnimation();
    const index = cellFromEvent(event);
    if (onTapCell && index != null) {
      lastCellRef.current = index;
      onTapCell(index);
      return;
    }
    if (index == null || filled[index] !== -1) {
      if (index != null && template.cells[index] !== selectedColor) {
        if (calmMode) return;
        setWrongCell(index);
        if (onWrongCell) onWrongCell();
        setTimeout(() => setWrongCell(null), 260);
      }
      return;
    }
    if (template.cells[index] !== selectedColor) {
      if (calmMode) return;
      setWrongCell(index);
      if (onWrongCell) onWrongCell();
      setTimeout(() => setWrongCell(null), 260);
      return;
    }
    drawingRef.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
    if (!hasPaintedRef.current) {
      hasPaintedRef.current = true;
      if (onFirstPaint) onFirstPaint();
    }
    const now = Date.now();
    strokeRef.current = {
      strokeId: `stroke_${now}_${Math.random().toString(36).slice(2, 6)}`,
      color: selectedColor,
      startedAt: now,
      indices: [index],
      indexSet: new Set([index]),
      lastCell: index,
      hadWrongCrossing: false,
    };
    lastCellRef.current = index;
    setStrokePreview([index]);
  }

  function handlePointerMove(event) {
    if (!drawingRef.current) {
      if (event.buttons === 0) drawingRef.current = false;
      return;
    }
    if (onTapCell) return;
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
      if (template.cells[ci] !== stroke.color) continue;
      stroke.indexSet.add(ci);
      stroke.indices.push(ci);
      added = true;
    }
    if (added) {
      setStrokePreview([...stroke.indices]);
    }
  }

  function handlePointerUp() {
    if (drawingRef.current) {
      drawingRef.current = false;
      commitStroke();
    }
    lastCellRef.current = null;
    twoFingerRef.current = false;
    endInteraction();
  }

  function handlePointerCancel() {
    cancelStroke();
    twoFingerRef.current = false;
    endInteraction();
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

  function handleTouchStart(event) {
    if (event.touches.length === 2) {
      event.preventDefault();
      commitStroke();
      cancelAnimation();
      const [a, b] = [event.touches[0], event.touches[1]];
      const dist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      const cx = (a.clientX + b.clientX) / 2;
      const cy = (a.clientY + b.clientY) / 2;
      pinchRef.current = { dist, cx, cy, scale: camera.zoom, startX: camera.x, startY: camera.y };
      twoFingerRef.current = true;
      drawingRef.current = false;
      pauseAuto();
    }
  }

  function handleTouchMove(event) {
    if (event.touches.length === 2 && pinchRef.current) {
      event.preventDefault();
      cancelAnimation();
      const [a, b] = [event.touches[0], event.touches[1]];
      const dist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      const cx = (a.clientX + b.clientX) / 2;
      const cy = (a.clientY + b.clientY) / 2;
      const scale = pinchRef.current.scale * (dist / pinchRef.current.dist);
      const newZoom = Math.min(4, Math.max(0.25, scale));
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const rx = cx - rect.left;
      const ry = cy - rect.top;
      setCamera({
        x: rx - (rx - pinchRef.current.startX) * (newZoom / pinchRef.current.scale),
        y: ry - (ry - pinchRef.current.startY) * (newZoom / pinchRef.current.scale),
        zoom: newZoom,
      });
      return;
    }
    if (event.touches.length === 1 && pinchRef.current && !drawingRef.current) {
      cancelAnimation();
      const t = event.touches[0];
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const dx = (t.clientX - pinchRef.current.cx) / camera.zoom;
      const dy = (t.clientY - pinchRef.current.cy) / camera.zoom;
      pinchRef.current.cx = t.clientX;
      pinchRef.current.cy = t.clientY;
      pinchRef.current.startX += dx;
      pinchRef.current.startY += dy;
      setCamera({ x: pinchRef.current.startX, y: pinchRef.current.startY, zoom: camera.zoom });
    }
  }

  function handleTouchEnd(event) {
    const wasTwoFinger = twoFingerRef.current;
    if (event.touches.length < 2) {
      if (wasTwoFinger) {
        pinchRef.current = null;
        twoFingerRef.current = false;
      }
    }
    if (event.touches.length === 0 && !wasTwoFinger) {
      handlePointerUp();
    }
    twoFingerRef.current = false;
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
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          aria-label={`Раскраска ${template?.title}`}
          style={{ display: 'block', imageRendering: 'pixelated' }}
        />
      </div>
    </div>
  );
}
