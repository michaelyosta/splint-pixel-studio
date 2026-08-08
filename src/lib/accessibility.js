/**
 * Client accessibility helpers shared by the classic and tiled coloring
 * sessions. These stay pure and bounded: they never create per-cell DOM and
 * only produce text that can be throttled before it reaches a live region.
 */

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function moveKeyboardCursor(current, key, { width, height, pageSize = 8 } = {}) {
  if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0) {
    throw new RangeError('Keyboard cursor requires a positive grid size');
  }
  const maxIndex = width * height - 1;
  const safe = clamp(Number.isInteger(current) ? current : 0, 0, maxIndex);
  if (key === 'Home') return 0;
  if (key === 'End') return maxIndex;
  if (key === 'PageUp' || key === 'PageDown') {
    const row = clamp(Math.floor(safe / width) + (key === 'PageUp' ? -pageSize : pageSize), 0, height - 1);
    return row * width + (safe % width);
  }
  let x = safe % width;
  let y = Math.floor(safe / width);
  switch (key) {
    case 'ArrowLeft': x = Math.max(0, x - 1); break;
    case 'ArrowRight': x = Math.min(width - 1, x + 1); break;
    case 'ArrowUp': y = Math.max(0, y - 1); break;
    case 'ArrowDown': y = Math.min(height - 1, y + 1); break;
    default: return safe;
  }
  return y * width + x;
}

export function formatPaletteState({ index, remaining = 0, selected = false, completed = false, disabled = false } = {}) {
  const number = Number(index) + 1;
  if (disabled) return `Цвет ${number}, заблокирован`;
  if (completed && selected) return `Цвет ${number}, выбран, готово`;
  if (completed) return `Цвет ${number}, готово`;
  if (selected) return `Цвет ${number}, выбран, осталось ${remaining}`;
  return `Цвет ${number}, осталось ${remaining}`;
}

export function hexToRgb(hex) {
  const value = String(hex || '').trim();
  const match = /^#?([\da-f]{6})$/i.exec(value) || /^#?([\da-f]{3})$/i.exec(value);
  if (!match) return null;
  if (match[1].length === 3) {
    return {
      r: parseInt(match[1][0] + match[1][0], 16),
      g: parseInt(match[1][1] + match[1][1], 16),
      b: parseInt(match[1][2] + match[1][2], 16),
    };
  }
  return {
    r: parseInt(match[1].slice(0, 2), 16),
    g: parseInt(match[1].slice(2, 4), 16),
    b: parseInt(match[1].slice(4, 6), 16),
  };
}

function channelLuminance(channel) {
  const value = channel / 255;
  return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance(hex) {
  const rgb = hexToRgb(hex);
  if (!rgb) return null;
  return 0.2126 * channelLuminance(rgb.r) + 0.7152 * channelLuminance(rgb.g) + 0.0722 * channelLuminance(rgb.b);
}

export function contrastRatio(first, second) {
  const firstLuminance = relativeLuminance(first);
  const secondLuminance = relativeLuminance(second);
  if (firstLuminance == null || secondLuminance == null) return null;
  const lighter = Math.max(firstLuminance, secondLuminance);
  const darker = Math.min(firstLuminance, secondLuminance);
  return (lighter + 0.05) / (darker + 0.05);
}

export function isReadablePair(foreground, background, minimum = 4.5) {
  const ratio = contrastRatio(foreground, background);
  return ratio != null && ratio >= minimum;
}

/**
 * Debounces and de-duplicates announcements so rapid painting cannot turn
 * into a per-cell live-region spam. Identical text is suppressed for
 * `minIntervalMs`; distinct text is coalesced by `debounceMs`.
 */
export function createBoundedAnnouncer({
  onAnnounce,
  debounceMs = 120,
  minIntervalMs = 700,
} = {}) {
  if (typeof onAnnounce !== 'function') {
    throw new TypeError('createBoundedAnnouncer requires an onAnnounce callback');
  }
  let timer = null;
  let pending = null;
  let lastText = null;
  let lastAt = -Infinity;

  function deliver(text) {
    const value = String(text || '').trim();
    if (!value) return;
    const now = Date.now();
    if (value === lastText && now - lastAt < minIntervalMs) return;
    lastText = value;
    lastAt = now;
    onAnnounce(value);
  }

  return {
    announce(text) {
      const value = String(text || '').trim();
      if (!value) return;
      if (timer) clearTimeout(timer);
      pending = value;
      timer = setTimeout(() => {
        timer = null;
        deliver(pending);
        pending = null;
      }, debounceMs);
    },
    flush() {
      if (timer) clearTimeout(timer);
      timer = null;
      if (pending != null) {
        const value = pending;
        pending = null;
        deliver(value);
      }
    },
    destroy() {
      if (timer) clearTimeout(timer);
      timer = null;
      pending = null;
    },
    getLastAnnouncement: () => lastText,
  };
}
