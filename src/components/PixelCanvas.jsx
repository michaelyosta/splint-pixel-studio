import { useLayoutEffect, useRef, useState } from 'react';

export default function PixelCanvas({ template, filled, selectedColor, onPaint, onWrong }) {
  const canvasRef = useRef(null);
  const drawingRef = useRef(false);
  const [wrongCell, setWrongCell] = useState(null);
  const logicalCell = Math.max(11, Math.floor(370 / template.width));

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const size = logicalCell;
    const nextWidth = template.width * size;
    const nextHeight = template.height * size;
    if (canvas.width !== nextWidth) canvas.width = nextWidth;
    if (canvas.height !== nextHeight) canvas.height = nextHeight;
    const context = canvas.getContext('2d');
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.font = `${Math.max(10, Math.floor(size * 0.42))}px Outfit, sans-serif`;
    template.cells.forEach((targetColor, index) => {
      const x = (index % template.width) * size;
      const y = Math.floor(index / template.width) * size;
      const paint = filled[index];
      const isSelected = paint === -1 && selectedColor === targetColor;
      context.fillStyle = paint === -1 ? (isSelected ? '#24465a' : '#172735') : template.palette[paint];
      context.fillRect(x, y, size, size);
      context.strokeStyle = '#0b131a';
      context.lineWidth = 1;
      context.strokeRect(x, y, size, size);
      if (paint === -1) {
        context.fillStyle = isSelected ? '#ffffff' : '#8d9fa5';
        context.fillText(String(targetColor + 1), x + size / 2, y + size / 2 + 1);
      }
      if (wrongCell === index) {
        context.strokeStyle = '#ff4d4d';
        context.lineWidth = 3;
        context.strokeRect(x + 1, y + 1, size - 2, size - 2);
      }
    });
    return undefined;
  }, [filled, logicalCell, selectedColor, template, wrongCell]);

  function paintFromEvent(event) {
    const canvas = canvasRef.current;
    if (!canvas || selectedColor === null) return;
    const rect = canvas.getBoundingClientRect();
    const x = Math.floor(((event.clientX - rect.left) / rect.width) * template.width);
    const y = Math.floor(((event.clientY - rect.top) / rect.height) * template.height);
    if (x < 0 || y < 0 || x >= template.width || y >= template.height) return;
    const index = y * template.width + x;
    if (filled[index] !== -1) return;
    if (template.cells[index] !== selectedColor) {
      setWrongCell(index);
      onWrong?.();
      window.setTimeout(() => setWrongCell(null), 260);
      return;
    }
    onPaint(index, selectedColor);
  }

  return (
    <div className="pixel-canvas-scroll">
      <canvas
        ref={canvasRef}
        className="pixel-canvas"
        onPointerDown={(event) => { drawingRef.current = true; event.currentTarget.setPointerCapture(event.pointerId); paintFromEvent(event); }}
        onPointerMove={(event) => { if (drawingRef.current) paintFromEvent(event); }}
        onPointerUp={() => { drawingRef.current = false; }}
        onPointerCancel={() => { drawingRef.current = false; }}
        aria-label={`Раскраска ${template.title}`}
      />
    </div>
  );
}
