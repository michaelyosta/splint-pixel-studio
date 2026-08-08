export const MANUAL_GRID_SIZES = Object.freeze([16, 24, 32, 40, 48, 64]);
export const MANUAL_HISTORY_LIMIT = 40;

export const DEFAULT_MANUAL_PALETTE = Object.freeze([
  '#0F172A',
  '#F8FAFC',
  '#38BDF8',
  '#A78BFA',
  '#FB7185',
  '#FBBF24',
  '#34D399',
  '#FB923C',
]);

export function getManualGridSize(value, fallback = 32) {
  const requested = Number(value);
  if (MANUAL_GRID_SIZES.includes(requested)) return requested;
  return MANUAL_GRID_SIZES.includes(fallback) ? fallback : MANUAL_GRID_SIZES[0];
}

export function createBlankCells(width, height, fillIndex = 0) {
  return Array(Math.max(1, Number(width) * Number(height))).fill(fillIndex);
}

export function resizePixelCells(cells, sourceWidth, sourceHeight, targetWidth, targetHeight) {
  const source = Array.isArray(cells) && cells.length === sourceWidth * sourceHeight
    ? cells
    : createBlankCells(sourceWidth, sourceHeight);
  const next = new Array(targetWidth * targetHeight);

  for (let y = 0; y < targetHeight; y += 1) {
    const sourceY = Math.min(sourceHeight - 1, Math.floor((y * sourceHeight) / targetHeight));
    for (let x = 0; x < targetWidth; x += 1) {
      const sourceX = Math.min(sourceWidth - 1, Math.floor((x * sourceWidth) / targetWidth));
      next[y * targetWidth + x] = source[sourceY * sourceWidth + sourceX];
    }
  }

  return next;
}

export function removePaletteColor(cells, palette, indexToRemove) {
  if (!Array.isArray(palette) || palette.length <= 2 || indexToRemove <= 0 || indexToRemove >= palette.length) {
    return { cells: [...cells], palette: [...palette], removed: false };
  }

  const nextPalette = palette.filter((_, index) => index !== indexToRemove);
  const nextCells = cells.map((colorIndex) => {
    if (colorIndex === indexToRemove) return 0;
    return colorIndex > indexToRemove ? colorIndex - 1 : colorIndex;
  });

  return { cells: nextCells, palette: nextPalette, removed: true };
}

export function cloneManualDraft(draft) {
  return {
    width: draft.width,
    height: draft.height,
    palette: [...draft.palette],
    cells: [...draft.cells],
  };
}

export function buildManualDraft({ width = 32, height = width, palette = DEFAULT_MANUAL_PALETTE, cells } = {}) {
  const safeWidth = getManualGridSize(width);
  const safeHeight = getManualGridSize(height, safeWidth);
  const safePalette = Array.isArray(palette) && palette.length >= 2
    ? palette.map((color) => String(color).toUpperCase())
    : [...DEFAULT_MANUAL_PALETTE];
  const expectedLength = safeWidth * safeHeight;
  const safeCells = Array.isArray(cells) && cells.length === expectedLength
    && cells.every((color) => Number.isInteger(color) && color >= 0 && color < safePalette.length)
    ? [...cells]
    : createBlankCells(safeWidth, safeHeight);

  return { width: safeWidth, height: safeHeight, palette: safePalette, cells: safeCells };
}
