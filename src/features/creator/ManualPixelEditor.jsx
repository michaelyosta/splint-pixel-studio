import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Brush, Eraser, Plus, Redo2, Trash2, Undo2 } from 'lucide-react';
import {
  DEFAULT_MANUAL_PALETTE,
  MANUAL_GRID_SIZES,
  MANUAL_HISTORY_LIMIT,
  buildManualDraft,
  cloneManualDraft,
  createBlankCells,
  getManualGridSize,
  removePaletteColor,
  resizePixelCells,
} from './manualPixelEditorUtils';
import './manualPixelEditor.css';

const DEFAULT_TITLE = 'Моя пиксельная раскраска';

function makePreviewDataUrl({ width, height, palette, cells }) {
  const longestSide = Math.max(width, height);
  // A nearest-neighbour preview stays compact enough for the current
  // /colorings/create payload limit while retaining visible pixel edges.
  const pixelSize = Math.max(4, Math.floor(384 / longestSide));
  const canvas = document.createElement('canvas');
  canvas.width = width * pixelSize;
  canvas.height = height * pixelSize;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Браузер не поддерживает создание превью');

  cells.forEach((colorIndex, index) => {
    context.fillStyle = palette[colorIndex] || palette[0];
    context.fillRect((index % width) * pixelSize, Math.floor(index / width) * pixelSize, pixelSize, pixelSize);
  });
  return canvas.toDataURL('image/png');
}

function nextPaletteColor(palette) {
  return DEFAULT_MANUAL_PALETTE.find((color) => !palette.includes(color)) || '#FFFFFF';
}

/**
 * Standalone pixel-art authoring surface.
 *
 * The parent owns persistence: onCreate receives the same data contract as
 * POST /colorings/create, so this component can be introduced without a new API.
 */
