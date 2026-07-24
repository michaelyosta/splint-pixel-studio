const BASE_CELL = 32;

export function planCamera(target, viewWidth, viewHeight, templateWidth, templateHeight, safeArea = null) {
  const zoom = target.zoom || 1;
  const totalW = templateWidth * BASE_CELL * zoom;
  const totalH = templateHeight * BASE_CELL * zoom;

  let x = viewWidth / 2 - target.centerX * BASE_CELL * zoom;
  let y = viewHeight / 2 - target.centerY * BASE_CELL * zoom;

  let minX = viewWidth - totalW;
  let minY = viewHeight - totalH;
  let maxX = 0;
  let maxY = 0;

  if (safeArea) {
    const left = safeArea.left || 0;
    const top = safeArea.top || 0;
    const right = safeArea.right || 0;
    const bottom = safeArea.bottom || 0;
    minX = Math.max(viewWidth - totalW, left + right < viewWidth ? left : 0);
    minY = Math.max(viewHeight - totalH, top + bottom < viewHeight ? top : 0);
    maxX = Math.min(0, viewWidth - right);
    maxY = Math.min(0, viewHeight - bottom);
  }

  x = Math.min(maxX, Math.max(minX, x));
  y = Math.min(maxY, Math.max(minY, y));
  return { x, y, zoom };
}

export function clampCamera(camera, viewWidth, viewHeight, templateWidth, templateHeight) {
  const zoom = Math.min(4, Math.max(0.25, camera.zoom));
  const totalW = templateWidth * BASE_CELL * zoom;
  const totalH = templateHeight * BASE_CELL * zoom;
  let x = camera.x;
  let y = camera.y;
  if (totalW <= viewWidth) {
    x = (viewWidth - totalW) / 2;
  } else {
    x = Math.min(0, Math.max(viewWidth - totalW, x));
  }
  if (totalH <= viewHeight) {
    y = (viewHeight - totalH) / 2;
  } else {
    y = Math.min(0, Math.max(viewHeight - totalH, y));
  }
  return { x, y, zoom };
}

export function computeInitialCamera(template, viewWidth, viewHeight, safeArea = null) {
  const availW = safeArea ? viewWidth - (safeArea.left || 0) - (safeArea.right || 0) : viewWidth;
  const availH = safeArea ? viewHeight - (safeArea.top || 0) - (safeArea.bottom || 0) : viewHeight;
  const zoomX = availW / (template.width * BASE_CELL);
  const zoomY = availH / (template.height * BASE_CELL);
  const zoom = Math.min(zoomX, zoomY, 1);
  const totalW = template.width * BASE_CELL * zoom;
  const totalH = template.height * BASE_CELL * zoom;
  return {
    x: (viewWidth - totalW) / 2,
    y: (viewHeight - totalH) / 2,
    zoom,
  };
}

export function getTransitionDuration(distance, reducedMotion) {
  if (reducedMotion) return 1;
  if (distance < 5) return 180;
  if (distance < 15) return 280;
  return 400;
}

export function isTargetVisible(target, camera, safeArea, viewWidth, viewHeight) {
  if (!target || !camera) return false;
  const zoom = camera.zoom || 1;
  const left = (safeArea?.left || 0);
  const top = (safeArea?.top || 0);
  const right = viewWidth - (safeArea?.right || 0);
  const bottom = viewHeight - (safeArea?.bottom || 0);
  const cx = target.centerX * BASE_CELL * zoom + camera.x;
  const cy = target.centerY * BASE_CELL * zoom + camera.y;
  return cx >= left && cx <= right && cy >= top && cy <= bottom;
}
