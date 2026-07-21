const BASE_CELL = 32;

export function planCamera(target, viewWidth, viewHeight, templateWidth, templateHeight) {
  const zoom = target.zoom || 1;
  const totalW = templateWidth * BASE_CELL * zoom;
  const totalH = templateHeight * BASE_CELL * zoom;
  let x = viewWidth / 2 - target.centerX * BASE_CELL * zoom;
  let y = viewHeight / 2 - target.centerY * BASE_CELL * zoom;
  x = Math.min(0, Math.max(viewWidth - totalW, x));
  y = Math.min(0, Math.max(viewHeight - totalH, y));
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

export function getTransitionDuration(distance, reducedMotion) {
  if (reducedMotion) return 1;
  if (distance < 5) return 180;
  if (distance < 15) return 280;
  return 400;
}