export default function ManualPixelEditor({
  onCreate,
  initialTitle = DEFAULT_TITLE,
  initialWidth = 32,
  initialHeight = initialWidth,
  initialPalette = DEFAULT_MANUAL_PALETTE,
  disabled = false,
}) {
  const titleId = useId();
  const canvasRef = useRef(null);
  const draftRef = useRef(buildManualDraft({ width: initialWidth, height: initialHeight, palette: initialPalette }));
  const strokeRef = useRef(null);
  const [draft, setDraft] = useState(() => draftRef.current);
  const [title, setTitle] = useState(initialTitle);
  const [selectedColor, setSelectedColor] = useState(1);
  const [tool, setTool] = useState('brush');
  const [history, setHistory] = useState([]);
  const [future, setFuture] = useState([]);
  const [cursor, setCursor] = useState({ x: 0, y: 0 });
  const [notice, setNotice] = useState('Выберите цвет и рисуйте по сетке.');
  const [creating, setCreating] = useState(false);

  const applyDraft = useCallback((nextDraft) => {
    draftRef.current = nextDraft;
    setDraft(nextDraft);
  }, []);

  const pushHistory = useCallback((before) => {
    setHistory((current) => [...current, cloneManualDraft(before)].slice(-MANUAL_HISTORY_LIMIT));
    setFuture([]);
  }, []);

  const commitChange = useCallback((transform) => {
    const before = draftRef.current;
    const next = transform(before);
    if (next === before) return false;
    pushHistory(before);
    applyDraft(next);
    return true;
  }, [applyDraft, pushHistory]);

  const paintIndex = useCallback((index) => {
    const current = draftRef.current;
    const colorIndex = tool === 'eraser' ? 0 : selectedColor;
    if (index < 0 || index >= current.cells.length || current.cells[index] === colorIndex) return false;

    const nextCells = [...current.cells];
    nextCells[index] = colorIndex;
    applyDraft({ ...current, cells: nextCells });
    return true;
  }, [applyDraft, selectedColor, tool]);

  const indexFromPointer = useCallback((event) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const { width, height } = draftRef.current;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    const x = Math.min(width - 1, Math.max(0, Math.floor(((event.clientX - rect.left) / rect.width) * width)));
    const y = Math.min(height - 1, Math.max(0, Math.floor(((event.clientY - rect.top) / rect.height) * height)));
    return { x, y, index: y * width + x };
  }, []);

  const finishStroke = useCallback(() => {
    const stroke = strokeRef.current;
    strokeRef.current = null;
    if (!stroke?.changed) return;
    pushHistory(stroke.before);
  }, [pushHistory]);

  const startStroke = useCallback((event) => {
    if (disabled || creating || event.button > 0) return;
    const hit = indexFromPointer(event);
    if (!hit) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    strokeRef.current = { before: cloneManualDraft(draftRef.current), changed: false };
    setCursor({ x: hit.x, y: hit.y });
    strokeRef.current.changed = paintIndex(hit.index);
  }, [creating, disabled, indexFromPointer, paintIndex]);

  const continueStroke = useCallback((event) => {
    if (!strokeRef.current) return;
    const hit = indexFromPointer(event);
    if (!hit) return;
    event.preventDefault();
    setCursor({ x: hit.x, y: hit.y });
    strokeRef.current.changed = paintIndex(hit.index) || strokeRef.current.changed;
  }, [indexFromPointer, paintIndex]);

  const stopStroke = useCallback((event) => {
    if (event?.currentTarget?.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    finishStroke();
  }, [finishStroke]);

  const undo = useCallback(() => {
    const previous = history.at(-1);
    if (!previous || disabled || creating) return;
    const current = cloneManualDraft(draftRef.current);
    setHistory((items) => items.slice(0, -1));
    setFuture((items) => [...items, current].slice(-MANUAL_HISTORY_LIMIT));
    applyDraft(cloneManualDraft(previous));
    setSelectedColor((color) => Math.min(color, previous.palette.length - 1));
    setCursor((position) => ({ x: Math.min(position.x, previous.width - 1), y: Math.min(position.y, previous.height - 1) }));
    setNotice('Последнее действие отменено.');
  }, [applyDraft, creating, disabled, history]);

  const redo = useCallback(() => {
    const next = future.at(-1);
    if (!next || disabled || creating) return;
    const current = cloneManualDraft(draftRef.current);
    setFuture((items) => items.slice(0, -1));
    setHistory((items) => [...items, current].slice(-MANUAL_HISTORY_LIMIT));
    applyDraft(cloneManualDraft(next));
    setSelectedColor((color) => Math.min(color, next.palette.length - 1));
    setCursor((position) => ({ x: Math.min(position.x, next.width - 1), y: Math.min(position.y, next.height - 1) }));
    setNotice('Действие повторено.');
  }, [applyDraft, creating, disabled, future]);

  const setGridSize = useCallback((size) => {
    const target = getManualGridSize(size);
    const changed = commitChange((previous) => {
      if (previous.width === target && previous.height === target) return previous;
      return {
        ...previous,
        width: target,
        height: target,
        cells: resizePixelCells(previous.cells, previous.width, previous.height, target, target),
      };
    });
    if (changed) {
      setCursor((position) => ({ x: Math.min(position.x, target - 1), y: Math.min(position.y, target - 1) }));
      setNotice(`Сетка изменена на ${target} × ${target}; рисунок масштабирован.`);
    }
  }, [commitChange]);

  const updatePaletteColor = useCallback((index, color) => {
    const normalized = String(color || '').toUpperCase();
    if (!/^#[0-9A-F]{6}$/.test(normalized)) return;
    const changed = commitChange((previous) => {
      if (previous.palette[index] === normalized) return previous;
      const palette = [...previous.palette];
      palette[index] = normalized;
      return { ...previous, palette };
    });
    if (changed) setNotice(`Цвет ${index + 1} обновлён.`);
  }, [commitChange]);

  const addPaletteColor = useCallback(() => {
    const changed = commitChange((previous) => {
      if (previous.palette.length >= 32) return previous;
      return { ...previous, palette: [...previous.palette, nextPaletteColor(previous.palette)] };
    });
    if (changed) {
      setSelectedColor(draftRef.current.palette.length - 1);
      setTool('brush');
      setNotice('Новый цвет добавлен в палитру.');
    } else {
      setNotice('В одной раскраске можно использовать не больше 32 цветов.');
    }
  }, [commitChange]);

  const deletePaletteColor = useCallback((index) => {
    const previous = draftRef.current;
    const result = removePaletteColor(previous.cells, previous.palette, index);
    if (!result.removed) {
      setNotice(index === 0 ? 'Фоновый цвет — это ластик, его нельзя удалить.' : 'В палитре должно остаться минимум два цвета.');
      return;
    }
    pushHistory(previous);
    applyDraft({ ...previous, palette: result.palette, cells: result.cells });
    setSelectedColor((color) => Math.max(1, Math.min(color > index ? color - 1 : color, result.palette.length - 1)));
    setNotice(`Цвет ${index + 1} удалён; его клетки стали фоновыми.`);
  }, [applyDraft, pushHistory]);

  const clearCanvas = useCallback(() => {
    if (disabled || creating || !window.confirm('Очистить весь рисунок? Это действие можно будет отменить.')) return;
    const changed = commitChange((previous) => ({ ...previous, cells: createBlankCells(previous.width, previous.height) }));
    if (changed) setNotice('Рисунок очищен. Нажмите «Отменить», если это было случайно.');
  }, [commitChange, creating, disabled]);

  const paintKeyboardCell = useCallback(() => {
    if (disabled || creating) return;
    const current = draftRef.current;
    const index = cursor.y * current.width + cursor.x;
    const desiredColor = tool === 'eraser' ? 0 : selectedColor;
    if (current.cells[index] === desiredColor) return;
    pushHistory(current);
    paintIndex(index);
  }, [creating, cursor, disabled, paintIndex, pushHistory, selectedColor, tool]);

  const handleCanvasKeyDown = useCallback((event) => {
    const current = draftRef.current;
    const move = (x, y) => {
      event.preventDefault();
      setCursor({ x: Math.min(current.width - 1, Math.max(0, x)), y: Math.min(current.height - 1, Math.max(0, y)) });
    };
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      if (event.shiftKey) redo(); else undo();
      return;
    }
    if (event.key === 'ArrowLeft') return move(cursor.x - 1, cursor.y);
    if (event.key === 'ArrowRight') return move(cursor.x + 1, cursor.y);
    if (event.key === 'ArrowUp') return move(cursor.x, cursor.y - 1);
    if (event.key === 'ArrowDown') return move(cursor.x, cursor.y + 1);
    if (event.key === ' ' || event.key === 'Enter') {
      event.preventDefault();
      paintKeyboardCell();
      return;
    }
    if (event.key.toLowerCase() === 'b') { event.preventDefault(); setTool('brush'); }
    if (event.key.toLowerCase() === 'e') { event.preventDefault(); setTool('eraser'); }
  }, [cursor, paintKeyboardCell, redo, undo]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const { width, height, palette, cells } = draft;
    const pixelSize = Math.max(8, Math.floor(768 / Math.max(width, height)));
    canvas.width = width * pixelSize;
    canvas.height = height * pixelSize;
    const context = canvas.getContext('2d');
    if (!context) return;
    context.imageSmoothingEnabled = false;
    cells.forEach((colorIndex, index) => {
      context.fillStyle = palette[colorIndex] || palette[0];
      context.fillRect((index % width) * pixelSize, Math.floor(index / width) * pixelSize, pixelSize, pixelSize);
    });

    context.strokeStyle = width <= 40 ? 'rgba(255,255,255,0.22)' : 'rgba(255,255,255,0.14)';
    context.lineWidth = Math.max(1, Math.floor(pixelSize / 10));
    context.beginPath();
    for (let x = 0; x <= width; x += 1) {
      const point = x * pixelSize;
      context.moveTo(point, 0);
      context.lineTo(point, height * pixelSize);
    }
    for (let y = 0; y <= height; y += 1) {
      const point = y * pixelSize;
      context.moveTo(0, point);
      context.lineTo(width * pixelSize, point);
    }
    context.stroke();

    context.strokeStyle = tool === 'eraser' ? '#F8FAFC' : '#FBBF24';
    context.lineWidth = Math.max(2, Math.floor(pixelSize / 5));
    context.strokeRect(cursor.x * pixelSize + context.lineWidth / 2, cursor.y * pixelSize + context.lineWidth / 2, pixelSize - context.lineWidth, pixelSize - context.lineWidth);
  }, [cursor, draft, tool]);

  const handleCreate = useCallback(async () => {
    const safeTitle = title.trim();
    if (!safeTitle) {
      setNotice('Введите название для раскраски.');
      return;
    }
    if (typeof onCreate !== 'function') {
      setNotice('Подключите onCreate, чтобы сохранить раскраску.');
      return;
    }
    try {
      setCreating(true);
      const current = cloneManualDraft(draftRef.current);
      const previewDataUrl = makePreviewDataUrl(current);
      await onCreate({ title: safeTitle, ...current, previewDataUrl });
      setNotice('Раскраска передана на сохранение.');
    } catch (error) {
      setNotice(error?.message || 'Не удалось сохранить раскраску.');
    } finally {
      setCreating(false);
    }
  }, [onCreate, title]);

  const activeSize = draft.width === draft.height ? draft.width : null;
  const busy = disabled || creating;

  return (
    <section className="manual-pixel-editor" aria-labelledby={titleId}>
      <header className="manual-pixel-editor__header">
        <div>
          <p className="manual-pixel-editor__eyebrow">СВОЯ РАСКРАСКА</p>
          <h2 id={titleId}>Нарисовать самому</h2>
          <p>Создайте картину пиксель за пикселем, затем передайте её в обычный поток сохранения.</p>
        </div>
      </header>

      <label className="manual-pixel-editor__title-field" htmlFor={`${titleId}-input`}>
        Название
        <input
          id={`${titleId}-input`}
          type="text"
          value={title}
          maxLength="80"
          disabled={busy}
          onChange={(event) => setTitle(event.target.value)}
        />
      </label>

      <fieldset className="manual-pixel-editor__sizes" disabled={busy}>
        <legend>Размер сетки</legend>
        <div role="group" aria-label="Размер сетки">
          {MANUAL_GRID_SIZES.map((size) => (
            <button
              key={size}
              type="button"
              className={activeSize === size ? 'is-selected' : ''}
              aria-pressed={activeSize === size}
              onClick={() => setGridSize(size)}
            >
              {size} × {size}
            </button>
          ))}
        </div>
        <small>При смене размера рисунок сохраняется и масштабируется.</small>
      </fieldset>

      <div className="manual-pixel-editor__workspace">
        <div className="manual-pixel-editor__canvas-wrap">
          <canvas
            ref={canvasRef}
            className={`manual-pixel-editor__canvas ${tool === 'eraser' ? 'is-erasing' : ''}`}
            tabIndex="0"
            role="application"
            aria-label={`Пиксельный редактор ${draft.width} на ${draft.height}. Текущая клетка: ${cursor.x + 1}, ${cursor.y + 1}.`}
            aria-describedby={`${titleId}-instructions ${titleId}-status`}
            onPointerDown={startStroke}
            onPointerMove={continueStroke}
            onPointerUp={stopStroke}
            onPointerCancel={stopStroke}
            onKeyDown={handleCanvasKeyDown}
          />
          <p id={`${titleId}-instructions`} className="manual-pixel-editor__instructions">
            Рисуйте пальцем или мышью. Клавиши-стрелки перемещают курсор, Enter или пробел закрашивает клетку, B — кисть, E — ластик.
          </p>
        </div>

        <aside className="manual-pixel-editor__tools" aria-label="Инструменты редактора">
          <div className="manual-pixel-editor__tool-row">
            <button type="button" className={tool === 'brush' ? 'is-active' : ''} aria-pressed={tool === 'brush'} disabled={busy} onClick={() => setTool('brush')}>
              <Brush size={18} aria-hidden="true" /> Кисть
            </button>
            <button type="button" className={tool === 'eraser' ? 'is-active' : ''} aria-pressed={tool === 'eraser'} disabled={busy} onClick={() => setTool('eraser')}>
              <Eraser size={18} aria-hidden="true" /> Ластик
            </button>
          </div>
          <div className="manual-pixel-editor__tool-row">
            <button type="button" aria-label="Отменить последнее действие" disabled={busy || history.length === 0} onClick={undo}>
              <Undo2 size={18} aria-hidden="true" /> Отменить
            </button>
            <button type="button" aria-label="Повторить отменённое действие" disabled={busy || future.length === 0} onClick={redo}>
              <Redo2 size={18} aria-hidden="true" /> Повторить
            </button>
          </div>
          <button type="button" className="manual-pixel-editor__clear" disabled={busy} onClick={clearCanvas}>
            <Trash2 size={18} aria-hidden="true" /> Очистить рисунок
          </button>
        </aside>
      </div>

      <section className="manual-pixel-editor__palette" aria-label="Палитра">
        <div className="manual-pixel-editor__section-heading">
          <div><h3>Палитра</h3><p>Первый цвет — фон и ластик.</p></div>
          <button type="button" className="manual-pixel-editor__add-color" disabled={busy || draft.palette.length >= 32} onClick={addPaletteColor}>
            <Plus size={17} aria-hidden="true" /> Добавить цвет
          </button>
        </div>
        <div className="manual-pixel-editor__swatches">
          {draft.palette.map((color, index) => (
            <div className={`manual-pixel-editor__swatch ${selectedColor === index && tool === 'brush' ? 'is-selected' : ''}`} key={`${color}-${index}`}>
              <button
                type="button"
                aria-label={`Выбрать цвет ${index + 1}: ${color}${index === 0 ? ', фон' : ''}`}
                aria-pressed={selectedColor === index && tool === 'brush'}
                disabled={busy}
                onClick={() => { setSelectedColor(index); setTool('brush'); }}
              >
                <i style={{ backgroundColor: color }} aria-hidden="true" />
                <span>{index + 1}</span>
              </button>
              <label aria-label={`Изменить цвет ${index + 1}`}>
                <input type="color" value={color} disabled={busy} onChange={(event) => updatePaletteColor(index, event.target.value)} />
              </label>
              {index > 0 && <button type="button" className="manual-pixel-editor__remove-color" aria-label={`Удалить цвет ${index + 1}`} disabled={busy || draft.palette.length <= 2} onClick={() => deletePaletteColor(index)}>×</button>}
            </div>
          ))}
        </div>
      </section>

      <p id={`${titleId}-status`} className="manual-pixel-editor__status" role="status" aria-live="polite">{notice}</p>
      <button type="button" className="manual-pixel-editor__create" disabled={busy || typeof onCreate !== 'function'} onClick={handleCreate}>
        {creating ? 'Готовим раскраску…' : 'Создать раскраску'}
      </button>
    </section>
  );
}
