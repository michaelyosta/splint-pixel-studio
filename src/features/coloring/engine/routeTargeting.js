const BASE_CELL = 32;

export function buildTargetId(template, windowObj, routingColor) {
  const color = routingColor != null ? routingColor : (windowObj.color ?? -1);
  const cells = windowObj.workCells || windowObj.cells || [];
  const sorted = [...cells].sort((a, b) => a - b);
  const templateId = template?.id ?? 'template';
  const version = template?.version ?? template?.updatedAt ?? '1';
  // A deterministic string is deliberate: every cell participates, avoiding
  // collisions between visually similar windows.
  return `target:${templateId}:${version}:${color}:${sorted.join(',')}`;
}

export function createActiveTarget(template, candidate, color, filled, viewport) {
  if (!template || !candidate || color == null) return { ok: false, reason: 'invalid_candidate' };
  const source = candidate.cells || candidate.workCells || [];
  const workCells = [...new Set(source)]
    .filter((index) => Number.isInteger(index) && index >= 0 && index < template.cells.length)
    .filter((index) => template.cells[index] === color && filled[index] === -1)
    .sort((a, b) => a - b);
  if (!workCells.length) return { ok: false, reason: 'empty_target' };
  const target = Object.freeze({
    id: buildTargetId(template, { workCells, color }, color),
    templateId: template.id,
    templateVersion: template.version ?? template.updatedAt ?? '1',
    color,
    workCells: Object.freeze(workCells),
    status: 'active',
    createdForViewport: Object.freeze({
      width: viewport.width,
      height: viewport.height,
      safeArea: Object.freeze({ ...viewport.safeArea }),
    }),
  });
  return { ok: true, target };
}

export function computeVisibleUnfilledCount(target, camera, template, filled, viewWidth, viewHeight, safeArea) {
  if (!target || !camera || !template) return 0;
  const zoom = camera.zoom || 1;
  const left = (safeArea?.left || 0);
  const top = (safeArea?.top || 0);
  const right = viewWidth - (safeArea?.right || 0);
  const bottom = viewHeight - (safeArea?.bottom || 0);

  let count = 0;
  for (const idx of target.workCells || target.cells || []) {
    if (filled[idx] !== -1) continue;
    const cellX = (idx % template.width) * BASE_CELL;
    const cellY = Math.floor(idx / template.width) * BASE_CELL;
    const cellLeft = camera.x + cellX * zoom;
    const cellTop = camera.y + cellY * zoom;
    const cellRight = cellLeft + BASE_CELL * zoom;
    const cellBottom = cellTop + BASE_CELL * zoom;
    if (cellLeft >= left && cellRight <= right && cellTop >= top && cellBottom <= bottom) {
      count++;
    }
  }
  return count;
}

// This is deliberately pure so the session can prove that it is safe to reveal
// the canvas before changing any UI state.
export function ensureActionableViewport({ activeTarget, progress, camera, viewport, safeArea, template }) {
  if (!activeTarget) return { actionable: false, reason: 'no_active_target' };
  const cells = activeTarget.workCells || [];
  if (!cells.length) return { actionable: false, reason: 'target_empty' };
  const filled = progress?.filled || progress;
  if (!filled || cells.every((index) => filled[index] !== -1)) return { actionable: false, reason: 'target_already_complete' };
  if (!camera || !Number.isFinite(camera.x) || !Number.isFinite(camera.y) || !Number.isFinite(camera.zoom) || camera.zoom <= 0) return { actionable: false, reason: 'camera_not_ready' };
  if (!viewport?.width || !viewport?.height) return { actionable: false, reason: 'invalid_viewport' };
  const sa = normalizeSafeArea(safeArea, viewport.width, viewport.height);
  if (viewport.width - sa.left - sa.right < 1 || viewport.height - sa.top - sa.bottom < 1) return { actionable: false, reason: 'invalid_safe_area' };
  const visibleUnfilledCells = computeVisibleUnfilledCount(activeTarget, camera, template, filled, viewport.width, viewport.height, sa);
  if (!visibleUnfilledCells) return { actionable: false, reason: 'no_visible_work_cells' };
  const remainingTargetCells = cells.filter((index) => filled[index] === -1).length;
  const allTargetCellsVisible = visibleUnfilledCells === remainingTargetCells;
  if (!allTargetCellsVisible) {
    return { actionable: false, reason: 'partial_target_visibility', visibleUnfilledCells, allTargetCellsVisible };
  }
  return { actionable: true, visibleUnfilledCells, allTargetCellsVisible: true };
}

