const BASE_CELL = 32;

export function buildTargetId(template, windowObj, routingColor) {
  const color = routingColor != null ? routingColor : -1;
  const sorted = [...windowObj.cells].sort((a, b) => a - b);
  let h = color;
  h = ((h << 5) - h) + sorted.length;
  h = ((h << 5) - h) + windowObj.bounds.minX;
  h = ((h << 5) - h) + windowObj.bounds.minY;
  h = ((h << 5) - h) + windowObj.bounds.maxX;
  h = ((h << 5) - h) + windowObj.bounds.maxY;
  for (let i = 0; i < Math.min(sorted.length, 8); i++) {
    h = ((h << 5) - h) + sorted[i];
  }
  if (sorted.length > 8) {
    h = ((h << 5) - h) + sorted[sorted.length - 1];
  }
  return `tgt_${color}_${Math.abs(h).toString(36)}`;
}

export function computeVisibleUnfilledCount(target, camera, template, filled, viewWidth, viewHeight, safeArea) {
  if (!target || !camera || !template) return 0;
  const zoom = camera.zoom || 1;
  const left = (safeArea?.left || 0);
  const top = (safeArea?.top || 0);
  const right = viewWidth - (safeArea?.right || 0);
  const bottom = viewHeight - (safeArea?.bottom || 0);

  let count = 0;
  for (const idx of target.cells) {
    if (filled[idx] !== -1) continue;
    const cx = (idx % template.width) * BASE_CELL + BASE_CELL / 2;
    const cy = Math.floor(idx / template.width) * BASE_CELL + BASE_CELL / 2;
    const sx = camera.x + cx * zoom;
    const sy = camera.y + cy * zoom;
    if (sx >= left && sx <= right && sy >= top && sy <= bottom) {
      count++;
    }
  }
  return count;
}

export function computeViewportCellBounds(camera, viewWidth, viewHeight, safeArea, templateWidth, templateHeight) {
  const zoom = camera.zoom || 1;
  const left = (safeArea?.left || 0);
  const top = (safeArea?.top || 0);
  const right = viewWidth - (safeArea?.right || 0);
  const bottom = viewHeight - (safeArea?.bottom || 0);

  const minCellX = Math.max(0, Math.floor((left - camera.x) / (BASE_CELL * zoom)));
  const minCellY = Math.max(0, Math.floor((top - camera.y) / (BASE_CELL * zoom)));
  const maxCellX = Math.min(templateWidth - 1, Math.floor((right - camera.x) / (BASE_CELL * zoom)));
  const maxCellY = Math.min(templateHeight - 1, Math.floor((bottom - camera.y) / (BASE_CELL * zoom)));

  return { minCellX, minCellY, maxCellX, maxCellY, cellsVisible: (maxCellX - minCellX + 1) * (maxCellY - minCellY + 1) };
}

export function isTargetConsideredDone(target, camera, template, filled, viewWidth, viewHeight, safeArea) {
  if (!target || !template) return false;
  const activeVisible = computeVisibleUnfilledCount(target, camera, template, filled, viewWidth, viewHeight, safeArea);
  if (activeVisible === 0) return true;
  const totalUnfilled = target.cells.reduce((c, idx) => c + (filled[idx] === -1 ? 1 : 0), 0);
  if (totalUnfilled === 0) return true;
  return false;
}

export function normalizeSafeArea(sa, viewWidth, viewHeight) {
  const MIN_USABLE = 120;

  let top = Number.isFinite(sa?.top) ? Math.max(0, sa.top) : 0;
  let right = Number.isFinite(sa?.right) ? Math.max(0, sa.right) : 0;
  let bottom = Number.isFinite(sa?.bottom) ? Math.max(0, sa.bottom) : 0;
  let left = Number.isFinite(sa?.left) ? Math.max(0, sa.left) : 0;

  top = Math.min(top, viewHeight - MIN_USABLE, viewHeight);
  right = Math.min(right, viewWidth - MIN_USABLE, viewWidth);
  bottom = Math.min(bottom, viewHeight - MIN_USABLE, viewHeight);
  left = Math.min(left, viewWidth - MIN_USABLE, viewWidth);

  const usableW = viewWidth - left - right;
  const usableH = viewHeight - top - bottom;

  if (usableW < MIN_USABLE || usableH < MIN_USABLE) {
    if (typeof globalThis !== 'undefined' && globalThis.process?.env?.NODE_ENV !== 'production') {
      console.warn(
        `[safeArea] Usable viewport too small (${usableW.toFixed(0)}x${usableH.toFixed(0)}). ` +
        `Falling back to zero insets. Raw: T${sa?.top?.toFixed?.(1) || sa?.top} R${sa?.right?.toFixed?.(1) || sa?.right} B${sa?.bottom?.toFixed?.(1) || sa?.bottom} L${sa?.left?.toFixed?.(1) || sa?.left}`
      );
    }
    return { top: 0, right: 0, bottom: 0, left: 0 };
  }

  return { top, right, bottom, left };
}

export function computeUsableViewport(viewWidth, viewHeight, safeArea) {
  const sa = normalizeSafeArea(safeArea, viewWidth, viewHeight);
  return {
    width: viewWidth - sa.left - sa.right,
    height: viewHeight - sa.top - sa.bottom,
    left: sa.left,
    top: sa.top,
    right: viewWidth - sa.right,
    bottom: viewHeight - sa.bottom,
  };
}
