const DEFAULT_CELL_SIZE = 32;

function numeric(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function readBound(bounds, snake, camel) {
  return numeric(bounds?.[snake] ?? bounds?.[camel]);
}

/**
 * Convert guidance bounds into a safe, integer cell rectangle.
 *
 * Guidance comes from the server and has historically used snake_case,
 * while resume snapshots use camelCase. Keeping this normalisation at the
 * ceremony boundary makes the visual layer tolerant without changing the
 * authoritative progress contract.
 */
export function normalizeRevealBounds(bounds, gridWidth, gridHeight) {
  const width = Math.floor(numeric(gridWidth) ?? 0);
  const height = Math.floor(numeric(gridHeight) ?? 0);
  if (!bounds || width < 1 || height < 1) return null;

  const rawMinX = readBound(bounds, 'min_x', 'minX');
  const rawMinY = readBound(bounds, 'min_y', 'minY');
  const rawMaxX = readBound(bounds, 'max_x', 'maxX');
  const rawMaxY = readBound(bounds, 'max_y', 'maxY');
  if ([rawMinX, rawMinY, rawMaxX, rawMaxY].some((value) => value == null)) return null;

  const minX = Math.max(0, Math.min(width - 1, Math.floor(rawMinX)));
  const minY = Math.max(0, Math.min(height - 1, Math.floor(rawMinY)));
  const maxX = Math.max(0, Math.min(width - 1, Math.floor(rawMaxX)));
  const maxY = Math.max(0, Math.min(height - 1, Math.floor(rawMaxY)));
  if (maxX < minX || maxY < minY) return null;
  return { min_x: minX, min_y: minY, max_x: maxX, max_y: maxY };
}

/**
 * Map a cell rectangle to the viewport's CSS coordinate space. The helper is
 * deliberately pure so it can be checked without a browser or a canvas.
 */
export function revealBoundsToScreen(bounds, camera, cellSize = DEFAULT_CELL_SIZE) {
  if (!bounds || !camera) return null;
  const zoom = numeric(camera.zoom);
  const originX = numeric(camera.x);
  const originY = numeric(camera.y);
  const size = numeric(cellSize);
  if (zoom == null || originX == null || originY == null || size == null || zoom <= 0 || size <= 0) {
    return null;
  }
  const left = originX + bounds.min_x * size * zoom;
  const top = originY + bounds.min_y * size * zoom;
  const width = (bounds.max_x - bounds.min_x + 1) * size * zoom;
  const height = (bounds.max_y - bounds.min_y + 1) * size * zoom;
  if ([left, top, width, height].some((value) => !Number.isFinite(value) || value <= 0)) return null;
  return { left, top, width, height };
}

export function revealCeremonyCopy(kind = 'fragment') {
  if (kind === 'artwork') {
    return {
      label: 'Картина раскрыта',
      detail: 'Последний слой проявился твоим жестом',
    };
  }
  if (kind === 'special') {
    return {
      label: 'Фрагмент разрешён',
      detail: 'Картина ответила на твоё действие',
    };
  }
  return {
    label: 'Фрагмент раскрыт',
    detail: 'Этот участок проявился твоим жестом',
  };
}

export function revealCeremonyDuration(kind = 'fragment', reducedMotion = false) {
  if (reducedMotion) return kind === 'artwork' ? 1_600 : 900;
  return kind === 'artwork' ? 2_800 : 1_450;
}