function chooseCandidate(template, filled, routingColor, candidates, blockedIds, currentCenter) {
  let best = null;
  let bestScore = -Infinity;
  for (const candidate of candidates || []) {
    const id = buildTargetId(template, candidate, routingColor);
    if (blockedIds.has(id)) continue;
    const remaining = (candidate.cells || candidate.workCells || [])
      .reduce((count, index) => count + (filled[index] === -1 ? 1 : 0), 0);
    if (!remaining) continue;
    const dx = candidate.centerX - (currentCenter?.x || 0);
    const dy = candidate.centerY - (currentCenter?.y || 0);
    const score = -Math.hypot(dx, dy) * 0.5 + remaining * 0.1 + (candidate.cellCount || remaining) * 0.005;
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }
  return best;
}

export function resolveColorTransition({
  template,
  filled,
  currentColor,
  requestedColor,
  requestedCandidates = [],
  fallbackColor = null,
  fallbackCandidates = [],
  currentCenter,
}) {
  if (!template || !filled || !Number.isInteger(requestedColor)) {
    return { type: 'error', reason: 'invalid_color_transition' };
  }
  if (!filled.some((color) => color === -1)) return { type: 'artwork_complete' };
  if (requestedColor === currentColor) return { type: 'unchanged', color: currentColor };

  let target = chooseCandidate(
    template, filled, requestedColor, requestedCandidates, new Set(), currentCenter,
  );
  if (target) return { type: 'color_changed', color: requestedColor, target };

  if (fallbackColor != null && fallbackColor !== requestedColor) {
    target = chooseCandidate(
      template, filled, fallbackColor, fallbackCandidates, new Set(), currentCenter,
    );
    if (target) {
      return {
        type: 'color_changed',
        color: fallbackColor,
        target,
        requestedColorComplete: true,
      };
    }
  }

  return { type: 'color_complete', color: requestedColor };
}

export function resolveNextOutcome({
  template,
  filled,
  routingColor,
  candidates,
  currentTargetId,
  visitedTargetIds = [],
  currentCenter,
  nextColor,
  nextColorCandidates = [],
}) {
  if (!template || !filled) return { type: 'error', reason: 'invalid_route_input' };
  if (!filled.some((color) => color === -1)) return { type: 'artwork_complete' };

  const blocked = new Set(visitedTargetIds);
  if (currentTargetId) blocked.add(currentTargetId);
  let target = chooseCandidate(template, filled, routingColor, candidates, blocked, currentCenter);
  if (target) return { type: 'target_changed', target, resetVisited: false };

  const currentOnly = new Set(currentTargetId ? [currentTargetId] : []);
  target = chooseCandidate(template, filled, routingColor, candidates, currentOnly, currentCenter);
  if (target) return { type: 'target_changed', target, resetVisited: true };

  if (nextColor != null && nextColor !== routingColor) {
    target = chooseCandidate(template, filled, nextColor, nextColorCandidates, new Set(), currentCenter);
    if (target) return { type: 'color_changed', color: nextColor, target };
  }

  const lastCell = filled.findIndex((paint, index) =>
    paint === -1 && (routingColor == null || template.cells[index] === routingColor));
  if (lastCell >= 0) {
    const x = lastCell % template.width;
    const y = Math.floor(lastCell / template.width);
    return {
      type: 'last_cell',
      target: {
        cells: [lastCell],
        centerX: x + 0.5,
        centerY: y + 0.5,
        zoom: 1,
        cellCount: 1,
        bounds: { minX: x, maxX: x, minY: y, maxY: y, width: 1, height: 1 },
      },
    };
  }

  return { type: 'error', reason: 'no_actionable_outcome' };
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

export function isTargetConsideredDone(target, camera, template, filled, _viewWidth, _viewHeight, _safeArea) {
  if (!target || !template) return false;
  const cells = target.workCells || target.cells || [];
  return cells.length > 0 && cells.every((index) => filled[index] !== -1);
}

export function normalizeSafeArea(sa, viewWidth, viewHeight) {
  const MIN_USABLE = BASE_CELL;

  let top = Number.isFinite(sa?.top) ? Math.max(0, sa.top) : 0;
  let right = Number.isFinite(sa?.right) ? Math.max(0, sa.right) : 0;
  let bottom = Number.isFinite(sa?.bottom) ? Math.max(0, sa.bottom) : 0;
  let left = Number.isFinite(sa?.left) ? Math.max(0, sa.left) : 0;

  top = Math.max(0, Math.min(top, viewHeight - MIN_USABLE, viewHeight));
  right = Math.max(0, Math.min(right, viewWidth - MIN_USABLE, viewWidth));
  bottom = Math.max(0, Math.min(bottom, viewHeight - MIN_USABLE, viewHeight));
  left = Math.max(0, Math.min(left, viewWidth - MIN_USABLE, viewWidth));

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
