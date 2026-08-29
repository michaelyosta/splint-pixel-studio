import { useMemo, useRef } from 'react';
import { formatPaletteState } from '../../lib/accessibility.js';

const LONG_PRESS_MS = 450;

export default function ColoringPalette({ template, filled, selectedColor, onSelectColor, disabled, onPeekColor }) {
  const pressTimerRef = useRef(null);
  const peekingRef = useRef(false);
  const suppressClickRef = useRef(false);

  const colorInfo = useMemo(() => {
    if (!template) return [];
    return template.palette.map((color, index) => {
      const remaining = template.cells.reduce((count, target, ci) =>
        count + (target === index && filled[ci] === -1 ? 1 : 0), 0);
      return { color, index, remaining, completed: remaining === 0 };
    });
  }, [template, filled]);

  function cancelPress() {
    if (pressTimerRef.current) {
      clearTimeout(pressTimerRef.current);
      pressTimerRef.current = null;
    }
    if (peekingRef.current) {
      peekingRef.current = false;
      suppressClickRef.current = true;
      onPeekColor?.(null);
    }
  }

  function handlePressStart(index) {
    if (disabled || !onPeekColor) return;
    if (pressTimerRef.current) clearTimeout(pressTimerRef.current);
    pressTimerRef.current = setTimeout(() => {
      pressTimerRef.current = null;
      peekingRef.current = true;
      onPeekColor(index);
      window.Telegram?.WebApp?.HapticFeedback?.impactOccurred?.('light');
    }, LONG_PRESS_MS);
  }

  return (
    <div className="palette" role="radiogroup" aria-label="Палитра цветов">
      {colorInfo.map((info) => (
        <button
          key={info.index}
          className={`color-swatch ${selectedColor === info.index ? 'selected' : ''} ${info.completed ? 'completed' : ''}`}
          role="radio"
          aria-checked={selectedColor === info.index}
          aria-label={formatPaletteState({
            index: info.index,
            remaining: info.remaining,
            selected: selectedColor === info.index,
            completed: info.completed,
            disabled,
          })}
          data-state={disabled ? 'disabled' : info.completed ? 'completed' : selectedColor === info.index ? 'selected' : 'available'}
          onClick={() => {
            if (disabled) return;
            if (suppressClickRef.current) {
              suppressClickRef.current = false;
              return;
            }
            onSelectColor(info.index);
            window.Telegram?.WebApp?.HapticFeedback?.selectionChanged?.();
          }}
          onPointerDown={() => handlePressStart(info.index)}
          onPointerUp={cancelPress}
          onPointerLeave={cancelPress}
          onPointerCancel={cancelPress}
          onContextMenu={(event) => event.preventDefault()}
          disabled={disabled}
          title={`Цвет ${info.index + 1}`}
        >
          <i style={{ background: info.color }} />
          <span>{info.index + 1}</span>
          <small>{info.remaining}</small>
        </button>
      ))}
    </div>
  );
}
