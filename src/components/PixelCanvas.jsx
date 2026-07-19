import { useLayoutEffect, useRef, useState, useCallback } from 'react';

export default function PixelCanvas({
  template, filled, selectedColor, onPaint, onWrong, onFirstPaint, onTapCell,
  calmMode = false, hideFilledNumbers = true, hintMode = false,
}) {
  const canvasRef = useRef(null);
  const drawingRef = useRef(false);
  const [wrongCell, setWrongCell] = useState(null);
  const viewport = useRef({ scale: 1, base: 11 });
  const pinchRef = useRef(null);
  const [scaleLabel, setScaleLabel] = useState(1);

  const baseCell = Math.max(11, Math.floor(370 / template.width));
  viewport.current.base = baseCell;

  const applyTransform = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const { scale, base } = viewport.current;
    const size = base * scale;
    const nextWidth = template.width * size;
    const nextHeight = template.height * size;
    canvas.style.width = `${nextWidth}px`;
    canvas.style.height = `${nextHeight}px`;
    canvas.dataset.size = String(size);
  }, [template.width, template.height]);

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const { scale, base } = viewport.current;
    const size = base * scale;
    const nextWidth = template.width * size;
    const nextHeight = template.height * size;
    canvas.width = nextWidth;
    canvas.height = nextHeight;
    const context = canvas.getContext('2d');
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.font = `${Math.max(10, Math.floor(size * 0.42))}px Outfit, sans-serif`;
    const showNumbers = size >= 16;
    template.cells.forEach((targetColor, index) => {
      const x = (index % template.width) * size;
      const y = Math.floor(index / template.width) * size;
      const paint = filled[index];
      const isSelected = paint === -1 && selectedColor === targetColor;
      const isHint = hintMode && paint === -1 && targetColor === selectedColor;
      context.fillStyle = paint === -1 ? (isSelected ? '#24465a' : isHint ? '#2f6f5a' : '#172735') : template.palette[paint];
      context.fillRect(x, y, size, size);
      context.strokeStyle = '#0b131a';
      context.lineWidth = 1;
      context.strokeRect(x, y, size, size);
      if (paint === -1 && showNumbers && !hideFilledNumbers) {
        context.fillStyle = isSelected ? '#ffffff' : isHint ? '#bfffe0' : '#8d9fa5';
        context.fillText(String(targetColor + 1), x + size / 2, y + size / 2 + 1);
      }
      if (wrongCell === index) {
        context.strokeStyle = '#ff4d4d';
        context.lineWidth = 3;
        context.strokeRect(x + 1, y + 1, size - 2, size - 2);
      }
    });
    return undefined;
  }, [filled, selectedColor, template, wrongCell, hintMode, hideFilledNumbers]);

  function cellFromEvent(event) {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const x = Math.floor(((event.clientX - rect.left) / rect.width) * template.width);
    const y = Math.floor(((event.clientY - rect.top) / rect.height) * template.height);
    if (x < 0 || y < 0 || x >= template.width || y >= template.height) return null;
    return y * template.width + x;
  }

  function paintIndex(index) {
    if (index == null || filled[index] !== -1) return;
    if (template.cells[index] !== selectedColor) {
      if (calmMode) return;
      setWrongCell(index);
      onWrong?.();
      window.setTimeout(() => setWrongCell(null), 260);
      return;
    }
    onFirstPaint?.();
    onPaint(index, selectedColor);
  }

  function handlePointerDown(event) {
    if (event.pointerType === 'touch' && event.isPrimary === false) return;
    drawingRef.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
    const index = cellFromEvent(event);
    if (onTapCell && index != null) {
      onTapCell(index);
      return;
    }
    paintIndex(index);
  }

  function handlePointerMove(event) {
    if (!drawingRef.current || onTapCell) return;
    paintIndex(cellFromEvent(event));
  }

  function handlePointerUp() {
    drawingRef.current = false;
  }

  function handleWheel(event) {
    event.preventDefault();
    const next = Math.min(4, Math.max(1, viewport.current.scale * (event.deltaY < 0 ? 1.15 : 0.87)));
    viewport.current.scale = next;
    setScaleLabel(Math.round(next * 100) / 100);
    applyTransform();
  }

  function handleTouchMove(event) {
    if (event.touches.length === 2) {
      event.preventDefault();
      const [a, b] = [event.touches[0], event.touches[1]];
      const dist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      if (!pinchRef.current) {
        pinchRef.current = { dist, scale: viewport.current.scale };
      } else {
        const next = Math.min(4, Math.max(1, pinchRef.current.scale * (dist / pinchRef.current.dist)));
        viewport.current.scale = next;
        setScaleLabel(Math.round(next * 100) / 100);
        applyTransform();
      }
    }
  }

  function handleTouchEnd() {
    pinchRef.current = null;
  }

  function resetView() {
    viewport.current.scale = 1;
    setScaleLabel(1);
    applyTransform();
  }

  useLayoutEffect(() => { applyTransform(); }, [applyTransform]);

  return (
    <div className="pixel-canvas-scroll">
      <div className="canvas-toolbar">
        <button type="button" onClick={() => { viewport.current.scale = Math.min(4, viewport.current.scale + 0.25); setScaleLabel(Math.round(viewport.current.scale * 100) / 100); applyTransform(); }} aria-label="Приблизить">＋</button>
        <button type="button" onClick={() => { viewport.current.scale = Math.max(1, viewport.current.scale - 0.25); setScaleLabel(Math.round(viewport.current.scale * 100) / 100); applyTransform(); }} aria-label="Отдалить">－</button>
        <button type="button" onClick={resetView} aria-label="Сбросить масштаб">{Math.round(scaleLabel * 100)}%</button>
      </div>
      <canvas
        ref={canvasRef}
        className="pixel-canvas"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onWheel={handleWheel}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        aria-label={`Раскраска ${template.title}`}
      />
    </div>
  );
}
