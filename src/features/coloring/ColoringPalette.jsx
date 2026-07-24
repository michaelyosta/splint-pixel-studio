import { useMemo } from 'react';

export default function ColoringPalette({ template, filled, selectedColor, onSelectColor, disabled }) {
  const colorInfo = useMemo(() => {
    if (!template) return [];
    return template.palette.map((color, index) => {
      const remaining = template.cells.reduce((count, target, ci) =>
        count + (target === index && filled[ci] === -1 ? 1 : 0), 0);
      return { color, index, remaining, completed: remaining === 0 };
    });
  }, [template, filled]);

  return (
    <div className="palette" aria-label="Палитра цветов">
      {colorInfo.map((info) => (
        <button
          key={info.index}
          className={`color-swatch ${selectedColor === info.index ? 'selected' : ''} ${info.completed ? 'completed' : ''}`}
          onClick={() => {
            if (disabled) return;
            onSelectColor(info.index);
            window.Telegram?.WebApp?.HapticFeedback?.selectionChanged?.();
          }}
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
